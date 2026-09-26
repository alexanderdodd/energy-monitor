import type { HistoryPoint } from "../ha/types.ts";

/**
 * States that mean "no reading", as opposed to a reading of zero. The
 * distinction matters: an unplugged appliance is not an idle one.
 */
const NON_NUMERIC_STATES = new Set(["unavailable", "unknown", "none", "null", ""]);

/** Parse a Home Assistant state string, or return null if it is not a number. */
export function parseNumericState(state: string | null | undefined): number | null {
  if (state === null || state === undefined) return null;
  const trimmed = state.trim();
  if (NON_NUMERIC_STATES.has(trimmed.toLowerCase())) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export type MeasurementKind = "power" | "energy" | "current" | "voltage";

/** Multipliers onto each measurement's canonical unit: W, kWh, A, V. */
const UNIT_FACTORS: Record<MeasurementKind, Record<string, number>> = {
  power: { w: 1, kw: 1_000, mw: 0.001, MW: 1_000_000 },
  energy: { wh: 0.001, kwh: 1, mwh: 1_000, gwh: 1_000_000 },
  current: { a: 1, ma: 0.001, ka: 1_000 },
  voltage: { v: 1, mv: 0.001, kv: 1_000 },
};

/**
 * Convert a value to the canonical unit for its measurement kind.
 *
 * Unknown units are rejected rather than assumed, so a sensor reporting
 * something unexpected shows as unavailable instead of as a wrong number.
 */
export function toCanonicalUnit(
  value: number | null,
  unit: string | null | undefined,
  kind: MeasurementKind,
): number | null {
  if (value === null) return null;
  if (!unit) return value;

  const factors = UNIT_FACTORS[kind];
  // "MW" (megawatt) and "mW" (milliwatt) differ only in case, so try the
  // exact spelling before falling back to a case-insensitive lookup.
  const exact = factors[unit];
  if (exact !== undefined) return value * exact;

  const factor = factors[unit.toLowerCase()];
  return factor === undefined ? null : value * factor;
}

/** Cost of an amount of energy, rounded to whole cents. */
export function costOf(kwh: number | null, pricePerKwh: number): number | null {
  if (kwh === null || !Number.isFinite(pricePerKwh)) return null;
  return Math.round(kwh * pricePerKwh * 100) / 100;
}

export interface ChartPoint {
  /** Bucket start, milliseconds since the epoch. */
  t: number;
  /** Bucket value, or null where no reading was recorded. */
  v: number | null;
}

/**
 * Reduce raw history to fixed-width buckets using a time-weighted mean.
 *
 * Home Assistant records a point only when a value changes, so each reading
 * holds until the next one. A plain arithmetic mean would over-weight bursts
 * of rapid changes; weighting by duration gives the average the appliance
 * actually drew.
 *
 * Buckets with no numeric coverage come back as null so the chart can show a
 * gap rather than inventing a zero.
 */
export function downsample(
  points: HistoryPoint[],
  start: number,
  end: number,
  bucketMs: number,
): ChartPoint[] {
  const bucketCount = Math.max(1, Math.ceil((end - start) / bucketMs));
  const weighted = new Float64Array(bucketCount);
  const weights = new Float64Array(bucketCount);

  for (let i = 0; i < points.length; i += 1) {
    const point = points[i]!;
    const value = parseNumericState(point.s);
    if (value === null) continue;

    const segmentStart = Math.max(point.t, start);
    const segmentEnd = Math.min(points[i + 1]?.t ?? end, end);
    if (segmentEnd <= segmentStart) continue;

    let cursor = segmentStart;
    while (cursor < segmentEnd) {
      const index = Math.min(bucketCount - 1, Math.floor((cursor - start) / bucketMs));
      const boundary = start + (index + 1) * bucketMs;
      const sliceEnd = Math.min(segmentEnd, boundary);
      const duration = sliceEnd - cursor;
      weighted[index] = weighted[index]! + value * duration;
      weights[index] = weights[index]! + duration;
      cursor = sliceEnd;
    }
  }

  const result: ChartPoint[] = new Array(bucketCount);
  for (let i = 0; i < bucketCount; i += 1) {
    const weight = weights[i]!;
    result[i] = {
      t: start + i * bucketMs,
      v: weight > 0 ? roundTo(weighted[i]! / weight, 2) : null,
    };
  }
  return result;
}

export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/** Number of days in the calendar month containing `date`, in local time. */
export function daysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

export interface Forecast {
  /** Mean kWh/day over the days the estimate is based on. */
  dailyAverageKwh: number;
  estimatedMonthlyKwh: number;
  estimatedYearlyKwh: number;
  /** How many complete days of history fed the estimate. */
  basedOnDays: number;
}

/**
 * Extrapolate monthly and yearly use from recent daily totals.
 *
 * Deliberately simple: a rolling mean of the complete days available. Today
 * is excluded because a partial day would drag every estimate downwards.
 * Callers must present the result as an estimate.
 */
export function forecastFromDailyTotals(dailyKwh: number[], now = new Date()): Forecast | null {
  const complete = dailyKwh.filter((value) => Number.isFinite(value));
  if (complete.length === 0) return null;

  const total = complete.reduce((sum, value) => sum + value, 0);
  const dailyAverageKwh = total / complete.length;

  return {
    dailyAverageKwh: roundTo(dailyAverageKwh, 3),
    estimatedMonthlyKwh: roundTo(dailyAverageKwh * daysInMonth(now), 2),
    estimatedYearlyKwh: roundTo(dailyAverageKwh * 365, 1),
    basedOnDays: complete.length,
  };
}

/** Local-time midnight at the start of the day containing `date`. */
export function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Local-time midnight on the first day of the month containing `date`. */
export function startOfLocalMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Local-time midnight `days` days before the start of today. */
export function startOfLocalDayBefore(date: Date, days: number): Date {
  const start = startOfLocalDay(date);
  start.setDate(start.getDate() - days);
  return start;
}
