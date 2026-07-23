import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  VoiceBenchmarkReportSchema,
  rankAvailableProviders,
  readVoiceBenchmarkReport,
  type LoadedVoiceBenchmark,
  type VoiceBenchmarkReport,
} from "../src/services/voice-benchmark-report.js";

const VALID_REPORT: VoiceBenchmarkReport = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  host: { platform: "linux", cpuCores: 4, totalRamMb: 16384, availableRamMb: 8192 },
  fixture: { text: "Sample fixture line for the benchmark.", approxWords: 8 },
  measurements: [
    {
      providerId: "kokoro",
      qualityTier: "neural_local",
      probeState: "available",
      coldLatencyMs: 4200,
      warmLatencyMs: 1800,
      durationSeconds: 6,
      realTimeFactor: 0.3,
      sampleRateHz: 24000,
      outputBytes: 240000,
      runs: 4,
      failures: 0,
      failureReasons: [],
    },
    {
      providerId: "piper",
      qualityTier: "neural_local",
      probeState: "available",
      coldLatencyMs: 3800,
      warmLatencyMs: 1400,
      durationSeconds: 6,
      realTimeFactor: 0.23,
      sampleRateHz: 22050,
      outputBytes: 230000,
      runs: 4,
      failures: 0,
      failureReasons: [],
    },
    {
      providerId: "espeak-ng",
      qualityTier: "synthetic_fallback",
      probeState: "available",
      coldLatencyMs: 350,
      warmLatencyMs: 300,
      durationSeconds: 5,
      realTimeFactor: 0.06,
      sampleRateHz: 22050,
      outputBytes: 110000,
      runs: 4,
      failures: 0,
      failureReasons: [],
    },
  ],
  recommendedProviderId: "piper",
  recommendationReason: "piper chosen — quality tier neural_local, real-time factor 0.23",
};

describe("VoiceBenchmarkReportSchema", () => {
  test("accepts a valid report", () => {
    expect(VoiceBenchmarkReportSchema.safeParse(VALID_REPORT).success).toBe(true);
  });

  test("rejects a report missing measurements", () => {
    const { measurements: _measurements, ...rest } = VALID_REPORT;
    void _measurements;
    expect(VoiceBenchmarkReportSchema.safeParse(rest).success).toBe(false);
  });

  test("rejects a report with an unknown probe state", () => {
    const bad = {
      ...VALID_REPORT,
      measurements: [{ ...VALID_REPORT.measurements[0]!, probeState: "haywire" }],
    };
    expect(VoiceBenchmarkReportSchema.safeParse(bad).success).toBe(false);
  });
});

describe("readVoiceBenchmarkReport", () => {
  let dir: string;
  let filePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "swarmxq-bench-"));
    filePath = join(dir, "report.json");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("returns null when the file does not exist", async () => {
    const result = await readVoiceBenchmarkReport(join(dir, "missing.json"));
    expect(result).toBeNull();
  });

  test("returns null when the file is not valid JSON", async () => {
    writeFileSync(filePath, "{not json");
    const result = await readVoiceBenchmarkReport(filePath);
    expect(result).toBeNull();
  });

  test("returns null when the schema does not match", async () => {
    writeFileSync(filePath, JSON.stringify({ schemaVersion: 1, foo: "bar" }));
    const result = await readVoiceBenchmarkReport(filePath);
    expect(result).toBeNull();
  });

  test("returns a fresh report with age and stale flag", async () => {
    writeFileSync(filePath, JSON.stringify(VALID_REPORT));
    const result = await readVoiceBenchmarkReport(filePath);
    expect(result).not.toBeNull();
    expect(result?.report.recommendedProviderId).toBe("piper");
    expect(result?.stale).toBe(false);
    expect(result?.ageHours).toBeGreaterThanOrEqual(0);
    expect(result?.ageHours).toBeLessThan(1);
  });

  test("flags a report older than the max age as stale", async () => {
    const oldReport: VoiceBenchmarkReport = {
      ...VALID_REPORT,
      generatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30).toISOString(),
    };
    writeFileSync(filePath, JSON.stringify(oldReport));
    const result = await readVoiceBenchmarkReport(filePath);
    expect(result?.stale).toBe(true);
  });
});

describe("rankAvailableProviders", () => {
  const loaded: LoadedVoiceBenchmark = {
    report: VALID_REPORT,
    path: "/tmp/fake.json",
    ageHours: 0.1,
    stale: false,
  };

  test("returns input order when only one provider is available", () => {
    expect(rankAvailableProviders(loaded, ["espeak-ng"])).toEqual(["espeak-ng"]);
  });

  test("returns input order when the report is missing", () => {
    expect(rankAvailableProviders(null, ["kokoro", "piper", "espeak-ng"]))
      .toEqual(["kokoro", "piper", "espeak-ng"]);
  });

  test("returns input order when the report is stale", () => {
    const staleLoaded: LoadedVoiceBenchmark = { ...loaded, stale: true };
    expect(rankAvailableProviders(staleLoaded, ["kokoro", "piper", "espeak-ng"]))
      .toEqual(["kokoro", "piper", "espeak-ng"]);
  });

  test("promotes the neural provider with the best real-time factor", () => {
    const ranked = rankAvailableProviders(loaded, ["kokoro", "piper", "espeak-ng"]);
    expect(ranked[0]).toBe("piper");
    expect(ranked).toContain("kokoro");
    expect(ranked).toContain("espeak-ng");
  });

  test("prefers a neural provider over espeak even when espeak has a lower RTF", () => {
    const ranked = rankAvailableProviders(loaded, ["kokoro", "espeak-ng"]);
    expect(ranked[0]).toBe("kokoro");
  });

  test("penalizes providers with failures", () => {
    const failingKokoro: VoiceBenchmarkReport = {
      ...VALID_REPORT,
      measurements: VALID_REPORT.measurements.map((m) =>
        m.providerId === "kokoro" ? { ...m, failures: 2, realTimeFactor: 0.15 } : m,
      ),
    };
    const failing: LoadedVoiceBenchmark = { ...loaded, report: failingKokoro };
    const ranked = rankAvailableProviders(failing, ["kokoro", "piper"]);
    expect(ranked[0]).toBe("piper");
  });

  test("keeps unmeasured providers at the end", () => {
    const partial: VoiceBenchmarkReport = {
      ...VALID_REPORT,
      measurements: [VALID_REPORT.measurements[1]!],
    };
    const partialLoaded: LoadedVoiceBenchmark = { ...loaded, report: partial };
    const ranked = rankAvailableProviders(partialLoaded, ["kokoro", "piper"]);
    expect(ranked).toEqual(["piper", "kokoro"]);
  });
});
