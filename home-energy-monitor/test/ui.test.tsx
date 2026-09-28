import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "../web/src/App.tsx";

// ECharts needs a real canvas, which jsdom does not provide. These tests are
// about the dashboard's own behaviour, so stand the chart in with a marker
// and let test/charts.test.tsx cover the failure path instead.
vi.mock("../web/src/components/PowerChart.tsx", () => ({
  default: ({ label }: { label: string }) => <div data-testid="chart" aria-label={label} />,
}));

vi.mock("../web/src/components/ComparisonChart.tsx", () => ({
  default: ({ view, series }: { view: string; series: { name: string }[] }) => (
    <div data-testid="comparison-chart" data-view={view} data-series={series.length} />
  ),
}));
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
    costWeek: 8.52,
    energyMonthKwh: 120,
    costMonth: 36,
    estimatedMonthlyKwh: 124,
    estimatedYearlyKwh: 1500,
    estimatedYearlyCost: 450,
  },
  categoriesOverlap: true,
  categories: [
    {
      id: "washing",
      name: "Washing",
      applianceIds: ["device:dryer", "device:fridge"],
      members: [
        { id: "device:dryer", name: "Dryer" },
        { id: "device:fridge", name: "Fridge" },
      ],
      livePowerW: 43,
      energyTodayKwh: 2.31,
      costToday: 0.69,
      energyWeekKwh: 14.2,
      costWeek: 4.26,
      energyMonthKwh: 60,
      costMonth: 18,
      dailyKwh: [
        { t: 1, v: 2 },
        { t: 2, v: 2.4 },
        { t: 3, v: 2.2 },
      ],
      trend: {
        windowDays: 7,
        currentKwh: 14.2,
        previousKwh: 12,
        changePercent: 18.3,
        comparable: true,
      },
    },
  ],
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

const CATEGORIES = { categories: [{ id: "washing", name: "Washing", applianceIds: ["device:fridge"] }] };

const CATEGORY_DETAIL = {
  ...SUMMARY.categories[0],
  currency: "EUR",
  electricityPricePerKwh: 0.3,
  homeAssistant: SUMMARY.connection,
};

const CUMULATIVE = {
  range: "today",
  start: 1790000000000,
  end: 1790040000000,
  points: [
    { t: 1790000000000, v: 0.1 },
    { t: 1790000300000, v: 0.35 },
    { t: 1790000600000, v: 0.62 },
  ],
  totalKwh: 0.62,
  source: "statistics",
};

const COMPARE = {
  scope: "appliances",
  range: "today",
  start: 1790000000000,
  end: 1790040000000,
  buckets: [1790000000000, 1790000300000],
  series: [
    { id: "device:fridge", name: "Fridge", points: [0.3, 0.62], totalKwh: 0.62, cost: 0.19 },
    { id: "device:dryer", name: "Dryer", points: [null, 1.2], totalKwh: 1.2, cost: 0.36 },
  ],
  totalKwh: 1.82,
  currency: "EUR",
};

