import { readFile } from "node:fs/promises";
import { z } from "zod";
import { loadEnv } from "../lib/env.js";
import { log } from "../lib/logger.js";

const VoiceProviderMeasurementSchema = z.object({
  providerId: z.string().min(1),
  qualityTier: z.string().min(1),
  probeState: z.enum(["available", "degraded", "unavailable"]),
  coldLatencyMs: z.number().nonnegative().nullable(),
  warmLatencyMs: z.number().nonnegative().nullable(),
  durationSeconds: z.number().nonnegative().nullable(),
  realTimeFactor: z.number().positive().nullable(),
  sampleRateHz: z.number().int().positive().nullable(),
  outputBytes: z.number().int().nonnegative().nullable(),
  runs: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
  failureReasons: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const VoiceBenchmarkReportSchema = z.object({
  schemaVersion: z.literal(1),
  generatedAt: z.string().min(1),
  host: z.object({
    platform: z.string().min(1),
    cpuCores: z.number().int().positive(),
    totalRamMb: z.number().int().nonnegative(),
    availableRamMb: z.number().int().nonnegative(),
  }),
  fixture: z.object({
    text: z.string().min(1),
    approxWords: z.number().int().positive(),
  }),
  measurements: z.array(VoiceProviderMeasurementSchema).min(1),
  recommendedProviderId: z.string().min(1).nullable(),
  recommendationReason: z.string().min(1),
});

export type VoiceProviderMeasurement = z.infer<typeof VoiceProviderMeasurementSchema>;
export type VoiceBenchmarkReport = z.infer<typeof VoiceBenchmarkReportSchema>;

export interface LoadedVoiceBenchmark {
  report: VoiceBenchmarkReport;
  path: string;
  ageHours: number;
  stale: boolean;
}

function parseIsoAgeHours(iso: string, now: number): number {
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return Number.POSITIVE_INFINITY;
  return Math.max(0, (now - parsed) / 3_600_000);
}

export async function readVoiceBenchmarkReport(
  overridePath?: string,
): Promise<LoadedVoiceBenchmark | null> {
  const env = loadEnv();
  const path = overridePath ?? env.SWARMX_VOICE_BENCHMARK_FILE;
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch (err) {
    log.warn({
      code: "VOICE_BENCHMARK_INVALID_JSON",
      path,
      err: err instanceof Error ? err.message : String(err),
    }, "voice benchmark report is not valid JSON");
    return null;
  }
  const parsed = VoiceBenchmarkReportSchema.safeParse(parsedJson);
  if (!parsed.success) {
    log.warn({
      code: "VOICE_BENCHMARK_SCHEMA_INVALID",
      path,
      issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    }, "voice benchmark report failed schema validation");
    return null;
  }
  const ageHours = parseIsoAgeHours(parsed.data.generatedAt, Date.now());
  const stale = ageHours > env.SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS;
  return { report: parsed.data, path, ageHours, stale };
}

const PROVIDER_QUALITY_RANK: Record<string, number> = {
  neural_local: 3,
  neural_hosted: 2,
  synthetic_fallback: 1,
  silent: 0,
};

export function rankAvailableProviders(
  loaded: LoadedVoiceBenchmark | null,
  availableProviderIds: string[],
): string[] {
  if (availableProviderIds.length <= 1) return availableProviderIds;
  if (!loaded || loaded.stale) return availableProviderIds;
  const measurementsById = new Map<string, VoiceProviderMeasurement>(
    loaded.report.measurements.map((m) => [m.providerId, m]),
  );
  const scored = availableProviderIds.map((id) => {
    const m = measurementsById.get(id);
    const qualityRank = m ? PROVIDER_QUALITY_RANK[m.qualityTier] ?? 0 : 0;
    const rtf = m?.realTimeFactor ?? Number.POSITIVE_INFINITY;
    const failures = m?.failures ?? Number.POSITIVE_INFINITY;
    const measured = m ? 1 : 0;
    return { id, qualityRank, rtf, failures, measured };
  });
  scored.sort((a, b) => {
    if (a.measured !== b.measured) return b.measured - a.measured;
    if (a.failures !== b.failures) return a.failures - b.failures;
    if (a.qualityRank !== b.qualityRank) return b.qualityRank - a.qualityRank;
    if (a.rtf !== b.rtf) return a.rtf - b.rtf;
    return availableProviderIds.indexOf(a.id) - availableProviderIds.indexOf(b.id);
  });
  return scored.map((s) => s.id);
}
