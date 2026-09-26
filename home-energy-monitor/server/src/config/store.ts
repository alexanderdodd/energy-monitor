import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { log } from "../logger.ts";
import {
  DEFAULT_CONFIG,
  DEFAULT_SETTINGS,
  type Appliance,
  type ApplianceEntities,
  type AppConfig,
  type AppSettings,
  type EntityRole,
} from "../appliances/types.ts";

const ENTITY_ROLES: EntityRole[] = [
  "power",
  "current",
  "voltage",
  "energy",
  "energyDay",
  "energyMonth",
];

/** Home Assistant persists app data here, across restarts and updates. */
export const DEFAULT_CONFIG_PATH = join(process.env.DATA_DIR ?? "/data", "config.json");

function sanitizeEntities(raw: unknown): ApplianceEntities {
  const entities: ApplianceEntities = {};
  if (typeof raw !== "object" || raw === null) return entities;
  const source = raw as Record<string, unknown>;
  for (const role of ENTITY_ROLES) {
    const value = source[role];
    if (typeof value === "string" && value.includes(".")) {
      entities[role] = value;
    }
  }
  return entities;
}

function sanitizeAppliance(raw: unknown): Appliance | null {
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (typeof source.id !== "string" || source.id.length === 0) return null;

  const entities = sanitizeEntities(source.entities);
  if (Object.keys(entities).length === 0) return null;

  return {
    id: source.id,
    name: typeof source.name === "string" && source.name.trim() ? source.name.trim() : source.id,
    deviceId: typeof source.deviceId === "string" ? source.deviceId : undefined,
    entities,
    enabled: source.enabled !== false,
  };
}

export function sanitizeSettings(raw: unknown, fallback: AppSettings = DEFAULT_SETTINGS): AppSettings {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const price = Number(source.electricityPricePerKwh);
  const currency = source.currency;

  return {
    electricityPricePerKwh:
      Number.isFinite(price) && price >= 0 ? price : fallback.electricityPricePerKwh,
    currency:
      typeof currency === "string" && currency.trim().length > 0
        ? currency.trim().toUpperCase().slice(0, 8)
        : fallback.currency,
  };
}

/** Coerce anything read from disk into a valid config, discarding junk. */
export function sanitizeConfig(raw: unknown): AppConfig {
  const source = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const appliances = Array.isArray(source.appliances)
    ? source.appliances.map(sanitizeAppliance).filter((item): item is Appliance => item !== null)
    : [];

  return {
    version: 1,
    setupComplete: source.setupComplete === true,
    settings: sanitizeSettings(source.settings),
    appliances,
  };
}

/**
 * Reads and writes the user's configuration.
 *
 * Writes go to a temporary file and are renamed into place, so a power cut
 * halfway through a save cannot leave a truncated config behind.
 */
export class ConfigStore {
  readonly #path: string;
  #config: AppConfig = structuredClone(DEFAULT_CONFIG);

  constructor(path: string = DEFAULT_CONFIG_PATH) {
    this.#path = path;
  }

  get path(): string {
    return this.#path;
  }

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.#path, "utf8");
      this.#config = sanitizeConfig(JSON.parse(raw));
      log.debug(`Loaded configuration with ${this.#config.appliances.length} appliance(s)`);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        log.warning(`Could not read ${this.#path}, starting fresh: ${(error as Error).message}`);
      }
      this.#config = structuredClone(DEFAULT_CONFIG);
    }
    return this.#config;
  }

  get(): AppConfig {
    return this.#config;
  }

  getAppliance(id: string): Appliance | undefined {
    return this.#config.appliances.find((appliance) => appliance.id === id);
  }

  /** Appliances the user has switched on, in display order. */
  enabledAppliances(): Appliance[] {
    return this.#config.appliances.filter((appliance) => appliance.enabled);
  }

  async setSettings(raw: unknown): Promise<AppConfig> {
    this.#config.settings = sanitizeSettings(raw, this.#config.settings);
    await this.#persist();
    return this.#config;
  }

  async setAppliances(raw: unknown, setupComplete = true): Promise<AppConfig> {
    if (!Array.isArray(raw)) throw new Error("appliances must be an array");
    this.#config.appliances = raw
      .map(sanitizeAppliance)
      .filter((item): item is Appliance => item !== null);
    this.#config.setupComplete = setupComplete;
    await this.#persist();
    return this.#config;
  }

  async #persist(): Promise<void> {
    const payload = `${JSON.stringify(this.#config, null, 2)}\n`;
    const temporary = `${this.#path}.tmp`;
    await mkdir(dirname(this.#path), { recursive: true });
    await writeFile(temporary, payload, "utf8");
    await rename(temporary, this.#path);
    log.debug(`Saved configuration to ${this.#path}`);
  }
}