const TREND = {
  scope: "appliances",
  period: "day",
  buckets: [1789900000000, 1790000000000],
  total: { points: [1.8, 1.82], changePercent: 1.1 },
  series: [
    { id: "device:fridge", name: "Fridge", points: [0.8, 0.62], changePercent: -22.4 },
    { id: "device:dryer", name: "Dryer", points: [1.0, 1.2], changePercent: 20 },
  ],
  currency: "EUR",
  electricityPricePerKwh: 0.3,
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

/**
 * A headline stat, scoped by its label.
 *
 * Restricted to the stat grids: labels like "Today" also appear as chart
 * range buttons, and several cards can show the same value.
 */
function stat(label: string): HTMLElement {
  for (const container of document.querySelectorAll(".headline, .detail-grid")) {
    const match = within(container as HTMLElement).queryByText(label);
    if (match) return match.parentElement as HTMLElement;
  }
  throw new Error(`No stat labelled "${label}"`);
}

/**
 * A card, scoped to its grid.
 *
 * Appliance and category cards can share a name - a category card's
 * accessible name includes its members - so the grid has to disambiguate.
 */
function cardIn(grid: ".appliance-grid" | ".category-grid", name: RegExp): HTMLElement {
  const container = document.querySelector(grid);
  if (!container) throw new Error(`No ${grid} rendered`);
  return within(container as HTMLElement).getByRole("link", { name });
}

const applianceCard = (name: RegExp) => cardIn(".appliance-grid", name);
const categoryCard = (name: RegExp) => cardIn(".category-grid", name);

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
    // Match the more specific paths first: "api/summary/cumulative" also
    // contains "api/summary".
    if (url.includes("/api/compare")) return respond(COMPARE);
    if (url.includes("/api/trend")) return respond(TREND);
    if (url.includes("/cumulative")) return respond(CUMULATIVE);
    if (url.includes("/api/summary")) return respond(SUMMARY);
    if (url.includes("/api/settings")) return respond(SETTINGS);
    if (url.includes("/api/discovery")) return respond(DISCOVERY);
    if (url.includes("/api/categories/")) return respond(CATEGORY_DETAIL);
    if (url.includes("/api/categories")) return respond(CATEGORIES);
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

    await screen.findByText("257 W");
    expect(within(stat("Live consumption")).getByText("257 W")).toBeInTheDocument();
    expect(within(stat("Today")).getByText("4.12 kWh")).toBeInTheDocument();
    // Cost sits under each energy figure rather than in a column of its own.
    expect(within(stat("Today")).getByText("€1.29")).toBeInTheDocument();
    expect(within(stat("This week")).getByText("28.40 kWh")).toBeInTheDocument();
    expect(within(stat("This week")).getByText("€8.52")).toBeInTheDocument();
    expect(within(stat("This month")).getByText("120 kWh")).toBeInTheDocument();
    expect(within(stat("This month")).getByText("€36.00")).toBeInTheDocument();

    const fridge = applianceCard(/Fridge/);
    expect(within(fridge).getByText("43 W")).toBeInTheDocument();
    expect(within(fridge).getByText("0.62 kWh today")).toBeInTheDocument();
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

    await waitFor(() =>
      expect(within(stat("Live consumption")).getByText("1.89 kW")).toBeInTheDocument(),
    );
    expect(within(applianceCard(/Dryer/)).getByText("1.85 kW")).toBeInTheDocument();
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

describe("Categories", () => {
  it("shows a card per category with its cost and trend", async () => {
    render(<App />);

    expect(await screen.findByText("Washing")).toBeInTheDocument();
    expect(screen.getByText("2.31 kWh today")).toBeInTheDocument();
    expect(screen.getByText("€0.69")).toBeInTheDocument();
    expect(screen.getByText("Dryer, Fridge")).toBeInTheDocument();
    // Rising consumption, so the badge points up.
    expect(screen.getByText(/18% vs previous 7 days/)).toBeInTheDocument();
  });

  it("shows live usage on the card, summed from the stream", async () => {
    render(<App />);
    await screen.findByText("Washing");

    StubEventSource.instances[0]!.emit("state", {
      generatedAt: "2026-09-26T12:00:05.000Z",
      connection: { connected: true, lastUpdate: "2026-09-26T12:00:05.000Z", lastError: null },
      totalPowerW: 1893,
      appliances: [
        { id: "device:fridge", name: "Fridge", available: true, powerW: 43, currentA: null, voltageV: null },
        { id: "device:dryer", name: "Dryer", available: true, powerW: 1850, currentA: null, voltageV: null },
      ],
    });

    // Washing covers the dryer and the fridge: 1850 + 43 W.
    const washing = categoryCard(/Washing/);
    await waitFor(() => expect(within(washing).getByText("1.89 kW")).toBeInTheDocument());
    expect(within(washing).getByText("now")).toBeInTheDocument();
  });

  it("says plainly that overlapping categories do not sum to the total", async () => {
    render(<App />);
    await screen.findByText("Washing");
    expect(
      screen.getByText(/belong to more than one category, so these figures overlap/),
    ).toBeInTheDocument();
  });

  it("opens the category detail page and names it in the header", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByText("Washing"));

    expect(await screen.findByRole("heading", { level: 1, name: "Washing" })).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(screen.getByText("14.20 kWh")).toBeInTheDocument();
    expect(screen.getByText("€4.26")).toBeInTheDocument();
    // Members link through to their own appliance pages.
    expect(screen.getByRole("link", { name: "Dryer" })).toBeInTheDocument();
  });
});

