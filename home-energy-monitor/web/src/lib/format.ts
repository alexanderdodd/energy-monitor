/** Shown wherever a value is genuinely unknown, never in place of a zero. */
export const NO_VALUE = "—";

export function formatPower(watts: number | null | undefined): string {
  if (watts === null || watts === undefined) return NO_VALUE;
  if (Math.abs(watts) >= 1_000) return `${(watts / 1_000).toFixed(2)} kW`;
  return `${Math.round(watts)} W`;
}

export function formatEnergy(kwh: number | null | undefined): string {
  if (kwh === null || kwh === undefined) return NO_VALUE;
  if (Math.abs(kwh) >= 100) return `${kwh.toFixed(0)} kWh`;
  return `${kwh.toFixed(2)} kWh`;
}

export function formatCurrent(amps: number | null | undefined): string {
  if (amps === null || amps === undefined) return NO_VALUE;
  return `${amps.toFixed(2)} A`;
}

export function formatVoltage(volts: number | null | undefined): string {
  if (volts === null || volts === undefined) return NO_VALUE;
  return `${Math.round(volts)} V`;
}

export function formatMoney(
  value: number | null | undefined,
  currency: string,
  locale?: string,
): string {
  if (value === null || value === undefined) return NO_VALUE;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    // An unrecognised currency code should not blank out the number.
    return `${value.toFixed(2)} ${currency}`;
  }
}

/** What a daily average is based on, so one day of data is not read as a trend. */
export function formatAverageBasis(days: number): string {
  if (days === 0) return "No complete day yet";
  return days === 1 ? "From 1 complete day" : `Over the last ${days} days`;
}

/** "2 minutes ago", for the Home Assistant connection status. */
export function formatRelativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "never";
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) return "never";

  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(timestamp).toLocaleString();
}

export function formatTimeAxis(timestamp: number, range: string): string {
  const date = new Date(timestamp);
  if (range === "6h" || range === "24h") {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Label for a hovered chart point.
 *
 * Axis labels are terse because they repeat across the width of the chart;
 * a tooltip is read one at a time, so it can afford the date as well. Day
 * buckets carry no meaningful time of day, so they omit it.
 */
export function formatTooltipTime(timestamp: number, range: string, locale?: string): string {
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);

  if (range === "30d") {
    return date.toLocaleDateString(locale, {
      weekday: "short",
      day: "numeric",
      month: "short",
    });
  }

  return date.toLocaleString(locale, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Tooltip label for a point on an axis that mixes resolutions.
 *
 * A multi-day comparison can hold one appliance's daily totals beside
 * another's five-minute readings. A day bucket starts at local midnight and
 * stands for the whole day, so it gets the date alone; anything finer gets
 * the time as well, or a day's worth of points all read as the same date.
 */
export function formatInstant(timestamp: number, locale?: string): string {
  if (!Number.isFinite(timestamp)) return "";
  const date = new Date(timestamp);
  const midnight =
    date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  return formatTooltipTime(timestamp, midnight ? "30d" : "7d", locale);
}
