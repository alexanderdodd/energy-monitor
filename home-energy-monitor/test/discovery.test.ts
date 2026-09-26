import { describe, expect, it } from "vitest";
import {
  assignRole,
  classifyEntity,
  discoverAppliances,
  objectIdPrefix,
} from "../server/src/ha/discovery.ts";
import type { HaState } from "../server/src/ha/types.ts";

function sensor(entityId: string, attributes: HaState["attributes"], state = "1"): HaState {
  return { entity_id: entityId, state, attributes };
}

describe("classifyEntity", () => {
  it("uses device_class when Home Assistant provides one", () => {
    expect(classifyEntity(sensor("sensor.a", { device_class: "power" }))).toBe("power");
    expect(classifyEntity(sensor("sensor.b", { device_class: "energy" }))).toBe("energy");
    expect(classifyEntity(sensor("sensor.c", { device_class: "current" }))).toBe("current");
    expect(classifyEntity(sensor("sensor.d", { device_class: "voltage" }))).toBe("voltage");
  });

  it("falls back to the unit when it is backed by a state_class", () => {
    const state = sensor("sensor.x", { unit_of_measurement: "kWh", state_class: "total_increasing" });
    expect(classifyEntity(state)).toBe("energy");
  });

  it("ignores a unit with no state_class", () => {
    expect(classifyEntity(sensor("sensor.x", { unit_of_measurement: "W" }))).toBeNull();
  });

  it("ignores entities outside the sensor domain", () => {
    expect(classifyEntity(sensor("switch.plug", { device_class: "power" }))).toBeNull();
  });

  it("does not classify on name alone", () => {
    expect(classifyEntity(sensor("sensor.fridge_power", { friendly_name: "Fridge Power" }))).toBeNull();
  });

  it("ignores unrelated device classes", () => {
    expect(
      classifyEntity(sensor("sensor.t", { device_class: "temperature", state_class: "measurement" })),
    ).toBeNull();
  });
});

describe("assignRole", () => {
  it("maps non-energy measurements straight through", () => {
    expect(assignRole(sensor("sensor.a", {}), "power")).toBe("power");
    expect(assignRole(sensor("sensor.a", {}), "voltage")).toBe("voltage");
  });

  it("treats a cumulative counter as the appliance's energy meter", () => {
    const state = sensor("sensor.fridge_energy", { state_class: "total_increasing" });
    expect(assignRole(state, "energy")).toBe("energy");
  });

  it("separates per-day and per-month counters by name", () => {
    expect(assignRole(sensor("sensor.fridge_energy_day", { state_class: "total" }), "energy")).toBe(
      "energyDay",
    );
    expect(
      assignRole(sensor("sensor.fridge_energy_month", { state_class: "total" }), "energy"),
    ).toBe("energyMonth");
    expect(
      assignRole(
        sensor("sensor.fridge_energy_x", { state_class: "total", friendly_name: "Fridge Energy today" }),
        "energy",
      ),
    ).toBe("energyDay");
  });
});

describe("objectIdPrefix", () => {
  it("strips measurement suffixes", () => {
    expect(objectIdPrefix("sensor.fridge_power")).toBe("fridge");
    expect(objectIdPrefix("sensor.washing_machine_energy_day")).toBe("washing_machine");
    expect(objectIdPrefix("sensor.fridge")).toBe("fridge");
  });
});

describe("discoverAppliances", () => {
  const states: HaState[] = [
    sensor("sensor.fridge_power", {
      device_class: "power",
      state_class: "measurement",
      unit_of_measurement: "W",
      friendly_name: "Fridge Power",
    }),
    sensor("sensor.fridge_current", {
      device_class: "current",
      unit_of_measurement: "A",
      friendly_name: "Fridge Current",
    }),
    sensor("sensor.fridge_energy", {
      device_class: "energy",
      state_class: "total_increasing",
      unit_of_measurement: "kWh",
      friendly_name: "Fridge Energy",
    }),
    sensor("sensor.fridge_energy_day", {
      device_class: "energy",
      state_class: "total",
      unit_of_measurement: "kWh",
      friendly_name: "Fridge Energy day",
    }),
    sensor("sensor.living_room_temperature", {
      device_class: "temperature",
      state_class: "measurement",
      unit_of_measurement: "°C",
    }),
  ];

  const entityRegistry = states.map((state) => ({
    entity_id: state.entity_id,
    device_id: state.entity_id.startsWith("sensor.fridge") ? "dev-1" : "dev-2",
  }));

  const deviceRegistry = [
    { id: "dev-1", name: "Smart Plug 1", name_by_user: "Fridge", manufacturer: "SONOFF", model: "S60TPF" },
    { id: "dev-2", name: "Thermometer" },
  ];

  it("groups a device's measurements into one appliance", () => {
    const result = discoverAppliances({ states, entityRegistry, deviceRegistry });
    expect(result).toHaveLength(1);

    const fridge = result[0]!;
    expect(fridge.name).toBe("Fridge"); // the user's own name wins
    expect(fridge.deviceId).toBe("dev-1");
    expect(fridge.entities).toEqual({
      power: "sensor.fridge_power",
      current: "sensor.fridge_current",
      energy: "sensor.fridge_energy",
      energyDay: "sensor.fridge_energy_day",
    });
    expect(fridge.candidates).toHaveLength(4);
  });

  it("drops devices with no power or energy measurement", () => {
    const result = discoverAppliances({
      states: [states[4]!],
      entityRegistry,
      deviceRegistry,
    });
    expect(result).toHaveLength(0);
  });

  it("falls back to name-based grouping when no registry is available", () => {
    const result = discoverAppliances({ states, entityRegistry: [], deviceRegistry: [] });
    expect(result).toHaveLength(1);
    expect(result[0]!.id).toBe("name:fridge");
    expect(result[0]!.name).toBe("Fridge");
    expect(result[0]!.entities.power).toBe("sensor.fridge_power");
  });

  it("skips disabled and hidden entities", () => {
    const hidden = entityRegistry.map((entry) =>
      entry.entity_id === "sensor.fridge_power" ? { ...entry, hidden_by: "user" } : entry,
    );
    const result = discoverAppliances({ states, entityRegistry: hidden, deviceRegistry });
    expect(result[0]!.entities.power).toBeUndefined();
    expect(result[0]!.entities.energy).toBe("sensor.fridge_energy");
  });

  it("marks appliances that are already configured", () => {
    const result = discoverAppliances({
      states,
      entityRegistry,
      deviceRegistry,
      configuredIds: new Set(["device:dev-1"]),
    });
    expect(result[0]!.configured).toBe(true);
  });
});
