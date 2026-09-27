/**
 * Categorical palette for comparison charts.
 *
 * Validated, not chosen by eye: both modes pass the lightness band, chroma
 * floor, adjacent-pair colour-vision separation and normal-vision floor
 * against this app's surfaces (worst adjacent CVD ΔE 9.1 light / 8.4 dark).
 *
 * Three light-mode slots fall below 3:1 contrast on white, so the relief rule
 * applies: every chart using this palette also carries a legend naming each
 * series and its value, and bars are directly labelled. Identity is never
 * carried by colour alone.
 *
 * The order is the safety mechanism, not decoration - hues are assigned in
 * this sequence and never cycled. A ninth series folds into "Other".
 */
export const SERIES_LIGHT = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // magenta
  "#008300", // green
  "#4a3aa7", // violet
  "#e34948", // red
] as const;

export const SERIES_DARK = [
  "#3987e5",
  "#d95926",
  "#199e70",
  "#c98500",
  "#d55181",
  "#008300",
  "#9085e9",
  "#e66767",
] as const;

/** Anything past the eighth slot is folded together, never given a new hue. */
export const OTHER_LIGHT = "#7a7a76";
export const OTHER_DARK = "#8b8b84";

export const MAX_SERIES = SERIES_LIGHT.length;

export function seriesColors(dark: boolean): readonly string[] {
  return dark ? SERIES_DARK : SERIES_LIGHT;
}

/**
 * Colour for a series, by its position in the configured order.
 *
 * Deliberately keyed to the entity's own index rather than its rank, so
 * changing the range or sorting by size never repaints a series.
 */
export function colorFor(index: number, dark: boolean): string {
  const colors = seriesColors(dark);
  return colors[index] ?? (dark ? OTHER_DARK : OTHER_LIGHT);
}
