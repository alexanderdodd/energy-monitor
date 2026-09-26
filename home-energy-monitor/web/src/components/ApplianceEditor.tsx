import {
  ENTITY_ROLES,
  type Appliance,
  type ApplianceEntities,
  type DiscoveredAppliance,
  type DiscoveredEntity,
  type EntityRole,
} from "../lib/types.ts";

export interface ApplianceDraft {
  id: string;
  name: string;
  deviceId?: string;
  entities: ApplianceEntities;
  enabled: boolean;
  manufacturer?: string;
  model?: string;
  /** Every measurement found on the device, for the override dropdowns. */
  candidates: DiscoveredEntity[];
}

/** Which measurements may fill each slot. */
const ROLE_KINDS: Record<EntityRole, DiscoveredEntity["kind"]> = {
  power: "power",
  current: "current",
  voltage: "voltage",
  energy: "energy",
  energyDay: "energy",
  energyMonth: "energy",
};

/**
 * Merge what discovery found with what the user already saved.
 *
 * Saved names and entity overrides win; newly discovered devices arrive
 * switched off so a re-scan never silently changes the dashboard.
 */
export function buildDrafts(
  discovered: DiscoveredAppliance[],
  configured: Appliance[],
  enableNew: boolean,
): ApplianceDraft[] {
  return discovered.map((appliance) => {
    const existing = configured.find((item) => item.id === appliance.id);
    return {
      id: appliance.id,
      name: existing?.name ?? appliance.name,
      deviceId: appliance.deviceId,
      entities: { ...appliance.entities, ...(existing?.entities ?? {}) },
      enabled: existing ? existing.enabled : enableNew,
      manufacturer: appliance.manufacturer,
      model: appliance.model,
      candidates: appliance.candidates,
    };
  });
}

/** Strip the editor-only fields before saving. */
export function toAppliances(drafts: ApplianceDraft[]): Appliance[] {
  return drafts.map(({ id, name, deviceId, entities, enabled }) => ({
    id,
    name,
    deviceId,
    entities,
    enabled,
  }));
}

interface Props {
  drafts: ApplianceDraft[];
  onChange: (drafts: ApplianceDraft[]) => void;
  /** Setup keeps things simple; Settings exposes the entity mapping. */
  showMappings: boolean;
}

export function ApplianceEditor({ drafts, onChange, showMappings }: Props) {
  const update = (id: string, patch: Partial<ApplianceDraft>) => {
    onChange(drafts.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  };

  return (
    <div>
      {drafts.map((draft) => (
        <section className="appliance-setting" key={draft.id}>
          <header>
            <label className="toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => update(draft.id, { enabled: event.target.checked })}
                aria-label={`Monitor ${draft.name}`}
              />
              Monitor
            </label>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => update(draft.id, { name: event.target.value })}
              aria-label={`Display name for ${draft.name}`}
            />
            {draft.model ? (
              <span className="meta">
                {draft.manufacturer ? `${draft.manufacturer} ` : ""}
                {draft.model}
              </span>
            ) : null}
          </header>

          {showMappings ? (
            <div className="mapping">
              {ENTITY_ROLES.map(({ role, label }) => {
                const options = draft.candidates.filter(
                  (candidate) => candidate.kind === ROLE_KINDS[role],
                );
                if (options.length === 0) return null;

                return (
                  <div className="field" key={role}>
                    <label htmlFor={`${draft.id}-${role}`}>{label}</label>
                    <select
                      id={`${draft.id}-${role}`}
                      value={draft.entities[role] ?? ""}
                      onChange={(event) =>
                        update(draft.id, {
                          entities: {
                            ...draft.entities,
                            [role]: event.target.value || undefined,
                          },
                        })
                      }
                    >
                      <option value="">Not used</option>
                      {options.map((candidate) => (
                        <option key={candidate.entityId} value={candidate.entityId}>
                          {candidate.name}
                          {candidate.unit ? ` (${candidate.unit})` : ""}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="meta">
              {summariseMeasurements(draft)}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}

function summariseMeasurements(draft: ApplianceDraft): string {
  const labels = ENTITY_ROLES.filter(({ role }) => draft.entities[role]).map(({ label }) => label);
  return labels.length > 0 ? labels.join(" · ") : "No measurements detected";
}
