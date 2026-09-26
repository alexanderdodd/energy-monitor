export interface ConnectionStatus {
  connected: boolean;
  lastUpdate: string | null;
  lastError: string | null;
}

export interface ApplianceEntities {
  power?: string;
  current?: string;
  voltage?: string;
  energy?: string;
  energyDay?: string;
  energyMonth?: string;
}

export type EntityRole = keyof ApplianceEntities;

export const ENTITY_ROLES: { role: EntityRole; label: string }[] = [
  { role: "power", label: "Power" },
  { role: "current", label: "Current" },
  { role: "voltage", label: "Voltage" },
  { role: "energy", label: "Total energy" },
  { role: "energyDay", label: "Energy today" },
  { role: "energyMonth", label: "Energy this month" },
];

export interface Appliance {
  id: string;
  name: string;
  deviceId?: string;
  entities: ApplianceEntities;
  enabled: boolean;
}

export interface DiscoveredEntity {
  entityId: string;
  name: string;
  kind: "power" | "energy" | "current" | "voltage";
  role: EntityRole;
  unit?: string;
  stateClass?: string;
}

export interface DiscoveredAppliance {
  id: string;
  name: string;
  deviceId?: string;
  manufacturer?: string;
  model?: string;
  entities: ApplianceEntities;
  candidates: DiscoveredEntity[];
  configured: boolean;
}

export interface ApplianceReading {
  id: string;
  name: string;
  available: boolean;
  powerW: number | null;
  currentA: number | null;
  voltageV: number | null;
  energyTodayKwh: number | null;
  costToday: number | null;
}

/**
 * A user-defined grouping of appliances. Membership is many-to-many, so an
 * appliance may count towards several categories at once.
 */
export interface Category {
  id: string;
  name: string;
  applianceIds: string[];
}

export interface Trend {
  windowDays: number;
  currentKwh: number;
  previousKwh: number;
  changePercent: number | null;
  comparable: boolean;
}

export interface CategoryReading {
  id: string;
  name: string;
  applianceIds: string[];
  members: { id: string; name: string }[];
  livePowerW: number | null;
  energyTodayKwh: number | null;
  costToday: number | null;
  energyWeekKwh: number | null;
  costWeek: number | null;
  energyMonthKwh: number | null;
  costMonth: number | null;
  dailyKwh: ChartPoint[];
  trend: Trend | null;
}

export interface CategoryDetail extends CategoryReading {
  currency: string;
  electricityPricePerKwh: number;
  homeAssistant: ConnectionStatus;
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
  /** True when an appliance belongs to more than one category. */
  categoriesOverlap: boolean;
}

export interface Forecast {
  dailyAverageKwh: number;
  estimatedMonthlyKwh: number;
  estimatedYearlyKwh: number;
  basedOnDays: number;
  estimatedYearlyCost: number | null;
}

export interface ApplianceDetail extends ApplianceReading {
  entities: ApplianceEntities;
  energyWeekKwh: number | null;
  energyMonthKwh: number | null;
  forecast: Forecast | null;
  currency: string;
  electricityPricePerKwh: number;
  homeAssistant: ConnectionStatus;
}

export interface ChartPoint {
  t: number;
  v: number | null;
}

export type HistoryRange = "6h" | "24h" | "7d" | "30d";

export interface HistoryResult {
  range: HistoryRange;
  start: number;
  end: number;
  power: ChartPoint[];
  energyDaily: ChartPoint[];
  powerSource: "history" | "statistics";
}

export interface CumulativeResult {
  start: number;
  end: number;
  bucketMs: number;
  /** Running kWh total since local midnight; empty when nothing was recorded. */
  points: ChartPoint[];
  totalKwh: number | null;
}

export interface Settings {
  electricityPricePerKwh: number;
  currency: string;
  setupComplete: boolean;
  homeAssistant?: ConnectionStatus;
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
