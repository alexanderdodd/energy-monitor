import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { ConfigStore, sanitizeConfig, sanitizeSettings } from "../server/src/config/store.ts";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "hem-config-"));
});

describe("sanitizeSettings", () => {
  it("keeps valid values", () => {
    expect(sanitizeSettings({ electricityPricePerKwh: 0.42, currency: "gbp" })).toEqual({
      electricityPricePerKwh: 0.42,
      currency: "GBP",
    });
  });

  it("falls back on nonsense rather than storing it", () => {
    expect(sanitizeSettings({ electricityPricePerKwh: -1, currency: "" })).toEqual({
      electricityPricePerKwh: 0.3,
      currency: "EUR",
    });
    expect(sanitizeSettings("nope")).toEqual({ electricityPricePerKwh: 0.3, currency: "EUR" });
  });
});

describe("sanitizeConfig", () => {
  it("drops appliances with no usable entities", () => {
    const config = sanitizeConfig({
      appliances: [
        { id: "a", name: "A", entities: { power: "sensor.a" } },
        { id: "b", name: "B", entities: {} },
        { id: "", name: "C", entities: { power: "sensor.c" } },
        "junk",
      ],
    });
    expect(config.appliances.map((appliance) => appliance.id)).toEqual(["a"]);
  });

  it("defaults an appliance to enabled", () => {
    const config = sanitizeConfig({
      appliances: [{ id: "a", name: "A", entities: { power: "sensor.a" } }],
    });
    expect(config.appliances[0]!.enabled).toBe(true);
  });
});

describe("ConfigStore", () => {
  it("starts from defaults when nothing is saved yet", async () => {
    const store = new ConfigStore(join(directory, "config.json"));
    const config = await store.load();
    expect(config.setupComplete).toBe(false);
    expect(config.appliances).toEqual([]);
    expect(config.settings.electricityPricePerKwh).toBe(0.3);
  });

  it("survives a restart", async () => {
    const path = join(directory, "config.json");
    const store = new ConfigStore(path);
    await store.load();
    await store.setAppliances([
      { id: "device:1", name: "Fridge", entities: { power: "sensor.fridge_power" }, enabled: true },
    ]);
    await store.setSettings({ electricityPricePerKwh: 0.45, currency: "GBP" });

    const reopened = new ConfigStore(path);
    const config = await reopened.load();
    expect(config.appliances).toHaveLength(1);
    expect(config.appliances[0]!.name).toBe("Fridge");
    expect(config.settings).toEqual({ electricityPricePerKwh: 0.45, currency: "GBP" });
    expect(config.setupComplete).toBe(true);
  });

  it("recovers from a corrupted file instead of crashing", async () => {
    const path = join(directory, "config.json");
    await writeFile(path, "{ this is not json", "utf8");
    const store = new ConfigStore(path);
    const config = await store.load();
    expect(config.appliances).toEqual([]);
  });

  it("writes the file to the configured path", async () => {
    const path = join(directory, "nested", "config.json");
    const store = new ConfigStore(path);
    await store.load();
    await store.setSettings({ electricityPricePerKwh: 0.2, currency: "EUR" });
    const written = JSON.parse(await readFile(path, "utf8")) as { settings: unknown };
    expect(written.settings).toEqual({ electricityPricePerKwh: 0.2, currency: "EUR" });
  });

  it("lists only enabled appliances", async () => {
    const store = new ConfigStore(join(directory, "config.json"));
    await store.load();
    await store.setAppliances([
      { id: "a", name: "A", entities: { power: "sensor.a" }, enabled: true },
      { id: "b", name: "B", entities: { power: "sensor.b" }, enabled: false },
    ]);
    expect(store.enabledAppliances().map((appliance) => appliance.id)).toEqual(["a"]);
  });
});
