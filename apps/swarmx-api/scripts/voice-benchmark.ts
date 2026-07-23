/**
 * Voice benchmark CLI.
 *
 * Probes each registered voice provider, runs one cold + N warm synthesis
 * iterations against a small fixture, and writes a JSON report consumed by
 * `selectVoiceProvider()` when `SWARMX_TTS_PROVIDER=auto`.
 *
 * Usage:
 *   pnpm --filter @swarmx/api exec tsx scripts/voice-benchmark.ts
 *
 * Providers with unavailable probes are recorded but not measured. Failures do
 * not abort the run — every provider gets a row so the operator can see
 * partial results.
 *
 * Output: SWARMX_VOICE_BENCHMARK_FILE (default: /tmp/swarmxq-voice-benchmark.json)
 */
import { cpus, platform, totalmem, freemem } from "node:os";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadEnv } from "../src/lib/env.js";
import { log } from "../src/lib/logger.js";
import {
  voiceProviders,
  type VoiceProvider,
} from "../src/services/voice-providers.js";
import type {
  VoiceBenchmarkReport,
  VoiceProviderMeasurement,
} from "../src/services/voice-benchmark-report.js";

const FIXTURE_TEXT = [
  "Stop scrolling. Here is the one habit that quietly separates the top ten percent from everyone else.",
  "They protect their first hour. Before email, before notifications, before anyone else's priorities.",
  "Save this. Try it tomorrow.",
].join(" ");
const APPROX_WORDS = FIXTURE_TEXT.split(/\s+/).length;
const WARM_ITERATIONS = 3;

interface RunOutcome {
  latencyMs: number | null;
  durationSeconds: number | null;
  outputBytes: number | null;
  sampleRateHz: number | null;
  error?: string;
}

