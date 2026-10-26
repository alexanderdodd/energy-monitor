import { lazy, memo, useMemo, useState } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { RollingRange, RollingResult } from "../lib/types.ts";

const RollingChart = lazy(() => import("./RollingChart.tsx"));

const RANGES: { range: RollingRange; label: string }[] = [
  { range: "30d", label: "30d" },
  { range: "90d", label: "90d" },
  { range: "1y", label: "1y" },
];

/** Past days do not change; a few minutes between refreshes is plenty. */
const REFRESH_MS = 300_000;

function shortDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/**
 * Household consumption with a trailing average, for answering "is our use
 * going down". Single days swing with the weather and the laundry; a week's
 * average holds weekdays and weekends in the same proportion at every point,
 * so its slope is the direction.
 */
function RollingCardInner() {
  const [range, setRange] = useState<RollingRange>("90d");
  const result = useApiResource<RollingResult>(`api/summary/rolling?range=${range}`, REFRESH_MS);

  const points = useMemo(
    () => (Array.isArray(result.data?.points) ? result.data.points : []),
    [result.data],
  );
  const windowDays = result.data?.windowDays ?? 7;
  const latest = result.data?.latestAverageKwh ?? null;
  const change = result.data?.changePercent ?? null;
  const price = result.data?.electricityPricePerKwh ?? 0;
  const currency = result.data?.currency ?? "EUR";
  const additions = result.data?.additions ?? [];

  const hasDays = points.some((point) => point.dayKwh !== null);
  const lastDay = [...points].reverse().find((point) => point.dayKwh !== null) ?? null;

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h2>Rolling average</h2>
        <div className="head-right">
          {latest !== null ? (
            <span className="chart-total">
              <span className="kwh">{formatEnergy(latest)} / day</span>
              <span className="cost">{formatMoney(latest * price, currency)}</span>
            </span>
          ) : null}
          <div className="range-tabs" role="group" aria-label="Average range">
            {RANGES.map((option) => (
              <button
                key={option.range}
                type="button"
                aria-pressed={option.range === range}
                onClick={() => setRange(option.range)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasDays ? (
        <>
          <ChartBoundary>
            <RollingChart
              points={points}
              windowDays={windowDays}
              label={`Whole-house energy per day with a ${windowDays}-day average`}
            />
          </ChartBoundary>

          <ul className="series-legend">
            <li>
              <span className="swatch rolling-average" aria-hidden="true" />
              <span className="name">{windowDays}-day average</span>
              <span className="value">{formatEnergy(latest)}</span>
              <span className="cost">
                {change === null ? (
                  <span className="meta">—</span>
                ) : Math.abs(change) < 1 ? (
                  <span className="trend flat">No change</span>
                ) : (
                  <span className={change > 0 ? "trend up" : "trend down"}>
                    {change > 0 ? "▲" : "▼"} {Math.abs(change).toFixed(0)}%
                  </span>
                )}
              </span>
            </li>
            <li>
              <span className="swatch rolling-day" aria-hidden="true" />
              <span className="name">
                Single day{lastDay ? ` (${shortDate(lastDay.t)})` : ""}
              </span>
              <span className="value">{formatEnergy(lastDay?.dayKwh ?? null)}</span>
              <span className="cost meta">
                {formatMoney(lastDay?.dayKwh == null ? null : lastDay.dayKwh * price, currency)}
              </span>
            </li>
          </ul>

          <p className="meta">
            {latest === null
              ? `The average appears once ${windowDays} whole days have been recorded.`
              : `Each point averages the ${windowDays} days up to it, so a falling line means falling use. The arrow compares the last ${windowDays} days with the ${windowDays} before. Today is left out until it is over.`}
          </p>
          {additions.length > 0 ? (
            <p className="meta">
              {additions
                .map((item) => `${item.name} is measured from ${shortDate(item.from)}`)
                .join("; ")}
              . The total steps up where a plug was added: more is being measured, not
              necessarily used.
            </p>
          ) : null}
        </>
      ) : (
        <p className="chart-placeholder">
          {result.loading ? "Loading…" : (result.error ?? "No whole day recorded yet.")}
        </p>
      )}
    </div>
  );
}

/** Takes no props, so live power updates on the overview never redraw it. */
export const RollingCard = memo(RollingCardInner);
