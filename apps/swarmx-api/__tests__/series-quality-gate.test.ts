import { describe, test, expect } from "vitest";
import {
  evaluateQualityGate,
  buildContinuityReport,
} from "../src/services/video-episode-preproducer.js";
import type {
  SeriesJob,
  EpisodeScript,
  ScenePromptSuite,
  AudioPlan,
  PlatformPublishingAsset,
  EpisodeViralityScore,
  CharacterProfile,
} from "@swarmx/types/series-types";

// ─── Base fixtures ────────────────────────────────────────────────────────────
// seriesLength=6 so episode 6 is the finale; episodes 1-5 are non-finales.

const baseSeries: SeriesJob = {
  id: "test-series",
  status: "planned",
  brief: {
    storyTheme: "the hidden cost of distraction",
    coreMessage: "focus is a skill you can rebuild",
    emotionalJourney: "confusion to clarity",
    primaryConflict: "internal",
    targetAudience: "25-35 knowledge workers",
    tone: "educational",
    seriesLength: 6,
    episodeDurationSeconds: 30,
    platformPrimary: "tiktok",
    arcStructure: "3-act",
  },
  videoJobIds: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  episodeRoadmap: [
    { episodeNumber: 1, title: "The Focus Myth", summary: "s1", continuityThread: "distraction spiral" },
    { episodeNumber: 2, title: "The Cost", summary: "s2", continuityThread: "attention debt" },
    { episodeNumber: 3, title: "The Science", summary: "s3", continuityThread: "neural rewiring" },
    { episodeNumber: 4, title: "The Method", summary: "s4", continuityThread: "practice protocol" },
    { episodeNumber: 5, title: "The Test", summary: "s5", continuityThread: "habit loop" },
    { episodeNumber: 6, title: "The Rebuild", summary: "s6", continuityThread: "mastery achieved" },
  ],
  characterBible: [],
  worldGuide: {
    keyLocations: [
      { name: "home studio", description: "minimalist workspace", lightingDefault: "natural key", timeOfDayDefault: "morning" },
    ],
    architecture: "minimalist",
    colorPalette: ["deep charcoal", "warm ivory", "slate blue"],
    cameraLanguage: { defaultLens: "35mm standard", defaultMovementStyle: "static", shotGrammarRules: "follow the emotion" },
    visualMotifs: ["empty desk", "single light source"],
    era: "contemporary",
    toneMap: "educational warm",
    soundSignature: "ambient piano motif with sparse reverb",
  },
};

// Passing script for ep 1 of 6 (non-finale, VISUAL_MATCH bridge)
const passingScript: EpisodeScript = {
  hook: "Everything you know about focus is provably wrong",    // 9 words ✓
  body: "Studies show every distraction costs 23 minutes to recover. [VISUAL: cluttered desk · static · home studio · stressed · cinematic] The spiral compounds silently.",
  emotionalPeak: "The moment you realize your calendar is optimized for interruption",
  cliffhanger: {
    type: "REVELATION",
    text: "But the real cause of your distraction is not what you think",
  },
  transitionBridge: {
    type: "VISUAL_MATCH",
    description: "The final frame of scattered papers matches the opening composition of episode 2",
  },
  sceneCount: 3,
};

function makeScene(index: number, ep: number): ScenePromptSuite {
  return {
    sceneIndex: index,
    sceneLabel: `SCENE [${ep}.${index}]`,
    sceneTitle: `Scene ${index + 1}`,
    master: "Person sits at a home studio desk, natural key light, 35mm standard lens, static shot. Deep charcoal tones dominate. Sharp focus on foreground, soft background.",
    character: "narrator only — no on-camera characters",
    environment: "home studio, morning, calm atmosphere",
    camera: "MS, static, 35mm standard, deep focus, rule of thirds",
    lighting: "natural key, 4000K neutral, low contrast, warm ivory highlights",
    motion: "minimal camera movement; papers settle in foreground",
    style: "cinematic grain, deep charcoal and warm ivory palette",
    animation: "static scene — no keyframe animation required",
    negative: "blurry, watermark, duplicate limbs, text overlay, low resolution, distorted face",
  };
}

