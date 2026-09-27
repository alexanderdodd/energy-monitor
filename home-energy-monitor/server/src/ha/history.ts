import {
  downsample,
  parseNumericState,
  roundTo,
  startOfLocalDay,
  unitScale,
  type ChartPoint,
} from "../appliances/calculations.ts";
import type { Appliance } from "../appliances/types.ts";
import type { HaSource, StatisticsPeriod } from "./types.ts";

export type HistoryRange = "6h" | "24h" | "7d" | "30d";

export const HISTORY_RANGES: Record<
  HistoryRange,
  {
    durationMs: number;
    /** Bucket width when reading raw history. */
    bucketMs: number;
    /** Statistics period to prefer, or null to always use raw history. */
    statisticsPeriod: StatisticsPeriod | null;
  }
> = {
  // Short ranges come from raw history so brief spikes stay visible.
  "6h": { durationMs: 6 * 3_600_000, bucketMs: 2 * 60_000, statisticsPeriod: null },
  "24h": { durationMs: 24 * 3_600_000, bucketMs: 5 * 60_000, statisticsPeriod: null },
  // Long ranges come from long-term statistics, which Home Assistant has
  // already aggregated - far cheaper than replaying weeks of raw states.
  "7d": { durationMs: 7 * 86_400_000, bucketMs: 15 * 60_000, statisticsPeriod: "hour" },
  "30d": { durationMs: 30 * 86_400_000, bucketMs: 3_600_000, statisticsPeriod: "day" },
};

export function isHistoryRange(value: string): value is HistoryRange {
  return value in HISTORY_RANGES;
}

export interface HistoryResult {
  range: HistoryRange;
  start: number;
  end: number;
  /** Average power per bucket, in watts. Null entries are gaps. */
  power: ChartPoint[];
  /** Energy consumed per day, in kWh. Empty when no statistics exist. */
  energyDaily: ChartPoint[];
  /** Where the power series came from, for the UI to caveat appropriately. */
  powerSource: "history" | "statistics";
}

/**
 * Build the chart series for one appliance over a time range.
 *
 * Prefers Home Assistant's pre-aggregated statistics for long ranges and
 * falls back to raw, downsampled history when they are unavailable (for
 * example on an instance whose recorder has been trimmed).
 */
export async function buildHistory(
  source: HaSource,
  appliance: Appliance,
  range: HistoryRange,
  now = new Date(),
): Promise<HistoryResult> {
  const config = HISTORY_RANGES[range];
  const end = now.getTime();
  const start = end - config.durationMs;

  const powerEntity = appliance.entities.power;
  let power: ChartPoint[] = [];
  let powerSource: HistoryResult["powerSource"] = "history";

  if (powerEntity) {
    if (config.statisticsPeriod) {
      const stats = await source.getStatistics(
        [powerEntity],
        new Date(start),
        new Date(end),
        config.statisticsPeriod,
      );
      const series = stats[powerEntity];
      if (series && series.length > 0) {
        power = series.map((point) => ({
          t: point.start,
          v: typeof point.mean === "number" ? roundTo(point.mean, 2) : null,
        }));
        powerSource = "statistics";
      }
    }

    if (power.length === 0) {
      const history = await source.getHistory([powerEntity], new Date(start), new Date(end));
      // Raw history is in the sensor's own unit; a plug reporting kW would
      // otherwise chart two orders of magnitude below one reporting W.
      const scale = unitScale(
        source.getCachedState(powerEntity)?.attributes.unit_of_measurement,
        "power",
      );
      power = downsample(history[powerEntity] ?? [], start, end, config.bucketMs, scale);
    }
  }

  const energyDaily = await buildDailyEnergy(source, appliance, new Date(start), new Date(end));

  return { range, start, end, power, energyDaily, powerSource };
}

/**
 * Daily energy totals from long-term statistics.
 *
 * The `change` field is exactly what we want: how much the cumulative meter
 * advanced within each bucket, already corrected for meter resets.
 *
 * Home Assistant buckets days in the instance's local timezone, which the
 * Supervisor also sets inside the app container, so the boundaries line up
 * with the ones the user sees in Home Assistant.
 */
export async function buildDailyEnergy(
  source: HaSource,
  appliance: Appliance,
  start: Date,
  end: Date,
): Promise<ChartPoint[]> {
  const entity = appliance.entities.energy;

  if (entity) {
    const stats = await source.getStatistics([entity], start, end, "day");
    const series = stats[entity];
    if (series && series.length > 0) {
      return series.map((point) => ({
        t: point.start,
        v: typeof point.change === "number" ? roundTo(point.change, 3) : null,
      }));
    }
  }

  // No lifetime meter means no statistics. A daily counter's own history
  // still yields a real total per day, which is what fills the daily chart
  // and the weekly figures for plugs that only expose day and month counters.
  if (appliance.entities.energyDay) {
    return buildDailyEnergyFromCounter(source, appliance.entities.energyDay, start, end);
  }

  return [];
}

/**
 * Daily totals recovered from a vendor "energy today" counter's history.
 *
 * Such a counter climbs through the day and resets at midnight, so the
 * highest value recorded within a local day is that day's total. Reading its
 * history gives genuine per-day figures for appliances that expose no
 * lifetime meter - and therefore have no long-term statistics at all.
 *
 * Limited by the recorder's retention (ten days by default), so the caller
 * must check coverage before claiming a period is complete.
 */
export async function buildDailyEnergyFromCounter(
  source: HaSource,
  entityId: string,
  start: Date,
  end: Date,
): Promise<ChartPoint[]> {
  const history = await source.getHistory([entityId], start, end);
  const points = history[entityId] ?? [];
  if (points.length === 0) return [];

  const scale = unitScale(
    source.getCachedState(entityId)?.attributes.unit_of_measurement,
    "energy",
  );

  // Highest reading seen within each local day.
  const peaks = new Map<number, number>();
  for (const point of points) {
    const value = parseNumericState(point.s);
    if (value === null) continue;
    const day = startOfLocalDay(new Date(point.t)).getTime();
    const scaled = value * scale;
    const current = peaks.get(day);
    if (current === undefined || scaled > current) peaks.set(day, scaled);
  }

  return [...peaks.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ t, v: roundTo(v, 4) }));
}

/** Sum the daily energy buckets that fall on or after `from`. */
export function sumDailyEnergy(points: ChartPoint[], from: Date): number | null {
  const threshold = startOfLocalDay(from).getTime();
  let total = 0;
  let seen = false;

  for (const point of points) {
    if (point.t < threshold || point.v === null) continue;
    total += point.v;
    seen = true;
  }

  return seen ? roundTo(total, 3) : null;
}
