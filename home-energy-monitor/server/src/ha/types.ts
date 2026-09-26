/** Wire types for the Home Assistant REST and WebSocket APIs. */

export interface HaState {
  entity_id: string;
  state: string;
  last_changed?: string;
  last_updated?: string;
  attributes: {
    friendly_name?: string;
    device_class?: string;
    state_class?: string;
    unit_of_measurement?: string;
    [key: string]: unknown;
  };
}

export interface EntityRegistryEntry {
  entity_id: string;
  device_id: string | null;
  area_id?: string | null;
  name?: string | null;
  original_name?: string | null;
  platform?: string;
  disabled_by?: string | null;
  hidden_by?: string | null;
  entity_category?: string | null;
}

export interface DeviceRegistryEntry {
  id: string;
  name: string | null;
  name_by_user?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  area_id?: string | null;
  disabled_by?: string | null;
}

/** A single point of recorded history: a timestamp and the raw state string. */
export interface HistoryPoint {
  /** Milliseconds since the epoch. */
  t: number;
  /** Raw Home Assistant state string ("unavailable" and friends included). */
  s: string;
}

/**
 * One long-term-statistics bucket.
 *
 * `mean` is used for power (W), `change` for energy consumed within the
 * bucket (kWh). Both are optional because Home Assistant only records the
 * ones that make sense for a given sensor's `state_class`.
 */
export interface StatisticsPoint {
  /** Bucket start, milliseconds since the epoch. */
  start: number;
  end: number;
  mean?: number | null;
  min?: number | null;
  max?: number | null;
  sum?: number | null;
  state?: number | null;
  change?: number | null;
}

export type StatisticsPeriod = "5minute" | "hour" | "day" | "week" | "month";

export interface StateChange {
  entityId: string;
  state: HaState | null;
}

export interface ConnectionStatus {
  connected: boolean;
  /** ISO timestamp of the last successful data exchange with Home Assistant. */
  lastUpdate: string | null;
  lastError: string | null;
}

/**
 * Everything the application needs from Home Assistant.
 *
 * Implemented twice: once against the Supervisor proxy, and once against an
 * in-process simulation used for development and tests.
 */
export interface HaSource {
  start(): Promise<void>;
  stop(): Promise<void>;

  /** All entity states, freshly fetched. */
  getStates(): Promise<HaState[]>;
  /** Cached state for a single entity; undefined if never seen. */
  getCachedState(entityId: string): HaState | undefined;

  listEntityRegistry(): Promise<EntityRegistryEntry[]>;
  listDeviceRegistry(): Promise<DeviceRegistryEntry[]>;

  getHistory(
    entityIds: string[],
    start: Date,
    end: Date,
  ): Promise<Record<string, HistoryPoint[]>>;

  getStatistics(
    statisticIds: string[],
    start: Date,
    end: Date,
    period: StatisticsPeriod,
  ): Promise<Record<string, StatisticsPoint[]>>;

  onStateChanged(listener: (change: StateChange) => void): () => void;

  status(): ConnectionStatus;
}