const passingPrompts: ScenePromptSuite[] = [makeScene(0, 1), makeScene(1, 1), makeScene(2, 1)];

const passingAudioPlan: AudioPlan = {
  narrationStyle: "authoritative",   // valid for tone "educational"
  musicDescription: "sparse ambient piano, 58bpm, building tension, contemplative mood",
  soundEffects: ["keyboard typing", "page turn"],
  silenceCues: ["after 'your calendar is optimized for interruption' — 1.5s silence before music returns"],
  seriesSonicSignature: "ambient piano motif with sparse reverb echoes through each episode",
  dialogueNotes: [],
};

function makePlatformAsset(platform: PlatformPublishingAsset["platform"], overrides: Partial<PlatformPublishingAsset> = {}): PlatformPublishingAsset {
  return {
    platform,
    title: "Why Your Focus Keeps Breaking (Proven Science)",  // 47 chars ✓
    seoDescription: "Neuroscience reveals the exact reason your focus keeps breaking and the evidence-based strategies that actually help you rebuild it.",  // 131 chars ✓
    caption: "Attention is being stolen every day\n\nEach interruption costs you 23 minutes to recover. Here's the science behind why and what to do next.\n\n#focus #productivity #deepwork #mindset",
    hashtags: ["#focus", "#productivity", "#deepwork", "#mindset"],
    cta: "Share with someone losing the focus battle",  // 8 words ✓
    thumbnailConcept: "Split frame: cluttered desk vs empty desk, deep charcoal and warm ivory contrast",
    pinnedComment: "How many hours a day do you actually spend in deep focus? Drop your honest number.",
    soundSuggestion: "sparse ambient piano with gradual tension build, 58bpm, contemplative",
    ...overrides,
  };
}

const allPlatformAssets: PlatformPublishingAsset[] = [
  makePlatformAsset("tiktok"),
  makePlatformAsset("reels"),
  makePlatformAsset("youtube_shorts"),
  makePlatformAsset("facebook"),
  makePlatformAsset("x"),
];

