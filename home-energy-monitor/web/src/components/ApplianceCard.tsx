import { formatEnergy, formatMoney, formatPower } from "../lib/format.ts";
import { hrefFor, navigate } from "../lib/router.ts";
import type { ApplianceReading, LiveApplianceState } from "../lib/types.ts";

interface Props {
  reading: ApplianceReading;
  live?: LiveApplianceState;
  currency: string;
}

export function ApplianceCard({ reading, live, currency }: Props) {
  // Live values arrive far more often than the summary; prefer them.
  const powerW = live ? live.powerW : reading.powerW;
  const available = live ? live.available || reading.energyTodayKwh !== null : reading.available;
  const href = hrefFor({ name: "appliance", id: reading.id });

  return (
    <a
      className="appliance-card"
      href={href}
      onClick={(event) => {
        // Keep modifier-clicks working as ordinary links.
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate({ name: "appliance", id: reading.id });
      }}
    >
      <span className="name">{reading.name}</span>
      {available ? (
        <span className={powerW && powerW > 1 ? "power active" : "power"}>
          {formatPower(powerW)}
        </span>
      ) : (
        <span className="power unavailable">Unavailable</span>
      )}
      <span className="footer">
        <span>{formatEnergy(reading.energyTodayKwh)} today</span>
        <span>{formatMoney(reading.costToday, currency)}</span>
      </span>
    </a>
  );
}
