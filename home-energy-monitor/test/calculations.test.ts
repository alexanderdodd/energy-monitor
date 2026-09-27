import { describe, expect, it } from "vitest";
import {
  costOf,
  cumulativeEnergy,
  holdLevel,
  daysInMonth,
  downsample,
  forecastFromDailyTotals,
  parseNumericState,
  startOfLocalDayBefore,
  toCanonicalUnit,
} from "../server/src/appliances/calculations.ts";

describe("parseNumericState", () => {
  it("parses numeric states", () => {
    expect(parseNumericState("42.5")).toBe(42.5);
    expect(parseNumericState(" 0 ")).toBe(0);
    expect(parseNumericState("-3")).toBe(-3);
  });

  it("treats Home Assistant's non-values as missing, not as zero", () => {
    for (const state of ["unavailable", "unknown", "none", "", "  ", "UNAVAILABLE"]) {
      expect(parseNumericState(state)).toBeNull();
    }
    expect(parseNumericState(null)).toBeNull();
    expect(parseNumericState(undefined)).toBeNull();
  });

  it("rejects non-numeric text", () => {
    expect(parseNumericState("on")).toBeNull();
    expect(parseNumericState("12 W")).toBeNull();
    expect(parseNumericState("NaN")).toBeNull();
    expect(parseNumericState("Infinity")).toBeNull();
  });
});

describe("toCanonicalUnit", () => {
  it("normalises power to watts", () => {
    expect(toCanonicalUnit(1.5, "kW", "power")).toBe(1500);
    expect(toCanonicalUnit(40, "W", "power")).toBe(40);
  });

  it("distinguishes milliwatts from megawatts by case", () => {
    expect(toCanonicalUnit(1000, "mW", "power")).toBe(1);
    expect(toCanonicalUnit(1, "MW", "power")).toBe(1_000_000);
  });

  it("normalises energy to kWh", () => {
    expect(toCanonicalUnit(500, "Wh", "energy")).toBe(0.5);
    expect(toCanonicalUnit(2, "kWh", "energy")).toBe(2);
  });

  it("normalises current and voltage", () => {
    expect(toCanonicalUnit(500, "mA", "current")).toBe(0.5);
    expect(toCanonicalUnit(236, "V", "voltage")).toBe(236);
  });

  it("rejects unknown units rather than guessing", () => {
    expect(toCanonicalUnit(10, "BTU/h", "power")).toBeNull();
  });

  it("passes values through when no unit is reported", () => {
    expect(toCanonicalUnit(12, undefined, "power")).toBe(12);
  });

  it("keeps missing values missing", () => {
    expect(toCanonicalUnit(null, "W", "power")).toBeNull();
  });
});

describe("costOf", () => {
  it("multiplies energy by price and rounds to cents", () => {
    expect(costOf(4.12, 0.3)).toBe(1.24);
    expect(costOf(0, 0.3)).toBe(0);
  });

  it("returns null for missing energy", () => {
    expect(costOf(null, 0.3)).toBeNull();
  });
});

describe("downsample", () => {
  const start = 0;
  const bucket = 60_000;

  it("weights each reading by how long it was held", () => {
    // 100 W for 45s then 0 W for 15s averages to 75 W over the minute.
    const points = [
      { t: 0, s: "100" },
      { t: 45_000, s: "0" },
    ];
    const result = downsample(points, start, bucket, bucket);
    expect(result).toHaveLength(1);
    expect(result[0]!.v).toBeCloseTo(75, 5);
  });

  it("is not skewed by a burst of rapid changes", () => {
    const steady = downsample(
      [
        { t: 0, s: "10" },
        { t: 30_000, s: "20" },
      ],
      start,
      bucket,
      bucket,
    );
    const bursty = downsample(
      [
        { t: 0, s: "10" },
        { t: 29_000, s: "10" },
        { t: 29_500, s: "10" },
        { t: 30_000, s: "20" },
      ],
      start,
      bucket,
      bucket,
    );
    expect(bursty[0]!.v).toBeCloseTo(steady[0]!.v!, 5);
  });

  it("reports buckets with no data as gaps rather than zeroes", () => {
    const result = downsample([{ t: 0, s: "50" }], start, bucket * 3, bucket);
    expect(result.map((point) => point.v)).toEqual([50, 50, 50]);

    const empty = downsample([], start, bucket * 2, bucket);
    expect(empty.map((point) => point.v)).toEqual([null, null]);
  });

  it("skips unavailable stretches", () => {
    const result = downsample(
      [
        { t: 0, s: "unavailable" },
        { t: bucket, s: "20" },
      ],
      start,
      bucket * 2,
      bucket,
    );
    expect(result[0]!.v).toBeNull();
    expect(result[1]!.v).toBe(20);
  });

  it("clips readings that start before the window", () => {
    const result = downsample(
      [
        { t: -10 * bucket, s: "30" },
        { t: bucket, s: "60" },
      ],
      start,
      bucket * 2,
      bucket,
    );
    expect(result[0]!.v).toBe(30);
    expect(result[1]!.v).toBe(60);
  });
});

