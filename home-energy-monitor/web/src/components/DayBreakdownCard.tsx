import { lazy, memo, useMemo, useState } from "react";
import { ChartBoundary } from "./ChartBoundary.tsx";
import { formatEnergy, formatMoney } from "../lib/format.ts";
import { foldByTotal, OTHER_COLOR_INDEX } from "../lib/fold.ts";
import { colorFor } from "../lib/palette.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { BreakdownItem, BreakdownResult } from "../lib/types.ts";
import type { BreakdownSlice, BreakdownView } from "./BreakdownChart.tsx";

const BreakdownChart = lazy(() => import("./BreakdownChart.tsx"));

const VIEWS: { view: BreakdownView; label: string }[] = [
  { view: "share", label: "Share" },
  { view: "bars", label: "Amounts" },
];

/** A donut reads at a glance only with a handful of segments. */
const DONUT_CAP = 6;

/** `YYYY-MM-DD` for a local calendar day, the form the API and date input take. */
export function dayKey(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function shiftDay(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  // By the calendar, not 24-hour steps, which slip across a DST change.
  return dayKey(new Date(year!, month! - 1, day! + days));
}

function dayTitle(key: string, today: string): string {
  if (key === today) return "Today so far";
  if (key === shiftDay(today, -1)) return "Yesterday";
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

interface PanelProps {
  title: string;
  items: BreakdownItem[];
  view: BreakdownView;
  currency: string;
  dark: boolean;
  note?: string;
}

function BreakdownPanel({ title, items, view, currency, dark, note }: PanelProps) {
  const { slices, colorOf, total } = useMemo(() => {
    const measured = items
      .filter((item) => item.kwh !== null && item.kwh > 0)
      .map((item) => ({ ...item, totalKwh: item.kwh }));
    const sum = measured.reduce((acc, item) => acc + (item.kwh ?? 0), 0);

    const byRank = (a: BreakdownSlice, b: BreakdownSlice) => b.kwh - a.kwh;
    const colors = new Map<string, number>();

    if (view === "bars") {
      // Every appliance gets its own bar; colour plays no part.
      const bars = measured.map((item) => ({
        id: item.id,
        name: item.name,
        kwh: item.kwh ?? 0,
        colorIndex: 0,
      }));
      return { slices: bars.sort(byRank), colorOf: colors, total: sum };
    }

    const { kept, rest } = foldByTotal(measured, DONUT_CAP);
    const donut: BreakdownSlice[] = kept.map((item) => {
      colors.set(item.id, item.colorIndex);
      return { id: item.id, name: item.name, kwh: item.kwh ?? 0, colorIndex: item.colorIndex };
    });
    donut.sort(byRank);
    if (rest.length > 0) {
      for (const item of rest) colors.set(item.id, OTHER_COLOR_INDEX);
      donut.push({
        id: "__other",
        name: `Other (${rest.length})`,
        kwh: rest.reduce((acc, item) => acc + (item.kwh ?? 0), 0),
        colorIndex: OTHER_COLOR_INDEX,
      });
    }
    return { slices: donut, colorOf: colors, total: sum };
  }, [items, view]);

  // Every item, largest first, with the unrecorded ones last: they have no
  // size to rank by, and they are not zero.
  const table = useMemo(
    () => [...items].sort((a, b) => (b.kwh ?? -1) - (a.kwh ?? -1)),
    [items],
  );

  return (
    <section className="breakdown-panel" aria-label={title}>
      <h3>{title}</h3>
      {slices.length > 0 ? (
        <ChartBoundary>
          <BreakdownChart view={view} slices={slices} label={`${title}: energy used that day`} />
        </ChartBoundary>
      ) : (
        <p className="chart-placeholder">Nothing used that day.</p>
      )}

      {/* The exact figures, and the relief the palette needs: identity
          never rests on colour alone. */}
      <ul className="breakdown-table">
        {table.map((item) => {
          const slot = view === "share" ? colorOf.get(item.id) : undefined;
          const share =
            item.kwh !== null && total > 0 ? `${((item.kwh / total) * 100).toFixed(0)}%` : "";
          return (
            <li key={item.id}>
              <span
                className="swatch"
                style={slot === undefined ? undefined : { background: colorFor(slot, dark) }}
                aria-hidden="true"
              />
              <span className="name">{item.name}</span>
              <span className="value">
                {item.kwh === null ? <span className="meta">No record</span> : formatEnergy(item.kwh)}
              </span>
              <span className="share">{share}</span>
              <span className="cost">{formatMoney(item.cost, currency)}</span>
            </li>
          );
        })}
      </ul>
      {note ? <p className="meta">{note}</p> : null}
    </section>
  );
}

interface Props {
  /** Limit to one category's appliances, for the category page. */
  categoryId?: string;
}

/**
 * What used what on one day, by appliance and (on the overview) by category.
 *
 * Read from the same daily series as the cards, so "Today so far" here adds
 * up to the "Today" figures printed elsewhere on the page.
 */
function DayBreakdownCardInner({ categoryId }: Props) {
  const today = dayKey(new Date());
  const [day, setDay] = useState(today);
  const [view, setView] = useState<BreakdownView>("share");

  const query = `api/breakdown?date=${day}${
    categoryId ? `&category=${encodeURIComponent(categoryId)}` : ""
  }`;
  const result = useApiResource<BreakdownResult>(query, 120_000);

  const dark =
    typeof window !== "undefined" &&
    (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false);

  const data = result.data;
  const earliest = data?.earliestDay ? dayKey(new Date(data.earliestDay)) : null;
  const appliances = useMemo(
    () => (Array.isArray(data?.appliances) ? data.appliances : []),
    [data],
  );
  const categories = useMemo(
    () => (Array.isArray(data?.categories) && data.categories.length > 0 ? data.categories : null),
    [data],
  );
  const currency = data?.currency ?? "EUR";
  const total = typeof data?.totalKwh === "number" ? data.totalKwh : null;

  return (
    <div className="card chart-card breakdown">
      <div className="chart-head">
        <h2>
          {dayTitle(day, today)}
          {total !== null ? <span className="chart-total"> {formatEnergy(total)}</span> : null}
        </h2>
        <div className="head-right">
          <div className="range-tabs" role="group" aria-label="Day">
            <button
              type="button"
              aria-label="Previous day"
              disabled={earliest !== null && day <= earliest}
              onClick={() => setDay(shiftDay(day, -1))}
            >
              ‹
            </button>
            <button
              type="button"
              aria-pressed={day === shiftDay(today, -1)}
              onClick={() => setDay(shiftDay(today, -1))}
            >
              Yesterday
            </button>
            <button type="button" aria-pressed={day === today} onClick={() => setDay(today)}>
              Today
            </button>
            <button
              type="button"
              aria-label="Next day"
              disabled={day >= today}
              onClick={() => setDay(shiftDay(day, 1))}
            >
              ›
            </button>
          </div>
          <input
            className="day-input"
            type="date"
            aria-label="Pick a day"
            value={day}
            min={earliest ?? undefined}
            max={today}
            onChange={(event) => {
              if (event.target.value) setDay(event.target.value);
            }}
          />
          <div className="range-tabs" role="group" aria-label="Breakdown chart">
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

      {data && appliances.length > 0 ? (
        <div className="breakdown-grid">
          <BreakdownPanel
            title="By appliance"
            items={appliances}
            view={view}
            currency={currency}
            dark={dark}
          />
          {categories ? (
            <BreakdownPanel
              title="By category"
              items={categories}
              view={view}
              currency={currency}
              dark={dark}
              note={
                data.categoriesOverlap
                  ? "Some appliances are in more than one category, so they count towards each, and the categories add up to more than the day's total."
                  : undefined
              }
            />
          ) : null}
        </div>
      ) : (
        <p className="chart-placeholder">
          {result.loading ? "Loading…" : (result.error ?? "Nothing recorded for this day.")}
        </p>
      )}
    </div>
  );
}

/** Memoised: the overview re-renders on every live reading. */
export const DayBreakdownCard = memo(DayBreakdownCardInner);
