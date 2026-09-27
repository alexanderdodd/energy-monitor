import { lazy, useMemo, useState } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { colorFor, MAX_SERIES } from "../lib/palette.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { CompareResult, CompareScope, CumulativeRange } from "../lib/types.ts";
import type { ComparisonSeries, ComparisonView } from "./ComparisonChart.tsx";

const ComparisonChart = lazy(() => import("./ComparisonChart.tsx"));

const SCOPES: { scope: CompareScope; label: string }[] = [
  { scope: "appliances", label: "Appliances" },
  { scope: "categories", label: "Categories" },
];

const RANGES: { range: CumulativeRange; label: string }[] = [
  { range: "today", label: "Today" },
  { range: "7d", label: "7 days" },
  { range: "30d", label: "30 days" },
];

const VIEWS: { view: ComparisonView; label: string; hint: string }[] = [
  { view: "lines", label: "Over time", hint: "How each one builds up across the range" },
  { view: "bars", label: "Totals", hint: "Ranked, largest first" },
  { view: "share", label: "Share", hint: "Proportion of the total" },
];

/**
 * A donut is only readable at a glance with a handful of segments; bars and
 * lines tolerate the full palette. Anything past the cap folds into "Other"
 * rather than being given a colour of its own.
 */
const CAP: Record<ComparisonView, number> = { lines: MAX_SERIES, bars: MAX_SERIES, share: 6 };

interface Folded {
  series: ComparisonSeries[];
  costs: (number | null)[];
  foldedCount: number;
}

/** Keep the largest contributors; sum the rest into a single "Other". */
function foldSeries(result: CompareResult, cap: number): Folded {
  // Defensive: a response that is not the shape we expect should degrade to
  // "nothing to show", never throw and take the dashboard with it.
  const source = Array.isArray(result.series) ? result.series : [];
  const buckets = Array.isArray(result.buckets) ? result.buckets : [];
  const withIndex = source.map((item, index) => ({
    ...item,
    points: Array.isArray(item.points) ? item.points : [],
    colorIndex: index,
  }));
  if (withIndex.length <= cap) {
    return {
      series: withIndex.map(({ id, name, points, totalKwh, colorIndex }) => ({
        id,
        name,
        points,
        totalKwh,
        colorIndex,
      })),
      costs: withIndex.map((item) => item.cost),
      foldedCount: 0,
    };
  }

  const ranked = [...withIndex].sort((a, b) => (b.totalKwh ?? 0) - (a.totalKwh ?? 0));
  const kept = ranked.slice(0, cap - 1);
  const rest = ranked.slice(cap - 1);

  const points = buckets.map((_, bucket) => {
    const values = rest
      .map((item) => item.points[bucket])
      .filter((value): value is number => value !== null && value !== undefined);
    return values.length > 0 ? values.reduce((a, b) => a + b, 0) : null;
  });

  return {
    series: [
      ...kept.map(({ id, name, points: p, totalKwh, colorIndex }) => ({
        id,
        name,
        points: p,
        totalKwh,
        colorIndex,
      })),
      {
        id: "__other",
        name: `Other (${rest.length})`,
        points,
        totalKwh: rest.reduce((sum, item) => sum + (item.totalKwh ?? 0), 0),
        colorIndex: MAX_SERIES, // past the palette: the reserved neutral
      },
    ],
    costs: [
      ...kept.map((item) => item.cost),
      rest.reduce((sum, item) => sum + (item.cost ?? 0), 0),
    ],
    foldedCount: rest.length,
  };
}

/**
 * Compare appliances or categories against each other.
 *
 * Every figure here is the same running total the individual pages show, so
 * the comparison can never disagree with the page it links to.
 */
export function ComparisonCard() {
  const [scope, setScope] = useState<CompareScope>("appliances");
  const [range, setRange] = useState<CumulativeRange>("today");
  const [view, setView] = useState<ComparisonView>("lines");

  const result = useApiResource<CompareResult>(
    `api/compare?scope=${scope}&range=${range}`,
    120_000,
  );

  const dark =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  const folded = useMemo(
    () => (result.data ? foldSeries(result.data, CAP[view]) : null),
    [result.data, view],
  );

  const currency = result.data?.currency ?? "EUR";
  const hasData = folded !== null && folded.series.some((item) => (item.totalKwh ?? 0) > 0);

  return (
    <div className="card chart-card comparison">
      <div className="chart-head">
        <h2>Compare</h2>
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
          <div className="range-tabs" role="group" aria-label="Range">
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
          <div className="range-tabs" role="group" aria-label="Chart">
            {VIEWS.map((option) => (
              <button
                key={option.view}
                type="button"
                title={option.hint}
                aria-pressed={option.view === view}
                onClick={() => setView(option.view)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasData && folded ? (
        <>
          <ChartBoundary>
            <ComparisonChart
              view={view}
              buckets={Array.isArray(result.data?.buckets) ? result.data.buckets : []}
              series={folded.series}
              range={range}
            />
          </ChartBoundary>

          {/* Always present for two or more series, and doubling as the table
              view: identity never rests on colour alone. */}
          <ul className="series-legend">
            {folded.series.map((item, index) => (
              <li key={item.id}>
                <span
                  className="swatch"
                  style={{ background: colorFor(item.colorIndex, dark) }}
                  aria-hidden="true"
                />
                <span className="name">{item.name}</span>
                <span className="value">{formatEnergy(item.totalKwh)}</span>
                <span className="cost">{formatMoney(folded.costs[index] ?? null, currency)}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="chart-placeholder">
          {result.loading
            ? "Loading…"
            : (result.error ??
              (scope === "categories"
                ? "No categories yet. Add some in Settings to compare them."
                : "Nothing recorded for this range yet."))}
        </p>
      )}
    </div>
  );
}
