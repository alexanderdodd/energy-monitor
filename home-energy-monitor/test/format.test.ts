import { describe, expect, it } from "vitest";
import {
  NO_VALUE,
  formatCurrent,
  formatEnergy,
  formatMoney,
  formatPower,
  formatRelativeTime,
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
