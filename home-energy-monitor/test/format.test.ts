import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  formatCurrent,
  formatEnergy,
  formatInstant,
  formatMoney,
  formatPower,
  formatRelativeTime,
  formatTimeAxis,
  formatTooltipTime,
  formatVoltage,
} from "../web/src/lib/format.ts";
import { hrefFor, parseHash } from "../web/src/lib/router.ts";

describe("formatting", () => {
  it("switches power to kW once it gets large", () => {
    expect(formatPower(43)).toBe("43 W");
    expect(formatPower(1850)).toBe("1.85 kW");
    expect(formatPower(0)).toBe("0 W");
  });

  it("shows a dash rather than a zero for missing values", () => {
    expect(formatPower(null)).toBe(NO_VALUE);
    expect(formatEnergy(undefined)).toBe(NO_VALUE);
    expect(formatCurrent(null)).toBe(NO_VALUE);
    expect(formatVoltage(null)).toBe(NO_VALUE);
    expect(formatMoney(null, "EUR")).toBe(NO_VALUE);
  });

  it("formats energy, current and voltage", () => {
    expect(formatEnergy(0.62)).toBe("0.62 kWh");
    expect(formatEnergy(228.4)).toBe("228 kWh");
    expect(formatCurrent(0.19)).toBe("0.19 A");
    expect(formatVoltage(236.4)).toBe("236 V");
  });

  it("formats money in the configured currency", () => {
    expect(formatMoney(1.29, "EUR", "en-IE")).toBe("€1.29");
    expect(formatMoney(1.29, "GBP", "en-GB")).toBe("£1.29");
  });

  it("does not blank out a value for an unknown currency code", () => {
    expect(formatMoney(1.29, "NOTACURRENCY")).toContain("1.29");
  });

  it("describes how stale a timestamp is", () => {
    const now = Date.parse("2026-09-26T12:00:00.000Z");
    expect(formatRelativeTime("2026-09-26T11:59:58.000Z", now)).toBe("just now");
    expect(formatRelativeTime("2026-09-26T11:58:00.000Z", now)).toBe("2 minutes ago");
    expect(formatRelativeTime("2026-09-26T09:00:00.000Z", now)).toBe("3 hours ago");
    expect(formatRelativeTime(null, now)).toBe("never");
    expect(formatRelativeTime("nonsense", now)).toBe("never");
  });
});

describe("chart labels", () => {
  // 26 September 2026, 20:27 UTC.
  const timestamp = Date.parse("2026-09-26T20:27:00.000Z");

  it("keeps axis labels terse, because they repeat across the chart", () => {
    expect(formatTimeAxis(timestamp, "24h")).toMatch(/\d{2}:\d{2}/);
    expect(formatTimeAxis(timestamp, "30d")).toMatch(/Sep/);
  });

  it("never shows a raw epoch timestamp in a tooltip", () => {
    for (const range of ["6h", "24h", "7d", "30d"]) {
      const label = formatTooltipTime(timestamp, range, "en-GB");
      expect(label).not.toContain(String(timestamp));
      expect(label).toContain("Sep");
      expect(label).toContain("26");
    }
  });

  it("includes the time of day except for day buckets", () => {
    expect(formatTooltipTime(timestamp, "24h", "en-GB")).toMatch(/\d{2}:\d{2}/);
    // 30d buckets are whole days; a time of day would be meaningless.
    expect(formatTooltipTime(timestamp, "30d", "en-GB")).not.toMatch(/\d{2}:\d{2}/);
  });

  it("dates a day bucket but times anything finer on a mixed axis", () => {
    const midnight = new Date(2026, 9, 4).getTime();
    const afternoon = new Date(2026, 9, 10, 14, 5).getTime();
    expect(formatInstant(midnight, "en-GB")).not.toMatch(/\d{2}:\d{2}/);
    expect(formatInstant(midnight, "en-GB")).toContain("4 Oct");
    // Without the time, every five-minute point of a day reads identically.
    expect(formatInstant(afternoon, "en-GB")).toContain("14:05");
  });

  it("degrades safely on a bad timestamp", () => {
    expect(formatTooltipTime(Number.NaN, "24h", "en-GB")).toBe("");
  });
});

describe("routing", () => {
  it("parses hash routes", () => {
    expect(parseHash("")).toEqual({ name: "overview" });
    expect(parseHash("#/")).toEqual({ name: "overview" });
    expect(parseHash("#/settings")).toEqual({ name: "settings" });
    expect(parseHash("#/setup")).toEqual({ name: "setup" });
    expect(parseHash("#/appliance/device%3Adev-1")).toEqual({
      name: "appliance",
      id: "device:dev-1",
    });
  });

  it("round-trips appliance ids containing a colon", () => {
    const route = { name: "appliance", id: "device:dev-1" } as const;
    expect(parseHash(hrefFor(route))).toEqual(route);
  });
});
