/**
 * Centralized environment schema for the SwarmX API.
 *
 * Purpose:
 *   - Fail-fast on invalid values at startup (e.g. non-numeric PORT, malformed URL)
 *     rather than crashing on first request or silently mis-behaving.
 *   - Document every env var the API reads in one place.
 *   - Provide typed, defaulted access via `env.X` — new code should import
 *     from here instead of reading `process.env` directly.
 *
 * Scope discipline:
 *   Only the vars that would cause silent misbehavior on invalid input are
 *   validated. Boolean toggles ("0"/"1"), path strings, and free-form model
 *   tags remain in ad-hoc access sites. Widen the schema as new invariants
 *   are discovered.
 */

import { z } from "zod";

const port = z.coerce.number().int().min(1).max(65535);
const positiveInt = z.coerce.number().int().min(1);
const nonNegativeInt = z.coerce.number().int().min(0);

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("production"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  SWARMX_API_PORT: port.default(3001),
  SWARMX_API_HOST: z.string().min(1).default("127.0.0.1"),

  SWARMX_DASHBOARD_ORIGIN: z.string().optional(),

  // Ollama endpoint — one of these three takes precedence (checked at call sites)
  OLLAMA_HOST: z.string().url().optional(),
  SWARMX_OLLAMA_URL: z.string().url().optional(),
  SWARMX_OLLAMA_BASE_URL: z.string().url().optional(),

  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),

  SWARMX_VIDEO_USE_BULLMQ: z.enum(["0", "1"]).default("0"),
  SWARMX_VIDEO_LOW_RAM_MODE: z.enum(["0", "1"]).default("0"),
  SWARMX_VIDEO_JOB_LIMIT_PER_HOUR: positiveInt.default(10),
  SWARMX_VIDEO_CAPTION_SCORE_LIMIT_PER_MIN: positiveInt.default(10),
  SWARMX_VIDEO_QUEUE_MAX_SIZE: positiveInt.default(20),
  SWARMX_VIDEO_EXPORT_TTL_DAYS: positiveInt.default(7),
  SWARMX_VIDEO_CLEANUP_INTERVAL_MS: positiveInt.default(6 * 60 * 60 * 1000),

  SWARMX_OLLAMA_PROBE_TIMEOUT_MS: positiveInt.default(5000),
  SWARMX_OLLAMA_CACHE_TTL_MS: nonNegativeInt.default(15_000),
});

type Env = z.infer<typeof schema>;

let cached: Env | null = null;

/**
 * Parse and cache the API env. Call at startup (server.ts) before any other
 * module reads env. Throws with a formatted list of issues on first invalid
 * value; process.exit(1) is the caller's responsibility.
 */
export function loadEnv(): Env {
  if (cached) return cached;
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  cached = result.data;
  return cached;
}

/**
 * Escape hatch for tests — resets the cached env so the next `loadEnv()` re-parses.
 */
export function resetEnvForTesting(): void {
  cached = null;
}
