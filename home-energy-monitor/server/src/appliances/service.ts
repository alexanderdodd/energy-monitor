import { log } from "../logger.ts";
import {
  buildDailyEnergy,
  buildHistory,
  sumDailyEnergy,
  type HistoryRange,
  type HistoryResult,
} from "../ha/history.ts";
import type { ConnectionStatus, HaSource, StatisticsPeriod } from "../ha/types.ts";
import type { ConfigStore } from "../config/store.ts";
import {
  alignByBucket,
  alignCumulative,
  costOf,
  groupByPeriod,
  startOfLocalWeek,
  cumulativeEnergy,
  holdLevel,
  forecastFromDailyTotals,
  parseNumericState,
  roundTo,
  runningTotal,
  startOfLocalDay,
  startOfLocalDayBefore,
  startOfLocalMonth,
  sumSeriesByBucket,
  toCanonicalUnit,
  unitScale,
  trendOverWindows,
  type BucketPeriod,
  type ChartPoint,
  type Forecast,
  type MeasurementKind,
} from "./calculations.ts";
import type {
  Appliance,
  ApplianceReading,
  Category,
  CategoryReading,
  EntityRole,
} from "./types.ts";

/**
 * How long a set of daily-energy statistics is reused before being refetched.
 * Long-term statistics only move once every five minutes, so a minute of
 * staleness costs nothing and keeps the Pi quiet.
 */
const ENERGY_CACHE_TTL_MS = 60_000;

/** Days of daily buckets to keep, enough for the 30-day view and forecasts. */
const ENERGY_WINDOW_DAYS = 30;

interface DailyEnergy {
  points: ChartPoint[];
  /**
   * True when real per-day history sits behind the series, whether from
   * Home Assistant's statistics or recovered from a daily counter's recorded
   * history. False when the only figure available is today's, read straight
   * off a counter, in which case nothing can be said about any earlier day.
   */
  fromStatistics: boolean;
}

interface CachedEnergy {
  fetchedAt: number;
  daily: DailyEnergy;
}

export interface LiveApplianceState {
  id: string;
  name: string;
  available: boolean;
  powerW: number | null;
  currentA: number | null;
  voltageV: number | null;
}

export interface LiveSnapshot {
  generatedAt: string;
  connection: ConnectionStatus;
  totalPowerW: number | null;
  appliances: LiveApplianceState[];
}

export interface SummaryTotals {
  livePowerW: number | null;
  energyTodayKwh: number | null;
  costToday: number | null;
  energyWeekKwh: number | null;
  costWeek: number | null;
  energyMonthKwh: number | null;
  costMonth: number | null;
  /** Mean kWh per complete day in the recent window; the forecast's own figure. */
  dailyAverageKwh: number | null;
  /** How many complete days the average covers. */
  dailyAverageDays: number;
  estimatedMonthlyKwh: number | null;
  estimatedYearlyKwh: number | null;
  estimatedYearlyCost: number | null;
}

export interface Summary {
  generatedAt: string;
  connection: ConnectionStatus;
  currency: string;
  electricityPricePerKwh: number;
  setupComplete: boolean;
  totals: SummaryTotals;
  appliances: ApplianceReading[];
  categories: CategoryReading[];
  /**
   * True when at least one appliance belongs to more than one category, so
   * the UI knows to say that category totals overlap. Stating it only when
   * it is actually true keeps the caveat meaningful.
   */
  categoriesOverlap: boolean;
}

/** Five minutes keeps a full day under 300 points - plenty for a day curve. */
const CUMULATIVE_BUCKET_MS = 5 * 60_000;

/** How far back a cumulative curve reaches. */
export type CumulativeRange = "today" | "7d" | "30d";

export function isCumulativeRange(value: string): value is CumulativeRange {
  return value === "today" || value === "7d" || value === "30d";
}

export interface CumulativeResult {
  range: CumulativeRange;
  start: number;
  end: number;
  /** Running total of kWh across the range. Empty when nothing recorded. */
  points: ChartPoint[];
  totalKwh: number | null;
  /**
   * Where the curve came from. "statistics" accumulates Home Assistant's own
   * energy statistics; "meter" follows a vendor "energy today" counter, which
   * is already a running total; "history" integrates the power sensor and is
   * the last resort, covering only what the recorder still holds.
   */
  source: "statistics" | "meter" | "history";
}