describe("Energy today curve", () => {
  it("shows the household running total on the overview", async () => {
    render(<App />);

    const heading = await screen.findByRole("heading", { name: "Energy used" });
    const chartCard = heading.closest(".chart-card") as HTMLElement;

    // The card's heading renders before its data arrives, so wait for the
    // total rather than asserting straight after finding the heading.
    await waitFor(() => expect(within(chartCard).getByText("0.62 kWh")).toBeInTheDocument());
    expect(within(chartCard).getByText("€0.19")).toBeInTheDocument();
    expect(within(chartCard).getByTestId("chart")).toBeInTheDocument();
  });

  it("asks for the household curve, not an appliance one", async () => {
    render(<App />);
    await screen.findByText("Energy used");
    expect(
      requests.some((request) => request.url.includes("api/summary/cumulative?range=today")),
    ).toBe(true);
  });

  it("switches the curve to a multi-day range", async () => {
    const user = userEvent.setup();
    render(<App />);

    const heading = await screen.findByRole("heading", { name: "Energy used" });
    const chartCard = heading.closest(".chart-card") as HTMLElement;
    await user.click(within(chartCard).getByRole("button", { name: "7d" }));

    await waitFor(() =>
      expect(
        requests.some((request) => request.url.includes("api/summary/cumulative?range=7d")),
      ).toBe(true),
    );
  });

  it("says when the curve only covers what the recorder still holds", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/api/compare")) return respond(COMPARE);
      if (url.includes("/api/trend")) return respond(TREND);
      if (url.includes("/cumulative")) return respond({ ...CUMULATIVE, source: "history" });
      if (url.includes("/api/summary")) return respond(SUMMARY);
      if (url.includes("/api/settings")) return respond(SETTINGS);
      if (url.includes("/api/discovery")) return respond(DISCOVERY);
      if (url.includes("/api/categories")) return respond(CATEGORIES);
      if (url.includes("/api/appliances")) return respond(APPLIANCES);
      return respond({});
    });

    render(<App />);
    expect(
      await screen.findByText(/covers only the period Home Assistant still holds history for/),
    ).toBeInTheDocument();
  });

  it("shows a curve on the category page too", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByText("Washing"));

    await screen.findByRole("heading", { level: 1, name: "Washing" });
    await waitFor(() => {
      expect(
        requests.some((request) => request.url.includes("api/categories/washing/cumulative")),
      ).toBe(true);
    });
  });

  it("says so plainly when nothing has been recorded yet", async () => {
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, init });
      if (url.includes("/api/compare")) return respond(COMPARE);
      if (url.includes("/api/trend")) return respond(TREND);
      if (url.includes("/cumulative")) {
        return respond({ range: "today", start: 0, end: 0, points: [], totalKwh: null, source: "statistics" });
      }
      if (url.includes("/api/summary")) return respond(SUMMARY);
      if (url.includes("/api/settings")) return respond(SETTINGS);
      if (url.includes("/api/discovery")) return respond(DISCOVERY);
      if (url.includes("/api/categories")) return respond(CATEGORIES);
      if (url.includes("/api/appliances")) return respond(APPLIANCES);
      return respond({});
    });

    render(<App />);
    const heading = await screen.findByRole("heading", { name: "Energy used" });
    const card = heading.closest(".chart-card") as HTMLElement;
    await waitFor(() =>
      expect(within(card).getByText("Nothing recorded yet.")).toBeInTheDocument(),
    );
  });
});

describe("Compare", () => {
  function compareCard(): HTMLElement {
    const heading = screen.getByRole("heading", { name: "Compare" });
    return heading.closest(".chart-card") as HTMLElement;
  }

  it("names every series and its value beside a colour swatch", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Compare" });

    const card = compareCard();
    await waitFor(() => expect(within(card).getByTestId("comparison-chart")).toBeInTheDocument());

    // Identity never rests on colour: the legend spells out name and value.
    const legend = within(card).getByRole("list");
    expect(within(legend).getByText("Fridge")).toBeInTheDocument();
    expect(within(legend).getByText("0.62 kWh")).toBeInTheDocument();
    expect(within(legend).getByText("Dryer")).toBeInTheDocument();
    expect(within(legend).getByText("1.20 kWh")).toBeInTheDocument();
  });

  it("refetches when the range changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Compare" });

    await waitFor(() =>
      expect(requests.some((r) => r.url.includes("scope=appliances&range=today"))).toBe(true),
    );

    await user.click(within(compareCard()).getByRole("button", { name: "7 days" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes("scope=appliances&range=7d"))).toBe(true),
    );
  });

  it("switches between appliances and categories", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Compare" });

    await user.click(within(compareCard()).getByRole("button", { name: "Categories" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes("scope=categories"))).toBe(true),
    );
  });

  it("switches chart type without refetching", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Compare" });

    const card = compareCard();
    await waitFor(() => expect(within(card).getByTestId("comparison-chart")).toBeInTheDocument());
    const before = requests.length;

    await user.click(within(card).getByRole("button", { name: "Share" }));
    expect(within(card).getByTestId("comparison-chart")).toHaveAttribute("data-view", "share");
    // The data is the same; only the drawing changes.
    expect(requests.length).toBe(before);
  });
});

