import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../server/src/app.ts";
import { ApplianceService } from "../server/src/appliances/service.ts";
import { ConfigStore } from "../server/src/config/store.ts";
import { LiveBroadcaster } from "../server/src/live.ts";
import type { HaState } from "../server/src/ha/types.ts";
import { FakeHaSource } from "./helpers/fakeSource.ts";

function sensor(entityId: string, state: string, attributes: HaState["attributes"]): HaState {
  return { entity_id: entityId, state, attributes };
}

const STATES: HaState[] = [
  sensor("sensor.fridge_power", "43.2", {
    device_class: "power",
    state_class: "measurement",
    unit_of_measurement: "W",
    friendly_name: "Fridge Power",
  }),
  sensor("sensor.fridge_voltage", "236", {
    device_class: "voltage",
    unit_of_measurement: "V",
    friendly_name: "Fridge Voltage",
  }),
  sensor("sensor.fridge_energy", "120.5", {
    device_class: "energy",
    state_class: "total_increasing",
    unit_of_measurement: "kWh",
    friendly_name: "Fridge Energy",
  }),
  sensor("sensor.fridge_energy_day", "2.5", {
    device_class: "energy",
    state_class: "total",
    unit_of_measurement: "kWh",
    friendly_name: "Fridge Energy day",
  }),
  sensor("sensor.dryer_power", "unavailable", {
    device_class: "power",
    state_class: "measurement",
    unit_of_measurement: "W",
    friendly_name: "Dryer Power",
  }),
];

const ENTITY_REGISTRY = [
  { entity_id: "sensor.fridge_power", device_id: "dev-fridge" },
  { entity_id: "sensor.fridge_voltage", device_id: "dev-fridge" },
  { entity_id: "sensor.fridge_energy", device_id: "dev-fridge" },
  { entity_id: "sensor.fridge_energy_day", device_id: "dev-fridge" },
  { entity_id: "sensor.dryer_power", device_id: "dev-dryer" },
];

const DEVICE_REGISTRY = [
  { id: "dev-fridge", name: "Fridge" },
  { id: "dev-dryer", name: "Dryer" },
];

const todayStart = (() => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.getTime();
})();

const DAY_MS = 86_400_000;
/** kWh recorded on each complete day before today. */
const PER_DAY = 0.8;
/** kWh recorded so far today. */
const TODAY_KWH = 0.62;

/** 35 days of daily buckets, so any calendar month is fully covered. */
const DAILY_STATISTICS = [
  ...Array.from({ length: 35 }, (_, i) => {
    const start = todayStart - (35 - i) * DAY_MS;
    return { start, end: start + DAY_MS, change: PER_DAY };
  }),
  { start: todayStart, end: todayStart + DAY_MS, change: TODAY_KWH },
];

/** Today split into three buckets, summing to the same daily figure. */
const INTRADAY_STATISTICS = [
  { start: todayStart, end: todayStart + 3_600_000, change: 0.2 },
  { start: todayStart + 3_600_000, end: todayStart + 7_200_000, change: 0.2 },
  { start: todayStart + 7_200_000, end: todayStart + 10_800_000, change: 0.22 },
];

/** Days from the first of the month up to yesterday. */
function completeDaysThisMonth(): number {
  const now = new Date();
  return now.getDate() - 1;
}

/** Remove every statistic, as on an install that has generated none. */
function clearStatistics(h: Harness): void {
  h.source.options.statistics = {};
  h.source.options.statisticsByPeriod = {};
}

interface Harness {
  app: FastifyInstance;
  source: FakeHaSource;
  store: ConfigStore;
  service: ApplianceService;
  broadcaster: LiveBroadcaster;
}

