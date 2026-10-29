import { describe, expect, it } from "vitest";
import { foldByTotal, sumPoints } from "../web/src/lib/fold.ts";
import { MAX_SERIES } from "../web/src/lib/palette.ts";

const items = (totals: number[]) =>
  totals.map((totalKwh, index) => ({ id: `a${index}`, totalKwh }));

describe("foldByTotal", () => {
  it("keeps everything, in order, when it fits", () => {
    const { kept, rest } = foldByTotal(items([1, 5, 3]), MAX_SERIES);
    expect(kept.map((item) => [item.id, item.colorIndex])).toEqual([
      ["a0", 0],
      ["a1", 1],
      ["a2", 2],
    ]);
    expect(rest).toEqual([]);
  });

  it("keeps the largest, leaving a slot for Other", () => {
    // Sixteen appliances, the biggest of them late in the list.
    const totals = Array.from({ length: 16 }, (_, index) => (index >= 12 ? 10 + index : index));
    const { kept, rest } = foldByTotal(items(totals), MAX_SERIES);
    expect(kept).toHaveLength(MAX_SERIES - 1);
    expect(rest).toHaveLength(16 - (MAX_SERIES - 1));
    expect(kept.map((item) => item.id)).toContain("a15");
  });

  it("gives every kept item a palette slot of its own", () => {
    // The ninth appliance onwards used to fall into the neutral reserved for
    // "Other", so a large consumer and "Other" were the same grey.
    const totals = Array.from({ length: 16 }, (_, index) => index);
    const { kept } = foldByTotal(items(totals), MAX_SERIES);
    expect(kept.map((item) => item.colorIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // Still in configured order, not by size.
    expect(kept.map((item) => item.id)).toEqual(["a9", "a10", "a11", "a12", "a13", "a14", "a15"]);
  });
});

describe("sumPoints", () => {
  it("adds bucket by bucket and keeps all-unknown buckets unknown", () => {
    expect(
      sumPoints(
        [
          [1, null, null],
          [2, 3, null],
        ],
        3,
      ),
    ).toEqual([3, 3, null]);
  });
});
