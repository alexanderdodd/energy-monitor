import type { MeasurementKind, Trend } from "./calculations.ts";

export type { Trend } from "./calculations.ts";

/** The measurement slots an appliance can fill. */
export interface ApplianceEntities {
  power?: string;
  current?: string;
  voltage?: string;
  /** Cumulative (total / total_increasing) energy sensor - the preferred source. */
  energy?: string;
  /** Vendor-provided "energy today" sensor, used when statistics are missing. */
  energyDay?: string;
  /** Vendor-provided "energy this month" sensor. */
  energyMonth?: string;
}

export type EntityRole = keyof ApplianceEntities;

export interface Appliance {
  id: string;
  name: string;
  deviceId?: string;
  entities: ApplianceEntities;
  enabled: boolean;
}

/**
 * A user-defined grouping of appliances, such as "Washing" or "Cooking".
 *
 * Membership is many-to-many on purpose: a dehumidifier can reasonably count
 * towards both washing and climate. The consequence is that category totals
 * overlap and do not sum to the household total, which the UI states wherever
 * it shows them together rather than quietly presenting a wrong sum.
 */
export interface Category {
  id: string;
  name: string;
  /** Appliance ids. Ids that no longer exist are ignored, not an error. */
  applianceIds: string[];
}

export interface AppSettings {
  electricityPricePerKwh: number;
  currency: string;
}

export interface AppConfig {
  version: 1;
  /** False until the user has been through first-run setup. */
  setupComplete: boolean;
  settings: AppSettings;
  appliances: Appliance[];
  categories: Category[];
}

export const DEFAULT_SETTINGS: AppSettings = {
  electricityPricePerKwh: 0.3,
  currency: "EUR",
};

export const DEFAULT_CONFIG: AppConfig = {
  version: 1,
  setupComplete: false,
  settings: DEFAULT_SETTINGS,
  appliances: [],
  categories: [],
};

/** One measurement entity found during discovery. */
export interface DiscoveredEntity {
  entityId: string;
  name: string;
  kind: MeasurementKind;
  role: EntityRole;
  unit?: string;
  stateClass?: string;
  deviceId?: string;
}

/** A device (or name-based group) that looks capable of energy monitoring. */
export interface DiscoveredAppliance {
  id: string;
  name: string;
  deviceId?: string;
  manufacturer?: string;
  model?: string;
  /** Best guess at which entity fills each role. */
  entities: ApplianceEntities;
  /** Every measurement entity found, so the user can override the guess. */
  candidates: DiscoveredEntity[];
  /** True when this appliance is already present in the saved configuration. */
  configured: boolean;
}

/** Aggregated figures for one category. */
export interface CategoryReading {
  id: string;
  name: string;
  /** Membership as configured, including ids that no longer resolve. */
  applianceIds: string[];
  /**
   * The member appliances that actually exist and are enabled, as id/name
   * pairs. Kept paired rather than as two parallel arrays, which fall out of
   * step the moment a stale id is present.
   */
  members: { id: string; name: string }[];
  livePowerW: number | null;
  energyTodayKwh: number | null;
  costToday: number | null;
  energyWeekKwh: number | null;
  costWeek: number | null;
  energyMonthKwh: number | null;
  costMonth: number | null;
  /** Daily totals over the rolling window, for the sparkline and charts. */
  dailyKwh: { t: number; v: number | null }[];
  trend: Trend | null;
}

/** Live values for one appliance. */
export interface ApplianceReading {
  id: string;
  name: string;
  /** False when no configured entity is reporting a usable value. */
  available: boolean;
  powerW: number | null;
  currentA: number | null;
  voltageV: number | null;
  energyTodayKwh: number | null;
  costToday: number | null;
}