async function harness(enforceIngress = false): Promise<Harness> {
  const directory = await mkdtemp(join(tmpdir(), "hem-api-"));
  const source = new FakeHaSource({
    states: STATES,
    entityRegistry: ENTITY_REGISTRY,
    deviceRegistry: DEVICE_REGISTRY,
    // Daily buckets going well back, so a "this week" or "this month" claim
    // has every day it needs; today split intraday for the day curve.
    statistics: { "sensor.fridge_energy": DAILY_STATISTICS },
    statisticsByPeriod: {
      "5minute": { "sensor.fridge_energy": INTRADAY_STATISTICS },
      hour: {},
    },
    history: {
      "sensor.fridge_power": [{ t: Date.now() - 3_600_000, s: "43.2" }],
      "sensor.fridge_energy_day": [
        { t: todayStart + 3_600_000, s: "0.9" },
        { t: Date.now() - 60_000, s: "2.5" },
      ],
    },
  });

  const store = new ConfigStore(join(directory, "config.json"));
  await store.load();
  const service = new ApplianceService(source, store);
  const broadcaster = new LiveBroadcaster(service, source);

  const app = await createApp({
    store,
    service,
    source,
    broadcaster,
    version: "9.9.9",
    staticRoot: null,
    enforceIngress,
  });

  return { app, source, store, service, broadcaster };
}

async function configureFridge(h: Harness) {
  const response = await h.app.inject({
    method: "PUT",
    url: "/api/appliances",
    payload: {
      appliances: [
        {
          id: "device:dev-fridge",
          name: "Fridge",
          entities: {
            power: "sensor.fridge_power",
            voltage: "sensor.fridge_voltage",
            energy: "sensor.fridge_energy",
            energyDay: "sensor.fridge_energy_day",
          },
          enabled: true,
        },
        {
          id: "device:dev-dryer",
          name: "Dryer",
          entities: { power: "sensor.dryer_power" },
          enabled: true,
        },
      ],
    },
  });
  expect(response.statusCode).toBe(200);
}

let current: Harness;

beforeEach(async () => {
  current = await harness();
});

afterEach(async () => {
  current.broadcaster.stop();
  await current.app.close();
});

describe("GET /api/health", () => {
  it("reports the version and Home Assistant status", async () => {
    const response = await current.app.inject({ url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      status: "ok",
      version: "9.9.9",
      setupComplete: false,
      homeAssistant: { connected: true },
    });
  });
});