describe("Usage by period", () => {
  function trendCard(): HTMLElement {
    const heading = screen.getByRole("heading", { name: "Usage by period" });
    return heading.closest(".chart-card") as HTMLElement;
  }

  it("shows each series with its latest period and direction of travel", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Usage by period" });

    const card = trendCard();
    await waitFor(() => expect(within(card).getByTestId("comparison-chart")).toBeInTheDocument());

    const legend = within(card).getByRole("list");
    expect(within(legend).getByText("Fridge")).toBeInTheDocument();
    // The latest period's own figure, not a running total.
    expect(within(legend).getByText("0.62 kWh")).toBeInTheDocument();
    // Falling use points down; rising points up.
    expect(within(legend).getByText(/▼ 22%/)).toBeInTheDocument();
    expect(within(legend).getByText(/▲ 20%/)).toBeInTheDocument();
  });

  it("defaults to grouped bars and can switch to lines", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Usage by period" });

    const card = trendCard();
    await waitFor(() =>
      expect(within(card).getByTestId("comparison-chart")).toHaveAttribute("data-view", "grouped"),
    );

    await user.click(within(card).getByRole("button", { name: "Lines" }));
    expect(within(card).getByTestId("comparison-chart")).toHaveAttribute("data-view", "lines");
  });

  it("shows the combined total and its direction", async () => {
    render(<App />);
    await screen.findByRole("heading", { name: "Usage by period" });

    // The heading renders before the data arrives, so wait for the legend's
    // content rather than assuming it is already there.
    const card = trendCard();
    const total = await within(card).findByText("All 2");
    const row = total.closest("li") as HTMLElement;

    // The household total, so "are we using more" needs no mental arithmetic.
    expect(within(row).getByText("1.82 kWh")).toBeInTheDocument();
    expect(within(row).getByText(/▲ 1%/)).toBeInTheDocument();
  });

  it("can stack the bars so their height is the total", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Usage by period" });

    const card = trendCard();
    // The controls render before the data does, so the chart may not exist
    // yet at the moment of the click.
    await within(card).findByTestId("comparison-chart");

    await user.click(within(card).getByRole("button", { name: "Stacked" }));
    expect(within(card).getByTestId("comparison-chart")).toHaveAttribute("data-view", "stacked");
  });

  it("refetches when the period changes", async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole("heading", { name: "Usage by period" });

    await user.click(within(trendCard()).getByRole("button", { name: "Weekly" }));
    await waitFor(() =>
      expect(requests.some((r) => r.url.includes("api/trend?scope=appliances&period=week"))).toBe(
        true,
      ),
    );
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

  it("saves a new category with its membership", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add category" }));
    await user.type(screen.getByLabelText("Name for category 2"), "Cooking");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const put = requests.find(
        (request) => request.init?.method === "PUT" && request.url.includes("/api/categories"),
      );
      expect(put).toBeDefined();
      const body = JSON.parse(String(put!.init!.body)) as {
        categories: { name: string }[];
      };
      expect(body.categories.map((category) => category.name)).toEqual(["Washing", "Cooking"]);
    });
  });

  it("does not send half-finished, unnamed categories", async () => {
    const user = userEvent.setup();
    window.location.hash = "#/settings";
    render(<App />);

    await user.click(await screen.findByRole("button", { name: "Add category" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => {
      const put = requests.find(
        (request) => request.init?.method === "PUT" && request.url.includes("/api/categories"),
      );
      const body = JSON.parse(String(put!.init!.body)) as { categories: unknown[] };
      expect(body.categories).toHaveLength(1);
    });
  });

  it("reports the Home Assistant connection", async () => {
    window.location.hash = "#/settings";
    render(<App />);
    expect(await screen.findByText("Connected")).toBeInTheDocument();
  });
});
