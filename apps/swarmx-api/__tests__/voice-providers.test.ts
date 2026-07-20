import { describe, expect, test } from "vitest";
import {
  EspeakVoiceProvider,
  KOKORO_VOICE_MAP,
  KokoroVoiceProvider,
  normalizeScriptForSpeech,
  voiceProviders,
} from "../src/services/voice-providers.js";

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
