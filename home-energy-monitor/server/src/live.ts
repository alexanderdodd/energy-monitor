import { log } from "./logger.ts";
import type { ApplianceService, LiveSnapshot } from "./appliances/service.ts";
import type { HaSource } from "./ha/types.ts";

/** Smallest gap between two pushes, so a burst of changes sends one update. */
const THROTTLE_MS = 1_000;
/** Keeps proxies from closing an idle stream. */
const HEARTBEAT_MS = 25_000;

export type LiveClient = (event: string, data: unknown) => void;

/**
 * Fans Home Assistant state changes out to connected browsers.
 *
 * Only entities belonging to configured appliances trigger a push, and pushes
 * are throttled - a kettle switching on produces one update, not thirty.
 */
export class LiveBroadcaster {
  readonly #service: ApplianceService;
  readonly #source: HaSource;
  readonly #clients = new Set<LiveClient>();

  #unsubscribe: (() => void) | null = null;
  #flushTimer: NodeJS.Timeout | null = null;
  #heartbeatTimer: NodeJS.Timeout | null = null;
  #lastConnected: boolean | null = null;

  constructor(service: ApplianceService, source: HaSource) {
    this.#service = service;
    this.#source = source;
  }

  start(): void {
    this.#unsubscribe = this.#source.onStateChanged(({ entityId }) => {
      if (!this.#service.watchedEntityIds().has(entityId)) return;
      this.#scheduleFlush();
    });

    this.#heartbeatTimer = setInterval(() => {
      // A heartbeat doubles as a connection-status ping, so the UI notices
      // Home Assistant dropping out even while nothing is changing.
      const connected = this.#source.status().connected;
      if (connected !== this.#lastConnected) {
        this.#lastConnected = connected;
        this.#flush();
        return;
      }
      this.#broadcast("ping", { t: Date.now() });
    }, HEARTBEAT_MS);
    this.#heartbeatTimer.unref?.();
  }

  stop(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    if (this.#flushTimer) clearTimeout(this.#flushTimer);
    if (this.#heartbeatTimer) clearInterval(this.#heartbeatTimer);
    this.#flushTimer = null;
    this.#heartbeatTimer = null;
    this.#clients.clear();
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  /** Register a client and send it the current snapshot immediately. */
  addClient(client: LiveClient): () => void {
    this.#clients.add(client);
    try {
      client("state", this.snapshot());
    } catch (error) {
      log.debug(`Could not send the initial snapshot: ${(error as Error).message}`);
    }
    return () => this.#clients.delete(client);
  }

  snapshot(): LiveSnapshot {
    return this.#service.getLiveSnapshot();
  }

  #scheduleFlush(): void {
    if (this.#flushTimer) return;
    this.#flushTimer = setTimeout(() => {
      this.#flushTimer = null;
      this.#flush();
    }, THROTTLE_MS);
    this.#flushTimer.unref?.();
  }

  #flush(): void {
    if (this.#clients.size === 0) return;
    this.#broadcast("state", this.snapshot());
  }

  #broadcast(event: string, data: unknown): void {
    for (const client of this.#clients) {
      try {
        client(event, data);
      } catch (error) {
        // A failed write means the browser went away; its own close handler
        // removes it from the set.
        log.debug(`Dropping a live client: ${(error as Error).message}`);
      }
    }
  }
}
