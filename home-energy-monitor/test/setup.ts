import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

/**
 * jsdom has no EventSource. The live stream is exercised through this stub,
 * which records instances so a test can push events into the app.
 */
class StubEventSource {
  static instances: StubEventSource[] = [];

  readonly url: string;
  readonly listeners = new Map<string, Set<(event: Event) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    StubEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: (event: Event) => void): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper: deliver an event to the app. */
  emit(type: string, data?: unknown): void {
    const event =
      data === undefined
        ? new Event(type)
        : new MessageEvent(type, { data: JSON.stringify(data) });
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

vi.stubGlobal("EventSource", StubEventSource);

export { StubEventSource };

afterEach(() => {
  cleanup();
  StubEventSource.instances.length = 0;
  vi.restoreAllMocks();
});
