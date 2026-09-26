import { log } from "../logger.ts";
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

interface MockProfile {
  deviceId: string;
  slug: string;
  name: string;
  model: string;
  /** Watts drawn at a given instant. Deterministic, so history, statistics
   *  and live values all tell the same story. */
  powerAt: (t: number) => number;
}

const PERIOD_MS: Record<StatisticsPeriod, number> = {
  "5minute": 300_000,
  hour: 3_600_000,
  day: 86_400_000,
  week: 7 * 86_400_000,
  month: 30 * 86_400_000,
};

/** Smooth, seeded jitter so the numbers move without jumping around. */
function wobble(t: number, seed: number, amplitude: number): number {
  return Math.sin(t / 37_000 + seed) * amplitude;
}

/** Local hour of day, as a fraction (13.5 === 13:30). */
function hourOfDay(t: number): number {
  const date = new Date(t);
  return date.getHours() + date.getMinutes() / 60;
}

function runsBetween(t: number, from: number, to: number): boolean {
  const hour = hourOfDay(t);
  return hour >= from && hour < to;
}

const PROFILES: MockProfile[] = [
  {
    deviceId: "mock-fridge",
    slug: "fridge",
    name: "Fridge",
    model: "S60TPF",
    // Compressor runs for 12 minutes out of every 40.
    powerAt: (t) => (t % 2_400_000 < 720_000 ? 43 + wobble(t, 1, 3) : 0.7),
  },
  {
    deviceId: "mock-dehumidifier",
    slug: "dehumidifier",
    name: "Dehumidifier",
    model: "S60TPF",
    powerAt: (t) => (runsBetween(t, 6, 22) ? 214 + wobble(t, 2, 9) : 0),
  },
  {
    deviceId: "mock-washing-machine",
    slug: "washing_machine",
    name: "Washing Machine",
    model: "S60TPF",
    // A wash between 09:00 and 10:30: heating element first, then tumbling.
    powerAt: (t) => {
      if (!runsBetween(t, 9, 10.5)) return 0;
      const hour = hourOfDay(t);
      if (hour < 9.4) return 1_900 + wobble(t, 3, 40);
      return 180 + wobble(t, 4, 60);
    },
  },
  {
    deviceId: "mock-air-fryer",
    slug: "air_fryer",
    name: "Air Fryer",
    model: "S60TPF",
    powerAt: (t) => (runsBetween(t, 18, 18.42) ? 1_850 + wobble(t, 5, 30) : 0),
  },
];

const VOLTAGE_AT = (t: number): number => 236 + wobble(t, 9, 1.5);

type Measurement = "power" | "current" | "voltage" | "energy" | "energy_day";

const MEASUREMENTS: Record<
  Measurement,
  { suffix: string; label: string; deviceClass: string; stateClass: string; unit: string; decimals: number }
> = {
  power: { suffix: "power", label: "Power", deviceClass: "power", stateClass: "measurement", unit: "W", decimals: 1 },
  current: { suffix: "current", label: "Current", deviceClass: "current", stateClass: "measurement", unit: "A", decimals: 2 },
  voltage: { suffix: "voltage", label: "Voltage", deviceClass: "voltage", stateClass: "measurement", unit: "V", decimals: 1 },
  energy: { suffix: "energy", label: "Energy", deviceClass: "energy", stateClass: "total_increasing", unit: "kWh", decimals: 3 },
  energy_day: { suffix: "energy_day", label: "Energy day", deviceClass: "energy", stateClass: "total", unit: "kWh", decimals: 3 },
};

function entityId(profile: MockProfile, measurement: Measurement): string {
  return `sensor.${profile.slug}_${MEASUREMENTS[measurement].suffix}`;
}

/**
 * An in-process stand-in for Home Assistant.
 *
 * Enabled with MOCK_HOME_ASSISTANT=true so the dashboard can be developed and
 * tested on a laptop. It models four smart plugs with deterministic power
 * curves, and serves history and statistics derived from the same curves.
 */
export class MockHaSource implements HaSource {
  readonly #listeners = new Set<(change: StateChange) => void>();
  readonly #cache = new Map<string, HaState>();
  #timer: NodeJS.Timeout | null = null;
  #lastUpdate: string | null = null;

