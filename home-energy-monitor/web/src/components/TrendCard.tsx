import { lazy, memo, useMemo, useState } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { foldByTotal, OTHER_COLOR_INDEX, sumPoints } from "../lib/fold.ts";
import { colorFor, MAX_SERIES } from "../lib/palette.ts";
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

/**
 * How many periods to draw. Every appliance gets a bar in every period, so
 * eleven days of sixteen appliances was close to two hundred bars, each a
 * hairline. Five periods is enough to see a direction, and the change figure
 * only ever compares the last two.
 */
const SHOWN_PERIODS = 5;

/** Change between the last two complete periods, as the server computes it. */
function changeOf(
  buckets: number[],
  points: (number | null)[],
  inProgressFrom: number | null,
): number | null {
  const complete = buckets
    .map((bucket, index) => ({ bucket, value: points[index] ?? null }))
    .filter((entry) => entry.bucket !== inProgressFrom && entry.value !== null)
    .map((entry) => entry.value as number);
  const previous = complete.at(-2);
  const latest = complete.at(-1);
  if (previous === undefined || latest === undefined || previous <= 0) return null;
  return ((latest - previous) / previous) * 100;
}

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
function TrendCardInner() {
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

  const allBuckets = useMemo(
    () => (Array.isArray(result.data?.buckets) ? result.data.buckets : []),
    [result.data],
  );
  // Only the most recent periods; the change figures are unaffected, since
  // they compare the last two complete periods either way.
  const offset = Math.max(0, allBuckets.length - SHOWN_PERIODS);
  const buckets = useMemo(() => allBuckets.slice(offset), [allBuckets, offset]);
  const inProgressFrom = result.data?.inProgressFrom ?? null;

  // Past the palette's eight slots, the smallest fold into "Other", ranked
  // over the periods actually shown.
  const series = useMemo(() => {
    const source = Array.isArray(result.data?.series) ? result.data.series : [];
    const shown = source.map((item) => {
      const points = (Array.isArray(item.points) ? item.points : []).slice(offset);
      return {
        ...item,
        points,
        totalKwh: points.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      };
    });
    const { kept, rest } = foldByTotal(shown, MAX_SERIES);
    if (rest.length === 0) return kept;
    const points = sumPoints(
      rest.map((item) => item.points),
      buckets.length,
    );
    return [
      ...kept,
      {
        id: "__other",
        name: `Other (${rest.length})`,
        points,
        totalKwh: points.reduce<number>((sum, value) => sum + (value ?? 0), 0),
        changePercent: changeOf(buckets, points, inProgressFrom),
        colorIndex: OTHER_COLOR_INDEX,
      },
    ];
  }, [result.data, offset, buckets, inProgressFrom]);

  // Built once per data change rather than on every render: a new array
  // identity would redraw the chart and close any tooltip being read.
  const chartSeries = useMemo(
    () =>
      series.map((item) => ({
        id: item.id,
        name: item.name,
        points: item.points,
        totalKwh: item.points.at(-1) ?? null,
        colorIndex: item.colorIndex,
      })),
    [series],
  );
  const currency = result.data?.currency ?? "EUR";
  const price = result.data?.electricityPricePerKwh ?? 0;
  const total = useMemo(() => {
    const whole = result.data?.total;
    if (!whole || !Array.isArray(whole.points)) return null;
    return { ...whole, points: whole.points.slice(offset) };
  }, [result.data, offset]);

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
              series={chartSeries}
              range={period}
              showChange
            />
          </ChartBoundary>

          <ul className="series-legend">
            {series.map((item) => {
              const latest = [...item.points].reverse().find((value) => value !== null) ?? null;
              return (
                <li key={item.id}>
                  <span
                    className="swatch"
                    style={{ background: colorFor(item.colorIndex, dark) }}
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
                <span className="name">All {result.data?.series.length ?? series.length}</span>
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
            The last {SHOWN_PERIODS} {PERIOD_NOUN[period]}s, each its own consumption. The arrow compares the
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

/**
 * Takes no props, so there is nothing for a parent re-render to change.
 * Without this the card re-rendered on every live power update - about once
 * a second - which is what made tooltips vanish mid-read.
 */
export const TrendCard = memo(TrendCardInner);
