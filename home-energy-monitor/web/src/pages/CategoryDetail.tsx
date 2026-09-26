import { lazy, useEffect } from "react";
import { ChartBoundary } from "../components/ChartBoundary.tsx";
import { ConnectionBanner } from "../components/ConnectionBanner.tsx";
import { CumulativeCard } from "../components/CumulativeCard.tsx";
import { Stat } from "../components/Stat.tsx";
import { TrendBadge } from "../components/TrendBadge.tsx";
import { formatEnergy, formatMoney, formatPower } from "../lib/format.ts";
import { hrefFor, navigate } from "../lib/router.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { CategoryDetail as Detail, LiveSnapshot } from "../lib/types.ts";

const PowerChart = lazy(() => import("../components/PowerChart.tsx"));

interface Props {
  id: string;
  live: LiveSnapshot | null;
  streaming: boolean;
  /** Reports the category's name so the masthead can show it. */
  onTitle: (name: string | undefined) => void;
}

export function CategoryDetailPage({ id, live, streaming, onTitle }: Props) {
  const category = useApiResource<Detail>(`api/categories/${encodeURIComponent(id)}`, 60_000);
  const name = category.data?.name;

  useEffect(() => {
    onTitle(name);
  }, [name, onTitle]);

  if (!category.data) {
    return (
      <div className="card empty">
        <h2>{category.loading ? "Loading…" : "Category not found"}</h2>
        {!category.loading ? (
          <p>{category.error ?? "It may have been removed in Settings."}</p>
        ) : null}
        <button className="button" onClick={() => navigate({ name: "overview" })}>
          Back to overview
        </button>
      </div>
    );
  }

  const data = category.data;
  const { currency } = data;

  // Live power comes from the stream, summed across the member appliances.
  const liveById = new Map((live?.appliances ?? []).map((item) => [item.id, item]));
  const livePowers = data.members
    .map((member) => liveById.get(member.id)?.powerW)
    .filter((value): value is number => value !== null && value !== undefined);
  const livePowerW = live && livePowers.length > 0
    ? Math.round(livePowers.reduce((a, b) => a + b, 0) * 10) / 10
    : data.livePowerW;

  const energyPoints = data.dailyKwh.filter((point) => point.v !== null);

  return (
    <>
      <ConnectionBanner status={live?.connection ?? data.homeAssistant} streaming={streaming} />

      <div className="detail-grid">
        <Stat label="Live power" value={formatPower(livePowerW)} accent />
        <Stat label="Today" value={formatEnergy(data.energyTodayKwh)} />
        <Stat label="Today cost" value={formatMoney(data.costToday, currency)} />
        <Stat label="Last 7 days" value={formatEnergy(data.energyWeekKwh)} />
        <Stat label="7 day cost" value={formatMoney(data.costWeek, currency)} />
        <Stat label="This month" value={formatEnergy(data.energyMonthKwh)} />
        <Stat label="Month cost" value={formatMoney(data.costMonth, currency)} />
      </div>

      {data.trend?.comparable ? (
        <p className="trend-line">
          <TrendBadge trend={data.trend} />
          <span className="meta">
            {formatEnergy(data.trend.currentKwh)} in the last {data.trend.windowDays} days, against{" "}
            {formatEnergy(data.trend.previousKwh)} in the {data.trend.windowDays} before.
          </span>
        </p>
      ) : null}

      <CumulativeCard
        basePath={`api/categories/${encodeURIComponent(id)}/cumulative`}
        subject={data.name}
        currency={currency}
        pricePerKwh={data.electricityPricePerKwh}
      />

      <div className="card chart-card">
        <div className="chart-head">
          <h2>Daily energy</h2>
        </div>
        {energyPoints.length > 0 ? (
          <ChartBoundary>
            <PowerChart
              points={energyPoints}
              kind="bar"
              range="30d"
              unitLabel="kWh"
              label={`${data.name} daily energy`}
            />
          </ChartBoundary>
        ) : (
          <p className="chart-placeholder">
            No daily totals yet. They appear once Home Assistant has recorded a full day for an
            energy sensor.
          </p>
        )}
      </div>

      <div className="card panel">
        <h2>Appliances in this category</h2>
        {data.members.length === 0 ? (
          <p className="meta">
            Nothing is assigned yet. Add appliances to this category in Settings.
          </p>
        ) : (
          <ul className="member-list">
            {data.members.map((member) => (
              <li key={member.id}>
                <a
                  href={hrefFor({ name: "appliance", id: member.id })}
                  onClick={(event) => {
                    if (event.metaKey || event.ctrlKey) return;
                    event.preventDefault();
                    navigate({ name: "appliance", id: member.id });
                  }}
                >
                  {member.name}
                </a>
                <span className="meta">{formatPower(liveById.get(member.id)?.powerW ?? null)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}
