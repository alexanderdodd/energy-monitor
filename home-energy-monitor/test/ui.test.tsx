import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../web/src/App.tsx";
import { StubEventSource } from "./setup.ts";

const SUMMARY = {
  generatedAt: "2026-09-26T12:00:00.000Z",
  connection: { connected: true, lastUpdate: "2026-09-26T12:00:00.000Z", lastError: null },
  currency: "EUR",
  electricityPricePerKwh: 0.3,
  setupComplete: true,
  totals: {
    livePowerW: 257,
    energyTodayKwh: 4.12,
    costToday: 1.29,
    energyWeekKwh: 28.4,
    energyMonthKwh: 120,
    estimatedMonthlyKwh: 124,
    estimatedYearlyKwh: 1500,
    estimatedYearlyCost: 450,
  },
  appliances: [
    {
      id: "device:fridge",
      name: "Fridge",
      available: true,
      powerW: 43,
      currentA: 0.19,
      voltageV: 236,
      energyTodayKwh: 0.62,
      costToday: 0.19,
    },
    {
      id: "device:dryer",
      name: "Dryer",
      available: false,
      powerW: null,
      currentA: null,
      voltageV: null,
      energyTodayKwh: null,
      costToday: null,
    },
  ],
};

const SETTINGS = {
  electricityPricePerKwh: 0.3,
  currency: "EUR",
  setupComplete: true,
  homeAssistant: { connected: true, lastUpdate: "2026-09-26T12:00:00.000Z", lastError: null },
};

const DISCOVERY = {
  appliances: [
    {
      id: "device:fridge",
      name: "Fridge",
      deviceId: "fridge",
      manufacturer: "SONOFF",
      model: "S60TPF",
      entities: { power: "sensor.fridge_power" },
      candidates: [
        {
          entityId: "sensor.fridge_power",
          name: "Fridge Power",
          kind: "power",
          role: "power",
          unit: "W",
        },
      ],
      configured: true,
    },
  ],
};

const APPLIANCES = {
  appliances: [
    {
      id: "device:fridge",
      name: "Fridge",
      entities: { power: "sensor.fridge_power" },
      enabled: true,
    },
  ],
};

const requests: { url: string; init?: RequestInit }[] = [];

function respond(body: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

beforeEach(() => {
  requests.length = 0;
  window.location.hash = "";

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requests.push({ url, init });
    if (url.includes("/api/summary")) return respond(SUMMARY);
    if (url.includes("/api/settings")) return respond(SETTINGS);
    if (url.includes("/api/discovery")) return respond(DISCOVERY);
    if (url.includes("/api/appliances")) return respond(APPLIANCES);
    return respond({});
  });
});

afterEach(() => {
  window.location.hash = "";
});

describe("Overview", () => {
  it("shows household totals and one card per appliance", async () => {
    render(<App />);

    expect(await screen.findByText("257 W")).toBeInTheDocument();
    expect(screen.getByText("4.12 kWh")).toBeInTheDocument();
    expect(screen.getByText("€1.29")).toBeInTheDocument();

    expect(screen.getByText("Fridge")).toBeInTheDocument();
    expect(screen.getByText("43 W")).toBeInTheDocument();
    expect(screen.getByText("0.62 kWh today")).toBeInTheDocument();
  });

  it("says an appliance is unavailable rather than showing 0 W", async () => {
    render(<App />);

    await screen.findByText("Fridge");
    expect(screen.getByText("Unavailable")).toBeInTheDocument();
    // The dryer's card must not claim it consumed nothing.
    expect(screen.queryByText("0 W")).not.toBeInTheDocument();
  });

  it("updates live power from the event stream without refetching", async () => {
    render(<App />);
    await screen.findByText("257 W");

    const stream = StubEventSource.instances[0]!;
    expect(stream.url).toContain("api/events");

    stream.emit("open");
    stream.emit("state", {
      generatedAt: "2026-09-26T12:00:05.000Z",
      connection: { connected: true, lastUpdate: "2026-09-26T12:00:05.000Z", lastError: null },
      totalPowerW: 1893,
      appliances: [
        { id: "device:fridge", name: "Fridge", available: true, powerW: 43, currentA: null, voltageV: null },
        { id: "device:dryer", name: "Dryer", available: true, powerW: 1850, currentA: null, voltageV: null },
      ],
    });

    expect(await screen.findByText("1.89 kW")).toBeInTheDocument();
    expect(screen.getByText("1.85 kW")).toBeInTheDocument();
  });

  it("warns when Home Assistant is unreachable", async () => {
    render(<App />);
    await screen.findByText("257 W");

    StubEventSource.instances[0]!.emit("state", {
      generatedAt: "2026-09-26T12:00:05.000Z",
      connection: {
        connected: false,
        lastUpdate: "2026-09-26T11:55:00.000Z",
        lastError: "Home Assistant connection lost",
      },
      totalPowerW: null,
      appliances: [],
    });

    expect(await screen.findByText(/Home Assistant connection lost/)).toBeInTheDocument();
  });
});

describe("Settings", () => {
  it("saves a changed electricity price", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    const price = (await screen.findByLabelText("Electricity price (per kWh)")) as HTMLInputElement;
    expect(price.value).toBe("0.3");

    await user.clear(price);
    await user.type(price, "0.42");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const put = requests.find(
        (request) => request.init?.method === "PUT" && request.url.includes("/api/settings"),
      );
      expect(put).toBeDefined();
      expect(JSON.parse(String(put!.init!.body))).toMatchObject({
        electricityPricePerKwh: 0.42,
      });
    });

    expect(await screen.findByText("Saved")).toBeInTheDocument();
  });

  it("rejects a negative price without calling the API", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    const price = (await screen.findByLabelText("Electricity price (per kWh)")) as HTMLInputElement;
    await user.clear(price);
    await user.type(price, "-1");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByText(/must be a number of 0 or more/)).toBeInTheDocument();
    expect(
      requests.some((request) => request.init?.method === "PUT" && request.url.includes("settings")),
    ).toBe(false);
  });

  it("reports the Home Assistant connection", async () => {
    window.location.hash = "#/settings";
    render(<App />);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});