/**
 * What a mapped sensor is actually reporting, raw.
 *
 * Exposed because a wrong number on the dashboard is nearly impossible to
 * diagnose from the dashboard: "0.21" could be a plug reporting kW, a plug
 * idling at a fifth of a watt, or the wrong entity mapped to the slot, and
 * they look identical once charted.
 */
export interface SensorDiagnostic {
  role: EntityRole;
  entityId: string;
  /** The state exactly as Home Assistant reports it. */
  state: string | null;
  unit: string | null;
  deviceClass: string | null;
  stateClass: string | null;
  lastChanged: string | null;
  /** The value after unit conversion, and the unit it is now in. */
  converted: number | null;
  convertedUnit: string | null;
}

export type CompareScope = "appliances" | "categories";

export function isCompareScope(value: string): value is CompareScope {
  return value === "appliances" || value === "categories";
}

export interface CompareSeries {
  id: string;
  name: string;
  /** Running kWh total at each shared bucket; null before the first reading. */
  points: (number | null)[];
  totalKwh: number | null;
  cost: number | null;
}

export interface CompareResult {
  scope: CompareScope;
  range: CumulativeRange;
  start: number;
  end: number;
  /** Shared time axis for every series. */
  buckets: number[];
  series: CompareSeries[];
  totalKwh: number | null;
  currency: string;
}

export type TrendPeriod = BucketPeriod;

export function isTrendPeriod(value: string): value is TrendPeriod {
  return value === "day" || value === "week" || value === "month";
}

export interface TrendSeries {
  id: string;
  name: string;
  /** That period's own consumption, not a running total. Null where unknown. */
  points: (number | null)[];
  /**
   * Change between the last two *complete* periods, as a percentage. The
   * period underway is excluded: part of a day measured against a whole one
   * always looks like a fall.
   */
  changePercent: number | null;
}

export interface TrendResult {
  scope: CompareScope;
  period: TrendPeriod;
  buckets: number[];
  /**
   * Everything added together per period, so the question "is the house using
   * more" can be answered without summing four series by eye.
   */
  total: { points: (number | null)[]; changePercent: number | null };
  /**
   * The bucket for the period currently underway, which is only part
   * finished. Kept in the chart, but excluded from the change figure and
   * flagged so the UI can say so.
   */
  inProgressFrom: number | null;
  series: TrendSeries[];
  currency: string;
  electricityPricePerKwh: number;
}

export interface ApplianceDetail extends ApplianceReading {
  entities: Appliance["entities"];
  energyWeekKwh: number | null;
  costWeek: number | null;
  energyMonthKwh: number | null;
  costMonth: number | null;
  forecast: (Forecast & { estimatedYearlyCost: number | null }) | null;
  sensors: SensorDiagnostic[];
  /** True when real per-day history backs the weekly and monthly figures. */
  hasDailyHistory: boolean;
}

/**
 * Turns Home Assistant entity states into the appliance-level numbers the
 * dashboard shows. Owns the small amount of caching needed to keep repeated
 * requests off the Home Assistant recorder.
 */
export class ApplianceService {
  readonly #source: HaSource;
  readonly #store: ConfigStore;
  readonly #energyCache = new Map<string, CachedEnergy>();

  constructor(source: HaSource, store: ConfigStore) {
    this.#source = source;
    this.#store = store;
  }

  /** Drop cached statistics, e.g. after the appliance mapping changed. */
  invalidate(): void {
    this.#energyCache.clear();
  }

  /** Every entity id the configured appliances care about. */
  watchedEntityIds(): Set<string> {
    const ids = new Set<string>();
    for (const appliance of this.#store.enabledAppliances()) {
      for (const entityId of Object.values(appliance.entities)) {
        if (entityId) ids.add(entityId);
      }
    }
    return ids;
  }