  /** Entity ids forced to report "unavailable", for exercising the UI. */
  readonly unavailable = new Set<string>(
    (process.env.MOCK_UNAVAILABLE_ENTITIES ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );

  async start(): Promise<void> {
    log.info("Running against the mock Home Assistant (MOCK_HOME_ASSISTANT=true)");
    this.#refresh(Date.now());
    // Push updates often enough that live values visibly move in the browser.
    this.#timer = setInterval(() => this.#refresh(Date.now()), 3_000);
    this.#timer.unref?.();
  }

  async stop(): Promise<void> {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  async getStates(): Promise<HaState[]> {
    this.#refresh(Date.now());
    return [...this.#cache.values()];
  }

  getCachedState(id: string): HaState | undefined {
    return this.#cache.get(id);
  }

  async listEntityRegistry(): Promise<EntityRegistryEntry[]> {
    const entries: EntityRegistryEntry[] = [];
    for (const profile of PROFILES) {
      for (const measurement of Object.keys(MEASUREMENTS) as Measurement[]) {
        entries.push({
          entity_id: entityId(profile, measurement),
          device_id: profile.deviceId,
          original_name: MEASUREMENTS[measurement].label,
          platform: "mock",
          disabled_by: null,
          hidden_by: null,
        });
      }
    }
    return entries;
  }

  async listDeviceRegistry(): Promise<DeviceRegistryEntry[]> {
    return PROFILES.map((profile) => ({
      id: profile.deviceId,
      name: profile.name,
      name_by_user: null,
      manufacturer: "SONOFF",
      model: profile.model,
      disabled_by: null,
    }));
  }

  async getHistory(
    entityIds: string[],
    start: Date,
    end: Date,
  ): Promise<Record<string, HistoryPoint[]>> {
    const from = start.getTime();
    const to = end.getTime();
    // Cap the series length the way the real recorder effectively does.
    const step = Math.max(30_000, Math.round((to - from) / 1_200));

    const result: Record<string, HistoryPoint[]> = {};
    for (const id of entityIds) {
      const points: HistoryPoint[] = [];
      for (let t = from; t <= to; t += step) {
        points.push({ t, s: this.#valueAt(id, t) });
      }
      result[id] = points;
    }
    this.#lastUpdate = new Date().toISOString();
    return result;
  }

  async getStatistics(
    statisticIds: string[],
    start: Date,
    end: Date,
    period: StatisticsPeriod,
  ): Promise<Record<string, StatisticsPoint[]>> {
    const bucketMs = PERIOD_MS[period];
    const result: Record<string, StatisticsPoint[]> = {};

    for (const id of statisticIds) {
      const profile = this.#profileFor(id);
      if (!profile || this.unavailable.has(id)) continue;

      const points: StatisticsPoint[] = [];
      // Align buckets to local midnight so day totals match what a user sees.
      const first = new Date(start);
      first.setHours(period === "day" ? 0 : first.getHours(), period === "day" ? 0 : 0, 0, 0);

      for (let bucket = first.getTime(); bucket < end.getTime(); bucket += bucketMs) {
        const bucketEnd = Math.min(bucket + bucketMs, end.getTime());
        // Sample at roughly five-minute resolution so short, high-power
        // bursts (an air fryer, a kettle) are not averaged away.
        const samples = Math.min(288, Math.max(12, Math.round((bucketEnd - bucket) / 300_000)));
        let total = 0;
        for (let i = 0; i < samples; i += 1) {
          total += profile.powerAt(bucket + ((bucketEnd - bucket) * i) / samples);
        }
        const meanW = total / samples;
        const hours = (bucketEnd - bucket) / 3_600_000;
        points.push({
          start: bucket,
          end: bucketEnd,
          mean: Math.round(meanW * 100) / 100,
          change: Math.round((meanW * hours) / 1_000 * 1_000) / 1_000,
        });
      }
      result[id] = points;
    }

    this.#lastUpdate = new Date().toISOString();
    return result;
  }

  onStateChanged(listener: (change: StateChange) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  status(): ConnectionStatus {
    return { connected: true, lastUpdate: this.#lastUpdate, lastError: null };
  }

  #profileFor(id: string): MockProfile | undefined {
    return PROFILES.find((profile) =>
      (Object.keys(MEASUREMENTS) as Measurement[]).some(
        (measurement) => entityId(profile, measurement) === id,
      ),
    );
  }

  /** The state string an entity would report at time `t`. */
  #valueAt(id: string, t: number): string {
    if (this.unavailable.has(id)) return "unavailable";

    const profile = this.#profileFor(id);
    if (!profile) return "unavailable";

    const watts = profile.powerAt(t);
    if (id.endsWith("_power")) return watts.toFixed(1);
    if (id.endsWith("_voltage")) return VOLTAGE_AT(t).toFixed(1);
    if (id.endsWith("_current")) return (watts / VOLTAGE_AT(t)).toFixed(2);
    if (id.endsWith("_energy_day")) return this.#energySince(profile, startOfDay(t), t).toFixed(3);
    // Lifetime total: an arbitrary but stable starting point plus today.
    return (120 + this.#energySince(profile, startOfDay(t), t)).toFixed(3);
  }

  /** kWh consumed between two instants, integrated from the power curve. */
  #energySince(profile: MockProfile, from: number, to: number): number {
    const step = 60_000;
    let kwh = 0;
    for (let t = from; t < to; t += step) {
      kwh += (profile.powerAt(t) * Math.min(step, to - t)) / 3_600_000 / 1_000;
    }
    return kwh;
  }

  #refresh(now: number): void {
    for (const profile of PROFILES) {
      for (const measurement of Object.keys(MEASUREMENTS) as Measurement[]) {
        const id = entityId(profile, measurement);
        const meta = MEASUREMENTS[measurement];
        const value = this.#valueAt(id, now);
        const previous = this.#cache.get(id);
        if (previous?.state === value) continue;

        const state: HaState = {
          entity_id: id,
          state: value,
          last_changed: new Date(now).toISOString(),
          last_updated: new Date(now).toISOString(),
          attributes: {
            friendly_name: `${profile.name} ${meta.label}`,
            device_class: meta.deviceClass,
            state_class: meta.stateClass,
            unit_of_measurement: meta.unit,
          },
        };
        this.#cache.set(id, state);
        for (const listener of this.#listeners) listener({ entityId: id, state });
      }
    }
    this.#lastUpdate = new Date(now).toISOString();
  }
}

function startOfDay(t: number): number {
  const date = new Date(t);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}
