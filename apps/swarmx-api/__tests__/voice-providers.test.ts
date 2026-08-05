import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  EspeakVoiceProvider,
  KOKORO_VOICE_MAP,
  KokoroVoiceProvider,
  normalizeScriptForSpeech,
  PiperVoiceProvider,
  resolveVoiceStyle,
  selectVoiceProvider,
  voiceProviders,
} from "../src/services/voice-providers.js";
import { resetEnvForTesting } from "../src/lib/env.js";

describe("normalizeScriptForSpeech", () => {
  test("removes prompt tags, visual cues, reasoning blocks, and quote debris", () => {
    const normalized = normalizeScriptForSpeech(`
      <think>hidden chain</think>
      [HOOK] "Planning too long? Here is why you should ship daily."
      [BODY] Solo founders know the pain. [VISUAL: keyboard, fast cuts]
      [CTA] "Write one pain. Ship tomorrow."
    `);

    expect(normalized).not.toContain("<think>");
    expect(normalized).not.toContain("[HOOK]");
    expect(normalized).not.toContain("[VISUAL:");
    expect(normalized).not.toContain("\"Planning");
    expect(normalized).toContain("Planning too long?");
    expect(normalized).toContain("Write one pain. Ship tomorrow.");
  });

  test("rejects empty narration after normalization", () => {
    expect(() => normalizeScriptForSpeech("[HOOK] [VISUAL: only markup]")).toThrow("Narration text is empty");
  });
});

describe("EspeakVoiceProvider", () => {
  test("lists fallback voices as synthetic, not neural", async () => {
    const provider = new EspeakVoiceProvider();
    const voices = await provider.listVoices("en-US");

    expect(voices.map((voice) => voice.voiceId)).toEqual(["default", "calm", "energetic", "narrator"]);
    expect(voices.every((voice) => voice.qualityTier === "synthetic_fallback")).toBe(true);
    expect(voices.every((voice) => voice.license.state === "approved")).toBe(true);
  });
});

describe("KokoroVoiceProvider", () => {
  test("maps tone and dashboard voice names to Kokoro voice IDs", () => {
    expect(KOKORO_VOICE_MAP.narrator).toBe("am_michael");
    expect(KOKORO_VOICE_MAP.educational).toBe("bm_george");
    expect(KOKORO_VOICE_MAP.energetic).toBe("am_adam");
  });

  test("lists local neural voices without requiring a live service probe", async () => {
    const provider = new KokoroVoiceProvider();
    const voices = await provider.listVoices("en-US");

    expect(voices.length).toBeGreaterThan(0);
    expect(voices.every((voice) => voice.providerId === "kokoro")).toBe(true);
    expect(voices.every((voice) => voice.qualityTier === "neural_local")).toBe(true);
    expect(voices.every((voice) => voice.license.state === "approved")).toBe(true);
  });

  test("provider ordering prefers Kokoro before Piper and espeak fallback", () => {
    expect(voiceProviders().map((provider) => provider.id)).toEqual(["kokoro", "piper", "espeak-ng"]);
  });
});

describe("voice profile integration", () => {
  let benchmarkDir: string;
  let benchmarkPath: string;

  beforeEach(() => {
    benchmarkDir = mkdtempSync(join(tmpdir(), "swarmxq-voice-providers-"));
    benchmarkPath = join(benchmarkDir, "voice-benchmark.json");
    process.env.NODE_ENV = "test";
    process.env.SWARMX_TTS_PROVIDER = "auto";
    process.env.SWARMX_VOICE_BENCHMARK_FILE = benchmarkPath;
    process.env.SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS = "168";
    resetEnvForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    resetEnvForTesting();
    rmSync(benchmarkDir, { recursive: true, force: true });
    delete process.env.SWARMX_TTS_PROVIDER;
    delete process.env.SWARMX_VOICE_BENCHMARK_FILE;
    delete process.env.SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS;
  });

  test("maps dashboard voice profiles and story mode to concrete runtime voice styles", () => {
    expect(resolveVoiceStyle({
      voiceId: "default",
      voiceProfileId: "kokoro_warm",
      storyMode: "single_narrator",
    })).toBe("warm");

    expect(resolveVoiceStyle({
      voiceId: "default",
      storyMode: "dialogue_storytime",
    })).toBe("narrator");
  });

  test("maps default voice through tone when no explicit profile is pinned", () => {
    expect(resolveVoiceStyle({
      voiceId: "default",
      tone: "urgent",
      storyMode: "single_narrator",
    })).toBe("urgent");

    expect(resolveVoiceStyle({
      voiceId: "default",
      tone: "warm",
      storyMode: "single_narrator",
    })).toBe("warm");
  });

  test("prefers Kokoro when an explicit Kokoro profile is requested, even if the benchmark ranks Piper first", async () => {
    writeFileSync(benchmarkPath, JSON.stringify({
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      host: { platform: "linux", cpuCores: 4, totalRamMb: 16384, availableRamMb: 8192 },
      fixture: { text: "benchmark", approxWords: 1 },
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
      ],
      recommendedProviderId: "piper",
      recommendationReason: "piper chosen by benchmark",
    }));

    vi.spyOn(KokoroVoiceProvider.prototype, "probe").mockResolvedValue({
      providerId: "kokoro",
      state: "available",
      qualityTier: "neural_local",
      supportsStreaming: false,
      supportsCancellation: true,
      requiresExternalDownload: false,
      probedAt: new Date().toISOString(),
    });
    vi.spyOn(PiperVoiceProvider.prototype, "probe").mockResolvedValue({
      providerId: "piper",
      state: "available",
      qualityTier: "neural_local",
      supportsStreaming: false,
      supportsCancellation: true,
      requiresExternalDownload: false,
      probedAt: new Date().toISOString(),
    });
    vi.spyOn(EspeakVoiceProvider.prototype, "probe").mockResolvedValue({
      providerId: "espeak-ng",
      state: "available",
      qualityTier: "synthetic_fallback",
      supportsStreaming: false,
      supportsCancellation: true,
      requiresExternalDownload: false,
      probedAt: new Date().toISOString(),
    });

    const selected = await selectVoiceProvider({ voiceProfileId: "kokoro_warm" });
    expect(selected.provider.id).toBe("kokoro");
  });
});
