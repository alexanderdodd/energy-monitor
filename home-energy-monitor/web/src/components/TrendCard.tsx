import { lazy, useState } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { colorFor } from "../lib/palette.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { CompareScope, TrendPeriod, TrendResult } from "../lib/types.ts";
import type { ComparisonView } from "./ComparisonChart.tsx";

const ComparisonChart = lazy(() => import("./ComparisonChart.tsx"));

const SCOPES: { scope: CompareScope; label: string }[] = [
  { scope: "appliances", label: "Appliances" },
  { scope: "categories", label: "Categories" },
];

const PERIODS: { period: TrendPeriod; label: string }[] = [
  { period: "day", label: "Daily" },
  { period: "week", label: "Weekly" },
  { period: "month", label: "Monthly" },
];

const VIEWS: { view: ComparisonView; label: string }[] = [
  { view: "grouped", label: "Bars" },
  // Stacking makes the bar's height the combined total, so the whole
  // household's direction is readable without adding the parts up by eye.
  { view: "stacked", label: "Stacked" },
  { view: "lines", label: "Lines" },
];

const PERIOD_NOUN: Record<TrendPeriod, string> = {
  day: "day",
  week: "week",
  month: "month",
};

/**
 * Consumption per period, side by side.
 *
 * The Compare card answers "who used most"; this one answers "is that going
 * up or down". Each bucket is a period's own figure rather than a running
 * total, so successive bars can be read against one another.
 */
export function TrendCard() {
  const [scope, setScope] = useState<CompareScope>("appliances");
  const [period, setPeriod] = useState<TrendPeriod>("day");
  const [view, setView] = useState<ComparisonView>("grouped");

  const result = useApiResource<TrendResult>(
    `api/trend?scope=${scope}&period=${period}`,
    120_000,
  );

  const dark =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  const series = Array.isArray(result.data?.series) ? result.data.series : [];
  const buckets = Array.isArray(result.data?.buckets) ? result.data.buckets : [];
  const currency = result.data?.currency ?? "EUR";
  const price = result.data?.electricityPricePerKwh ?? 0;
  const total = result.data?.total;

  // Two periods are the minimum for a comparison to mean anything.
  const comparable = buckets.length > 1;
  const hasData = series.some((item) => item.points.some((value) => value !== null));

  return (
    <div className="card chart-card comparison">
      <div className="chart-head">
        <h2>Usage by period</h2>
        <div className="head-right">
          <div className="range-tabs" role="group" aria-label="Compare">
            {SCOPES.map((option) => (
              <button
                key={option.scope}
                type="button"
                aria-pressed={option.scope === scope}
                onClick={() => setScope(option.scope)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="range-tabs" role="group" aria-label="Period">
            {PERIODS.map((option) => (
              <button
                key={option.period}
                type="button"
                aria-pressed={option.period === period}
                onClick={() => setPeriod(option.period)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="range-tabs" role="group" aria-label="Chart">
            {VIEWS.map((option) => (
              <button
                key={option.view}
                type="button"
                aria-pressed={option.view === view}
                onClick={() => setView(option.view)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasData ? (
        <>
          <ChartBoundary>
            <ComparisonChart
              view={view}
              buckets={buckets}
              series={series.map((item, index) => ({
                id: item.id,
                name: item.name,
                points: item.points,
                totalKwh: item.points.at(-1) ?? null,
                colorIndex: index,
              }))}
              range={period}
              showChange
            />
          </ChartBoundary>

          <ul className="series-legend">
            {series.map((item, index) => {
              const latest = [...item.points].reverse().find((value) => value !== null) ?? null;
              return (
                <li key={item.id}>
                  <span
                    className="swatch"
                    style={{ background: colorFor(index, dark) }}
                    aria-hidden="true"
                  />
                  <span className="name">{item.name}</span>
                  <span className="value">{formatEnergy(latest)}</span>
                  <span className="cost">
                    {item.changePercent === null ? (
                      <span className="meta">
                        {comparable ? formatMoney(latest === null ? null : latest * price, currency) : "—"}
                      </span>
                    ) : (
                      <span className={item.changePercent > 0 ? "trend up" : "trend down"}>
                        {item.changePercent > 0 ? "▲" : "▼"}{" "}
                        {Math.abs(item.changePercent).toFixed(0)}%
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
            {total ? (
              <li className="total">
                <span className="swatch" aria-hidden="true" />
                <span className="name">All {series.length}</span>
                <span className="value">
                  {formatEnergy(
                    [...total.points].reverse().find((value) => value !== null) ?? null,
                  )}
                </span>
                <span className="cost">
                  {total.changePercent === null ? (
                    <span className="meta">—</span>
                  ) : (
                    <span className={total.changePercent > 0 ? "trend up" : "trend down"}>
                      {total.changePercent > 0 ? "▲" : "▼"}{" "}
                      {Math.abs(total.changePercent).toFixed(0)}%
                    </span>
                  )}
                </span>
              </li>
            ) : null}
          </ul>

          <p className="meta">
            Figures are each {PERIOD_NOUN[period]}&rsquo;s own consumption. The arrow compares the
            last two complete {PERIOD_NOUN[period]}s
            {result.data?.inProgressFrom !== null
              ? `; this ${PERIOD_NOUN[period]} is still in progress and is left out of it`
              : ""}
            .
            {comparable
              ? ""
              : ` A second ${PERIOD_NOUN[period]} is needed before anything can be compared.`}
          </p>
        </>
      ) : (
        <p className="chart-placeholder">
          {result.loading
            ? "Loading…"
            : (result.error ??
              (scope === "categories"
                ? "No categories yet. Add some in Settings to compare them."
                : "Nothing recorded yet."))}
        </p>
      )}
    </div>
  );
}
