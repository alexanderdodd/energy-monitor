import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { log } from "./logger.ts";
import { registerApiRoutes, type ApiDependencies } from "./routes/api.ts";

/** The only address Home Assistant Ingress connects from. */
export const INGRESS_SOURCE_IP = "172.30.32.2";

export interface CreateAppOptions extends ApiDependencies {
  /** Directory holding the built frontend, or null to serve the API only. */
  staticRoot: string | null;
  /** Reject requests that did not come through Ingress. */
  enforceIngress: boolean;
}

function isIngressAddress(address: string | undefined): boolean {
  if (!address) return false;
  // Node reports IPv4 peers on a dual-stack socket as "::ffff:172.30.32.2".
  return address === INGRESS_SOURCE_IP || address === `::ffff:${INGRESS_SOURCE_IP}`;
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Work out the URL the browser thinks it is at.
 *
 * Ingress serves the app from a path like `/api/hassio_ingress/<token>/` and
 * passes it along in `X-Ingress-Path`. Injecting it as a `<base>` element is
 * what lets the same bundle work at the root during development and under an
 * arbitrary prefix in Home Assistant.
 */
export function ingressBase(headerValue: string | undefined): string {
  if (!headerValue) return "./";
  const path = headerValue.trim();
  if (!path.startsWith("/")) return "./";
  return path.endsWith("/") ? path : `${path}/`;
}

export async function createApp(options: CreateAppOptions): Promise<FastifyInstance> {
  const { staticRoot, enforceIngress, ...api } = options;

  const app = Fastify({
    // The app has its own logger; Fastify's would duplicate every line.
    logger: false,
    // Ingress terminates the client connection, so trust its forwarding headers.
    trustProxy: true,
    bodyLimit: 256 * 1024,
  });

  if (enforceIngress) {
    app.addHook("onRequest", async (request, reply) => {
      if (isIngressAddress(request.socket.remoteAddress)) return;
      log.warning(`Refused a request from ${request.socket.remoteAddress ?? "an unknown address"}`);
      await reply.code(403).send({ error: "This app is only reachable through Home Assistant" });
    });
  }

  registerApiRoutes(app, api);

  if (staticRoot && existsSync(join(staticRoot, "index.html"))) {
    await app.register(fastifyStatic, {
      root: staticRoot,
      index: false,
      wildcard: false,
      // Hashed asset filenames are safe to cache hard; index.html is not
      // served from here.
      maxAge: "1y",
      immutable: true,
    });

    const template = await readFile(join(staticRoot, "index.html"), "utf8");
    const rendered = new Map<string, string>();

    const sendIndex = async (request: FastifyRequest, reply: FastifyReply) => {
      const base = ingressBase(request.headers["x-ingress-path"] as string | undefined);
      let html = rendered.get(base);
      if (!html) {
        html = template.replace("<head>", `<head>\n    <base href="${escapeAttribute(base)}">`);
        rendered.set(base, html);
      }
      return reply
        .type("text/html; charset=utf-8")
        .header("Cache-Control", "no-store")
        .send(html);
    };

    app.get("/", sendIndex);
    app.setNotFoundHandler(async (request, reply) => {
      if (request.method !== "GET" || request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "Not found" });
      }
      // Anything else is a client-side route; hand back the app shell.
      return sendIndex(request, reply);
    });
  } else {
    if (staticRoot) {
      log.warning(`No frontend build found in ${staticRoot}; serving the API only`);
    }
    app.setNotFoundHandler(async (_request, reply) => reply.code(404).send({ error: "Not found" }));
  }

  return app;
}
