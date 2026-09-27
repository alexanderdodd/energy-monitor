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
/**
 * Walk a step series, handing each slice of constant value to `onSlice`.
 *
 * Home Assistant records a point only when a value changes, so each reading
 * holds until the next one. Both the averaging and the integration below
 * depend on identical clipping and bucket-boundary handling, so they share
 * this walk rather than each keeping their own copy of the arithmetic.
 */
function forEachSlice(
  points: HistoryPoint[],
  start: number,
  end: number,
  bucketMs: number,
  bucketCount: number,
  onSlice: (bucket: number, value: number, durationMs: number) => void,
): void {
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
      onSlice(index, value, sliceEnd - cursor);
      cursor = sliceEnd;
    }
  }
}

function bucketCountFor(start: number, end: number, bucketMs: number): number {
  return Math.max(1, Math.ceil((end - start) / bucketMs));
}

/**
 * Reduce raw history to fixed-width buckets using a time-weighted mean.
 *
 * A plain arithmetic mean would over-weight bursts of rapid changes;
 * weighting by duration gives the average the appliance actually drew.
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
  const bucketCount = bucketCountFor(start, end, bucketMs);
  const weighted = new Float64Array(bucketCount);
  const weights = new Float64Array(bucketCount);

  forEachSlice(points, start, end, bucketMs, bucketCount, (index, value, duration) => {
    weighted[index] = weighted[index]! + value * duration;
    weights[index] = weights[index]! + duration;
  });

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

/**
 * Sample a series that reports a *level* rather than a rate, holding the last
 * reading forward across each bucket.
 *
 * A vendor "energy today" counter is already a running total for the day, so
 * its recorded history is the cumulative curve - it only needs putting on a
 * regular grid. Buckets before the first reading stay null rather than
 * assuming zero.
 */
export function holdLevel(
  points: HistoryPoint[],
  start: number,
  end: number,
  bucketMs: number,
): ChartPoint[] {
  const bucketCount = bucketCountFor(start, end, bucketMs);
  const result: ChartPoint[] = new Array(bucketCount);

  let index = 0;
  let current: number | null = null;

  for (let i = 0; i < bucketCount; i += 1) {
    const bucketStart = start + i * bucketMs;
    // Each bucket carries the level as at its *end*, the same convention
    // cumulativeEnergy uses: the running total through that interval. Taking
    // the level at the start would leave the newest reading off the end of
    // the chart, which on a live dashboard is exactly the value being
    // watched.
    const bucketEnd = Math.min(bucketStart + bucketMs, end);
    // Home Assistant includes the state as it was at the start of the
    // window, so readings from before `start` legitimately seed the level.
    while (index < points.length && points[index]!.t <= bucketEnd) {
      const value = parseNumericState(points[index]!.s);
      if (value !== null) current = value;
      index += 1;
    }
    result[i] = { t: bucketStart, v: current };
  }

  return result;
}

/** Watt-milliseconds to kilowatt-hours. */
const WATT_MS_PER_KWH = 3_600_000 * 1_000;

/**
 * A running total of energy used, integrated from power history.
 *
 * This is what makes a "how is today building up" chart possible on a fresh
 * install: it needs only recorder history for a power sensor, not the
 * long-term statistics that take a full day to produce their first bucket.
 *
 * Several series are integrated together so a category or the whole
 * household can be charted; integrating each and summing is equivalent to
 * summing the power first.
 *
 * A stretch where nothing was recorded contributes nothing, so the line runs
 * flat across it rather than jumping. Returns an empty series when no source
 * reported anything at all, which the caller shows as "no data" rather than
 * as a flat zero.
 */