async function runOnce(provider: VoiceProvider, outputPath: string): Promise<RunOutcome> {
  try {
    const started = Date.now();
    const artifact = await provider.synthesize(
      {
        text: FIXTURE_TEXT,
        voiceId: "default",
        locale: loadEnv().SWARMX_TTS_LOCALE,
        requestedSampleRateHz: 22_050,
      },
      outputPath,
    );
    const info = await stat(outputPath);
    return {
      latencyMs: Date.now() - started,
      durationSeconds: artifact.durationSeconds,
      outputBytes: info.size,
      sampleRateHz: artifact.actualSampleRateHz,
    };
  } catch (err) {
    return {
      latencyMs: null,
      durationSeconds: null,
      outputBytes: null,
      sampleRateHz: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function measureProvider(provider: VoiceProvider, workDir: string): Promise<VoiceProviderMeasurement> {
  const probe = await provider.probe();
  const qualityTier = probe.qualityTier;
  if (probe.state !== "available") {
    return {
      providerId: provider.id,
      qualityTier,
      probeState: probe.state,
      coldLatencyMs: null,
      warmLatencyMs: null,
      durationSeconds: null,
      realTimeFactor: null,
      sampleRateHz: null,
      outputBytes: null,
      runs: 0,
      failures: 0,
      failureReasons: [],
      notes: probe.reason ?? "provider not available",
    };
  }

  const outcomes: RunOutcome[] = [];
  for (let i = 0; i < WARM_ITERATIONS + 1; i++) {
    const outputPath = join(workDir, `${provider.id}-${i}.wav`);
    outcomes.push(await runOnce(provider, outputPath));
  }
  const successful = outcomes.filter((o) => o.latencyMs !== null);
  const failures = outcomes.filter((o) => o.error);
  const [coldOutcome, ...warmOutcomes] = outcomes;
  const coldLatencyMs = coldOutcome?.latencyMs ?? null;
  const warmLatencies = warmOutcomes
    .map((o) => o.latencyMs)
    .filter((v): v is number => typeof v === "number");
  const warmLatencyMs = median(warmLatencies);
  const durationSecondsList = successful
    .map((o) => o.durationSeconds)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const durationSeconds = median(durationSecondsList);
  const sampleRates = successful
    .map((o) => o.sampleRateHz)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const outputBytesList = successful
    .map((o) => o.outputBytes)
    .filter((v): v is number => typeof v === "number" && v > 0);
  const realTimeFactor =
    warmLatencyMs !== null && durationSeconds !== null && durationSeconds > 0
      ? warmLatencyMs / 1000 / durationSeconds
      : null;

  return {
    providerId: provider.id,
    qualityTier,
    probeState: probe.state,
    coldLatencyMs,
    warmLatencyMs,
    durationSeconds,
    realTimeFactor,
    sampleRateHz: sampleRates[0] ?? null,
    outputBytes: median(outputBytesList),
    runs: successful.length,
    failures: failures.length,
    failureReasons: failures
      .map((o) => o.error ?? "unknown failure")
      .filter((v, i, a) => a.indexOf(v) === i)
      .slice(0, 5),
  };
}

const PROVIDER_QUALITY_RANK: Record<string, number> = {
  neural_local: 3,
  neural_hosted: 2,
  synthetic_fallback: 1,
  silent: 0,
};

function recommend(measurements: VoiceProviderMeasurement[]): { id: string | null; reason: string } {
  const eligible = measurements.filter((m) => m.probeState === "available" && m.runs > 0 && m.failures === 0);
  if (eligible.length === 0) {
    const anyProbed = measurements.find((m) => m.probeState === "available");
    if (anyProbed) {
      return { id: anyProbed.providerId, reason: "no provider completed a clean run; falling back to first probed-available" };
    }
    return { id: null, reason: "no provider was available during benchmark" };
  }
  const sorted = [...eligible].sort((a, b) => {
    const rankA = PROVIDER_QUALITY_RANK[a.qualityTier] ?? 0;
    const rankB = PROVIDER_QUALITY_RANK[b.qualityTier] ?? 0;
    if (rankA !== rankB) return rankB - rankA;
    const rtfA = a.realTimeFactor ?? Number.POSITIVE_INFINITY;
    const rtfB = b.realTimeFactor ?? Number.POSITIVE_INFINITY;
    return rtfA - rtfB;
  });
  const winner = sorted[0]!;
  const rtf = winner.realTimeFactor?.toFixed(2) ?? "n/a";
  return {
    id: winner.providerId,
    reason: `${winner.providerId} chosen — quality tier ${winner.qualityTier}, real-time factor ${rtf}`,
  };
}

async function main() {
  loadEnv();
  const env = loadEnv();
  const workDir = await mkdtemp(join(tmpdir(), "swarmxq-voice-bench-"));
  try {
    const measurements: VoiceProviderMeasurement[] = [];
    for (const provider of voiceProviders()) {
      log.info({ providerId: provider.id }, "voice benchmark: measuring provider");
      measurements.push(await measureProvider(provider, workDir));
    }
    const recommendation = recommend(measurements);
    const report: VoiceBenchmarkReport = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      host: {
        platform: platform(),
        cpuCores: cpus().length,
        totalRamMb: Math.round(totalmem() / (1024 * 1024)),
        availableRamMb: Math.round(freemem() / (1024 * 1024)),
      },
      fixture: {
        text: FIXTURE_TEXT,
        approxWords: APPROX_WORDS,
      },
      measurements,
      recommendedProviderId: recommendation.id,
      recommendationReason: recommendation.reason,
    };
    const target = env.SWARMX_VOICE_BENCHMARK_FILE;
    await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    log.info({
      target,
      recommendedProviderId: report.recommendedProviderId,
      providers: measurements.map((m) => ({
        id: m.providerId,
        state: m.probeState,
        rtf: m.realTimeFactor,
        failures: m.failures,
      })),
    }, "voice benchmark complete");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  log.error({ err: err instanceof Error ? err.stack : String(err) }, "voice benchmark failed");
  process.exit(1);
});
