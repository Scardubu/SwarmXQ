/**
 * Shared structured logger for service modules that do not have access to the
 * Fastify `server.log` instance (e.g. adaptive-timeout-config, circuit breaker).
 *
 * Emits Pino-compatible NDJSON to stderr so log aggregators (Loki, Datadog,
 * CloudWatch) ingest it identically to the Fastify server logger. Interface
 * matches `pino.Logger` so callers can be migrated to real Pino later without
 * source changes.
 *
 * Zero external dependencies — safe for offline dev and cold-start containers.
 */

type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

const LEVEL_VALUE: Record<LogLevel, number> = {
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

const configuredLevel = (process.env["LOG_LEVEL"] ?? "info").toLowerCase() as LogLevel;
const minLevelValue = LEVEL_VALUE[configuredLevel] ?? LEVEL_VALUE.info;
const NAME = "swarmx-api";
const PID = process.pid;

function emit(level: LogLevel, obj: Record<string, unknown> | undefined, msg: string): void {
  const value = LEVEL_VALUE[level];
  if (value < minLevelValue) return;
  const payload: Record<string, unknown> = {
    level: value,
    time: Date.now(),
    pid: PID,
    name: NAME,
    ...(obj ?? {}),
    msg,
  };
  // Serialise Error instances so stack traces are preserved
  for (const [k, v] of Object.entries(payload)) {
    if (v instanceof Error) {
      payload[k] = { type: v.name, message: v.message, stack: v.stack };
    }
  }
  try {
    process.stderr.write(JSON.stringify(payload) + "\n");
  } catch {
    // stderr write failure is non-recoverable and non-loggable; swallow
  }
}

function makeMethod(level: LogLevel) {
  return function log(objOrMsg: Record<string, unknown> | string, msg?: string): void {
    if (typeof objOrMsg === "string") {
      emit(level, undefined, objOrMsg);
    } else {
      emit(level, objOrMsg, msg ?? "");
    }
  };
}

export const log = {
  debug: makeMethod("debug"),
  info:  makeMethod("info"),
  warn:  makeMethod("warn"),
  error: makeMethod("error"),
  fatal: makeMethod("fatal"),
};
