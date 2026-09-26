import { readFileSync } from "node:fs";

const LEVELS = ["trace", "debug", "info", "notice", "warning", "error", "fatal"] as const;
export type LogLevel = (typeof LEVELS)[number];

function readConfiguredLevel(): LogLevel {
  const fromEnv = process.env.LOG_LEVEL?.toLowerCase();
  if (fromEnv && (LEVELS as readonly string[]).includes(fromEnv)) {
    return fromEnv as LogLevel;
  }
  // Home Assistant writes the app's user options here.
  try {
    const raw = readFileSync("/data/options.json", "utf8");
    const level = (JSON.parse(raw) as { log_level?: string }).log_level?.toLowerCase();
    if (level && (LEVELS as readonly string[]).includes(level)) {
      return level as LogLevel;
    }
  } catch {
    // No options file (development, or first boot) - fall through to the default.
  }
  return "info";
}

const threshold = LEVELS.indexOf(readConfiguredLevel());

/**
 * Strip anything that looks like a bearer token before it reaches stdout.
 *
 * The Supervisor token must never be written to the app log.
 */
function redact(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer <redacted>");
}

function emit(level: LogLevel, args: unknown[]): void {
  if (LEVELS.indexOf(level) < threshold) return;
  const stream = LEVELS.indexOf(level) >= LEVELS.indexOf("warning") ? console.error : console.log;
  stream(`[${level.toUpperCase()}]`, ...args.map(redact));
}

export const log = {
  level: LEVELS[threshold] as LogLevel,
  trace: (...args: unknown[]) => emit("trace", args),
  debug: (...args: unknown[]) => emit("debug", args),
  info: (...args: unknown[]) => emit("info", args),
  notice: (...args: unknown[]) => emit("notice", args),
  warning: (...args: unknown[]) => emit("warning", args),
  error: (...args: unknown[]) => emit("error", args),
  fatal: (...args: unknown[]) => emit("fatal", args),
};
