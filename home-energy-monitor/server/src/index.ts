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

  watchMemory();

  // A kill from outside (the kernel's out-of-memory killer sends SIGKILL)
  // runs no handler at all, so a restart with no line before it was killed.
  // Any exit the process makes itself says so here.
  process.on("exit", (code) => log.info(`Exiting with code ${code}`));

  // The container runs node as PID 1, which gets no default signal handlers.
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

const MB = 1024 * 1024;

/**
 * Warn each time resident memory reaches a new 50 MB step above 150 MB.
 *
 * The V8 heap is capped, but response bodies and other buffers live outside
 * it, so the process can grow past the cap without V8 ever complaining - and
 * if the kernel then kills it, nothing is logged. A rising line here before a
 * silent restart is the evidence that it was memory.
 */
function watchMemory(): void {
  let reported = 150;
  const check = () => {
    const usage = process.memoryUsage();
    const rss = usage.rss / MB;
    if (rss < reported + 50) return;
    reported = Math.floor(rss / 50) * 50;
    log.warning(
      `Memory high: rss ${rss.toFixed(0)} MB, heap ${(usage.heapUsed / MB).toFixed(0)} MB, ` +
        `buffers ${(usage.arrayBuffers / MB).toFixed(0)} MB, external ${(usage.external / MB).toFixed(0)} MB`,
    );
  };
  // Unref'd so the timer never holds the process open by itself.
  setInterval(check, 5_000).unref();
  const usage = process.memoryUsage();
  log.info(`Memory at start: rss ${(usage.rss / MB).toFixed(0)} MB`);
}

main().catch((error: Error) => {
  log.fatal(`Could not start Home Energy Monitor: ${error.message}`);
  process.exitCode = 1;
});
