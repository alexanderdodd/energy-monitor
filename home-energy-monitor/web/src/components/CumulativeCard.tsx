import { lazy } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { CumulativeResult } from "../lib/types.ts";

const PowerChart = lazy(() => import("./PowerChart.tsx"));

interface Props {
  /** API path serving the curve for this scope. */
  path: string;
  /** What the curve covers, e.g. "Fridge" or "the whole house". */
  subject: string;
  currency: string;
  pricePerKwh: number;
}

/** Refreshed every couple of minutes; the shape of a day moves slowly. */
const REFRESH_MS = 120_000;

/**
 * "How today is building up": energy used since midnight, as a running total.
 *
 * Integrated from power history rather than read from long-term statistics,
 * so it has something to show within an hour of a sensor being added instead
 * of waiting a full day for the first statistics bucket.
 */
export function CumulativeCard({ path, subject, currency, pricePerKwh }: Props) {
  const curve = useApiResource<CumulativeResult>(path, REFRESH_MS);

  // Defensive: a response that is not the shape we expect should degrade to
  // "nothing recorded", never throw and take the whole dashboard with it.
  const points = Array.isArray(curve.data?.points) ? curve.data.points : [];
  const total = typeof curve.data?.totalKwh === "number" ? curve.data.totalKwh : null;
  const cost = total === null ? null : total * pricePerKwh;

  return (
    <div className="card chart-card">
      <div className="chart-head">
        <h2>Energy today</h2>
        {total !== null ? (
          <span className="chart-total">
            <span className="kwh">{formatEnergy(total)}</span>
            <span className="cost">{formatMoney(cost, currency)}</span>
          </span>
        ) : null}
      </div>

      {points.length > 0 ? (
        <ChartBoundary>
          <PowerChart
            points={points}
            kind="line"
            range="24h"
            unitLabel="kWh"
            label={`Energy used today by ${subject}, accumulating from midnight`}
          />
        </ChartBoundary>
      ) : (
        <p className="chart-placeholder">
          {curve.loading
            ? "Loading chart…"
            : (curve.error ?? "Nothing recorded yet today.")}
        </p>
      )}
    </div>
  );
}