describe("GET /api/discovery", () => {
  it("groups entities into appliances", async () => {
    const response = await current.app.inject({ url: "/api/discovery" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { appliances: { id: string; name: string }[] };
    expect(body.appliances.map((appliance) => appliance.name)).toEqual(["Dryer", "Fridge"]);
  });

  it("reports 503 when Home Assistant cannot be reached", async () => {
    current.source.options.failing = true;
    const response = await current.app.inject({ url: "/api/discovery" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ error: "Could not reach Home Assistant" });
  });

  it("never leaks the Supervisor token", async () => {
    const response = await current.app.inject({ url: "/api/discovery" });
    expect(response.body.toLowerCase()).not.toContain("bearer");
    expect(response.body).not.toContain("supervisor");
  });
});

describe("appliance configuration", () => {
  it("saves and reloads the user's selection", async () => {
    await configureFridge(current);
    const response = await current.app.inject({ url: "/api/appliances" });
    const body = response.json() as { appliances: { id: string }[]; setupComplete: boolean };
    expect(body.setupComplete).toBe(true);
    expect(body.appliances.map((appliance) => appliance.id)).toEqual([
      "device:dev-fridge",
      "device:dev-dryer",
    ]);
  });

  it("rejects a payload that is not a list", async () => {
    const response = await current.app.inject({
      method: "PUT",
      url: "/api/appliances",
      payload: { appliances: "nope" },
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("GET /api/summary", () => {
  it("reports weekly and monthly energy with their costs", async () => {
    await configureFridge(current);
    const body = (await current.app.inject({ url: "/api/summary" })).json() as {
      totals: {
        energyWeekKwh: number;
        costWeek: number;
        energyMonthKwh: number;
        costMonth: number;
      };
    };
    // Six complete days at 0.8 plus today's 0.62.
    const week = 6 * PER_DAY + TODAY_KWH;
    expect(body.totals.energyWeekKwh).toBeCloseTo(week, 3);
    expect(body.totals.costWeek).toBeCloseTo(week * 0.3, 2);

    const month = completeDaysThisMonth() * PER_DAY + TODAY_KWH;
    expect(body.totals.energyMonthKwh).toBeCloseTo(month, 3);
  });

  it("totals live power, energy and cost", async () => {
    await configureFridge(current);
    const response = await current.app.inject({ url: "/api/summary" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      totals: { livePowerW: number; energyTodayKwh: number; costToday: number };
      appliances: { id: string; available: boolean; powerW: number | null }[];
      currency: string;
    };

    expect(body.currency).toBe("EUR");
    // The dryer is unavailable, so only the fridge contributes.
    expect(body.totals.livePowerW).toBe(43.2);
    expect(body.totals.energyTodayKwh).toBe(0.62);
    expect(body.totals.costToday).toBe(0.19);

    const dryer = body.appliances.find((appliance) => appliance.id === "device:dev-dryer")!;
    expect(dryer.available).toBe(false);
    expect(dryer.powerW).toBeNull();
  });

  it("reflects a changed electricity price", async () => {
    await configureFridge(current);
    await current.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { electricityPricePerKwh: 0.5, currency: "GBP" },
    });

    const body = current.app
      .inject({ url: "/api/summary" })
      .then((response) => response.json() as { totals: { costToday: number }; currency: string });
    await expect(body).resolves.toMatchObject({ currency: "GBP", totals: { costToday: 0.31 } });
  });
});

describe("GET /api/appliances/:id", () => {
  it("returns detail for a configured appliance", async () => {
    await configureFridge(current);
    const response = await current.app.inject({ url: "/api/appliances/device:dev-fridge" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      name: "Fridge",
      powerW: 43.2,
      voltageV: 236,
      energyTodayKwh: 0.62,
      currency: "EUR",
    });
  });

  it("reports what each mapped sensor is actually saying", async () => {
    await configureFridge(current);
    const body = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge" })
    ).json() as {
      sensors: {
        role: string;
        entityId: string;
        state: string;
        unit: string;
        converted: number;
        convertedUnit: string;
      }[];
    };

    const power = body.sensors.find((sensor) => sensor.role === "power")!;
    expect(power.entityId).toBe("sensor.fridge_power");
    expect(power.state).toBe("43.2");
    expect(power.unit).toBe("W");
    expect(power.converted).toBe(43.2);
    expect(power.convertedUnit).toBe("W");
  });

  it("shows the raw and converted value for a sensor reporting kW", async () => {
    // The case that took three attempts to diagnose from the dashboard alone:
    // a plug whose numbers look a thousand times too small.
    current.source.setState("sensor.fridge_power", "0.0432", {
      device_class: "power",
      unit_of_measurement: "kW",
      state_class: "measurement",
    });
    await configureFridge(current);

    const body = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge" })
    ).json() as { sensors: { role: string; state: string; unit: string; converted: number }[] };

    const power = body.sensors.find((sensor) => sensor.role === "power")!;
    expect(power.state).toBe("0.0432");
    expect(power.unit).toBe("kW");
    expect(power.converted).toBeCloseTo(43.2, 6);
  });

  it("404s for an unknown appliance", async () => {
    const response = await current.app.inject({ url: "/api/appliances/nope" });
    expect(response.statusCode).toBe(404);
  });
});

describe("GET /api/appliances/:id/history", () => {
  it("returns a bucketed power series", async () => {
    await configureFridge(current);
    const response = await current.app.inject({
      url: "/api/appliances/device:dev-fridge/history?range=24h",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { range: string; power: unknown[] };
    expect(body.range).toBe("24h");
    expect(body.power.length).toBe(288);
  });

  it("rejects an unsupported range", async () => {
    await configureFridge(current);
    const response = await current.app.inject({
      url: "/api/appliances/device:dev-fridge/history?range=99y",
    });
    expect(response.statusCode).toBe(400);
  });
});

describe("settings validation", () => {
  it("clamps an invalid price instead of storing it", async () => {
    const response = await current.app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: { electricityPricePerKwh: -5, currency: "" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ electricityPricePerKwh: 0.3, currency: "EUR" });
  });
});

describe("categories", () => {
  async function configureCategories(h: Harness) {
    await configureFridge(h);
    const response = await h.app.inject({
      method: "PUT",
      url: "/api/categories",
      payload: {
        categories: [
          { name: "Washing", applianceIds: ["device:dev-fridge", "device:dev-dryer"] },
          { name: "Cooling", applianceIds: ["device:dev-fridge"] },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as { categories: { id: string; name: string }[] };
  }

  it("assigns ids from the name and saves membership", async () => {
    const body = await configureCategories(current);
    expect(body.categories.map((category) => category.id)).toEqual(["washing", "cooling"]);

    const reloaded = await current.app.inject({ url: "/api/categories" });
    expect((reloaded.json() as { categories: unknown[] }).categories).toHaveLength(2);
  });

  it("rolls member appliances up into category totals", async () => {
    await configureCategories(current);
    const response = await current.app.inject({ url: "/api/categories/washing" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as {
      name: string;
      members: { id: string; name: string }[];
      energyTodayKwh: number;
      costToday: number;
      livePowerW: number | null;
    };
    expect(body.name).toBe("Washing");
    expect(body.members.map((member) => member.name)).toEqual(["Fridge", "Dryer"]);
    // Only the fridge has energy statistics; the dryer is unavailable.
    expect(body.energyTodayKwh).toBe(0.62);
    expect(body.costToday).toBe(0.19);
    expect(body.livePowerW).toBe(43.2);
  });

  it("reports overlap when an appliance is in more than one category", async () => {
    await configureCategories(current);
    const summary = await current.app.inject({ url: "/api/summary" });
    const body = summary.json() as {
      categories: { id: string; energyTodayKwh: number | null }[];
      categoriesOverlap: boolean;
    };
    expect(body.categoriesOverlap).toBe(true);
    expect(body.categories.map((category) => category.id)).toEqual(["washing", "cooling"]);
    // The fridge counts towards both, so the two categories overlap.
    expect(body.categories[0]!.energyTodayKwh).toBe(0.62);
    expect(body.categories[1]!.energyTodayKwh).toBe(0.62);
  });

  it("ignores membership for appliances that no longer exist", async () => {
    await configureFridge(current);
    await current.app.inject({
      method: "PUT",
      url: "/api/categories",
      payload: {
        categories: [{ name: "Washing", applianceIds: ["device:dev-fridge", "device:gone"] }],
      },
    });

    const response = await current.app.inject({ url: "/api/categories/washing" });
    expect(response.statusCode).toBe(200);
    const body = response.json() as { members: { id: string; name: string }[] };
    expect(body.members).toEqual([{ id: "device:dev-fridge", name: "Fridge" }]);
  });

  it("404s for an unknown category and rejects a bad payload", async () => {
    expect((await current.app.inject({ url: "/api/categories/nope" })).statusCode).toBe(404);
    const bad = await current.app.inject({
      method: "PUT",
      url: "/api/categories",
      payload: { categories: "nope" },
    });
    expect(bad.statusCode).toBe(400);
  });

  it("reports no overlap and no categories by default", async () => {
    await configureFridge(current);
    const summary = await current.app.inject({ url: "/api/summary" });
    const body = summary.json() as { categories: unknown[]; categoriesOverlap: boolean };
    expect(body.categories).toEqual([]);
    expect(body.categoriesOverlap).toBe(false);
  });
});

describe("an appliance with only vendor counters and no statistics", () => {
  // Exactly the shape a SONOFF plug reports through SonoffLAN: daily and
  // monthly counters, no lifetime total, and no long-term statistics yet.
  async function configureCounterOnly(h: Harness) {
    clearStatistics(h);
    // No recorded history for the daily counter either, so today's reading is
    // genuinely all that is known.
    h.source.options.history = {};
    h.source.setState("sensor.fridge_energy_day", "0.0", {
      device_class: "energy",
      state_class: "total_increasing",
      unit_of_measurement: "kWh",
    });
    h.source.setState("sensor.fridge_energy_month", "1.86", {
      device_class: "energy",
      state_class: "total_increasing",
      unit_of_measurement: "kWh",
    });

    await h.app.inject({
      method: "PUT",
      url: "/api/appliances",
      payload: {
        appliances: [
          {
            id: "device:dev-fridge",
            name: "Fridge",
            entities: {
              power: "sensor.fridge_power",
              energyDay: "sensor.fridge_energy_day",
              energyMonth: "sensor.fridge_energy_month",
            },
            enabled: true,
          },
        ],
      },
    });
  }

  it("uses the monthly counter instead of reporting zero for the month", async () => {
    await configureCounterOnly(current);
    const body = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge" })
    ).json() as { energyMonthKwh: number; costMonth: number };

    // The device says 1.86 kWh this month; reporting 0.00 contradicted it.
    expect(body.energyMonthKwh).toBe(1.86);
    expect(body.costMonth).toBe(0.56);
  });

  it("says the week is unknown rather than inventing a zero", async () => {
    await configureCounterOnly(current);
    const body = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge" })
    ).json() as { energyTodayKwh: number; energyWeekKwh: number | null; hasDailyHistory: boolean };

    expect(body.hasDailyHistory).toBe(false);
    // Today is known from the daily counter.
    expect(body.energyTodayKwh).toBe(0);
    // Six earlier days nobody has any record of must not read as 0.00.
    expect(body.energyWeekKwh).toBeNull();
  });

  it("carries the same distinction into the household totals", async () => {
    await configureCounterOnly(current);
    const body = (await current.app.inject({ url: "/api/summary" })).json() as {
      totals: { energyWeekKwh: number | null; energyMonthKwh: number | null };
    };
    expect(body.totals.energyWeekKwh).toBeNull();
    expect(body.totals.energyMonthKwh).toBe(1.86);
  });
});

describe("cumulative curves", () => {
  it("agrees with the Today figure shown above it", async () => {
    await configureFridge(current);

    const summary = (await current.app.inject({ url: "/api/summary" })).json() as {
      totals: { energyTodayKwh: number };
    };
    const curve = (await current.app.inject({ url: "/api/summary/cumulative" })).json() as {
      totalKwh: number;
      source: string;
      points: { v: number }[];
    };

    // Both come from the same statistics, so a user never sees two different
    // answers to "how much today".
    expect(curve.source).toBe("statistics");
    expect(curve.totalKwh).toBe(summary.totals.energyTodayKwh);

    const values = curve.points.map((point) => point.v);
    for (let i = 1; i < values.length; i += 1) {
      expect(values[i]!).toBeGreaterThanOrEqual(values[i - 1]!);
    }
    expect(values.at(-1)).toBe(curve.totalKwh);
  });

  it("keeps the 7d curve tied to the this-week figure", async () => {
    await configureFridge(current);
    await current.app.inject({
      method: "PUT",
      url: "/api/categories",
      payload: { categories: [{ name: "Washing", applianceIds: ["device:dev-fridge"] }] },
    });

    const summary = (await current.app.inject({ url: "/api/summary" })).json() as {
      totals: { energyWeekKwh: number };
    };
    const curve = (
      await current.app.inject({ url: "/api/categories/washing/cumulative?range=7d" })
    ).json() as { points: unknown[]; totalKwh: number };

    expect(curve.points.length).toBeGreaterThan(0);
    expect(curve.totalKwh).toBeCloseTo(summary.totals.energyWeekKwh, 3);
  });

  it("draws the history it has rather than one dot on an empty week", async () => {
    // A day-old install asked for 7 days: show that day properly, the way a
    // long-range stock chart shows a recent listing.
    await configureFridge(current);
    clearStatistics(current);

    const response = await current.app.inject({ url: "/api/summary/cumulative?range=7d" });
    const body = response.json() as {
      range: string;
      source: string;
      points: { t: number }[];
      start: number;
    };

    expect(body.range).toBe("7d");
    expect(body.source).toBe("meter");
    // Many points across the one day available, not a single daily dot.
    expect(body.points.length).toBeGreaterThan(1);
    // The window reported is the data's own span, so the axis is not mostly
    // empty space.
    expect(body.start).toBe(body.points[0]!.t);
    expect(body.start).toBeGreaterThanOrEqual(todayStart);
  });

  it("sums every member of a category, not just the first", async () => {
    await configureFridge(current);
    await current.app.inject({
      method: "PUT",
      url: "/api/categories",
      payload: {
        categories: [
          { name: "Washing", applianceIds: ["device:dev-fridge", "device:dev-dryer"] },
        ],
      },
    });

    const category = (
      await current.app.inject({ url: "/api/categories/washing/cumulative?range=7d" })
    ).json() as { totalKwh: number };
    const fridge = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge/cumulative?range=7d" })
    ).json() as { totalKwh: number };
    const dryer = (
      await current.app.inject({ url: "/api/appliances/device:dev-dryer/cumulative?range=7d" })
    ).json() as { totalKwh: number | null };

    // The dryer contributes nothing, so the category equals the fridge - that
    // is a correct sum, not a dropped member.
    expect(dryer.totalKwh).toBeNull();
    expect(category.totalKwh).toBeCloseTo(fridge.totalKwh, 3);
  });

  it("accumulates across days for the longer ranges", async () => {
    await configureFridge(current);
    const response = await current.app.inject({ url: "/api/summary/cumulative?range=7d" });
    expect(response.statusCode).toBe(200);

    const body = response.json() as { range: string; totalKwh: number; points: { v: number }[] };
    expect(body.range).toBe("7d");
    // The curve keeps climbing across day boundaries rather than resetting.
    expect(body.totalKwh).toBeCloseTo(6 * PER_DAY + TODAY_KWH, 3);
    expect(body.points.at(0)!.v).toBeCloseTo(PER_DAY, 3);
  });

  it("follows the vendor daily meter when statistics are missing", async () => {
    await configureFridge(current);
    clearStatistics(current);

    const response = await current.app.inject({ url: "/api/summary/cumulative" });
    const body = response.json() as { source: string; totalKwh: number };
    // The daily counter is already a running total, and it is what the
    // headline figure falls back to, so the two must agree.
    expect(body.source).toBe("meter");
    expect(body.totalKwh).toBe(2.5);
  });

  it("integrates power only when there is no meter either", async () => {
    await configureFridge(current);
    clearStatistics(current);
    current.source.options.history = {
      "sensor.fridge_power": [{ t: todayStart, s: "100" }],
    };

    const response = await current.app.inject({ url: "/api/summary/cumulative" });
    const body = response.json() as { source: string; totalKwh: number };
    expect(body.source).toBe("history");
    expect(body.totalKwh).toBeGreaterThan(0);
  });

  it("rejects an unsupported range", async () => {
    const response = await current.app.inject({ url: "/api/summary/cumulative?range=99y" });
    expect(response.statusCode).toBe(400);
  });

  it("serves the same shape per appliance and per category", async () => {
    await configureFridge(current);
    await current.app.inject({
      method: "PUT",
      url: "/api/categories",
      payload: { categories: [{ name: "Washing", applianceIds: ["device:dev-fridge"] }] },
    });

    const appliance = await current.app.inject({
      url: "/api/appliances/device:dev-fridge/cumulative",
    });
    const category = await current.app.inject({ url: "/api/categories/washing/cumulative" });

    expect(appliance.statusCode).toBe(200);
    expect(category.statusCode).toBe(200);
    // One appliance in the category, so the two curves agree.
    expect((category.json() as { totalKwh: number }).totalKwh).toBe(
      (appliance.json() as { totalKwh: number }).totalKwh,
    );
  });

  it("returns an empty curve, not an error, when nothing was recorded", async () => {
    await configureFridge(current);
    current.source.options.history = {};
    clearStatistics(current);
    const response = await current.app.inject({
      url: "/api/appliances/device:dev-dryer/cumulative",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ points: [], totalKwh: null });
  });

  it("404s for unknown appliances and categories", async () => {
    expect((await current.app.inject({ url: "/api/appliances/nope/cumulative" })).statusCode).toBe(
      404,
    );
    expect((await current.app.inject({ url: "/api/categories/nope/cumulative" })).statusCode).toBe(
      404,
    );
  });
});

describe("ingress guard", () => {
  it("refuses requests that did not come through Home Assistant", async () => {
    const guarded = await harness(true);
    try {
      const blocked = await guarded.app.inject({
        url: "/api/health",
        remoteAddress: "192.168.1.50",
      });
      expect(blocked.statusCode).toBe(403);

      const allowed = await guarded.app.inject({
        url: "/api/health",
        remoteAddress: "172.30.32.2",
      });
      expect(allowed.statusCode).toBe(200);
    } finally {
      guarded.broadcaster.stop();
      await guarded.app.close();
    }
  });
});

describe("recovering daily totals from a daily counter", () => {
  /** A counter that climbs through each day and resets at midnight. */
  function counterHistory(days: number, perDay: number) {
    const points: { t: number; s: string }[] = [];
    for (let day = days - 1; day >= 0; day -= 1) {
      const dayStart = todayStart - day * 86_400_000;
      points.push({ t: dayStart + 1_000, s: "0" });
      points.push({ t: dayStart + 6 * 3_600_000, s: String(perDay / 2) });
      points.push({ t: dayStart + 20 * 3_600_000, s: String(perDay) });
    }
    return points;
  }

  async function configureCounterWithHistory(h: Harness, days: number, perDay: number) {
    clearStatistics(h);
    h.source.options.history = {
      "sensor.fridge_energy_day": counterHistory(days, perDay),
    };
    await h.app.inject({
      method: "PUT",
      url: "/api/appliances",
      payload: {
        appliances: [
          {
            id: "device:dev-fridge",
            name: "Fridge",
            entities: {
              power: "sensor.fridge_power",
              energyDay: "sensor.fridge_energy_day",
            },
            enabled: true,
          },
        ],
      },
    });
  }

  it("takes each day's peak before its midnight reset as that day's total", async () => {
    await configureCounterWithHistory(current, 10, 1.2);
    const body = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge" })
    ).json() as {
      hasDailyHistory: boolean;
      energyTodayKwh: number;
      energyWeekKwh: number;
    };

    expect(body.hasDailyHistory).toBe(true);
    expect(body.energyTodayKwh).toBeCloseTo(1.2, 3);
    // Seven days of real measured totals, not a vendor counter.
    expect(body.energyWeekKwh).toBeCloseTo(7 * 1.2, 3);
  });

  it("still refuses a week it cannot fully account for", async () => {
    await configureCounterWithHistory(current, 3, 1.2);
    const body = (
      await current.app.inject({ url: "/api/appliances/device:dev-fridge" })
    ).json() as { energyWeekKwh: number | null; energyTodayKwh: number };

    expect(body.energyTodayKwh).toBeCloseTo(1.2, 3);
    // Only three days recorded; the other four are unknown, not zero.
    expect(body.energyWeekKwh).toBeNull();
  });

  it("fills the daily energy chart that had nothing to draw before", async () => {
    await configureCounterWithHistory(current, 10, 1.2);
    const body = (
      await current.app.inject({
        url: "/api/appliances/device:dev-fridge/history?range=30d",
      })
    ).json() as { energyDaily: { v: number | null }[] };

    // One bar per recorded day, where the chart previously said "no daily
    // totals yet" and would have gone on saying it forever.
    expect(body.energyDaily.length).toBe(10);
    expect(body.energyDaily.every((point) => point.v === 1.2)).toBe(true);
  });
});
