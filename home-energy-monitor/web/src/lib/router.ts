import { useEffect, useState } from "react";

export type Route =
  | { name: "overview" }
  | { name: "appliance"; id: string }
  | { name: "settings" }
  | { name: "setup" };

/**
 * Hash-based routing.
 *
 * Ingress serves the app from an unpredictable path prefix, so the fragment
 * is the one part of the URL the app can own outright - no basename to
 * configure and nothing for the proxy to rewrite.
 */
export function parseHash(hash: string): Route {
  const path = hash.replace(/^#\/?/, "");
  if (path === "settings") return { name: "settings" };
  if (path === "setup") return { name: "setup" };
  if (path.startsWith("appliance/")) {
    return { name: "appliance", id: decodeURIComponent(path.slice("appliance/".length)) };
  }
  return { name: "overview" };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case "settings":
      return "#/settings";
    case "setup":
      return "#/setup";
    case "appliance":
      return `#/appliance/${encodeURIComponent(route.id)}`;
    default:
      return "#/";
  }
}

export function navigate(route: Route): void {
  window.location.hash = hrefFor(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);

  return route;
}
