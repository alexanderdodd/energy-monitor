import { lazy, useState } from "react";
import { ChartBoundary } from "../components/ChartBoundary.tsx";
import { ConnectionBanner } from "../components/ConnectionBanner.tsx";
import { CumulativeCard } from "../components/CumulativeCard.tsx";
import { Stat } from "../components/Stat.tsx";
import {
  formatAverageBasis,
  formatCurrent,
  formatRelativeTime,
  formatEnergy,
  formatMoney,
  formatPower,
  formatVoltage,
} from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { useApiResource } from "../lib/useApi.ts";
import type {
  ApplianceDetail as Detail,
  HistoryRange,
  HistoryResult,
  LiveSnapshot,
} from "../lib/types.ts";

// ECharts is a large dependency; keep it out of the initial bundle so the
// overview paints quickly.
const PowerChart = lazy(() => import("../components/PowerChart.tsx"));

const RANGES: HistoryRange[] = ["6h", "24h", "7d", "30d"];

interface Props {
  id: string;
  live: LiveSnapshot | null;
  streaming: boolean;
}

export function ApplianceDetailPage({ id, live, streaming }: Props) {
  const [range, setRange] = useState<HistoryRange>("24h");
  const detail = useApiResource<Detail>(`api/appliances/${encodeURIComponent(id)}`, 60_000);
  const history = useApiResource<HistoryResult>(
    `api/appliances/${encodeURIComponent(id)}/history?range=${range}`,
    120_000,
  );

  if (!detail.data) {
    return (
      <div className="card empty">
        <h2>{detail.loading ? "Loading…" : "Appliance not found"}</h2>
        {!detail.loading ? <p>{detail.error ?? "It may have been removed in Settings."}</p> : null}
        <button className="button" onClick={() => navigate({ name: "overview" })}>
          Back to overview
        </button>
      </div>
    );
  }

  const appliance = detail.data;
  const liveState = live?.appliances.find((item) => item.id === id);
  const powerW = liveState ? liveState.powerW : appliance.powerW;
  const currentA = liveState ? liveState.currentA : appliance.currentA;
  const voltageV = liveState ? liveState.voltageV : appliance.voltageV;
  const available = liveState ? liveState.available : appliance.available;
  const { currency } = appliance;

  const hasPower = appliance.entities.power !== undefined;
  const energyPoints = history.data?.energyDaily.filter((point) => point.v !== null) ?? [];

  return (
    <>
      <ConnectionBanner status={live?.connection ?? appliance.homeAssistant} streaming={streaming} />

      {!available ? (
        <div className="banner warn" role="status">
          <span className="dot" />
          <span>{appliance.name} is not reporting right now.</span>
        </div>
      ) : null}

      <div className="detail-grid">
        <Stat label="Live power" value={available ? formatPower(powerW) : "Unavailable"} accent />
        <Stat label="Current" value={available ? formatCurrent(currentA) : "—"} />
        <Stat label="Voltage" value={available ? formatVoltage(voltageV) : "—"} />
        <Stat label="Today" value={formatEnergy(appliance.energyTodayKwh)} />
        <Stat label="Today cost" value={formatMoney(appliance.costToday, currency)} />
        <Stat label="This week" value={formatEnergy(appliance.energyWeekKwh)} />
        <Stat label="Week cost" value={formatMoney(appliance.costWeek, currency)} />
        <Stat label="This month" value={formatEnergy(appliance.energyMonthKwh)} />
        <Stat label="Month cost" value={formatMoney(appliance.costMonth, currency)} />
        <Stat
          label="Daily average"
          value={formatEnergy(appliance.forecast?.dailyAverageKwh)}
          hint={formatAverageBasis(appliance.forecast?.basedOnDays ?? 0)}
        />
      </div>

      {appliance.forecast ? (
        <>
          <h2 className="section-title">Estimates</h2>
          <div className="detail-grid">
            <Stat
              label="Estimated monthly"
              value={formatEnergy(appliance.forecast.estimatedMonthlyKwh)}
              hint={`From ${appliance.forecast.basedOnDays} day${
                appliance.forecast.basedOnDays === 1 ? "" : "s"
              } of history`}
            />
            <Stat
              label="Estimated yearly"
              value={formatEnergy(appliance.forecast.estimatedYearlyKwh)}
            />
            <Stat
              label="Estimated yearly cost"
              value={formatMoney(appliance.forecast.estimatedYearlyCost, currency)}
            />
          </div>
        </>
      ) : null}

      <div className="card chart-card">
        <div className="chart-head">
          <h2>Power</h2>
          <div className="range-tabs" role="group" aria-label="Chart range">
            {RANGES.map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={option === range}
                onClick={() => setRange(option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        {!hasPower ? (
          <p className="chart-placeholder">No power sensor is mapped for this appliance.</p>
        ) : history.data && history.data.power.length > 0 ? (
          <ChartBoundary>
            <PowerChart
              points={history.data.power}
              kind="line"
              range={range}
              unitLabel="W"
              label={`${appliance.name} power over ${range}`}
            />
          </ChartBoundary>
        ) : (
          <p className="chart-placeholder">
            {history.loading ? "Loading chart…" : (history.error ?? "No history recorded yet.")}
          </p>
        )}

        {history.data?.powerSource === "statistics" ? (
          <p className="meta">Averaged from Home Assistant long-term statistics.</p>
        ) : null}
      </div>

      <CumulativeCard
        basePath={`api/appliances/${encodeURIComponent(id)}/cumulative`}
        subject={appliance.name}
        currency={currency}
        pricePerKwh={appliance.electricityPricePerKwh}
      />

      <details className="card panel diagnostics">
        <summary>Sensor details</summary>
        <p className="description">
          Exactly what Home Assistant reports for each mapped sensor. If a figure above looks
          wrong, the answer is almost always here — the wrong entity in a slot, or a unit the app
          has misread.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Measurement</th>
                <th>Entity</th>
                <th>Reported</th>
                <th>Used as</th>
                <th>Class</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {appliance.sensors.map((sensor) => (
                <tr key={sensor.entityId}>
                  <td>{sensor.role}</td>
                  <td><code>{sensor.entityId}</code></td>
                  <td>
                    {sensor.state ?? "—"} {sensor.unit ?? ""}
                  </td>
                  <td>
                    {sensor.converted === null
                      ? "not a number"
                      : `${sensor.converted} ${sensor.convertedUnit ?? ""}`}
                  </td>
                  <td className="meta">
                    {sensor.deviceClass ?? "—"}
                    {sensor.stateClass ? ` / ${sensor.stateClass}` : ""}
                  </td>
                  <td className="meta">{formatRelativeTime(sensor.lastChanged)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="meta">
          {appliance.hasDailyHistory
            ? "Per-day history is available, so weekly and monthly figures are real sums."
            : "No per-day history yet, so only today can be measured. Periods without a full record show a dash rather than a zero."}
        </p>
      </details>

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
              label={`${appliance.name} daily energy`}
            />
          </ChartBoundary>
        ) : (
          <p className="chart-placeholder">
            No daily totals yet. They appear once Home Assistant has recorded a full day for an
            energy sensor.
          </p>
        )}
      </div>
    </>
  );
}
