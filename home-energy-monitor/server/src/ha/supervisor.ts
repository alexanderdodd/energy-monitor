import { log } from "../logger.ts";
import { HaRestClient } from "./client.ts";
import { HaWebSocketClient } from "./websocket.ts";
import type {
  ConnectionStatus,
  DeviceRegistryEntry,
  EntityRegistryEntry,
  HaSource,
  HaState,
  HistoryPoint,
  StateChange,
  StatisticsPeriod,
  StatisticsPoint,
} from "./types.ts";

export const SUPERVISOR_REST_URL = "http://supervisor/core/api";
export const SUPERVISOR_WS_URL = "ws://supervisor/core/websocket";

/**
 * The real Home Assistant data source: REST for bulk reads and history,
 * WebSocket for the registries, long-term statistics and live updates.
 */
export class SupervisorHaSource implements HaSource {
  readonly #rest: HaRestClient;
  readonly #ws: HaWebSocketClient;
  readonly #cache = new Map<string, HaState>();
  readonly #listeners = new Set<(change: StateChange) => void>();

  #lastUpdate: string | null = null;
  #lastError: string | null = null;

  constructor(token: string, restUrl = SUPERVISOR_REST_URL, wsUrl = SUPERVISOR_WS_URL) {
    this.#rest = new HaRestClient(restUrl, token);
    this.#ws = new HaWebSocketClient(wsUrl, token, {
      onStateChanged: (entityId, state) => this.#handleStateChanged(entityId, state),
      onConnected: () => {
        this.#lastError = null;
        // Re-prime the cache: states may have moved on while we were away.
        void this.#primeCache();
      },
      onDisconnected: (reason) => {
        this.#lastError = `Home Assistant connection lost (${reason})`;
        log.warning(this.#lastError);
      },
    });
  }

  async start(): Promise<void> {
    this.#ws.start();
    try {
      await this.#ws.waitUntilReady();
    } catch (error) {
      // Not fatal: the app starts anyway and keeps retrying in the background.
      this.#lastError = (error as Error).message;
      log.warning(`Home Assistant not reachable yet: ${this.#lastError}`);
    }
  }

  async stop(): Promise<void> {
    this.#ws.stop();
  }

  async getStates(): Promise<HaState[]> {
    const states = await this.#rest.getStates();
    this.#cache.clear();
    for (const state of states) this.#cache.set(state.entity_id, state);
    this.#markUpdated();
    return states;
  }

  getCachedState(entityId: string): HaState | undefined {
    return this.#cache.get(entityId);
  }

  async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
    return this.#registry<EntityRegistryEntry>("config/entity_registry/list", "entity");
  }

  async listDeviceRegistry(): Promise<DeviceRegistryEntry[]> {
    return this.#registry<DeviceRegistryEntry>("config/device_registry/list", "device");
  }

  /**
   * Registry access needs an admin-level connection. If it is refused we fall
   * back to name-based grouping rather than failing discovery outright.
   */
  async #registry<T>(type: string, label: string): Promise<T[]> {
    try {
      const result = await this.#ws.send<T[]>({ type });
      this.#markUpdated();
      return result;
    } catch (error) {
      log.warning(
        `Could not read the Home Assistant ${label} registry: ${(error as Error).message}`,
      );
      return [];
    }
  }

  async getHistory(
    entityIds: string[],
    start: Date,
    end: Date,
  ): Promise<Record<string, HistoryPoint[]>> {
    const history = await this.#rest.getHistory(entityIds, start, end);
    this.#markUpdated();
    return history;
  }

  async getStatistics(
    statisticIds: string[],
    start: Date,
    end: Date,
    period: StatisticsPeriod,
  ): Promise<Record<string, StatisticsPoint[]>> {
    if (statisticIds.length === 0) return {};
    try {
      const result = await this.#ws.send<Record<string, StatisticsPoint[]>>({
        type: "recorder/statistics_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        statistic_ids: statisticIds,
        period,
        types: ["mean", "change", "state", "sum"],
      });
      this.#markUpdated();
      return result ?? {};
    } catch (error) {
      // Statistics are an optimisation; callers fall back to raw history.
      log.debug(`Statistics unavailable: ${(error as Error).message}`);
      return {};
    }
  }

  onStateChanged(listener: (change: StateChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  status(): ConnectionStatus {
    return {
      connected: this.#ws.authenticated,
      lastUpdate: this.#lastUpdate,
      lastError: this.#ws.authenticated ? null : this.#lastError,
    };
  }

  async #primeCache(): Promise<void> {
    try {
      await this.getStates();
    } catch (error) {
      log.warning(`Could not load Home Assistant states: ${(error as Error).message}`);
    }
  }

  #handleStateChanged(entityId: string, state: HaState | null): void {
    if (state) {
      this.#cache.set(entityId, state);
    } else {
      this.#cache.delete(entityId);
    }
    this.#markUpdated();
    for (const listener of this.#listeners) listener({ entityId, state });
  }

  #markUpdated(): void {
    this.#lastUpdate = new Date().toISOString();
  }
}
