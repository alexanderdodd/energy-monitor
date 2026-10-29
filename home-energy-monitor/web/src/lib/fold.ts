import { MAX_SERIES } from "./palette.ts";

/**
 * Keep the largest items and set the rest aside to be folded into "Other".
 *
 * Kept items stay in their configured order, and each takes the palette slot
 * of its position among the kept ones. Keying the slot to the entity's index
 * across *all* appliances stopped working once a house had more than eight:
 * the ninth onwards fell past the palette into the neutral reserved for
 * "Other", so a dishwasher and the "Other" segment beside it were the same
 * grey. A slot within the kept set is stable for as long as the same items
 * stay largest, which over one range is nearly always.
 */
export function foldByTotal<T extends { totalKwh: number | null }>(
  items: T[],
  cap: number,
): { kept: (T & { colorIndex: number })[]; rest: T[] } {
  if (items.length <= cap) {
    return { kept: items.map((item, index) => ({ ...item, colorIndex: index })), rest: [] };
  }

  const ranked = items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (b.item.totalKwh ?? 0) - (a.item.totalKwh ?? 0));
  // One slot goes to "Other" itself.
  const keptIndexes = new Set(ranked.slice(0, cap - 1).map((entry) => entry.index));

  const kept: (T & { colorIndex: number })[] = [];
  const rest: T[] = [];
  items.forEach((item, index) => {
    if (keptIndexes.has(index)) kept.push({ ...item, colorIndex: kept.length });
    else rest.push(item);
  });
  return { kept, rest };
}

/** Palette index for "Other": past the last slot, which colours it neutral. */
export const OTHER_COLOR_INDEX = MAX_SERIES;

/** Bucket-by-bucket sum of several series; null only where all are null. */
export function sumPoints(series: (number | null)[][], length: number): (number | null)[] {
  return Array.from({ length }, (_, bucket) => {
    const values = series
      .map((points) => points[bucket])
      .filter((value): value is number => value !== null && value !== undefined);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  });
}
