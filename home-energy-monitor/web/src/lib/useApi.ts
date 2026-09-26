import { useCallback, useEffect, useState } from "react";
import { api } from "./api.ts";

export interface Resource<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  reload: () => void;
}

/**
 * Fetch a JSON resource, optionally refreshing on an interval.
 *
 * On failure the last good data is kept on screen and the error is reported
 * alongside it, rather than replacing the dashboard with an error page.
 */
export function useApiResource<T>(path: string, refreshMs?: number): Resource<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const result = await api.get<T>(path);
        if (cancelled) return;
        setData(result);
        setError(null);
      } catch (cause) {
        if (cancelled) return;
        setError((cause as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void load();
    if (!refreshMs) return () => { cancelled = true; };

    const timer = setInterval(load, refreshMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [path, refreshMs, nonce]);

  return { data, error, loading, reload };
}
