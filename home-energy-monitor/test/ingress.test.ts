import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp, ingressBase } from "../server/src/app.ts";
import { ApplianceService } from "../server/src/appliances/service.ts";
import { ConfigStore } from "../server/src/config/store.ts";
import { LiveBroadcaster } from "../server/src/live.ts";
import { FakeHaSource } from "./helpers/fakeSource.ts";

describe("ingressBase", () => {
  it("adds the trailing slash the browser needs to resolve relative URLs", () => {
    expect(ingressBase("/api/hassio_ingress/AbC123")).toBe("/api/hassio_ingress/AbC123/");
    expect(ingressBase("/api/hassio_ingress/AbC123/")).toBe("/api/hassio_ingress/AbC123/");
  });

  it("falls back to a document-relative base outside Ingress", () => {
    expect(ingressBase(undefined)).toBe("./");
    expect(ingressBase("")).toBe("./");
    // Anything that is not an absolute path is not trusted as a base.
    expect(ingressBase("https://evil.example/")).toBe("./");
  });
});

describe("serving the frontend under Ingress", () => {
  async function appWithFrontend() {
    const directory = await mkdtemp(join(tmpdir(), "hem-static-"));
    await writeFile(
      join(directory, "index.html"),
      '<!doctype html>\n<html>\n  <head>\n    <title>Energy Monitor</title>\n  </head>\n  <body><script src="./assets/app.js"></script></body>\n</html>\n',
      "utf8",
    );

    const store = new ConfigStore(join(directory, "config.json"));
    await store.load();
    const source = new FakeHaSource();
    const service = new ApplianceService(source, store);
    const broadcaster = new LiveBroadcaster(service, source);

    const app = await createApp({
      store,
      service,
      source,
      broadcaster,
      version: "1.0.0",
      staticRoot: directory,
      enforceIngress: false,
    });
    return { app, broadcaster };
  }

  it("injects the Ingress path so relative assets and API calls resolve", async () => {
    const { app, broadcaster } = await appWithFrontend();
    try {
      const response = await app.inject({
        url: "/",
        headers: { "x-ingress-path": "/api/hassio_ingress/AbC123" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.body).toContain('<base href="/api/hassio_ingress/AbC123/">');
    } finally {
      broadcaster.stop();
      await app.close();
    }
  });

  it("escapes the header rather than trusting it verbatim", async () => {
    const { app, broadcaster } = await appWithFrontend();
    try {
      const response = await app.inject({
        url: "/",
        headers: { "x-ingress-path": '/x"><script>alert(1)</script>' },
      });
      expect(response.body).not.toContain("<script>alert(1)</script>");
      expect(response.body).toContain("&quot;");
    } finally {
      broadcaster.stop();
      await app.close();
    }
  });

  it("serves the app shell for client-side routes but 404s unknown API paths", async () => {
    const { app, broadcaster } = await appWithFrontend();
    try {
      const spa = await app.inject({ url: "/some/deep/route" });
      expect(spa.statusCode).toBe(200);
      expect(spa.body).toContain("Energy Monitor");

      const missing = await app.inject({ url: "/api/does-not-exist" });
      expect(missing.statusCode).toBe(404);
      expect(missing.json()).toEqual({ error: "Not found" });
    } finally {
      broadcaster.stop();
      await app.close();
    }
  });
});
