import type { FastifyInstance, FastifyReply } from "fastify";
import { log } from "../logger.ts";
import { discoverAppliances } from "../ha/discovery.ts";
import { isHistoryRange } from "../ha/history.ts";
import type { HaSource } from "../ha/types.ts";
import {
  isCompareScope,
  isCumulativeRange,
  isTrendPeriod,
  type ApplianceService,
  type CumulativeRange,
} from "../appliances/service.ts";
import type { ConfigStore } from "../config/store.ts";
import type { LiveBroadcaster } from "../live.ts";

export interface ApiDependencies {
  store: ConfigStore;
  service: ApplianceService;
  source: HaSource;
  broadcaster: LiveBroadcaster;
  version: string;
}

/**
 * The application's own API.
 *
 * Home Assistant's API is never proxied through to the browser: every
 * response here is a shape this app defines, built on the server.
 */
export function registerApiRoutes(app: FastifyInstance, deps: ApiDependencies): void {
  const { store, service, source, broadcaster, version } = deps;

  app.get("/api/health", async () => {
    const status = source.status();
    return {
      status: "ok",
      version,
      homeAssistant: status,
      setupComplete: store.get().setupComplete,
    };
  });

  app.get("/api/settings", async () => {
    const config = store.get();
    return {
      ...config.settings,
      setupComplete: config.setupComplete,
      homeAssistant: source.status(),
    };
  });

  app.put("/api/settings", async (request, reply) => {
    try {
      const config = await store.setSettings(request.body);
      return { ...config.settings, setupComplete: config.setupComplete };
    } catch (error) {
      log.warning(`Rejected settings update: ${(error as Error).message}`);
      return reply.code(400).send({ error: "Invalid settings" });
    }
  });

  app.get("/api/discovery", async (_request, reply) => {
    try {
      const [states, entityRegistry, deviceRegistry] = await Promise.all([
        source.getStates(),
        source.listEntityRegistry(),
        source.listDeviceRegistry(),
      ]);

      const configured = store.get().appliances;
      const configuredIds = new Set(configured.map((appliance) => appliance.id));
      const discovered = discoverAppliances({
        states,
        entityRegistry,
        deviceRegistry,
        configuredIds,
      });

      // Carry the user's own names and overrides across a re-discovery.
      const merged = discovered.map((appliance) => {
        const existing = configured.find((item) => item.id === appliance.id);
        if (!existing) return appliance;
        return {
          ...appliance,
          name: existing.name,
          entities: { ...appliance.entities, ...existing.entities },
        };
      });

      return { appliances: merged, homeAssistant: source.status() };
    } catch (error) {
      log.warning(`Discovery failed: ${(error as Error).message}`);
      return reply.code(503).send({
        error: "Could not reach Home Assistant",
        homeAssistant: source.status(),
      });
    }
  });

  app.get("/api/appliances", async () => {
    const config = store.get();
    return { appliances: config.appliances, setupComplete: config.setupComplete };
  });

  app.put("/api/appliances", async (request, reply) => {
    const body = request.body as { appliances?: unknown } | undefined;
    try {
      const config = await store.setAppliances(body?.appliances);
      // Mappings changed, so cached energy totals no longer apply.
      service.invalidate();
      return { appliances: config.appliances, setupComplete: config.setupComplete };
    } catch (error) {
      log.warning(`Rejected appliance update: ${(error as Error).message}`);
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get("/api/categories", async () => {
    return { categories: store.categories() };
  });

  app.put("/api/categories", async (request, reply) => {
    const body = request.body as { categories?: unknown } | undefined;
    try {
      const config = await store.setCategories(body?.categories);
      return { categories: config.categories };
    } catch (error) {
      log.warning(`Rejected category update: ${(error as Error).message}`);
      return reply.code(400).send({ error: (error as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/api/categories/:id", async (request, reply) => {
    try {
      const detail = await service.getCategoryDetail(request.params.id);
      if (!detail) return reply.code(404).send({ error: "Unknown category" });
      const config = store.get();
      return {
        ...detail,
        currency: config.settings.currency,
        electricityPricePerKwh: config.settings.electricityPricePerKwh,
        homeAssistant: source.status(),
      };
    } catch (error) {
      log.warning(`Could not build category detail: ${(error as Error).message}`);
      return reply.code(503).send({ error: "Could not reach Home Assistant" });
    }
  });

  /**
   * "How is today building up" curves. Separate from /history because they
   * are always today-to-now and are integrated from power, so they work
   * before long-term statistics have produced anything.
   */
  const cumulative = async (
    rawRange: string | undefined,
    load: (range: CumulativeRange) => Promise<unknown | null>,
    reply: FastifyReply,
  ) => {
    const range = rawRange ?? "today";
    if (!isCumulativeRange(range)) {
      return reply.code(400).send({ error: "range must be one of today, 7d, 30d" });
    }
    try {
      const result = await load(range);
      if (!result) return reply.code(404).send({ error: "Not found" });
      return result;
    } catch (error) {
      log.warning(`Could not build the cumulative curve: ${(error as Error).message}`);
      return reply.code(503).send({ error: "Could not load history from Home Assistant" });
    }
  };

  app.get<{ Querystring: { range?: string } }>("/api/summary/cumulative", async (request, reply) =>
    cumulative(request.query.range, (range) => service.getHouseholdCumulative(range), reply),
  );

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/api/appliances/:id/cumulative",
    async (request, reply) =>
      cumulative(
        request.query.range,
        (range) => service.getApplianceCumulative(request.params.id, range),
        reply,
      ),
  );

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/api/categories/:id/cumulative",
    async (request, reply) =>
      cumulative(
        request.query.range,
        (range) => service.getCategoryCumulative(request.params.id, range),
        reply,
      ),
  );

  app.get<{ Querystring: { scope?: string; range?: string } }>(
    "/api/compare",
    async (request, reply) => {
      const scope = request.query.scope ?? "appliances";
      const range = request.query.range ?? "today";
      if (!isCompareScope(scope)) {
        return reply.code(400).send({ error: "scope must be appliances or categories" });
      }
      if (!isCumulativeRange(range)) {
        return reply.code(400).send({ error: "range must be one of today, 7d, 30d" });
      }
      try {
        return await service.compare(scope, range);
      } catch (error) {
        log.warning(`Could not build the comparison: ${(error as Error).message}`);
        return reply.code(503).send({ error: "Could not reach Home Assistant" });
      }
    },
  );

  app.get<{ Querystring: { scope?: string; period?: string } }>(
    "/api/trend",
    async (request, reply) => {
      const scope = request.query.scope ?? "appliances";
      const period = request.query.period ?? "day";
      if (!isCompareScope(scope)) {
        return reply.code(400).send({ error: "scope must be appliances or categories" });
      }
      if (!isTrendPeriod(period)) {
        return reply.code(400).send({ error: "period must be one of day, week, month" });
      }
      try {
        return await service.trend(scope, period);
      } catch (error) {
        log.warning(`Could not build the trend: ${(error as Error).message}`);
        return reply.code(503).send({ error: "Could not reach Home Assistant" });
      }
    },
  );

  app.get("/api/summary", async (_request, reply) => {
    try {
      return await service.getSummary();
    } catch (error) {
      log.warning(`Could not build the summary: ${(error as Error).message}`);
      return reply.code(503).send({
        error: "Could not reach Home Assistant",
        homeAssistant: source.status(),
      });
    }
  });

  app.get<{ Params: { id: string } }>("/api/appliances/:id", async (request, reply) => {
    const detail = await service.getApplianceDetail(request.params.id);
    if (!detail) return reply.code(404).send({ error: "Unknown appliance" });
    const config = store.get();
    return {
      ...detail,
      currency: config.settings.currency,
      electricityPricePerKwh: config.settings.electricityPricePerKwh,
      homeAssistant: source.status(),
    };
  });

  app.get<{ Params: { id: string }; Querystring: { range?: string } }>(
    "/api/appliances/:id/history",
    async (request, reply) => {
      const range = request.query.range ?? "24h";
      if (!isHistoryRange(range)) {
        return reply.code(400).send({ error: "range must be one of 6h, 24h, 7d, 30d" });
      }
      try {
        const history = await service.getHistory(request.params.id, range);
        if (!history) return reply.code(404).send({ error: "Unknown appliance" });
        return history;
      } catch (error) {
        log.warning(`History request failed: ${(error as Error).message}`);
        return reply.code(503).send({ error: "Could not load history from Home Assistant" });
      }
    },
  );

  /**
   * Live updates as Server-Sent Events. One-way is all the dashboard needs,
   * and SSE reconnects on its own if Home Assistant or the app restarts.
   */
  app.get("/api/events", (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Ingress sits behind a proxy that would otherwise buffer the stream.
      "X-Accel-Buffering": "no",
    });
    reply.raw.write("retry: 5000\n\n");

    const remove = broadcaster.addClient((event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    });

    request.raw.on("close", remove);
    request.raw.on("error", remove);
  });
}
