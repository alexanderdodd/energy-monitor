import type { Trend } from "../lib/types.ts";

interface Props {
  trend: Trend | null;
}

/**
 * Week-on-week change.
 *
 * For consumption, up is the bad direction, so the colours are the reverse of
 * the usual financial convention. Nothing is shown until both windows have
 * data - an apparent doubling in week one is just the recorder filling up.
 */
export function TrendBadge({ trend }: Props) {
  if (!trend || !trend.comparable || trend.changePercent === null) return null;

  const change = trend.changePercent;
  // Below a percent or so the movement is noise, not a trend.
  if (Math.abs(change) < 1) {
    return (
      <span className="trend flat">
        No change vs previous {trend.windowDays} days
      </span>
    );
  }

  const up = change > 0;
  return (
    <span className={up ? "trend up" : "trend down"}>
      {up ? "▲" : "▼"} {Math.abs(change).toFixed(0)}% vs previous {trend.windowDays} days
    </span>
  );
}
