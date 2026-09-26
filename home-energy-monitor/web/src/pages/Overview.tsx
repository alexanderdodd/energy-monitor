import { ApplianceCard } from "../components/ApplianceCard.tsx";
import { ConnectionBanner } from "../components/ConnectionBanner.tsx";
import { Stat } from "../components/Stat.tsx";
import { formatEnergy, formatMoney, formatPower } from "../lib/format.ts";
import { navigate } from "../lib/router.ts";
import { useApiResource } from "../lib/useApi.ts";
import type { LiveSnapshot, Summary } from "../lib/types.ts";

interface Props {
  live: LiveSnapshot | null;
  streaming: boolean;
}

/** Energy totals move slowly; a minute between refreshes is plenty. */
const SUMMARY_REFRESH_MS = 60_000;

export function Overview({ live, streaming }: Props) {
  const summary = useApiResource<Summary>("api/summary", SUMMARY_REFRESH_MS);

  if (summary.loading && !summary.data) {
    return <p className="meta">Loading&hellip;</p>;
  }

  if (!summary.data) {
    return (
      <div className="card empty">
        <h2>Cannot reach Home Assistant</h2>
        <p>{summary.error ?? "No data available yet."}</p>
        <button className="button" onClick={summary.reload}>
          Try again
        </button>
      </div>
    );
  }

  const { totals, appliances, currency } = summary.data;
  const liveById = new Map((live?.appliances ?? []).map((item) => [item.id, item]));
  // The live stream is seconds old; the summary can be up to a minute old.
  const livePower = live ? live.totalPowerW : totals.livePowerW;

  if (appliances.length === 0) {
    return (
      <>
        <ConnectionBanner status={live?.connection ?? summary.data.connection} streaming={streaming} />
        <div className="card empty">
          <h2>No appliances yet</h2>
          <p>Pick the devices you want to monitor and they will appear here.</p>
          <button className="button button-primary" onClick={() => navigate({ name: "setup" })}>
            Find my devices
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <ConnectionBanner status={live?.connection ?? summary.data.connection} streaming={streaming} />

      <div className="card headline">
        <Stat label="Live consumption" value={formatPower(livePower)} accent />
        <Stat
          label="Today"
          value={formatEnergy(totals.energyTodayKwh)}
          hint={`${formatEnergy(totals.energyWeekKwh)} over 7 days`}
        />
        <Stat
          label="Estimated cost today"
          value={formatMoney(totals.costToday, currency)}
          hint={
            totals.estimatedYearlyCost !== null
              ? `≈ ${formatMoney(totals.estimatedYearlyCost, currency)} per year`
              : undefined
          }
        />
      </div>

      <h2 className="section-title">Appliances</h2>
      <div className="appliance-grid">
        {appliances.map((reading) => (
          <ApplianceCard
            key={reading.id}
            reading={reading}
            live={liveById.get(reading.id)}
            currency={currency}
          />
        ))}
      </div>

      {totals.estimatedMonthlyKwh !== null ? (
        <p className="meta" style={{ marginTop: 18 }}>
          Estimated {formatEnergy(totals.estimatedMonthlyKwh)} this month and{" "}
          {formatEnergy(totals.estimatedYearlyKwh)} this year, extrapolated from recent daily use.
        </p>
      ) : null}
    </>
  );
}
