/**
 * SwarmX doctor CLI.
 *
 * Runs a fast preflight against the host before the pipeline is booted.
 *
 * Usage:
 *   pnpm --filter @swarmx/api exec tsx scripts/doctor.ts
 *
 * Exit codes:
 *   0 — every check passed (or was intentionally skipped)
 *   1 — at least one check failed; a structured error list is logged
 *
 * Zero console.* — all output routes through the structured logger.
 * Zero side effects beyond a scoped Redis ping and an optional Ollama probe.
 */
import { freemem } from "node:os";
import IORedis from "ioredis";
import { loadEnv } from "../src/lib/env.js";
import { log } from "../src/lib/logger.js";
import { FULL_PIPELINE_MIN_AVAILABLE_MB } from "../src/services/video-runtime-config.js";
import { readVoiceBenchmarkReport } from "../src/services/voice-benchmark-report.js";
import { voiceProviders } from "../src/services/voice-providers.js";

export type CheckResult = { name: string; ok: boolean; detail: string };

export async function checkEnv(): Promise<CheckResult> {
  try {
    loadEnv();
    return { name: "env", ok: true, detail: "loadEnv() succeeded" };
  } catch (err) {
    return {
      name: "env",
      ok: false,
      detail: `loadEnv() threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function checkRedis(): Promise<CheckResult> {
  // Direct ioredis import is normally prohibited (BullMQ Queue/Worker require
  // shared connection isolation), but doctor is a one-shot CLI that opens a
  // single lazyConnect client, pings, and disconnects. Do NOT copy this
  // pattern into src/services/.
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
  } catch {
    return { name: "redis", ok: false, detail: "loadEnv() failed; cannot resolve REDIS_URL" };
  }
  const client = new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    lazyConnect: true,
    connectTimeout: 3000,
  });
  try {
    await client.connect();
    const pong = await client.ping();
    if (pong !== "PONG") {
      return { name: "redis", ok: false, detail: `PING returned ${pong}` };
    }
    return { name: "redis", ok: true, detail: `${env.REDIS_URL} responded PONG` };
  } catch (err) {
    return {
      name: "redis",
      ok: false,
      detail: `connect/ping failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  } finally {
    client.disconnect();
  }
}

export async function checkOllama(): Promise<CheckResult> {
  let env: ReturnType<typeof loadEnv>;
  try {
    env = loadEnv();
  } catch {
    return { name: "ollama", ok: false, detail: "loadEnv() failed; cannot resolve Ollama host" };
  }
  const host = env.OLLAMA_HOST ?? env.SWARMX_OLLAMA_URL ?? "http://127.0.0.1:11434";
  try {
    const res = await fetch(`${host}/api/ps`, {
      signal: AbortSignal.timeout(env.SWARMX_OLLAMA_PROBE_TIMEOUT_MS),
    });
    if (!res.ok) {
      return { name: "ollama", ok: false, detail: `${host}/api/ps returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { models?: unknown[] };
    const modelCount = Array.isArray(body.models) ? body.models.length : 0;
    return { name: "ollama", ok: true, detail: `${host} reachable, ${modelCount} loaded model(s)` };
  } catch (err) {
    return {
      name: "ollama",
      ok: false,
      detail: `${host}/api/ps unreachable: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

export async function checkRam(): Promise<CheckResult> {
  const availableMb = Math.floor(freemem() / 1024 / 1024);
  if (availableMb >= FULL_PIPELINE_MIN_AVAILABLE_MB) {
    return {
      name: "ram",
      ok: true,
      detail: `${availableMb} MB available (>= ${FULL_PIPELINE_MIN_AVAILABLE_MB} MB required for full pipeline)`,
    };
  }
  return {
    name: "ram",
    ok: false,
    detail: `${availableMb} MB available (< ${FULL_PIPELINE_MIN_AVAILABLE_MB} MB); low-RAM mode auto-engages but full pipeline blocked`,
  };
}

export async function checkVoiceBinaries(): Promise<CheckResult> {
  // Use the canonical VoiceProvider probes so behavior matches what the
  // pipeline itself would observe. Espeak is not counted — it is fallback
  // only, never a production voice.
  const providers = voiceProviders().filter((p) => p.id === "kokoro" || p.id === "piper");
  const outcomes: Array<{ id: string; state: string; reason?: string }> = [];
  for (const provider of providers) {
    try {
      const capability = await provider.probe();
      outcomes.push({ id: provider.id, state: capability.state, reason: capability.reason });
    } catch (err) {
      outcomes.push({
        id: provider.id,
        state: "unavailable",
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  const anyAvailable = outcomes.some((o) => o.state === "available");
  if (anyAvailable) {
    const available = outcomes.filter((o) => o.state === "available").map((o) => o.id).join(", ");
    return { name: "voice-binaries", ok: true, detail: `neural provider(s) available: ${available}` };
  }
  const summary = outcomes.map((o) => `${o.id}=${o.state}`).join(", ");
  return {
    name: "voice-binaries",
    ok: false,
    detail: `no neural TTS provider available (${summary}); pipeline will fall back to espeak-ng`,
  };
}

export async function checkVoiceBenchmark(): Promise<CheckResult> {
  const report = await readVoiceBenchmarkReport();
  if (!report) {
    return {
      name: "voice-benchmark",
      ok: false,
      detail: "no benchmark report found or report invalid; run scripts/voice-benchmark.ts",
    };
  }
  if (report.stale) {
    return {
      name: "voice-benchmark",
      ok: false,
      detail: `report is ${Math.floor(report.ageHours)}h old (stale); re-run scripts/voice-benchmark.ts`,
    };
  }
  return {
    name: "voice-benchmark",
    ok: true,
    detail: `fresh (${Math.floor(report.ageHours)}h old), recommended: ${report.report.recommendedProviderId}`,
  };
}

export async function runAllChecks(): Promise<CheckResult[]> {
  return [
    await checkEnv(),
    await checkRedis(),
    await checkOllama(),
    await checkRam(),
    await checkVoiceBinaries(),
    await checkVoiceBenchmark(),
  ];
}

async function main(): Promise<void> {
  const checks = await runAllChecks();
  const failures = checks.filter((c) => !c.ok);
  if (failures.length === 0) {
    log.info({ checks }, "doctor:report");
    process.exit(0);
  }
  log.error({ failures, checks }, "doctor:unhealthy");
  process.exit(1);
}

// Only run when invoked as a script, not when imported by tests.
const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith("/doctor.ts") === true ||
  process.argv[1]?.endsWith("\\doctor.ts") === true;
if (invokedDirectly) {
  void main();
}