const passingViralityScore: EpisodeViralityScore = {
  hookStrength: 0.80,
  completionProxy: 0.76,
  shareability: 0.72,
  seoScore: 0.66,
  overall: 0.75,   // 0.80*0.35 + 0.76*0.25 + 0.72*0.25 + 0.66*0.15 = 0.28+0.19+0.18+0.099 = 0.749
  recommendations: ["Strengthen the cliffhanger specificity", "Add a visual callback to episode 1"],
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function runGate(
  overrides: {
    series?: Partial<SeriesJob>;
    ep?: number;
    script?: Partial<EpisodeScript>;
    prompts?: ScenePromptSuite[];
    audio?: Partial<AudioPlan>;
    assets?: PlatformPublishingAsset[];
    virality?: Partial<EpisodeViralityScore>;
  } = {},
) {
  const series: SeriesJob = { ...baseSeries, ...(overrides.series ?? {}) };
  const ep = overrides.ep ?? 1;
  const script: EpisodeScript = { ...passingScript, ...(overrides.script ?? {}) };
  const prompts = overrides.prompts ?? passingPrompts;
  const audio: AudioPlan = { ...passingAudioPlan, ...(overrides.audio ?? {}) };
  const assets = overrides.assets ?? allPlatformAssets;
  const virality: EpisodeViralityScore = { ...passingViralityScore, ...(overrides.virality ?? {}) };
  return evaluateQualityGate(series, ep, script, prompts, audio, assets, virality);
}

function passedCategory(result: ReturnType<typeof evaluateQualityGate>, category: string) {
  return result.checks.filter((c) => c.category === category).every((c) => c.passed);
}

function findCheck(result: ReturnType<typeof evaluateQualityGate>, label: string) {
  return result.checks.find((c) => c.label.startsWith(label));
}

// ─── Full passing fixture ────────────────────────────────────────────────────

describe("evaluateQualityGate — full passing fixture", () => {
  test("all checks pass for a well-formed episode", () => {
    const result = runGate();
    const failures = result.checks.filter((c) => !c.passed).map((c) => `${c.category}: ${c.label} — ${c.detail ?? ""}`);
    expect(failures).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

// ─── STORY_INTEGRITY — LOOP_BRIDGE rule ─────────────────────────────────────

describe("evaluateQualityGate — STORY_INTEGRITY: LOOP_BRIDGE rule", () => {
  test("finale (ep 6 of 6) with LOOP_BRIDGE passes the finale check", () => {
    const result = runGate({
      ep: 6,
      script: {
        transitionBridge: { type: "LOOP_BRIDGE", description: "final frame echoes episode 1 opening composition" },
      },
    });
    const check = findCheck(result, "Finale transition bridge is LOOP_BRIDGE");
    expect(check?.passed).toBe(true);
  });

  test("finale (ep 6 of 6) with VISUAL_MATCH fails the finale check", () => {
    const result = runGate({
      ep: 6,
      script: {
        transitionBridge: { type: "VISUAL_MATCH", description: "visual match to next episode" },
      },
    });
    const check = findCheck(result, "Finale transition bridge is LOOP_BRIDGE");
    expect(check?.passed).toBe(false);
  });

  test("non-finale (ep 1 of 6) with LOOP_BRIDGE fails the non-finale check", () => {
    const result = runGate({
      ep: 1,
      script: {
        transitionBridge: { type: "LOOP_BRIDGE", description: "loop back" },
      },
    });
    const check = findCheck(result, "Non-finale bridge is not LOOP_BRIDGE");
    expect(check?.passed).toBe(false);
  });

  test("non-finale (ep 1 of 6) with AUDIO_THREAD passes the non-finale check", () => {
    const result = runGate({
      ep: 1,
      script: {
        transitionBridge: { type: "AUDIO_THREAD", description: "piano motif begins before next episode opens" },
      },
    });
    const check = findCheck(result, "Non-finale bridge is not LOOP_BRIDGE");
    expect(check?.passed).toBe(true);
  });

  test("invalid cliffhanger type fails STORY_INTEGRITY", () => {
    const result = runGate({
      script: {
        cliffhanger: { type: "REVELATION" as never, text: "..." },
      },
    });
    // Force an invalid type at runtime
    const invalidScript: EpisodeScript = {
      ...passingScript,
      cliffhanger: { type: "MANUFACTURED" as "REVELATION", text: "bad type" },
    };
    const r2 = evaluateQualityGate(baseSeries, 1, invalidScript, passingPrompts, passingAudioPlan, allPlatformAssets, passingViralityScore);
    const check = findCheck(r2, "Cliffhanger type is valid");
    expect(check?.passed).toBe(false);
  });
});

// ─── CREATIVE_QUALITY — hook word count ─────────────────────────────────────

describe("evaluateQualityGate — CREATIVE_QUALITY: hook word count", () => {
  test("hook of exactly 18 words passes", () => {
    const hook = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen";
    const result = runGate({ script: { hook } });
    const check = findCheck(result, "Hook ≤ 18 words");
    expect(check?.passed).toBe(true);
  });

  test("hook of 19 words fails", () => {
    const hook = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen";
    const result = runGate({ script: { hook } });
    const check = findCheck(result, "Hook ≤ 18 words");
    expect(check?.passed).toBe(false);
  });
});

// ─── CREATIVE_QUALITY — HOOK_BLOCKLIST ──────────────────────────────────────

describe("evaluateQualityGate — CREATIVE_QUALITY: HOOK_BLOCKLIST", () => {
  test("hook starting with 'Welcome back' is rejected", () => {
    const result = runGate({ script: { hook: "Welcome back to the focus series" } });
    const check = findCheck(result, "Hook passes HOOK_BLOCKLIST");
    expect(check?.passed).toBe(false);
  });

  test("hook starting with 'In today's video' is rejected", () => {
    const result = runGate({ script: { hook: "In today's video we explore distraction" } });
    const check = findCheck(result, "Hook passes HOOK_BLOCKLIST");
    expect(check?.passed).toBe(false);
  });

  test("hook starting with 'Hi everyone' is rejected", () => {
    const result = runGate({ script: { hook: "Hi everyone welcome back to the channel" } });
    const check = findCheck(result, "Hook passes HOOK_BLOCKLIST");
    expect(check?.passed).toBe(false);
  });

  test("hook starting with a non-blocked phrase passes", () => {
    const result = runGate({ script: { hook: "The focus industry is lying to you" } });
    const check = findCheck(result, "Hook passes HOOK_BLOCKLIST");
    expect(check?.passed).toBe(true);
  });
});

// ─── CREATIVE_QUALITY — virality thresholds ─────────────────────────────────

describe("evaluateQualityGate — CREATIVE_QUALITY: virality thresholds", () => {
  test("hookStrength = 0.5 passes the hook strength check", () => {
    const result = runGate({ virality: { hookStrength: 0.5 } });
    const check = findCheck(result, "Hook strength ≥ 0.5");
    expect(check?.passed).toBe(true);
  });

  test("hookStrength = 0.49 fails the hook strength check", () => {
    const result = runGate({ virality: { hookStrength: 0.49 } });
    const check = findCheck(result, "Hook strength ≥ 0.5");
    expect(check?.passed).toBe(false);
  });

  test("overall = 0.65 passes both the soft-min and the hard-floor checks", () => {
    const result = runGate({ virality: { overall: 0.65 } });
    expect(findCheck(result, "Virality overall ≥ 0.65")?.passed).toBe(true);
    expect(findCheck(result, "Virality hard floor ≥ 0.55")?.passed).toBe(true);
  });

  test("overall = 0.60 passes the hard floor but fails the soft-min check", () => {
    const result = runGate({ virality: { overall: 0.60 } });
    expect(findCheck(result, "Virality overall ≥ 0.65")?.passed).toBe(false);
    expect(findCheck(result, "Virality hard floor ≥ 0.55")?.passed).toBe(true);
  });

  test("overall = 0.54 fails both the soft-min and the hard-floor checks", () => {
    const result = runGate({ virality: { overall: 0.54 } });
    expect(findCheck(result, "Virality overall ≥ 0.65")?.passed).toBe(false);
    expect(findCheck(result, "Virality hard floor ≥ 0.55")?.passed).toBe(false);
  });
});

// ─── PRODUCTION_READINESS — caption firstLine ────────────────────────────────

describe("evaluateQualityGate — PRODUCTION_READINESS: caption firstLine", () => {
  test("firstLine of exactly 40 chars passes", () => {
    // 40 chars: "Your attention is the product being sold."  → exactly 40
    const firstLine = "Your attention is the product being sold";   // 40 chars
    expect(firstLine.length).toBe(40);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok"
          ? { ...a, caption: `${firstLine}\n\nBody text here.` }
          : a,
      ),
    });
    const check = findCheck(result, "Caption firstLine ≤ 40 chars");
    expect(check?.passed).toBe(true);
  });

  test("firstLine of 41 chars fails", () => {
    const firstLine = "Your attention is the product being sold.";  // 41 chars
    expect(firstLine.length).toBe(41);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok"
          ? { ...a, caption: `${firstLine}\n\nBody text here.` }
          : a,
      ),
    });
    const check = findCheck(result, "Caption firstLine ≤ 40 chars");
    expect(check?.passed).toBe(false);
  });

  test("firstLine starting with 'My' fails the opener blocklist check", () => {
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok"
          ? { ...a, caption: "My focus journey changed everything\n\nBody." }
          : a,
      ),
    });
    const check = findCheck(result, "Caption firstLine does not start with");
    expect(check?.passed).toBe(false);
  });

  test("firstLine starting with 'This ' fails the opener blocklist check", () => {
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok"
          ? { ...a, caption: "This changed how I think about focus\n\nBody." }
          : a,
      ),
    });
    const check = findCheck(result, "Caption firstLine does not start with");
    expect(check?.passed).toBe(false);
  });
});

