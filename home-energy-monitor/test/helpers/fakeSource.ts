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
} from "../../server/src/ha/types.ts";

export interface FakeSourceOptions {
  states?: HaState[];
  entityRegistry?: EntityRegistryEntry[];
  deviceRegistry?: DeviceRegistryEntry[];
  history?: Record<string, HistoryPoint[]>;
  /** Used for any period without a more specific entry. */
  statistics?: Record<string, StatisticsPoint[]>;
  /**
   * Per-period statistics. Real Home Assistant returns quite different data
   * for "day" than for "5minute", and code now chooses between them, so the
   * fake has to tell them apart.
   */
  statisticsByPeriod?: Partial<Record<StatisticsPeriod, Record<string, StatisticsPoint[]>>>;
  status?: ConnectionStatus;
  /** Make every Home Assistant read fail, to exercise degraded behaviour. */
  failing?: boolean;
}

/** A scripted Home Assistant, for testing the API and service layers. */
export class FakeHaSource implements HaSource {
  readonly #listeners = new Set<(change: StateChange) => void>();
  readonly #cache = new Map<string, HaState>();
  options: FakeSourceOptions;

  constructor(options: FakeSourceOptions = {}) {
    this.options = options;
    for (const state of options.states ?? []) this.#cache.set(state.entity_id, state);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  #guard(): void {
    if (this.options.failing) throw new Error("Home Assistant is unreachable");
  }

  async getStates(): Promise<HaState[]> {
    this.#guard();
    return [...this.#cache.values()];
  }

  getCachedState(entityId: string): HaState | undefined {
    return this.#cache.get(entityId);
  }

  async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
    this.#guard();
    return this.options.entityRegistry ?? [];
  }

  async listDeviceRegistry(): Promise<DeviceRegistryEntry[]> {
    this.#guard();
    return this.options.deviceRegistry ?? [];
  }

  async getHistory(entityIds: string[]): Promise<Record<string, HistoryPoint[]>> {
    this.#guard();
    const history = this.options.history ?? {};
    return Object.fromEntries(entityIds.map((id) => [id, history[id] ?? []]));
  }

  async getStatistics(
    statisticIds: string[],
    _start: Date,
    _end: Date,
    period: StatisticsPeriod,
  ): Promise<Record<string, StatisticsPoint[]>> {
    const statistics = this.options.statisticsByPeriod?.[period] ?? this.options.statistics ?? {};
    const result: Record<string, StatisticsPoint[]> = {};
    for (const id of statisticIds) {
      if (statistics[id]) result[id] = statistics[id]!;
    }
    return result;
  }

  onStateChanged(listener: (change: StateChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  status(): ConnectionStatus {
    return (
      this.options.status ?? {
        connected: !this.options.failing,
        lastUpdate: "2026-09-26T12:00:00.000Z",
        lastError: this.options.failing ? "Home Assistant is unreachable" : null,
      }
    );
  }

  /** Test helper: push a new state, as Home Assistant would. */
  setState(entityId: string, state: string, attributes: HaState["attributes"] = {}): void {
    const next: HaState = { entity_id: entityId, state, attributes };
    this.#cache.set(entityId, next);
    for (const listener of this.#listeners) listener({ entityId, state: next });
  }
}
