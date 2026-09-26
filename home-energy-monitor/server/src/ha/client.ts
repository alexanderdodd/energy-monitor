import type { HaState, HistoryPoint } from "./types.ts";

/**
 * Thin REST client for the Home Assistant API exposed by the Supervisor
 * proxy. The Supervisor token is held here and never leaves this module.
 */
export class HaRestClient {
  readonly #baseUrl: string;
  readonly #token: string;

  constructor(baseUrl: string, token: string) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#token = token;
  }

  async #request<T>(path: string, timeoutMs = 20_000): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.#baseUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${this.#token}`,
          "Content-Type": "application/json",
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        // The URL is safe to log; the Authorization header is not included.
        throw new Error(`Home Assistant API ${path} returned ${response.status}`);
      }
      return (await response.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<void> {
    await this.#request<{ message: string }>("/", 5_000);
  }

  async getStates(): Promise<HaState[]> {
    return this.#request<HaState[]>("/states");
  }

  /**
   * Fetch recorded history for the given entities.
   *
   * `minimal_response` and `no_attributes` keep the payload small, which
   * matters a great deal on a Raspberry Pi. With `minimal_response` only the
   * first entry per entity is a full state object; the rest carry just the
   * state and a timestamp.
   */
  async getHistory(
    entityIds: string[],
    start: Date,
    end: Date,
  ): Promise<Record<string, HistoryPoint[]>> {
    if (entityIds.length === 0) return {};

    const params = new URLSearchParams({
      filter_entity_id: entityIds.join(","),
      end_time: end.toISOString(),
      minimal_response: "",
      no_attributes: "",
    });
    const raw = await this.#request<unknown>(
      `/history/period/${encodeURIComponent(start.toISOString())}?${params}`,
    );

    return parseHistoryResponse(raw, entityIds);
  }
}

type RawHistoryEntry = {
  entity_id?: string;
  state?: unknown;
  last_changed?: string;
  last_updated?: string;
};

/**
 * Turn Home Assistant's `[[entity1...], [entity2...]]` history payload into a
 * map keyed by entity id.
 *
 * Exported for testing: the shape differs between the first entry of each
 * series and the `minimal_response` entries that follow it.
 */
export function parseHistoryResponse(
  raw: unknown,
  requestedIds: string[] = [],
): Record<string, HistoryPoint[]> {
  const result: Record<string, HistoryPoint[]> = {};
  if (!Array.isArray(raw)) return result;

  for (const [index, series] of raw.entries()) {
    if (!Array.isArray(series) || series.length === 0) continue;

    const entries = series as RawHistoryEntry[];
    // Only the first entry is guaranteed to carry the entity id. Fall back to
    // positional matching against what we asked for.
    const entityId = entries.find((entry) => entry.entity_id)?.entity_id ?? requestedIds[index];
    if (!entityId) continue;

    const points: HistoryPoint[] = [];
    for (const entry of entries) {
      const timestamp = entry.last_changed ?? entry.last_updated;
      if (typeof entry.state !== "string" || !timestamp) continue;
      const t = Date.parse(timestamp);
      if (Number.isNaN(t)) continue;
      points.push({ t, s: entry.state });
    }
    points.sort((a, b) => a.t - b.t);
    result[entityId] = points;
  }

  return result;
}
