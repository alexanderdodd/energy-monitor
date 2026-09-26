import { lazy, useState } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { CumulativeRange, CumulativeResult } from "../lib/types.ts";

const PowerChart = lazy(() => import("./PowerChart.tsx"));

const RANGES: { range: CumulativeRange; label: string }[] = [
  { range: "today", label: "Today" },
  { range: "7d", label: "7d" },
  { range: "30d", label: "30d" },
];

interface Props {
  /** API path for this scope; the range is appended. */
  basePath: string;
  /** What the curve covers, e.g. "Fridge" or "the whole house". */
  subject: string;
  currency: string;
  pricePerKwh: number;
}

/** Refreshed every couple of minutes; the shape of a day moves slowly. */
const REFRESH_MS = 120_000;

/**
 * Total energy consumed over time, as a running sum.
 *
 * Built from the same Home Assistant statistics as the figures above it, so
 * the curve and the headline total always tell the same story.
 */
export function CumulativeCard({ basePath, subject, currency, pricePerKwh }: Props) {
  const [range, setRange] = useState<CumulativeRange>("today");
  const curve = useApiResource<CumulativeResult>(`${basePath}?range=${range}`, REFRESH_MS);

  const points = Array.isArray(curve.data?.points) ? curve.data.points : [];
  const total = typeof curve.data?.totalKwh === "number" ? curve.data.totalKwh : null;
  const cost = total === null ? null : total * pricePerKwh;
  const label = RANGES.find((option) => option.range === range)?.label ?? "Today";

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h2>Energy used</h2>
        <div className="head-right">
          {total !== null ? (
            <span className="chart-total">
              <span className="kwh">{formatEnergy(total)}</span>
              <span className="cost">{formatMoney(cost, currency)}</span>
            </span>
          ) : null}
          <div className="range-tabs" role="group" aria-label="Cumulative range">
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

      {points.length > 0 ? (
        <ChartBoundary>
          <PowerChart
            points={points}
            kind="line"
            range={range === "today" ? "24h" : "30d"}
            unitLabel="kWh"
            label={`Total energy used by ${subject} over ${label}, accumulating`}
          />
        </ChartBoundary>
      ) : (
        <p className="chart-placeholder">
          {curve.loading ? "Loading chart…" : (curve.error ?? "Nothing recorded yet.")}
        </p>
      )}

      {curve.data?.source === "history" && points.length > 0 ? (
        <p className="meta">
          Measured from recorded power, so this covers only the period Home Assistant still holds
          history for. It will match the daily total once statistics have been recorded.
        </p>
      ) : null}
    </div>
  );
}
