import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./logger.ts";
import { createApp } from "./app.ts";
import { ApplianceService } from "./appliances/service.ts";
import { ConfigStore, DEFAULT_CONFIG_PATH } from "./config/store.ts";
import { MockHaSource } from "./ha/mock.ts";
import { SupervisorHaSource } from "./ha/supervisor.ts";
import type { HaSource } from "./ha/types.ts";
import { LiveBroadcaster } from "./live.ts";

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(here, "../..");

async function readVersion(): Promise<string> {
  try {
    const raw = await readFile(join(packageRoot, "package.json"), "utf8");
    return (JSON.parse(raw) as { version?: string }).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function createSource(): HaSource {
  if (process.env.MOCK_HOME_ASSISTANT === "true") {
    return new MockHaSource();
  }

  const token = process.env.SUPERVISOR_TOKEN;
  if (!token) {
    throw new Error(
      "SUPERVISOR_TOKEN is not set. Enable homeassistant_api in config.yaml, " +
        "or set MOCK_HOME_ASSISTANT=true for local development.",
    );
  }
  return new SupervisorHaSource(token);
}

async function main(): Promise<void> {
  const version = await readVersion();
  const mock = process.env.MOCK_HOME_ASSISTANT === "true";
  const port = Number(process.env.PORT ?? 3000);
  const host = process.env.HOST ?? "0.0.0.0";

  const store = new ConfigStore(process.env.CONFIG_PATH ?? DEFAULT_CONFIG_PATH);
  await store.load();

  const source = createSource();
  const service = new ApplianceService(source, store);
  const broadcaster = new LiveBroadcaster(service, source);

  // Starting the Home Assistant connection must not block the HTTP server:
  // if Home Assistant is slow to come up, the UI should still load and say so.
  void source.start().catch((error: Error) => {
    log.warning(`Home Assistant connection could not be established: ${error.message}`);
  });
  broadcaster.start();

  const app = await createApp({
    store,
    service,
    source,
    broadcaster,
    version,
    staticRoot: process.env.STATIC_ROOT ?? join(packageRoot, "dist/web"),
    // In development there is no Ingress in front of the app.
    enforceIngress: !mock && process.env.DISABLE_INGRESS_GUARD !== "true",
  });

  await app.listen({ port, host });
  log.info(`Home Energy Monitor ${version} listening on ${host}:${port}`);

  const shutdown = (signal: string) => {
    log.info(`Received ${signal}, shutting down`);
    broadcaster.stop();
    void source.stop();
    void app.close().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };

  // The container runs node as PID 1, which gets no default signal handlers.
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((error: Error) => {
  log.fatal(`Could not start Home Energy Monitor: ${error.message}`);
  process.exitCode = 1;
});
