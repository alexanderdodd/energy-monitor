import type { MeasurementKind } from "../appliances/calculations.ts";
import type {
  ApplianceEntities,
  DiscoveredAppliance,
  DiscoveredEntity,
  EntityRole,
} from "../appliances/types.ts";
import type { DeviceRegistryEntry, EntityRegistryEntry, HaState } from "./types.ts";

/**
 * Units that identify a measurement when `device_class` is absent.
 * Keyed by the lower-cased unit, except where case is meaningful.
 */
const UNIT_KINDS: Record<string, MeasurementKind> = {
  w: "power",
  kw: "power",
  mw: "power",
  wh: "energy",
  kwh: "energy",
  mwh: "energy",
  a: "current",
  ma: "current",
  v: "voltage",
  mv: "voltage",
};

const DEVICE_CLASS_KINDS: Record<string, MeasurementKind> = {
  power: "power",
  energy: "energy",
  current: "current",
  voltage: "voltage",
};

/**
 * Decide what a sensor measures.
 *
 * Home Assistant metadata is authoritative: `device_class` first, then
 * `unit_of_measurement` backed by a `state_class` (which is what separates a
 * real measurement from, say, a text sensor that happens to read "12 V").
 * Entity names are never consulted here.
 */
export function classifyEntity(state: HaState): MeasurementKind | null {
  if (!state.entity_id.startsWith("sensor.")) return null;

  const deviceClass = state.attributes.device_class?.toLowerCase();
  if (deviceClass && DEVICE_CLASS_KINDS[deviceClass]) {
    return DEVICE_CLASS_KINDS[deviceClass]!;
  }

  const unit = state.attributes.unit_of_measurement;
  if (!unit || !state.attributes.state_class) return null;
  return UNIT_KINDS[unit.toLowerCase()] ?? null;
}

/** Tokens that mark an energy sensor as covering a day or a month. */
const DAY_HINTS = /(^|[_\s])(day|daily|today)([_\s]|$)/i;
const MONTH_HINTS = /(^|[_\s])(month|monthly)([_\s]|$)/i;

/**
 * Map a measurement onto an appliance slot.
 *
 * Energy is the only ambiguous case: a plug typically exposes a lifetime
 * total alongside per-day and per-month counters. The cumulative one is
 * identified from `state_class`; only the day/month split falls back to the
 * entity name, which Home Assistant gives us no other way to distinguish.
 */
export function assignRole(state: HaState, kind: MeasurementKind): EntityRole {
  if (kind !== "energy") return kind;

  const stateClass = state.attributes.state_class?.toLowerCase();
  const name = `${state.entity_id} ${state.attributes.friendly_name ?? ""}`;

  if (MONTH_HINTS.test(name)) return "energyMonth";
  if (DAY_HINTS.test(name)) return "energyDay";
  if (stateClass === "total_increasing" || stateClass === "total") return "energy";
  return "energy";
}

function friendlyName(state: HaState): string {
  return state.attributes.friendly_name ?? state.entity_id;
}

/**
 * Strip the measurement suffix from an entity's object id.
 *
 * `sensor.fridge_energy_day` -> `fridge`. Used only when Home Assistant has
 * no device registry entry to group by.
 */
export function objectIdPrefix(entityId: string): string {
  const objectId = entityId.slice(entityId.indexOf(".") + 1);
  const parts = objectId.split("_");
  const suffixes = new Set([
    "power",
    "energy",
    "current",
    "voltage",
    "day",
    "daily",
    "today",
    "month",
    "monthly",
    "total",
    "consumption",
    "usage",
  ]);
  while (parts.length > 1 && suffixes.has(parts[parts.length - 1]!.toLowerCase())) {
    parts.pop();
  }
  return parts.join("_");
}