describe("forecastFromDailyTotals", () => {
  const june = new Date(2026, 5, 15);

  it("extrapolates from a rolling daily average", () => {
    const forecast = forecastFromDailyTotals([2, 2, 2, 2], june);
    expect(forecast).not.toBeNull();
    expect(forecast!.dailyAverageKwh).toBe(2);
    expect(forecast!.estimatedMonthlyKwh).toBe(60); // June has 30 days
    expect(forecast!.estimatedYearlyKwh).toBe(730);
    expect(forecast!.basedOnDays).toBe(4);
  });

  it("returns null when there is no history to extrapolate from", () => {
    expect(forecastFromDailyTotals([], june)).toBeNull();
  });
});

describe("date helpers", () => {
  it("counts days in a month, leap years included", () => {
    expect(daysInMonth(new Date(2026, 1, 10))).toBe(28);
    expect(daysInMonth(new Date(2028, 1, 10))).toBe(29);
    expect(daysInMonth(new Date(2026, 5, 10))).toBe(30);
  });

  it("walks back whole local days", () => {
    const start = startOfLocalDayBefore(new Date(2026, 2, 10, 13, 45), 3);
    expect(start.getDate()).toBe(7);
    expect(start.getHours()).toBe(0);
    expect(start.getMinutes()).toBe(0);
  });
});

describe("cumulativeEnergy", () => {
  const hour = 3_600_000;
  const bucket = 15 * 60_000;

  it("integrates power into a running kWh total", () => {
    // 1000 W held for a full hour is exactly 1 kWh.
    const result = cumulativeEnergy([[{ t: 0, s: "1000" }]], 0, hour, bucket);
    expect(result).toHaveLength(4);
    expect(result.at(-1)!.v).toBeCloseTo(1, 6);
    // It accumulates evenly across the hour.
    expect(result[0]!.v).toBeCloseTo(0.25, 6);
    expect(result[1]!.v).toBeCloseTo(0.5, 6);
  });

  it("never decreases", () => {
    const result = cumulativeEnergy(
      [
        [
          { t: 0, s: "2000" },
          { t: hour / 2, s: "0" },
        ],
      ],
      0,
      hour,
      bucket,
    );
    const values = result.map((point) => point.v!);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    }
    expect(values.at(-1)).toBeCloseTo(1, 6);
  });

  it("sums several appliances into one curve", () => {
    const combined = cumulativeEnergy(
      [[{ t: 0, s: "600" }], [{ t: 0, s: "400" }]],
      0,
      hour,
      bucket,
    );
    expect(combined.at(-1)!.v).toBeCloseTo(1, 6);
  });

  it("runs flat across a gap rather than jumping", () => {
    // Recorded for the first half hour only; nothing after.
    const result = cumulativeEnergy([[{ t: 0, s: "1000" }, { t: hour / 2, s: "unavailable" }]], 0, hour, bucket);
    expect(result.at(-1)!.v).toBeCloseTo(0.5, 6);
    expect(result[2]!.v).toBeCloseTo(0.5, 6);
    expect(result[3]!.v).toBeCloseTo(0.5, 6);
  });

  it("returns nothing when no source reported at all", () => {
    expect(cumulativeEnergy([], 0, hour, bucket)).toEqual([]);
    expect(cumulativeEnergy([[]], 0, hour, bucket)).toEqual([]);
    expect(cumulativeEnergy([[{ t: 0, s: "unavailable" }]], 0, hour, bucket)).toEqual([]);
  });

  it("ignores readings outside the window", () => {
    const result = cumulativeEnergy([[{ t: -10 * hour, s: "1000" }]], 0, hour, bucket);
    // The reading still holds into the window, so it counts from the start.
    expect(result.at(-1)!.v).toBeCloseTo(1, 6);
  });
});

describe("holdLevel", () => {
  const bucket = 60_000;

  it("holds the last reading forward across buckets", () => {
    // Each bucket reports the level as at its end, so the reading at 2*bucket
    // lands in the bucket that ends there.
    const result = holdLevel(
      [
        { t: 0, s: "0.5" },
        { t: 2 * bucket, s: "1.25" },
      ],
      0,
      4 * bucket,
      bucket,
    );
    expect(result.map((point) => point.v)).toEqual([0.5, 1.25, 1.25, 1.25]);
  });

  it("stays null until the first reading rather than assuming zero", () => {
    const result = holdLevel([{ t: 2 * bucket, s: "3" }], 0, 4 * bucket, bucket);
    expect(result.map((point) => point.v)).toEqual([null, 3, 3, 3]);
  });

  it("includes a reading that arrives inside the final bucket", () => {
    // The newest value is what a live dashboard is being watched for; it must
    // not be left off the end of the chart.
    const result = holdLevel(
      [
        { t: 0, s: "1" },
        { t: 3 * bucket + 30_000, s: "9" },
      ],
      0,
      4 * bucket,
      bucket,
    );
    expect(result.at(-1)!.v).toBe(9);
  });

  it("is seeded by the reading Home Assistant reports at the window start", () => {
    const result = holdLevel([{ t: -10 * bucket, s: "2" }], 0, 2 * bucket, bucket);
    expect(result.map((point) => point.v)).toEqual([2, 2]);
  });

  it("carries the level across an unavailable stretch", () => {
    const result = holdLevel(
      [
        { t: 0, s: "1" },
        { t: bucket, s: "unavailable" },
        { t: 3 * bucket, s: "4" },
      ],
      0,
      4 * bucket,
      bucket,
    );
    expect(result.map((point) => point.v)).toEqual([1, 1, 4, 4]);
  });
});