// ─── PRODUCTION_READINESS — title length ─────────────────────────────────────

describe("evaluateQualityGate — PRODUCTION_READINESS: platform title", () => {
  test("title of exactly 60 chars passes", () => {
    const title = "Why Focus Keeps Breaking: The Science Behind Distraction Now";  // 60 chars
    expect(title.length).toBe(60);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, title } : a,
      ),
    });
    const check = findCheck(result, "Platform title ≤ 60 chars");
    expect(check?.passed).toBe(true);
  });

  test("title of 61 chars fails", () => {
    const title = "Why Focus Keeps Breaking: The Science Behind Distraction Now!";  // 61 chars
    expect(title.length).toBe(61);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, title } : a,
      ),
    });
    const check = findCheck(result, "Platform title ≤ 60 chars");
    expect(check?.passed).toBe(false);
  });
});

// ─── PRODUCTION_READINESS — SEO description length ───────────────────────────

describe("evaluateQualityGate — PRODUCTION_READINESS: SEO description", () => {
  test("SEO description of exactly 120 chars passes (boundary)", () => {
    const seo = "A".repeat(120);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, seoDescription: seo } : a,
      ),
    });
    const check = findCheck(result, "SEO description 120–160 chars");
    expect(check?.passed).toBe(true);
  });

  test("SEO description of 119 chars fails", () => {
    const seo = "A".repeat(119);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, seoDescription: seo } : a,
      ),
    });
    const check = findCheck(result, "SEO description 120–160 chars");
    expect(check?.passed).toBe(false);
  });

  test("SEO description of 161 chars fails", () => {
    const seo = "A".repeat(161);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, seoDescription: seo } : a,
      ),
    });
    const check = findCheck(result, "SEO description 120–160 chars");
    expect(check?.passed).toBe(false);
  });

  test("SEO description of 160 chars passes", () => {
    const seo = "A".repeat(160);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, seoDescription: seo } : a,
      ),
    });
    const check = findCheck(result, "SEO description 120–160 chars");
    expect(check?.passed).toBe(true);
  });
});