function titleCase(value: string): string {
  return value
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

/**
 * Pick the best entity for each role.
 *
 * Where several entities compete, prefer the one whose `device_class` named
 * the measurement outright, then the shortest entity id - vendor integrations
 * tend to give the primary sensor the plainest name.
 */
function pickEntities(candidates: DiscoveredEntity[], states: Map<string, HaState>): ApplianceEntities {
  const entities: ApplianceEntities = {};
  const byRole = new Map<EntityRole, DiscoveredEntity[]>();

  for (const candidate of candidates) {
    const list = byRole.get(candidate.role) ?? [];
    list.push(candidate);
    byRole.set(candidate.role, list);
  }

  for (const [role, list] of byRole) {
    list.sort((a, b) => {
      const aExplicit = states.get(a.entityId)?.attributes.device_class ? 0 : 1;
      const bExplicit = states.get(b.entityId)?.attributes.device_class ? 0 : 1;
      if (aExplicit !== bExplicit) return aExplicit - bExplicit;
      if (a.entityId.length !== b.entityId.length) return a.entityId.length - b.entityId.length;
      return a.entityId.localeCompare(b.entityId);
    });
    entities[role] = list[0]!.entityId;
  }

  return entities;
}

export interface DiscoveryInput {
  states: HaState[];
  entityRegistry: EntityRegistryEntry[];
  deviceRegistry: DeviceRegistryEntry[];
  /** Appliance ids already present in the saved configuration. */
  configuredIds?: Set<string>;
}

/**
 * Find every device capable of energy monitoring and group its measurements
 * into a single appliance.
 */
export function discoverAppliances({
  states,
  entityRegistry,
  deviceRegistry,
  configuredIds = new Set(),
}: DiscoveryInput): DiscoveredAppliance[] {
  const stateById = new Map(states.map((state) => [state.entity_id, state]));
  const registryByEntity = new Map(entityRegistry.map((entry) => [entry.entity_id, entry]));
  const deviceById = new Map(deviceRegistry.map((device) => [device.id, device]));

  // Group key -> discovered entities. The key is the device id where one
  // exists, and a name-derived prefix otherwise.
  const groups = new Map<string, DiscoveredEntity[]>();

  for (const state of states) {
    const kind = classifyEntity(state);
    if (!kind) continue;

    const registryEntry = registryByEntity.get(state.entity_id);
    // Skip entities the user has deliberately hidden or disabled, and
    // diagnostic entities, which are rarely the appliance's real reading.
    if (registryEntry?.disabled_by || registryEntry?.hidden_by) continue;

    const deviceId = registryEntry?.device_id ?? undefined;
    const key = deviceId ? `device:${deviceId}` : `name:${objectIdPrefix(state.entity_id)}`;

    const discovered: DiscoveredEntity = {
      entityId: state.entity_id,
      name: friendlyName(state),
      kind,
      role: assignRole(state, kind),
      unit: state.attributes.unit_of_measurement,
      stateClass: state.attributes.state_class,
      deviceId,
    };

    const list = groups.get(key) ?? [];
    list.push(discovered);
    groups.set(key, list);
  }

  const appliances: DiscoveredAppliance[] = [];

  for (const [key, candidates] of groups) {
    // A group with neither power nor energy cannot drive the dashboard.
    const useful = candidates.some(
      (candidate) => candidate.kind === "power" || candidate.kind === "energy",
    );
    if (!useful) continue;

    const deviceId = key.startsWith("device:") ? key.slice("device:".length) : undefined;
    const device = deviceId ? deviceById.get(deviceId) : undefined;
    if (device?.disabled_by) continue;

    const name =
      device?.name_by_user?.trim() ||
      device?.name?.trim() ||
      titleCase(key.slice(key.indexOf(":") + 1));

    candidates.sort((a, b) => a.entityId.localeCompare(b.entityId));

    appliances.push({
      id: key,
      name,
      deviceId,
      manufacturer: device?.manufacturer ?? undefined,
      model: device?.model ?? undefined,
      entities: pickEntities(candidates, stateById),
      candidates,
      configured: configuredIds.has(key),
    });
  }

  appliances.sort((a, b) => a.name.localeCompare(b.name));
  return appliances;
}
