import { log } from "../logger.ts";
import { buildDailyEnergy, buildHistory, sumDailyEnergy, type HistoryRange, type HistoryResult } from "../ha/history.ts";
import type { ConnectionStatus, HaSource } from "../ha/types.ts";
import type { ConfigStore } from "../config/store.ts";
import {
  costOf,
  forecastFromDailyTotals,
  parseNumericState,
  roundTo,
  startOfLocalDay,
  startOfLocalDayBefore,
  startOfLocalMonth,
  sumDailySeries,
  toCanonicalUnit,
  trendOverWindows,
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

interface CachedEnergy {
  fetchedAt: number;
  points: ChartPoint[];
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
  energyMonthKwh: number | null;
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

export interface ApplianceDetail extends ApplianceReading {
  entities: Appliance["entities"];
  energyWeekKwh: number | null;
  energyMonthKwh: number | null;
  forecast: (Forecast & { estimatedYearlyCost: number | null }) | null;
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
  async #dailyEnergy(appliance: Appliance, now: Date): Promise<ChartPoint[]> {
    const cached = this.#energyCache.get(appliance.id);
    if (cached && now.getTime() - cached.fetchedAt < ENERGY_CACHE_TTL_MS) {
      return cached.points;
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

    if (points.length === 0) {
      const today = this.#measurement(appliance, "energyDay", "energy");
      if (today !== null) {
        points = [{ t: startOfLocalDay(now).getTime(), v: today }];
      }
    }

    this.#energyCache.set(appliance.id, { fetchedAt: now.getTime(), points });
    return points;
  }

  async #reading(appliance: Appliance, pricePerKwh: number, now: Date): Promise<ApplianceReading> {
    const live = this.#liveState(appliance);
    const daily = await this.#dailyEnergy(appliance, now);
    const energyTodayKwh = sumDailyEnergy(daily, now);

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

    for (const appliance of appliances) {
      readings.push(await this.#reading(appliance, price, now));
      dailySeries.push(await this.#dailyEnergy(appliance, now));
    }

    const totals = this.#totals(readings, dailySeries, price, now);

    // Reuse the per-appliance series already fetched above rather than
    // asking Home Assistant for the same statistics again.
    const dailyByAppliance = new Map<string, ChartPoint[]>();
    appliances.forEach((appliance, index) => {
      dailyByAppliance.set(appliance.id, dailySeries[index] ?? []);
    });

    const categories = config.categories.map((category) =>
      this.#categoryReading(category, appliances, dailyByAppliance, price, now),
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

    const daily = sumDailySeries(
      members.map((appliance) => dailyByAppliance.get(appliance.id) ?? []),
    );

    const energyTodayKwh = sumDailyEnergy(daily, now);
    const energyWeekKwh = sumDailyEnergy(daily, startOfLocalDayBefore(now, 6));
    const energyMonthKwh = sumDailyEnergy(daily, startOfLocalMonth(now));

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
    for (const appliance of appliances) {
      if (!category.applianceIds.includes(appliance.id)) continue;
      dailyByAppliance.set(appliance.id, await this.#dailyEnergy(appliance, now));
    }

    return this.#categoryReading(category, appliances, dailyByAppliance, price, now);
  }

  #totals(
    readings: ApplianceReading[],
    dailySeries: ChartPoint[][],
    price: number,
    now: Date,
  ): SummaryTotals {
    const livePowers = readings
      .map((reading) => reading.powerW)
      .filter((value): value is number => value !== null);
    const energyToday = sumValues(readings.map((reading) => reading.energyTodayKwh));

    const energyWeek = sumValues(
      dailySeries.map((series) => sumDailyEnergy(series, startOfLocalDayBefore(now, 6))),
    );
    const energyMonth = sumValues(
      dailySeries.map((series) => sumDailyEnergy(series, startOfLocalMonth(now))),
    );

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
      energyMonthKwh: energyMonth,
      estimatedMonthlyKwh: forecast?.estimatedMonthlyKwh ?? null,
      estimatedYearlyKwh: forecast?.estimatedYearlyKwh ?? null,
      estimatedYearlyCost: costOf(forecast?.estimatedYearlyKwh ?? null, price),
    };
  }

  async getApplianceDetail(id: string, now = new Date()): Promise<ApplianceDetail | null> {
    const appliance = this.#store.getAppliance(id);
    if (!appliance) return null;

    const price = this.#store.get().settings.electricityPricePerKwh;
    const reading = await this.#reading(appliance, price, now);
    const daily = await this.#dailyEnergy(appliance, now);

    const todayStart = startOfLocalDay(now).getTime();
    const completeDays = daily
      .filter((point) => point.v !== null && point.t < todayStart)
      .map((point) => point.v!);
    const forecast = forecastFromDailyTotals(completeDays, now);

    return {
      ...reading,
      entities: appliance.entities,
      energyWeekKwh: sumDailyEnergy(daily, startOfLocalDayBefore(now, 6)),
      energyMonthKwh: sumDailyEnergy(daily, startOfLocalMonth(now)),
      forecast: forecast
        ? { ...forecast, estimatedYearlyCost: costOf(forecast.estimatedYearlyKwh, price) }
        : null,
    };
  }

  async getHistory(id: string, range: HistoryRange, now = new Date()): Promise<HistoryResult | null> {
    const appliance = this.#store.getAppliance(id);
    if (!appliance) return null;
    return buildHistory(this.#source, appliance, range, now);
  }
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
