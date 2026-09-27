import {
  downsample,
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
  if (!entity) return [];

  const stats = await source.getStatistics([entity], start, end, "day");
  const series = stats[entity];
  if (!series) return [];

  return series.map((point) => ({
    t: point.start,
    v: typeof point.change === "number" ? roundTo(point.change, 3) : null,
  }));
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