export function cumulativeEnergy(
  series: HistoryPoint[][],
  start: number,
  end: number,
  bucketMs: number,
): ChartPoint[] {
  const bucketCount = bucketCountFor(start, end, bucketMs);
  const wattMs = new Float64Array(bucketCount);
  let sawAnything = false;

  for (const points of series) {
    forEachSlice(points, start, end, bucketMs, bucketCount, (index, value, duration) => {
      wattMs[index] = wattMs[index]! + value * duration;
      sawAnything = true;
    });
  }

  if (!sawAnything) return [];

  const result: ChartPoint[] = new Array(bucketCount);
  let total = 0;
  for (let i = 0; i < bucketCount; i += 1) {
    total += wattMs[i]! / WATT_MS_PER_KWH;
    result[i] = { t: start + i * bucketMs, v: roundTo(total, 4) };
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

/**
 * Combine several bucketed series into one, bucket by bucket.
 *
 * Used to roll member appliances up into a category, at whatever resolution
 * the caller is working in - daily totals or five-minute ones. A bucket is
 * null only when every contributing series is null there, so a gap in one
 * appliance's recording does not silently read as zero for the whole group.
 */
export function sumSeriesByBucket(series: ChartPoint[][]): ChartPoint[] {
  const totals = new Map<number, number | null>();

  for (const points of series) {
    for (const point of points) {
      const existing = totals.get(point.t);
      if (point.v === null) {
        if (existing === undefined) totals.set(point.t, null);
        continue;
      }
      totals.set(point.t, (existing ?? 0) + point.v);
    }
  }

  // Rounded only enough to keep floating-point noise out of the numbers.
  // Three decimals would be plenty for daily totals but silently zeroes a
  // five-minute bucket: an idle fridge draws well under 0.0001 kWh in five
  // minutes, and hundreds of those rounded away is a visibly wrong total.
  return [...totals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, v]) => ({ t, v: v === null ? null : roundTo(v, 6) }));
}

/**
 * How use has moved between two equal, adjacent windows of whole days.
 *
 * Today is excluded from both windows - a day still in progress would always
 * look like a decline.
 */
export interface Trend {
  windowDays: number;
  currentKwh: number;
  previousKwh: number;
  /** Null when the previous window was zero, where a percentage means nothing. */
  changePercent: number | null;
  /** False until both windows have data, so the UI can stay quiet early on. */
  comparable: boolean;
}

export function trendOverWindows(
  daily: ChartPoint[],
  now = new Date(),
  windowDays = 7,
): Trend | null {
  const todayStart = startOfLocalDay(now).getTime();
  const currentStart = startOfLocalDayBefore(now, windowDays).getTime();
  const previousStart = startOfLocalDayBefore(now, windowDays * 2).getTime();

  let current = 0;
  let previous = 0;
  let currentSeen = false;
  let previousSeen = false;

  for (const point of daily) {
    if (point.v === null) continue;
    if (point.t >= todayStart) continue;
    if (point.t >= currentStart) {
      current += point.v;
      currentSeen = true;
    } else if (point.t >= previousStart) {
      previous += point.v;
      previousSeen = true;
    }
  }

  if (!currentSeen && !previousSeen) return null;

  return {
    windowDays,
    currentKwh: roundTo(current, 3),
    previousKwh: roundTo(previous, 3),
    changePercent:
      previousSeen && previous > 0
        ? roundTo(((current - previous) / previous) * 100, 1)
        : null,
    comparable: currentSeen && previousSeen,
  };
}

/**
 * Turn per-bucket amounts into a running total.
 *
 * Used for "how much has been consumed over time" across days, where the
 * per-day figures already exist as statistics and only need accumulating.
 * A null bucket contributes nothing and the total carries forward, so a gap
 * in recording flattens the line rather than breaking it.
 */
export function runningTotal(points: ChartPoint[]): ChartPoint[] {
  let total = 0;
  let sawAnything = false;

  const result = points.map((point) => {
    if (point.v !== null) {
      total += point.v;
      sawAnything = true;
    }
    return { t: point.t, v: roundTo(total, 4) };
  });

  return sawAnything ? result : [];
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