  /**
   * Read one measurement from the cached state, converted to its canonical
   * unit. Returns null for `unavailable`, `unknown` and anything non-numeric,
   * which the UI renders as "Unavailable" rather than as zero.
   */
  #measurement(appliance: Appliance, role: EntityRole, kind: MeasurementKind): number | null {
    const entityId = appliance.entities[role];
    if (!entityId) return null;
    const state = this.#source.getCachedState(entityId);
    if (!state) return null;
    return toCanonicalUnit(
      parseNumericState(state.state),
      state.attributes.unit_of_measurement,
      kind,
    );
  }

  #liveState(appliance: Appliance): LiveApplianceState {
    const powerW = this.#measurement(appliance, "power", "power");
    const currentA = this.#measurement(appliance, "current", "current");
    const voltageV = this.#measurement(appliance, "voltage", "voltage");

    // "Available" means at least one configured sensor is reporting a number.
    const available = powerW !== null || currentA !== null || voltageV !== null;

    return { id: appliance.id, name: appliance.name, available, powerW, currentA, voltageV };
  }

  /** Live values straight from the state cache - no Home Assistant calls. */
  getLiveSnapshot(): LiveSnapshot {
    const appliances = this.#store.enabledAppliances().map((appliance) => this.#liveState(appliance));
    const powers = appliances
      .map((appliance) => appliance.powerW)
      .filter((value): value is number => value !== null);

    return {
      generatedAt: new Date().toISOString(),
      connection: this.#source.status(),
      totalPowerW: powers.length > 0 ? roundTo(powers.reduce((a, b) => a + b, 0), 1) : null,
      appliances,
    };
  }

  /**
   * Daily energy buckets for an appliance over the rolling window, cached
   * briefly. Falls back to the vendor's "energy today" sensor when no
   * statistics are available for the cumulative meter.
   */
  async #dailyEnergy(appliance: Appliance, now: Date): Promise<DailyEnergy> {
    const cached = this.#energyCache.get(appliance.id);
    if (cached && now.getTime() - cached.fetchedAt < ENERGY_CACHE_TTL_MS) {
      return cached.daily;
    }

    let points: ChartPoint[] = [];
    try {
      points = await buildDailyEnergy(
        this.#source,
        appliance,
        startOfLocalDayBefore(now, ENERGY_WINDOW_DAYS),
        now,
      );
    } catch (error) {
      log.debug(`Energy statistics unavailable for ${appliance.id}: ${(error as Error).message}`);
    }

    let daily: DailyEnergy = { points, fromStatistics: points.length > 0 };

    if (daily.points.length === 0) {
      const today = this.#measurement(appliance, "energyDay", "energy");
      if (today !== null) {
        daily = {
          points: [{ t: startOfLocalDay(now).getTime(), v: today }],
          fromStatistics: false,
        };
      }
    }

    this.#energyCache.set(appliance.id, { fetchedAt: now.getTime(), daily });
    return daily;
  }

  /**
   * Energy for each period an appliance reports on.
   *
   * Without statistics the only thing known is today, read off the vendor's
   * daily counter. Summing that single figure over a week would print a
   * confident 0.00 kWh for six days nobody has any record of, so the week
   * comes back null - unknown, which the UI shows as a dash.
   *
   * The month is different: plugs commonly expose a monthly counter too, and
   * ignoring it meant showing 0.00 kWh for a month the device itself said was
   * 1.86 kWh.
   */
  async #energyPeriods(
    appliance: Appliance,
    now: Date,
  ): Promise<{ daily: DailyEnergy; today: number | null; week: number | null; month: number | null }> {
    const daily = await this.#dailyEnergy(appliance, now);

    // A plain sum of the days actually measured. Two earlier attempts got
    // this wrong in opposite directions: reading the vendor's monthly
    // counter reported energy used before monitoring ever began, and
    // refusing any period without a complete record blanked the week out
    // entirely. What the dashboard is for is the energy it has measured, so
    // that is what it adds up.
    return {
      daily,
      today: sumDailyEnergy(daily.points, now),
      week: sumDailyEnergy(daily.points, startOfLocalDayBefore(now, 6)),
      month: sumDailyEnergy(daily.points, startOfLocalMonth(now)),
    };
  }

  async #reading(appliance: Appliance, pricePerKwh: number, now: Date): Promise<ApplianceReading> {
    const live = this.#liveState(appliance);
    const { today: energyTodayKwh } = await this.#energyPeriods(appliance, now);

    return {
      ...live,
      // An appliance with no live sensors but a recorded total today is still
      // present, just not reporting right now.
      available: live.available || energyTodayKwh !== null,
      energyTodayKwh,
      costToday: costOf(energyTodayKwh, pricePerKwh),
    };
  }

  async getSummary(now = new Date()): Promise<Summary> {
    const config = this.#store.get();
    const { electricityPricePerKwh: price, currency } = config.settings;
    const appliances = this.#store.enabledAppliances();

    const readings: ApplianceReading[] = [];
    const dailySeries: ChartPoint[][] = [];
    const weekly: (number | null)[] = [];
    const monthly: (number | null)[] = [];

    for (const appliance of appliances) {
      readings.push(await this.#reading(appliance, price, now));
      const periods = await this.#energyPeriods(appliance, now);
      dailySeries.push(periods.daily.points);
      weekly.push(periods.week);
      monthly.push(periods.month);
    }

    const totals = this.#totals(readings, dailySeries, weekly, monthly, price, now);

    // Reuse the per-appliance series already fetched above rather than
    // asking Home Assistant for the same statistics again.
    const dailyByAppliance = new Map<string, ChartPoint[]>();
    appliances.forEach((appliance, index) => {
      dailyByAppliance.set(appliance.id, dailySeries[index] ?? []);
    });

    const periodsByAppliance = new Map<string, { week: number | null; month: number | null }>();
    appliances.forEach((appliance, index) => {
      periodsByAppliance.set(appliance.id, {
        week: weekly[index] ?? null,
        month: monthly[index] ?? null,
      });
    });

    const categories = config.categories.map((category) =>
      this.#categoryReading(category, appliances, dailyByAppliance, periodsByAppliance, price, now),
    );

    return {
      generatedAt: now.toISOString(),
      connection: this.#source.status(),
      currency,
      electricityPricePerKwh: price,
      setupComplete: config.setupComplete,
      totals,
      appliances: readings,
      categories,
      categoriesOverlap: hasOverlap(config.categories),
    };
  }

  /**
   * Roll a category's member appliances up into one set of figures.
   *
   * Synchronous by design: it works from series the caller has already
   * fetched, so adding categories costs no extra Home Assistant traffic.
   */
  #categoryReading(
    category: Category,
    appliances: Appliance[],
    dailyByAppliance: Map<string, ChartPoint[]>,
    periodsByAppliance: Map<string, { week: number | null; month: number | null }>,
    price: number,
    now: Date,
  ): CategoryReading {
    // Ignore ids for appliances that have since been removed or disabled,
    // rather than treating stale membership as an error.
    const members = category.applianceIds
      .map((id) => appliances.find((appliance) => appliance.id === id))
      .filter((appliance): appliance is Appliance => appliance !== undefined);

    const livePowers = members
      .map((appliance) => this.#measurement(appliance, "power", "power"))
      .filter((value): value is number => value !== null);

    const daily = sumSeriesByBucket(
      members.map((appliance) => dailyByAppliance.get(appliance.id) ?? []),
    );

    const energyTodayKwh = sumDailyEnergy(daily, now);
    // Weekly and monthly figures come from each member's own periods, which
    // know whether real history exists behind them. Re-deriving them from the
    // merged daily series would turn a member's "unknown week" into a zero.
    const energyWeekKwh = sumValues(
      members.map((appliance) => periodsByAppliance.get(appliance.id)?.week ?? null),
    );
    const energyMonthKwh = sumValues(
      members.map((appliance) => periodsByAppliance.get(appliance.id)?.month ?? null),
    );
    // Same arithmetic as the household and appliance forecasts: whole days
    // only, since today is still in progress.
    const todayStart = startOfLocalDay(now).getTime();
    const average = forecastFromDailyTotals(
      daily.filter((point) => point.v !== null && point.t < todayStart).map((point) => point.v!),
      now,
    );

    return {
      id: category.id,
      name: category.name,
      applianceIds: category.applianceIds,
      members: members.map((appliance) => ({ id: appliance.id, name: appliance.name })),
      livePowerW:
        livePowers.length > 0 ? roundTo(livePowers.reduce((a, b) => a + b, 0), 1) : null,
      energyTodayKwh,
      costToday: costOf(energyTodayKwh, price),
      energyWeekKwh,
      costWeek: costOf(energyWeekKwh, price),
      energyMonthKwh,
      costMonth: costOf(energyMonthKwh, price),
      dailyAverageKwh: average?.dailyAverageKwh ?? null,
      dailyAverageDays: average?.basedOnDays ?? 0,
      dailyKwh: daily,
      trend: trendOverWindows(daily, now),
    };
  }

  async getCategoryDetail(id: string, now = new Date()): Promise<CategoryReading | null> {
    const category = this.#store.getCategory(id);
    if (!category) return null;

    const price = this.#store.get().settings.electricityPricePerKwh;
    const appliances = this.#store.enabledAppliances();

    const dailyByAppliance = new Map<string, ChartPoint[]>();
    const periodsByAppliance = new Map<string, { week: number | null; month: number | null }>();
    for (const appliance of appliances) {
      if (!category.applianceIds.includes(appliance.id)) continue;
      const periods = await this.#energyPeriods(appliance, now);
      dailyByAppliance.set(appliance.id, periods.daily.points);
      periodsByAppliance.set(appliance.id, { week: periods.week, month: periods.month });
    }

    return this.#categoryReading(
      category,
      appliances,
      dailyByAppliance,
      periodsByAppliance,
      price,
      now,
    );
  }

  #totals(
    readings: ApplianceReading[],
    dailySeries: ChartPoint[][],
    weekly: (number | null)[],
    monthly: (number | null)[],
    price: number,
    now: Date,
  ): SummaryTotals {
    const livePowers = readings
      .map((reading) => reading.powerW)
      .filter((value): value is number => value !== null);
    const energyToday = sumValues(readings.map((reading) => reading.energyTodayKwh));

    const energyWeek = sumValues(weekly);
    const energyMonth = sumValues(monthly);

    // Forecast from whole days only; today is still in progress.
    const todayStart = startOfLocalDay(now).getTime();
    const householdByDay = new Map<number, number>();
    for (const series of dailySeries) {
      for (const point of series) {
        if (point.v === null || point.t >= todayStart) continue;
        householdByDay.set(point.t, (householdByDay.get(point.t) ?? 0) + point.v);
      }
    }
    const forecast = forecastFromDailyTotals([...householdByDay.values()], now);

    return {
      livePowerW: livePowers.length > 0 ? roundTo(livePowers.reduce((a, b) => a + b, 0), 1) : null,
      energyTodayKwh: energyToday,
      costToday: costOf(energyToday, price),
      energyWeekKwh: energyWeek,
      costWeek: costOf(energyWeek, price),
      energyMonthKwh: energyMonth,
      costMonth: costOf(energyMonth, price),
      dailyAverageKwh: forecast?.dailyAverageKwh ?? null,
      dailyAverageDays: forecast?.basedOnDays ?? 0,
      estimatedMonthlyKwh: forecast?.estimatedMonthlyKwh ?? null,
      estimatedYearlyKwh: forecast?.estimatedYearlyKwh ?? null,
      estimatedYearlyCost: costOf(forecast?.estimatedYearlyKwh ?? null, price),
    };
  }

  /** Canonical unit each measurement is converted into. */
  static readonly #CANONICAL: Record<MeasurementKind, string> = {
    power: "W",
    energy: "kWh",
    current: "A",
    voltage: "V",
  };

  static readonly #ROLE_KINDS: Record<EntityRole, MeasurementKind> = {
    power: "power",
    current: "current",
    voltage: "voltage",
    energy: "energy",
    energyDay: "energy",
    energyMonth: "energy",
  };

  #diagnostics(appliance: Appliance): SensorDiagnostic[] {
    const roles = Object.keys(ApplianceService.#ROLE_KINDS) as EntityRole[];

    return roles.flatMap((role) => {
      const entityId = appliance.entities[role];
      if (!entityId) return [];

      const kind = ApplianceService.#ROLE_KINDS[role];
      const state = this.#source.getCachedState(entityId);
      const unit = state?.attributes.unit_of_measurement ?? null;

      return [
        {
          role,
          entityId,
          state: state?.state ?? null,
          unit,
          deviceClass: state?.attributes.device_class ?? null,
          stateClass: state?.attributes.state_class ?? null,
          lastChanged: state?.last_changed ?? null,
          // Rounded: this is read by a person, and unit conversion leaves
          // floating-point tails like 0.9577000000000001.
          converted: round6(toCanonicalUnit(parseNumericState(state?.state), unit, kind)),
          convertedUnit: ApplianceService.#CANONICAL[kind],
        },
      ];
    });
  }

  async getApplianceDetail(id: string, now = new Date()): Promise<ApplianceDetail | null> {
    const appliance = this.#store.getAppliance(id);
    if (!appliance) return null;

    const price = this.#store.get().settings.electricityPricePerKwh;
    const reading = await this.#reading(appliance, price, now);
    const periods = await this.#energyPeriods(appliance, now);
    const daily = periods.daily;

    const todayStart = startOfLocalDay(now).getTime();
    const completeDays = daily.points
      .filter((point) => point.v !== null && point.t < todayStart)
      .map((point) => point.v!);
    const forecast = forecastFromDailyTotals(completeDays, now);

    const energyWeekKwh = periods.week;
    const energyMonthKwh = periods.month;

    return {
      ...reading,
      entities: appliance.entities,
      energyWeekKwh,
      costWeek: costOf(energyWeekKwh, price),
      energyMonthKwh,
      costMonth: costOf(energyMonthKwh, price),
      forecast: forecast
        ? { ...forecast, estimatedYearlyCost: costOf(forecast.estimatedYearlyKwh, price) }
        : null,
      sensors: this.#diagnostics(appliance),
      hasDailyHistory: daily.fromStatistics,
    };
  }

  /**
   * Energy accumulated since local midnight, integrated from power history.
   *
   * Deliberately independent of long-term statistics: this works from the
   * first hour a sensor is recorded, whereas daily statistics buckets only
   * appear after a full day.
   */
  /**
   * Energy consumed over time, as a running total.
   *
   * Today's curve is integrated from power history: statistics produce their
   * first day bucket only after a full day, so on a fresh install history is
   * the only source that has anything to say.
   *
   * Longer ranges accumulate Home Assistant's daily statistics instead.
   * Replaying a month of raw states to integrate them would be far too much
   * work for a Raspberry Pi, and the daily totals are already computed.
   */
  /**
   * Energy consumed over the range, as a running total.
   *
   * Built from Home Assistant's energy statistics wherever they exist, which
   * matters for more than resolution: the headline "Today" figure comes from
   * the same statistics, so the curve and the number agree. Integrating the
   * power sensor instead silently undercounts whenever recorder history does
   * not reach back to the start of the range - a very visible wrong answer,
   * since the chart then disagrees with the figure printed above it.
   *
   * Power integration is kept only as a fallback, for an install too new to
   * have any statistics at all. It is flagged in `source` so the UI can say
   * the curve covers only what was recorded.
   */
  async #cumulativeFor(
    appliances: Appliance[],
    range: CumulativeRange,
    now: Date,
  ): Promise<CumulativeResult> {
    const end = now.getTime();
    const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
    const start =
      range === "today"
        ? startOfLocalDay(now).getTime()
        : startOfLocalDayBefore(now, days - 1).getTime();

    const result = (points: ChartPoint[], source: CumulativeResult["source"]): CumulativeResult => ({
      range,
      start: points[0]?.t ?? start,
      end,
      points,
      totalKwh: points.at(-1)?.v ?? null,
      source,
    });

    // Resolution, finest first. A chart asked for 30 days on an install a day
    // old should still draw that day properly - the way a five-year stock
    // chart of a company that listed last month draws last month, rather than
    // one dot against an empty axis. So take the finest source that actually
    // has data, and let the axis cover what exists rather than what was asked
    // for.
    const periods: StatisticsPeriod[] =
      range === "today" ? ["5minute", "hour"] : ["hour", "day"];

    for (const period of periods) {
      const series = await this.#energyStatistics(appliances, new Date(start), new Date(end), period);
      const combined = sumSeriesByBucket(series).filter((point) => point.t >= start);
      const points = runningTotal(combined);
      if (points.length > 1) return result(points, "statistics");
    }

    // The daily figures behind the "this week" and "this month" totals,
    // fallbacks included. Coarse, but it covers whole days that finer
    // statistics may not retain.
    if (range !== "today") {
      const daily: ChartPoint[][] = [];
      for (const appliance of appliances) {
        daily.push((await this.#dailyEnergy(appliance, now)).points);
      }
      const combined = sumSeriesByBucket(daily).filter((point) => point.t >= start);
      const points = runningTotal(combined);
      // One point is a dot, not a chart. Fall through to the fine-grained
      // sources below, which can draw today's curve inside a weekly view.
      if (points.length > 1) return result(points, "statistics");
    }

    // A vendor "energy today" counter is already the curve we want, and it is
    // what the headline figure falls back to as well - so following it here
    // keeps the chart and the number in agreement. It only covers today, but
    // one real day beats an empty week.
    const todayStart = startOfLocalDay(now).getTime();
    const meterIds = appliances
      .map((appliance) => appliance.entities.energyDay)
      .filter((entityId): entityId is string => entityId !== undefined);

    if (meterIds.length > 0) {
      const meterHistory = await this.#source.getHistory(
        meterIds,
        new Date(todayStart),
        new Date(end),
      );
      const levels = meterIds.map((entityId) =>
        holdLevel(
          meterHistory[entityId] ?? [],
          todayStart,
          end,
          CUMULATIVE_BUCKET_MS,
          this.#unitScale(entityId, "energy"),
        ),
      );
      const points = sumSeriesByBucket(levels).filter((point) => point.v !== null);
      if (points.length > 0) return result(points, "meter");
    }

    const entityIds = this.#powerEntities(appliances);
    if (entityIds.length === 0) return result([], "statistics");

    const history = await this.#source.getHistory(
      entityIds,
      new Date(todayStart),
      new Date(end),
    );
    const points = cumulativeEnergy(
      entityIds.map((entityId) => history[entityId] ?? []),
      todayStart,
      end,
      CUMULATIVE_BUCKET_MS,
      entityIds.map((entityId) => this.#unitScale(entityId, "power")),
    );
    return result(points, points.length > 0 ? "history" : "statistics");
  }

  /** Per-bucket energy `change` for each appliance's cumulative meter. */
  async #energyStatistics(
    appliances: Appliance[],
    start: Date,
    end: Date,
    period: StatisticsPeriod,
  ): Promise<ChartPoint[][]> {
    const entityIds = appliances
      .map((appliance) => appliance.entities.energy)
      .filter((entityId): entityId is string => entityId !== undefined);
    if (entityIds.length === 0) return [];

    // One call for every member, rather than one per appliance.
    const stats = await this.#source.getStatistics(entityIds, start, end, period);
    return entityIds.map((entityId) =>
      (stats[entityId] ?? []).map((point) => ({
        t: point.start,
        v: typeof point.change === "number" ? point.change : null,
      })),
    );
  }

  /** Multiplier converting an entity's reported unit to the canonical one. */
  #unitScale(entityId: string, kind: MeasurementKind): number {
    return unitScale(
      this.#source.getCachedState(entityId)?.attributes.unit_of_measurement,
      kind,
    );
  }

  #powerEntities(appliances: Appliance[]): string[] {
    return appliances
      .map((appliance) => appliance.entities.power)
      .filter((entityId): entityId is string => entityId !== undefined);
  }

  async getHouseholdCumulative(
    range: CumulativeRange = "today",
    now = new Date(),
  ): Promise<CumulativeResult> {
    return this.#cumulativeFor(this.#store.enabledAppliances(), range, now);
  }

  async getApplianceCumulative(
    id: string,
    range: CumulativeRange = "today",
    now = new Date(),
  ): Promise<CumulativeResult | null> {
    const appliance = this.#store.getAppliance(id);
    if (!appliance) return null;
    return this.#cumulativeFor([appliance], range, now);
  }

  async getCategoryCumulative(
    id: string,
    range: CumulativeRange = "today",
    now = new Date(),
  ): Promise<CumulativeResult | null> {
    const category = this.#store.getCategory(id);
    if (!category) return null;
    const members = this.#store
      .enabledAppliances()
      .filter((appliance) => category.applianceIds.includes(appliance.id));
    return this.#cumulativeFor(members, range, now);
  }

  /**
   * Every appliance, or every category, on one axis for comparison.
   *
   * Each series is the same running total the individual pages show, so a
   * figure here always matches the one on that appliance's own page.
   */
  async compare(
    scope: CompareScope,
    range: CumulativeRange = "today",
    now = new Date(),
  ): Promise<CompareResult> {
    const config = this.#store.get();
    const items = this.#comparisonItems(scope);

    const curves: CumulativeResult[] = [];
    for (const item of items) {
      curves.push(await this.#cumulativeFor(item.members, range, now));
    }

    const { buckets, values } = alignCumulative(curves.map((curve) => curve.points));
    const price = config.settings.electricityPricePerKwh;

    const series: CompareSeries[] = items.map((item, index) => {
      const totalKwh = curves[index]?.totalKwh ?? null;
      return {
        id: item.id,
        name: item.name,
        points: values[index] ?? [],
        totalKwh,
        cost: costOf(totalKwh, price),
      };
    });

    return {
      scope,
      range,
      start: buckets[0] ?? startOfLocalDay(now).getTime(),
      end: now.getTime(),
      buckets,
      series,
      totalKwh: sumValues(series.map((item) => item.totalKwh)),
      currency: config.settings.currency,
    };
  }

  /** Appliances or categories, resolved to the appliances behind each. */
  #comparisonItems(scope: CompareScope): { id: string; name: string; members: Appliance[] }[] {
    const config = this.#store.get();
    const appliances = this.#store.enabledAppliances();

    if (scope !== "categories") {
      return appliances.map((appliance) => ({
        id: appliance.id,
        name: appliance.name,
        members: [appliance],
      }));
    }

    return config.categories.map((category) => ({
      id: category.id,
      name: category.name,
      members: appliances.filter((appliance) => category.applianceIds.includes(appliance.id)),
    }));
  }

  /**
   * Consumption per period, for spotting whether use is rising or falling.
   *
   * Distinct from `compare`, which shows running totals within one range.
   * Here each bucket is a period's own figure, so successive bars or points
   * can be read against each other.
   */
  async trend(
    scope: CompareScope,
    period: TrendPeriod,
    now = new Date(),
  ): Promise<TrendResult> {
    const items = this.#comparisonItems(scope);
    const config = this.#store.get();

    const grouped: ChartPoint[][] = [];
    for (const item of items) {
      const daily: ChartPoint[][] = [];
      for (const appliance of item.members) {
        daily.push((await this.#dailyEnergy(appliance, now)).points);
      }
      grouped.push(groupByPeriod(sumSeriesByBucket(daily), period));
    }

    const { buckets: allBuckets, values: allValues } = alignByBucket(grouped);

    // A week or month that began before the data window did is only part
    // recorded, and next to a full one it reads as a dramatic rise.
    const windowStart = startOfLocalDayBefore(now, ENERGY_WINDOW_DAYS).getTime();
    const keep = allBuckets
      .map((bucket, index) => ({ bucket, index }))
      .filter(({ bucket }) => period === "day" || bucket >= windowStart);

    const buckets = keep.map(({ bucket }) => bucket);
    const values = allValues.map((points) => keep.map(({ index }) => points[index] ?? null));

    const currentPeriodStart =
      period === "day"
        ? startOfLocalDay(now).getTime()
        : period === "week"
          ? startOfLocalWeek(now).getTime()
          : startOfLocalMonth(now).getTime();
    const inProgressFrom = buckets.includes(currentPeriodStart) ? currentPeriodStart : null;

    const series: TrendSeries[] = items.map((item, index) => {
      const points = values[index] ?? [];
      const changePercent = changeBetweenComplete(buckets, points, inProgressFrom);
      return { id: item.id, name: item.name, points, changePercent };
    });

    const totalPoints = buckets.map((_, position) => {
      const contributions = series
        .map((item) => item.points[position])
        .filter((value): value is number => value !== null && value !== undefined);
      return contributions.length > 0
        ? roundTo(contributions.reduce((a, b) => a + b, 0), 4)
        : null;
    });

    return {
      scope,
      period,
      buckets,
      inProgressFrom,
      total: { points: totalPoints, changePercent: changeBetweenComplete(buckets, totalPoints, inProgressFrom) },
      series,
      currency: config.settings.currency,
      electricityPricePerKwh: config.settings.electricityPricePerKwh,
    };
  }

  async getHistory(id: string, range: HistoryRange, now = new Date()): Promise<HistoryResult | null> {
    const appliance = this.#store.getAppliance(id);
    if (!appliance) return null;
    return buildHistory(this.#source, appliance, range, now);
  }
}

function round6(value: number | null): number | null {
  return value === null ? null : roundTo(value, 6);
}

/**
 * Percentage change between the last two complete periods.
 *
 * The period underway is skipped: part of a day measured against a whole one
 * always looks like a fall.
 */
function changeBetweenComplete(
  buckets: number[],
  points: (number | null)[],
  inProgressFrom: number | null,
): number | null {
  const complete = buckets
    .map((bucket, position) => ({ bucket, value: points[position] ?? null }))
    .filter((entry) => entry.bucket !== inProgressFrom && entry.value !== null)
    .map((entry) => entry.value as number);

  const previous = complete.at(-2);
  const latest = complete.at(-1);
  if (previous === undefined || latest === undefined || previous <= 0) return null;
  return roundTo(((latest - previous) / previous) * 100, 1);
}

/** True when any appliance is a member of more than one category. */
export function hasOverlap(categories: Category[]): boolean {
  const seen = new Set<string>();
  for (const category of categories) {
    for (const id of new Set(category.applianceIds)) {
      if (seen.has(id)) return true;
      seen.add(id);
    }
  }
  return false;
}

/** Sum values, ignoring nulls; null when nothing was available at all. */
function sumValues(values: (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null);
  if (present.length === 0) return null;
  return roundTo(present.reduce((a, b) => a + b, 0), 3);
}
