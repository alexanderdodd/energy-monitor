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
