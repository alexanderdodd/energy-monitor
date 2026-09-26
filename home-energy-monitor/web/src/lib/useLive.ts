import { useEffect, useRef, useState } from "react";
import { apiUrl } from "./api.ts";
import type { LiveSnapshot } from "./types.ts";

export interface LiveState {
  snapshot: LiveSnapshot | null;
  /** True while the browser holds an open stream to the app. */
  streaming: boolean;
}

/**
 * Subscribe to the app's Server-Sent Events stream.
 *
 * EventSource reconnects on its own, so a Home Assistant restart or an app
 * update heals without the user reloading the page.
 */
export function useLive(): LiveState {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [streaming, setStreaming] = useState(false);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const source = new EventSource(apiUrl("api/events"));
    sourceRef.current = source;

    source.addEventListener("open", () => setStreaming(true));
    source.addEventListener("state", (event) => {
      try {
        setSnapshot(JSON.parse((event as MessageEvent<string>).data) as LiveSnapshot);
        setStreaming(true);
      } catch {
        // A malformed frame is not worth tearing the stream down for.
      }
    });
    source.addEventListener("error", () => setStreaming(false));

    return () => {
      source.close();
      sourceRef.current = null;
    };
  }, []);

  return { snapshot, streaming };
}
