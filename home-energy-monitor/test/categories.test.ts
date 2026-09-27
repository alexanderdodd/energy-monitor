import { describe, expect, it } from "vitest";
import { alignCumulative, runningTotal, sumSeriesByBucket, trendOverWindows } from "../server/src/appliances/calculations.ts";
import { hasOverlap } from "../server/src/appliances/service.ts";
import { sanitizeConfig, slugify } from "../server/src/config/store.ts";

/** Local midnight `offset` days from 26 September 2026. */
function day(offset: number): number {
  const date = new Date(2026, 8, 26);
  date.setDate(date.getDate() + offset);
  return date.getTime();
}

const now = new Date(2026, 8, 26, 14, 30);

describe("sumSeriesByBucket", () => {
  it("adds matching buckets across appliances", () => {
    const result = sumSeriesByBucket([
      [
        { t: day(-1), v: 1 },
        { t: day(0), v: 2 },
      ],
      [
        { t: day(-1), v: 0.5 },
        { t: day(0), v: 0.25 },
      ],
    ]);
    expect(result).toEqual([
      { t: day(-1), v: 1.5 },
      { t: day(0), v: 2.25 },
    ]);
  });

  it("keeps a bucket null only when every contributor is null", () => {
    const result = sumSeriesByBucket([
      [{ t: day(0), v: null }],
      [{ t: day(0), v: 3 }],
    ]);
    expect(result).toEqual([{ t: day(0), v: 3 }]);

    const allMissing = sumSeriesByBucket([[{ t: day(0), v: null }], [{ t: day(0), v: null }]]);
    expect(allMissing).toEqual([{ t: day(0), v: null }]);
  });

  it("unions buckets the appliances do not share, in time order", () => {
    const result = sumSeriesByBucket([[{ t: day(0), v: 1 }], [{ t: day(-2), v: 2 }]]);
    expect(result.map((point) => point.t)).toEqual([day(-2), day(0)]);
  });

  it("handles no members at all", () => {
    expect(sumSeriesByBucket([])).toEqual([]);
  });
});

describe("trendOverWindows", () => {
  const sevenDaysEach = [
    ...Array.from({ length: 7 }, (_, i) => ({ t: day(-14 + i), v: 2 })),
    ...Array.from({ length: 7 }, (_, i) => ({ t: day(-7 + i), v: 3 })),
  ];

  it("compares the last 7 whole days with the 7 before", () => {
    const trend = trendOverWindows(sevenDaysEach, now);
    expect(trend).not.toBeNull();
    expect(trend!.previousKwh).toBe(14); // day(-14)..day(-8) at 2 kWh
    expect(trend!.currentKwh).toBe(21); // day(-7)..day(-1) at 3 kWh
    expect(trend!.changePercent).toBe(50);
    expect(trend!.comparable).toBe(true);
  });

  it("excludes today, so a part-finished day never looks like a collapse", () => {
    const withHugeToday = [...sevenDaysEach, { t: day(0), v: 999 }];
    expect(trendOverWindows(withHugeToday, now)!.currentKwh).toBe(
      trendOverWindows(sevenDaysEach, now)!.currentKwh,
    );
  });

  it("is not comparable until both windows have data", () => {
    const onlyRecent = Array.from({ length: 3 }, (_, i) => ({ t: day(-3 + i), v: 1 }));
    const trend = trendOverWindows(onlyRecent, now);
    expect(trend!.comparable).toBe(false);
    expect(trend!.changePercent).toBeNull();
  });

  it("declines to express a percentage change from zero", () => {
    const fromNothing = [
      { t: day(-10), v: 0 },
      { t: day(-2), v: 5 },
    ];
    expect(trendOverWindows(fromNothing, now)!.changePercent).toBeNull();
  });

  it("returns null when there is no history at all", () => {
    expect(trendOverWindows([], now)).toBeNull();
    expect(trendOverWindows([{ t: day(0), v: 5 }], now)).toBeNull();
  });
});

describe("hasOverlap", () => {
  it("detects an appliance shared between categories", () => {
    expect(
      hasOverlap([
        { id: "washing", name: "Washing", applianceIds: ["a", "b"] },
        { id: "climate", name: "Climate", applianceIds: ["b", "c"] },
      ]),
    ).toBe(true);
  });

  it("is false when categories are disjoint", () => {
    expect(
      hasOverlap([
        { id: "washing", name: "Washing", applianceIds: ["a"] },
        { id: "climate", name: "Climate", applianceIds: ["b"] },
      ]),
    ).toBe(false);
    expect(hasOverlap([])).toBe(false);
  });

  it("does not mistake a repeated id within one category for overlap", () => {
    expect(hasOverlap([{ id: "washing", name: "Washing", applianceIds: ["a", "a"] }])).toBe(false);
  });
});

