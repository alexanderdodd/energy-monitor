import { describe, expect, it } from "vitest";
import { parseHistoryResponse } from "../server/src/ha/client.ts";
import { buildHistory, sumDailyEnergy } from "../server/src/ha/history.ts";
import { FakeHaSource } from "./helpers/fakeSource.ts";
import type { Appliance } from "../server/src/appliances/types.ts";

const appliance: Appliance = {
  id: "device:1",
  name: "Fridge",
  entities: { power: "sensor.fridge_power", energy: "sensor.fridge_energy" },
  enabled: true,
};

describe("parseHistoryResponse", () => {
  it("handles the mixed full/minimal entry shapes", () => {
    const raw = [
      [
        {
          entity_id: "sensor.fridge_power",
          state: "40",
          last_changed: "2026-09-26T10:00:00.000Z",
          attributes: {},
        },
        { state: "45", last_changed: "2026-09-26T10:05:00.000Z" },
        { state: "0", last_updated: "2026-09-26T10:10:00.000Z" },
      ],
    ];
    const result = parseHistoryResponse(raw, ["sensor.fridge_power"]);
    expect(result["sensor.fridge_power"]).toEqual([
      { t: Date.parse("2026-09-26T10:00:00.000Z"), s: "40" },
      { t: Date.parse("2026-09-26T10:05:00.000Z"), s: "45" },
      { t: Date.parse("2026-09-26T10:10:00.000Z"), s: "0" },
    ]);
  });

  it("matches series positionally when no entry carries an entity id", () => {
    const raw = [[{ state: "12", last_changed: "2026-09-26T10:00:00.000Z" }]];
    const result = parseHistoryResponse(raw, ["sensor.a"]);
    expect(result["sensor.a"]).toHaveLength(1);
  });

  it("ignores malformed payloads", () => {
    expect(parseHistoryResponse(null)).toEqual({});
    expect(parseHistoryResponse({ oops: true })).toEqual({});
    expect(parseHistoryResponse([[]])).toEqual({});
  });

  it("skips entries with no usable timestamp", () => {
    const raw = [
      [
        { entity_id: "sensor.a", state: "1", last_changed: "not a date" },
        { state: "2", last_changed: "2026-09-26T10:00:00.000Z" },
      ],
    ];
    expect(parseHistoryResponse(raw)["sensor.a"]).toHaveLength(1);
  });
});

describe("buildHistory", () => {
  const now = new Date("2026-09-26T12:00:00.000Z");

  it("downsamples raw history for short ranges", async () => {
    const start = now.getTime() - 6 * 3_600_000;
    const source = new FakeHaSource({
      history: {
        "sensor.fridge_power": [
          { t: start, s: "40" },
          { t: start + 3_600_000, s: "0" },
        ],
      },
    });

    const result = await buildHistory(source, appliance, "6h", now);
    expect(result.powerSource).toBe("history");
    expect(result.power).toHaveLength(180); // 6h in 2-minute buckets
    expect(result.power[0]!.v).toBe(40);
    expect(result.power.at(-1)!.v).toBe(0);
  });

  it("prefers long-term statistics for long ranges", async () => {
    const source = new FakeHaSource({
      statistics: {
        "sensor.fridge_power": [
          { start: now.getTime() - 3_600_000, end: now.getTime(), mean: 41.234 },
        ],
      },
    });

    const result = await buildHistory(source, appliance, "30d", now);
    expect(result.powerSource).toBe("statistics");
    expect(result.power).toEqual([{ t: now.getTime() - 3_600_000, v: 41.23 }]);
  });

  it("falls back to raw history when statistics are empty", async () => {
    const source = new FakeHaSource({
      history: { "sensor.fridge_power": [{ t: now.getTime() - 86_400_000, s: "10" }] },
    });
    const result = await buildHistory(source, appliance, "7d", now);
    expect(result.powerSource).toBe("history");
    expect(result.power.some((point) => point.v === 10)).toBe(true);
  });

  it("returns an empty series when no power sensor is mapped", async () => {
    const source = new FakeHaSource();
    const result = await buildHistory(
      source,
      { ...appliance, entities: { energy: "sensor.fridge_energy" } },
      "24h",
      now,
    );
    expect(result.power).toEqual([]);
  });
});

describe("sumDailyEnergy", () => {
  const day = (offset: number) => {
    const date = new Date(2026, 8, 26);
    date.setDate(date.getDate() + offset);
    return date.getTime();
  };

  it("adds up the buckets from a cut-off onwards", () => {
    const points = [
      { t: day(-2), v: 1 },
      { t: day(-1), v: 2 },
      { t: day(0), v: 3 },
    ];
    expect(sumDailyEnergy(points, new Date(day(-1)))).toBe(5);
  });

  it("returns null when nothing was recorded", () => {
    expect(sumDailyEnergy([], new Date())).toBeNull();
    expect(sumDailyEnergy([{ t: day(0), v: null }], new Date(day(0)))).toBeNull();
  });
});