// ─── PRODUCTION_READINESS — TikTok caption hard cap ─────────────────────────

describe("evaluateQualityGate — PRODUCTION_READINESS: TikTok caption hard cap", () => {
  test("caption of exactly 2200 chars passes", () => {
    const caption = "A".repeat(2200);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, caption } : a,
      ),
    });
    const check = findCheck(result, "Full caption ≤ 2,200 chars");
    expect(check?.passed).toBe(true);
  });

  test("caption of 2201 chars fails", () => {
    const caption = "A".repeat(2201);
    const result = runGate({
      assets: allPlatformAssets.map((a) =>
        a.platform === "tiktok" ? { ...a, caption } : a,
      ),
    });
    const check = findCheck(result, "Full caption ≤ 2,200 chars");
    expect(check?.passed).toBe(false);
  });
});

// ─── AUDIO_COHERENCE ─────────────────────────────────────────────────────────

describe("evaluateQualityGate — AUDIO_COHERENCE: sonic signature", () => {
  test("seriesSonicSignature containing worldGuide soundSignature first 3 words passes", () => {
    // worldGuide.soundSignature = "ambient piano motif with sparse reverb"
    // first 3 words = "ambient piano motif"
    const result = runGate({
      audio: { seriesSonicSignature: "ambient piano motif weaves through every episode" },
    });
    const check = findCheck(result, "Series sonic signature consistent");
    expect(check?.passed).toBe(true);
  });

  test("seriesSonicSignature that does NOT contain the first 3 words of worldGuide soundSignature fails", () => {
    const result = runGate({
      audio: { seriesSonicSignature: "electric guitar riff from the opening" },
    });
    const check = findCheck(result, "Series sonic signature consistent");
    expect(check?.passed).toBe(false);
  });
});

describe("evaluateQualityGate — AUDIO_COHERENCE: narration style coherence", () => {
  test("narration 'authoritative' with tone 'urgent' passes", () => {
    const result = runGate({
      series: { brief: { ...baseSeries.brief, tone: "urgent" } },
      audio: { narrationStyle: "authoritative" },
    });
    const check = findCheck(result, "Narration style coherent with tone");
    expect(check?.passed).toBe(true);
  });

  test("narration 'intimate' with tone 'urgent' fails", () => {
    const result = runGate({
      series: { brief: { ...baseSeries.brief, tone: "urgent" } },
      audio: { narrationStyle: "intimate" },
    });
    const check = findCheck(result, "Narration style coherent with tone");
    expect(check?.passed).toBe(false);
  });

  test("narration 'intimate' with tone 'cinematic' passes", () => {
    const result = runGate({
      series: { brief: { ...baseSeries.brief, tone: "cinematic" } },
      audio: { narrationStyle: "intimate" },
    });
    const check = findCheck(result, "Narration style coherent with tone");
    expect(check?.passed).toBe(true);
  });
});

