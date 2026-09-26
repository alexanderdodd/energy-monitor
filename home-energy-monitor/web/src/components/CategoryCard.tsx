import { Sparkline } from "./Sparkline.tsx";
import { TrendBadge } from "./TrendBadge.tsx";
import { formatEnergy, formatMoney, formatPower } from "../lib/format.ts";
import { hrefFor, navigate } from "../lib/router.ts";
import type { CategoryReading } from "../lib/types.ts";

interface Props {
  category: CategoryReading;
  currency: string;
  /** Summed from the live stream; falls back to the summary's own figure. */
  livePowerW: number | null;
}

export function CategoryCard({ category, currency, livePowerW }: Props) {
  const power = livePowerW ?? category.livePowerW;
  const href = hrefFor({ name: "category", id: category.id });
  const recent = category.dailyKwh.slice(-14).map((point) => point.v);

  return (
    <a
      className="category-card"
      href={href}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) return;
        event.preventDefault();
        navigate({ name: "category", id: category.id });
      }}
    >
      <span className="head">
        <span className="name">{category.name}</span>
        <Sparkline values={recent} label={`${category.name} daily energy, last 14 days`} />
      </span>

      <span className="live">
        <span className={power && power > 1 ? "power active" : "power"}>
          {formatPower(power)}
        </span>
        <span className="live-label">now</span>
      </span>

      <span className="figures">
        <span className="energy">{formatEnergy(category.energyTodayKwh)} today</span>
        <span className="cost">{formatMoney(category.costToday, currency)}</span>
      </span>

      <span className="footer">
        <TrendBadge trend={category.trend} />
        <span className="members">
          {category.members.length > 0
            ? category.members.map((member) => member.name).join(", ")
            : "No appliances yet"}
        </span>
      </span>
    </a>
  );
}