describe("slugify", () => {
  it("makes a URL-safe id from a name", () => {
    expect(slugify("Washing")).toBe("washing");
    expect(slugify("Kitchen & Cooking")).toBe("kitchen-cooking");
    expect(slugify("  Café  ")).toBe("cafe");
  });

  it("always produces something usable", () => {
    expect(slugify("!!!")).toBe("category");
    expect(slugify("")).toBe("category");
  });
});

describe("category persistence", () => {
  it("derives ids for new categories and keeps them unique", () => {
    const config = sanitizeConfig({
      categories: [
        { name: "Washing", applianceIds: ["a"] },
        { name: "Washing", applianceIds: ["b"] },
      ],
    });
    expect(config.categories.map((category) => category.id)).toEqual(["washing", "washing-2"]);
  });

  it("preserves an existing id so renaming does not orphan the category", () => {
    const config = sanitizeConfig({
      categories: [{ id: "washing", name: "Laundry", applianceIds: ["a"] }],
    });
    expect(config.categories[0]).toEqual({
      id: "washing",
      name: "Laundry",
      applianceIds: ["a"],
    });
  });

  it("drops unusable entries and de-duplicates membership", () => {
    const config = sanitizeConfig({
      categories: [
        { name: "  ", applianceIds: ["a"] },
        "junk",
        { name: "Cooking", applianceIds: ["a", "a", 7] },
      ],
    });
    expect(config.categories).toEqual([
      { id: "cooking", name: "Cooking", applianceIds: ["a"] },
    ]);
  });

  it("defaults to no categories", () => {
    expect(sanitizeConfig({}).categories).toEqual([]);
  });
});

describe("sumSeriesByBucket rounding", () => {
  it("keeps values too small to survive three decimals", () => {
    // An idle fridge draws about 0.7 W: roughly 0.00006 kWh per five minutes.
    // Rounded to three decimals every bucket reads zero and a day of standby
    // vanishes, which is exactly the sort of quiet wrongness that makes a
    // chart disagree with the figure printed above it.
    const tiny = 0.0000583;
    const buckets = Array.from({ length: 288 }, (_, i) => ({ t: i * 300_000, v: tiny }));

    const summed = sumSeriesByBucket([buckets]);
    expect(summed.every((point) => point.v !== null && point.v > 0)).toBe(true);

    // Six decimals still round, but the loss is now noise rather than the
    // whole value: three decimals would have given exactly zero.
    const total = summed.reduce((sum, point) => sum + (point.v ?? 0), 0);
    const exact = tiny * 288;
    expect(Math.abs(total - exact) / exact).toBeLessThan(0.01);
  });
});

describe("runningTotal", () => {
  it("accumulates across buckets and never falls", () => {
    const result = runningTotal([
      { t: 1, v: 0.5 },
      { t: 2, v: 0.25 },
      { t: 3, v: 1 },
    ]);
    expect(result.map((point) => point.v)).toEqual([0.5, 0.75, 1.75]);
  });

  it("carries the total across a gap rather than breaking the line", () => {
    const result = runningTotal([
      { t: 1, v: 2 },
      { t: 2, v: null },
      { t: 3, v: 1 },
    ]);
    expect(result.map((point) => point.v)).toEqual([2, 2, 3]);
  });

  it("returns nothing when no bucket had a value", () => {
    expect(runningTotal([{ t: 1, v: null }])).toEqual([]);
    expect(runningTotal([])).toEqual([]);
  });
});

describe("alignCumulative", () => {
  it("puts differently bucketed series on one axis", () => {
    const { buckets, values } = alignCumulative([
      [
        { t: 10, v: 1 },
        { t: 30, v: 3 },
      ],
      [
        { t: 20, v: 5 },
        { t: 30, v: 6 },
      ],
    ]);

    expect(buckets).toEqual([10, 20, 30]);
    // Running totals hold their last value across buckets they lack.
    expect(values[0]).toEqual([1, 1, 3]);
    // The second series reported nothing at t=10, which is not zero.
    expect(values[1]).toEqual([null, 5, 6]);
  });

  it("handles a series with no points at all", () => {
    const { buckets, values } = alignCumulative([[{ t: 1, v: 2 }], []]);
    expect(buckets).toEqual([1]);
    expect(values[1]).toEqual([null]);
  });

  it("returns an empty axis when nothing was recorded", () => {
    expect(alignCumulative([])).toEqual({ buckets: [], values: [] });
  });
});