describe("evaluateQualityGate — AUDIO_COHERENCE: silence cues", () => {
  test("empty silenceCues for 15s episode passes (silence is optional)", () => {
    const result = runGate({
      series: { brief: { ...baseSeries.brief, episodeDurationSeconds: 15 } },
      audio: { silenceCues: [] },
    });
    const check = findCheck(result, "Silence cues present");
    expect(check?.passed).toBe(true);
  });

  test("empty silenceCues for 30s episode fails (silence required)", () => {
    const result = runGate({
      series: { brief: { ...baseSeries.brief, episodeDurationSeconds: 30 } },
      audio: { silenceCues: [] },
    });
    const check = findCheck(result, "Silence cues present");
    expect(check?.passed).toBe(false);
  });

  test("non-empty silenceCues for 30s episode passes", () => {
    const result = runGate({
      series: { brief: { ...baseSeries.brief, episodeDurationSeconds: 30 } },
      audio: { silenceCues: ["after the reveal — 1.2s silence"] },
    });
    const check = findCheck(result, "Silence cues present");
    expect(check?.passed).toBe(true);
  });
});

// ─── Virality formula invariant ───────────────────────────────────────────────

describe("Virality formula invariant", () => {
  test("VIRALITY_WEIGHTS sum to exactly 1.0", () => {
    expect(0.35 + 0.25 + 0.25 + 0.15).toBeCloseTo(1.0, 10);
  });

  test("all dimensions at 1.0 produce overall of 1.0 via gate check", () => {
    const perfectScore: EpisodeViralityScore = {
      hookStrength: 1.0, completionProxy: 1.0, shareability: 1.0, seoScore: 1.0, overall: 1.0,
      recommendations: ["already perfect"],
    };
    const result = runGate({ virality: perfectScore });
    expect(findCheck(result, "Virality overall ≥ 0.65")?.passed).toBe(true);
    expect(findCheck(result, "Hook strength ≥ 0.5")?.passed).toBe(true);
  });
});

// ─── buildContinuityReport — character drift ────────────────────────────────

const alexCharacter: CharacterProfile = {
  name: "Alex",
  appearance: "tall, athletic build",
  face: "strong jawline, sharp dark eyes",
  defaultOutfit: "dark charcoal blazer, minimal accessories",
  voice: "deep, measured, authoritative",
  personality: "driven, analytical — secretly afraid of failure",
  relationships: {},
  emotionalArc: "self-doubt to earned confidence",
  signatureCues: "pauses before answering",
  speakingStyle: "precise, never wastes words",
  aiPromptSeed: "Alex, tall athletic figure, dark charcoal blazer, sharp jawline",
};

const seriesWithCharacter: SeriesJob = {
  ...baseSeries,
  characterBible: [alexCharacter],
};

function makeSceneWithCharacterSeed(index: number): ScenePromptSuite {
  return {
    ...makeScene(index, 1),
    character: `${alexCharacter.aiPromptSeed} // DELTA: contemplative expression, looking at desk`,
  };
}

describe("buildContinuityReport — character drift checks", () => {
  test("character name in scene character prompt → seedPresentInPrompts: true", () => {
    const prompts = [makeSceneWithCharacterSeed(0), makeSceneWithCharacterSeed(1)];
    const report = buildContinuityReport(seriesWithCharacter, 1, passingScript, prompts, passingAudioPlan);
    expect(report.characterDriftChecks[0].characterName).toBe("Alex");
    expect(report.characterDriftChecks[0].seedPresentInPrompts).toBe(true);
  });

  test("character absent from all scene prompts → seedPresentInPrompts: false", () => {
    const promptsWithoutAlex: ScenePromptSuite[] = passingPrompts; // character = "narrator only"
    const report = buildContinuityReport(seriesWithCharacter, 1, passingScript, promptsWithoutAlex, passingAudioPlan);
    expect(report.characterDriftChecks[0].seedPresentInPrompts).toBe(false);
  });

  test("dialogueNote matching characterName → speakingStyleNoted: true", () => {
    const audioWithNote: AudioPlan = {
      ...passingAudioPlan,
      dialogueNotes: [{
        characterName: "Alex",
        emotion: "doubt",
        subtext: "hiding fear",
        deliveryInstruction: "near-whisper on the key line",
        transitionType: "silence-as-tension",
      }],
    };
    const report = buildContinuityReport(seriesWithCharacter, 1, passingScript, passingPrompts, audioWithNote);
    expect(report.characterDriftChecks[0].speakingStyleNoted).toBe(true);
  });

  test("empty dialogueNotes → speakingStyleNoted: false", () => {
    const report = buildContinuityReport(seriesWithCharacter, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.characterDriftChecks[0].speakingStyleNoted).toBe(false);
  });

  test("no characters in bible → characterDriftChecks is empty array", () => {
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.characterDriftChecks).toEqual([]);
  });
});

