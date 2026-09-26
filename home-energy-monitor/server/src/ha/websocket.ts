import WebSocket from "ws";
import { log } from "../logger.ts";
import type { HaState } from "./types.ts";

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

export interface HaWebSocketEvents {
  onStateChanged: (entityId: string, state: HaState | null) => void;
  onConnected: () => void;
  onDisconnected: (reason: string) => void;
}

const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const COMMAND_TIMEOUT_MS = 30_000;

/**
 * Long-lived connection to the Home Assistant WebSocket API.
 *
 * Handles the auth handshake, request/response correlation by message id,
 * the `state_changed` subscription, and reconnection with exponential
 * backoff. A dropped connection is never fatal - the app keeps serving the
 * last known values and reports itself as disconnected.
 */
export class HaWebSocketClient {
  readonly #url: string;
  readonly #token: string;
  readonly #events: HaWebSocketEvents;

  #socket: WebSocket | null = null;
  #nextId = 1;
  #pending = new Map<number, PendingCommand>();
  #authenticated = false;
  #stopped = false;
  #reconnectAttempts = 0;
  #reconnectTimer: NodeJS.Timeout | null = null;
  /** Resolves once the current connection has authenticated. */
  #ready: Promise<void> | null = null;
  #resolveReady: (() => void) | null = null;

  constructor(url: string, token: string, events: HaWebSocketEvents) {
    this.#url = url;
    this.#token = token;
    this.#events = events;
  }

  get authenticated(): boolean {
    return this.#authenticated;
  }

  start(): void {
    this.#stopped = false;
    this.#connect();
  }

  stop(): void {
    this.#stopped = true;
    if (this.#reconnectTimer) clearTimeout(this.#reconnectTimer);
    this.#reconnectTimer = null;
    this.#failPending(new Error("Home Assistant connection closed"));
    this.#socket?.close();
    this.#socket = null;
    this.#authenticated = false;
  }

  /** Wait until authenticated, or reject once `timeoutMs` elapses. */
  async waitUntilReady(timeoutMs = 15_000): Promise<void> {
    if (this.#authenticated) return;
    if (!this.#ready) {
      this.#ready = new Promise<void>((resolve) => {
        this.#resolveReady = resolve;
      });
    }
    await Promise.race([
      this.#ready,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Timed out waiting for Home Assistant")), timeoutMs),
      ),
    ]);
  }

  /** Send a command and resolve with its `result` payload. */
  async send<T>(message: Record<string, unknown>): Promise<T> {
    await this.waitUntilReady();
    const socket = this.#socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      throw new Error("Home Assistant WebSocket is not connected");
    }

    const id = this.#nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`Home Assistant command "${String(message.type)}" timed out`));
      }, COMMAND_TIMEOUT_MS);

      this.#pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });
      socket.send(JSON.stringify({ ...message, id }));
    });
  }

  #connect(): void {
    if (this.#stopped) return;

    log.debug("Connecting to the Home Assistant WebSocket API");
    const socket = new WebSocket(this.#url);
    this.#socket = socket;

    socket.on("message", (data) => this.#handleMessage(data.toString()));
    socket.on("error", (error: Error) => {
      // Never log the error object wholesale - it can echo request headers.
      log.warning(`Home Assistant WebSocket error: ${error.message}`);
    });
    socket.on("close", () => {
      const wasAuthenticated = this.#authenticated;
      this.#authenticated = false;
      this.#ready = null;
      this.#resolveReady = null;
      this.#failPending(new Error("Home Assistant connection lost"));
      if (wasAuthenticated) this.#events.onDisconnected("connection closed");
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect(): void {
    if (this.#stopped || this.#reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * 2 ** this.#reconnectAttempts,
      RECONNECT_MAX_MS,
    );
    this.#reconnectAttempts += 1;
    log.debug(`Reconnecting to Home Assistant in ${Math.round(delay / 1000)}s`);
    this.#reconnectTimer = setTimeout(() => {
      this.#reconnectTimer = null;
      this.#connect();
    }, delay);
  }

  #handleMessage(raw: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      log.warning("Ignoring malformed message from Home Assistant");
      return;
    }

    switch (message.type) {
      case "auth_required":
        this.#socket?.send(JSON.stringify({ type: "auth", access_token: this.#token }));
        return;

      case "auth_ok":
        this.#onAuthenticated();
        return;

      case "auth_invalid":
        // Do not log the message body; it may echo the token.
        log.error("Home Assistant rejected the Supervisor token");
        this.#socket?.close();
        return;

      case "result": {
        const pending = this.#pending.get(message.id as number);
        if (!pending) return;
        this.#pending.delete(message.id as number);
        clearTimeout(pending.timer);
        if (message.success === true) {
          pending.resolve(message.result);
        } else {
          const error = message.error as { message?: string } | undefined;
          pending.reject(new Error(error?.message ?? "Home Assistant command failed"));
        }
        return;
      }

      case "event": {
        const event = (message.event ?? {}) as {
          event_type?: string;
          data?: { entity_id?: string; new_state?: HaState | null };
        };
        if (event.event_type !== "state_changed" || !event.data?.entity_id) return;
        this.#events.onStateChanged(event.data.entity_id, event.data.new_state ?? null);
        return;
      }

      default:
        return;
    }
  }

  #onAuthenticated(): void {
    log.info("Connected to Home Assistant");
    this.#authenticated = true;
    this.#reconnectAttempts = 0;
    this.#resolveReady?.();
    this.#resolveReady = null;
    this.#ready = Promise.resolve();

    // Subscribe before announcing readiness so no state change is missed.
    this.send({ type: "subscribe_events", event_type: "state_changed" }).catch((error: Error) => {
      log.warning(`Could not subscribe to state changes: ${error.message}`);
    });

    this.#events.onConnected();
  }

  #failPending(error: Error): void {
    for (const pending of this.#pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.#pending.clear();
  }
}
