import { ApplianceCard } from "../components/ApplianceCard.tsx";
import { CategoryCard } from "../components/CategoryCard.tsx";
import { ConnectionBanner } from "../components/ConnectionBanner.tsx";
import { CumulativeCard } from "../components/CumulativeCard.tsx";
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

  // Category live power is summed from the stream so it moves at the same
  // pace as the appliance cards, rather than lagging a minute behind in the
  // summary.
  const livePowerFor = (applianceIds: string[]): number | null => {
    if (!live) return null;
    const powers = applianceIds
      .map((id) => liveById.get(id)?.powerW)
      .filter((value): value is number => value !== null && value !== undefined);
    if (powers.length === 0) return null;
    return Math.round(powers.reduce((a, b) => a + b, 0) * 10) / 10;
  };
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
          hint={formatMoney(totals.costToday, currency)}
        />
        <Stat
          label="This week"
          value={formatEnergy(totals.energyWeekKwh)}
          hint={formatMoney(totals.costWeek, currency)}
        />
        <Stat
          label="This month"
          value={formatEnergy(totals.energyMonthKwh)}
          hint={formatMoney(totals.costMonth, currency)}
        />
      </div>

      <CumulativeCard
        basePath="api/summary/cumulative"
        subject="the whole house"
        currency={currency}
        pricePerKwh={summary.data.electricityPricePerKwh}
      />

      {summary.data.categories.length > 0 ? (
        <>
          <h2 className="section-title">Categories</h2>
          <div className="category-grid">
            {summary.data.categories.map((category) => (
              <CategoryCard
                key={category.id}
                category={category}
                currency={currency}
                livePowerW={livePowerFor(category.applianceIds)}
              />
            ))}
          </div>
          {summary.data.categoriesOverlap ? (
            <p className="meta overlap-note">
              Some appliances belong to more than one category, so these figures overlap and will
              add up to more than the household total.
            </p>
          ) : null}
        </>
      ) : null}

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