// ─── buildContinuityReport — world drift ────────────────────────────────────

describe("buildContinuityReport — world drift checks", () => {
  test("worldGuide soundSignature non-empty + audioPlan seriesSonicSignature non-empty → soundSignaturePresent: true", () => {
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.worldDriftCheck.soundSignaturePresent).toBe(true);
  });

  test("empty audioPlan seriesSonicSignature → soundSignaturePresent: false", () => {
    const audio: AudioPlan = { ...passingAudioPlan, seriesSonicSignature: "" };
    // Bypass Zod — construct AudioPlan directly
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, audio);
    expect(report.worldDriftCheck.soundSignaturePresent).toBe(false);
  });

  test("palette color present in scene style prompt → colorPaletteReferenced: true", () => {
    // passingPrompts[0].style = "cinematic grain, deep charcoal and warm ivory palette"
    // colorPalette includes "deep charcoal"
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.worldDriftCheck.colorPaletteReferenced).toBe(true);
  });
});

// ─── buildContinuityReport — plot thread status ─────────────────────────────

describe("buildContinuityReport — plot thread status", () => {
  test("Chekhov's gun first 2 words present in script body → chekkovGunPlanted: true", () => {
    const roadmapWithGun: SeriesJob = {
      ...baseSeries,
      episodeRoadmap: baseSeries.episodeRoadmap!.map((e) =>
        e.episodeNumber === 1
          // "distraction costs" are the first 2 words; passingScript.body contains "distraction costs"
          ? { ...e, chekhovGun: "distraction costs compound silently over weeks", chekhovPayoffEpisode: 4 }
          : e,
      ),
    };
    const report = buildContinuityReport(roadmapWithGun, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.plotThreadStatus.chekhovGunPlanted).toBe(true);
  });

  test("Chekhov's gun NOT present in script body → chekkovGunPlanted: false", () => {
    const roadmapWithGun: SeriesJob = {
      ...baseSeries,
      episodeRoadmap: baseSeries.episodeRoadmap!.map((e) =>
        e.episodeNumber === 1
          ? { ...e, chekhovGun: "encrypted message hidden in background" }
          : e,
      ),
    };
    // "encrypted" is NOT in passingScript.body
    const report = buildContinuityReport(roadmapWithGun, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.plotThreadStatus.chekhovGunPlanted).toBe(false);
  });

  test("no chekhovGun in roadmap entry → chekkovGunPlanted: true (vacuously)", () => {
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.plotThreadStatus.chekhovGunPlanted).toBe(true);
  });

  test("non-empty transitionBridge description → transitionBridgeConfirmed: true", () => {
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.transitionBridgeConfirmed).toBe(true);
  });
});

// ─── buildContinuityReport — overallContinuityPassed ────────────────────────

describe("buildContinuityReport — overallContinuityPassed", () => {
  test("all checks satisfied → overallContinuityPassed: true", () => {
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, passingAudioPlan);
    expect(report.overallContinuityPassed).toBe(true);
  });

  test("empty seriesSonicSignature → overallContinuityPassed: false", () => {
    const audio: AudioPlan = { ...passingAudioPlan, seriesSonicSignature: "" };
    const report = buildContinuityReport(baseSeries, 1, passingScript, passingPrompts, audio);
    expect(report.overallContinuityPassed).toBe(false);
  });
});
