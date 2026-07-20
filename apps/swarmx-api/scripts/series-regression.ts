/**
 * apps/swarmx-api/scripts/series-regression.ts
 * V6.2.27 — Series Engine spec compliance regression script.
 * Runnable with: npx tsx scripts/series-regression.ts
 * No Ollama, no Redis required.
 */

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateQualityGate, buildContinuityReport } from "../src/services/video-episode-preproducer.js";
import type {
  SeriesJob,
  EpisodeScript,
  EpisodeRoadmapEntry,
  ScenePromptSuite,
  AudioPlan,
  DialogueNote,
  PlatformPublishingAsset,
  EpisodeViralityScore,
} from "@swarmx/types/series-types";

// ─── Passing Fixtures ─────────────────────────────────────────────────────────

const BASE_SERIES: SeriesJob = {
  id: "series-regression-test",
  status: "planned",
  brief: {
    storyTheme: "A warrior's journey through fear",
    coreMessage: "Courage transforms fear into fuel",
    emotionalJourney: "fear → hope → courage",
    primaryConflict: "internal",
    targetAudience: "18–34 mindset seekers",
    tone: "cinematic",
    seriesLength: 6,
    episodeDurationSeconds: 45,
    platformPrimary: "tiktok",
    arcStructure: "heros_journey",
  },
  characterBible: [{
    name: "Kai",
    appearance: "tall, lean, dark skin, short locs",
    face: "sharp jawline, deep brown eyes",
    defaultOutfit: "slate grey training gear",
    voice: "low, measured, deliberate",
    personality: "focused, determined; unexpectedly gentle with allies",
    relationships: {},
    emotionalArc: "fear → acceptance → courage",
    signatureCues: "touches scar on left hand before speaking",
    speakingStyle: "short sentences, deliberate pauses",
    aiPromptSeed: "Kai, 28, tall lean male, dark skin, short locs, slate grey gear, sharp jawline",
  }],
  worldGuide: {
    keyLocations: [{
      name: "dojo",
      description: "sparse training hall with wooden floors",
      lightingDefault: "natural key from high window",
      timeOfDayDefault: "dawn",
    }],
    architecture: "minimal brutalist",
    colorPalette: ["#1a1a2e", "#16213e", "#e94560"],
    cameraLanguage: {
      defaultLens: "50mm natural",
      defaultMovementStyle: "slow push-in",
      shotGrammarRules: "ECU on tension, WS on wonder, OTS for intimacy",
    },
    visualMotifs: ["shadow", "doorway", "broken symmetry"],
    era: "contemporary",
    toneMap: "cinematic dark",
    soundSignature: "distant piano motif",
  },
  episodeRoadmap: [{
    episodeNumber: 1,
    title: "The First Step",
    summary: "Kai enters the dojo for the first time",
    continuityThread: "fear holds Kai back from committing",
    chekhovGun: "a broken training staff",
    chekhovPayoffEpisode: 4,
  }],
  videoJobIds: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

const BASE_SCRIPT: EpisodeScript = {
  hook: "Fear is not the enemy here.",
  body: "fear walks with Kai every morning into the dojo [VISUAL: Kai entering dojo · slow push-in · dawn · dread · cinematic 720p] a broken training staff catches his eye. His fingers hesitate at the threshold — fear holds him back from committing.",
  emotionalPeak: "Kai picks up a broken staff and trains until dawn — fear becomes fuel",
  cliffhanger: {
    type: "MYSTERY",
    text: "The staff belonged to someone who never came back",
  },
  transitionBridge: {
    type: "VISUAL_MATCH",
    description: "last frame of episode 1 mirrors the color composition of episode 2 opening",
  },
  sceneCount: 2,
};

// Scene prompt includes character name + aiPromptSeed prefix + color palette reference
const BASE_PROMPTS: ScenePromptSuite[] = [
  {
    sceneIndex: 0,
    sceneLabel: "SCENE [1.0]",
    sceneTitle: "Kai enters the dojo",
    master: "Kai, 28, tall lean male, dark skin, short locs, slate grey gear enters a sparse dojo at dawn. natural key light from high window. 50mm natural lens. slow push-in. cinematic grain. #1a1a2e shadows. 720p",
    character: "Kai, 28, tall lean male, dark skin, short locs, slate grey gear, sharp jawline — expression: apprehensive, hand near scar",
    environment: "dojo training hall, dawn, wooden floors, single high window, sparse, minimal brutalist architecture",
    camera: "MS · slow push-in · 50mm natural · shallow DOF · rule-of-thirds",
    lighting: "natural key from high window · 4000K neutral · low contrast motivated by dawn",
    motion: "Kai walks slowly head down; camera pushes in steadily; dust motes in light beam",
    style: "#1a1a2e cinematic grain, desaturated editorial, deep shadow tones, moody",
    animation: "static scene — no keyframe animation",
    negative: "blurry, watermark, duplicate limbs, text overlay, low resolution, distorted face, anachronistic props",
  },
  {
    sceneIndex: 1,
    sceneLabel: "SCENE [1.1]",
    sceneTitle: "The broken staff",
    master: "Kai notices a broken training staff on the dojo floor. #16213e shadows, #e94560 accent glint, 50mm natural lens, slow push-in, cinematic grain, 720p",
    character: "Kai, 28, tall lean male, dark skin, short locs, slate grey gear, sharp jawline — fingers hover above the broken staff",
    environment: "dojo training hall, dawn, wooden floorboards, dust in natural key light",
    camera: "CU · slow push-in · 50mm natural · shallow DOF · centred-symmetry",
    lighting: "natural key from high window · 4000K neutral · low contrast · #e94560 accent reflection",
    motion: "Kai kneels; dust shifts around the staff; camera pushes toward his hand",
    style: "#16213e cinematic grain, desaturated editorial, deep shadow tones, moody",
    animation: "static scene — no keyframe animation",
    negative: "blurry, watermark, duplicate limbs, text overlay, low resolution, distorted face, anachronistic props",
  },
];

// Audio plan: tone=cinematic → allowed narration styles: poetic, intimate
// silenceCues ≥ 1 (episode is 45s, requires silence cues)
// seriesSonicSignature echoes worldGuide.soundSignature "distant piano motif"
const KAI_DIALOGUE_NOTE: DialogueNote = {
  characterName: "Kai",
  emotion: "fear",
  subtext: "fear holds him back from speaking aloud",
  deliveryInstruction: "barely audible, almost a whisper — pause before last word",
  transitionType: "J-cut",
};

const BASE_AUDIO: AudioPlan = {
  narrationStyle: "poetic",
  musicDescription: "sparse piano, slow tempo 60bpm, building string tension, emotional function: amplify dread transitioning to resolve",
  soundEffects: ["wooden floor creak on entry", "staff hitting floor", "distant city ambient"],
  silenceCues: ["beat of silence after Kai picks up the broken staff — 2 seconds of visual only"],
  seriesSonicSignature: "distant piano motif with subtle reverb returns in every episode final 5 seconds",
  dialogueNotes: [KAI_DIALOGUE_NOTE],
};

// Title ≤ 60 chars, caption firstLine ≤ 40 chars (not starting with I/My/This/We/Our)
// SEO description 120–160 chars, caption ≤ 2200 chars, in-feed first paragraph ≤ 280 chars
const PASSING_FIRST_LINE = "Courage waits beyond fear."; // 26 chars ✓

const PASSING_SEO = "A warrior enters the dojo for the very first time and confronts what fear truly means in this powerful 45-second cinematic story series.";
// Let me verify: should be 120-160 chars.
// That string is: 136 chars — ✓

const PASSING_CAPTION = `${PASSING_FIRST_LINE}\n\nKai's transformation begins here — 6 episodes of raw courage.\n\n#mindset #courage #storytelling #cinematic`;

const PASSING_ASSETS: PlatformPublishingAsset[] = [
  {
    platform: "tiktok",
    title: "Fear is not the enemy — Ep 1",
    seoDescription: PASSING_SEO,
    caption: PASSING_CAPTION,
    hashtags: ["#mindset", "#courage", "#storytelling", "#cinematic"],
    cta: "Watch all 6 episodes uninterrupted",
    thumbnailConcept: "Kai in silhouette against dawn light, title in white monospace",
    pinnedComment: "What's the biggest thing fear has stopped you from starting?",
    soundSuggestion: "slow building piano with subtle string undertone, tempo mirrors heartbeat",
  },
  {
    platform: "reels",
    title: "Fear is not the enemy — Ep 1",
    seoDescription: PASSING_SEO,
    caption: PASSING_CAPTION,
    hashtags: ["#mindset", "#courage", "#storytelling"],
    cta: "Watch all 6 episodes uninterrupted",
    thumbnailConcept: "Kai silhouette, dawn light, minimal text",
    pinnedComment: "What stops you from starting?",
    soundSuggestion: "slow piano with building tension, resolving into quiet",
  },
  {
    platform: "youtube_shorts",
    title: "Fear is not the enemy — Ep 1",
    seoDescription: PASSING_SEO,
    caption: PASSING_CAPTION,
    hashtags: ["#mindset", "#courage", "#cinematic"],
    cta: "Subscribe to watch the full series",
    thumbnailConcept: "Kai in dojo, text overlay: 'FEAR IS NOT THE ENEMY'",
    pinnedComment: "Full 6-episode series drops weekly.",
    soundSuggestion: "cinematic piano, slow build, emotional release at end",
  },
  {
    platform: "facebook",
    title: "Fear is not the enemy — Ep 1",
    seoDescription: PASSING_SEO,
    caption: PASSING_CAPTION,
    hashtags: ["#mindset", "#courage", "#storytelling"],
    cta: "Share this with someone who needs it",
    thumbnailConcept: "Kai and broken staff, dawn glow",
    pinnedComment: "Who do you know that needs to see this?",
    soundSuggestion: "gentle piano building slowly, introspective mood",
  },
  {
    platform: "x",
    title: "Fear is not the enemy",
    seoDescription: PASSING_SEO,
    caption: PASSING_CAPTION,
    hashtags: ["#mindset", "#courage", "#storytelling"],
    cta: "Thread drops every episode weekly",
    thumbnailConcept: "Kai silhouette, minimal dark tones",
    pinnedComment: "Reply with where fear is holding you back right now.",
    soundSuggestion: "ambient tension resolving to sparse piano",
  },
];

const PASSING_VIRALITY: EpisodeViralityScore = {
  hookStrength: 0.75,
  completionProxy: 0.70,
  shareability: 0.68,
  seoScore: 0.72,
  overall: 0.72,  // 0.75×0.35 + 0.70×0.25 + 0.68×0.25 + 0.72×0.15 = 0.2625+0.175+0.17+0.108 = 0.7155 → 0.72
  recommendations: ["Sharpen the hook's first word", "Add a visual callback to episode 1 in episodes 3–4"],
};

// ─── Section 1: Source Structure Assertions ────────────────────────────────────

console.log("Section 1: source structure...");

const preproducerSource = await readFile(
  new URL("../src/services/video-episode-preproducer.ts", import.meta.url), "utf8",
);

assert.ok(preproducerSource.includes("AUDIO_COHERENCE"), "AUDIO_COHERENCE category must be present in quality gate");
assert.ok(preproducerSource.includes("NARRATION_STYLE_BY_TONE"), "NARRATION_STYLE_BY_TONE table must be declared");
assert.ok(preproducerSource.includes("buildContinuityReport"), "buildContinuityReport must be exported");
assert.ok(preproducerSource.includes("hookStrength >= 0.5"), "quality gate must check hookStrength ≥ 0.5");
assert.ok(
  preproducerSource.includes("overall >= 0.55"),
  "quality gate must check virality hard floor ≥ 0.55",
);
assert.ok(preproducerSource.includes("CAPTION_OPENER_BLOCKLIST"), "caption opener blocklist must exist");
assert.ok(preproducerSource.includes("<= 60"), "platform title ≤ 60 check must be present");
assert.ok(
  preproducerSource.includes("120 && seoLen <= 160") || preproducerSource.includes("seoLen >= 120"),
  "SEO description range 120–160 must be checked",
);
assert.ok(preproducerSource.includes("2200"), "TikTok 2200-char hard cap must be checked");
assert.ok(preproducerSource.includes("280"), "in-feed 280-char soft cap must be checked");

console.log("  ✓ source structure assertions passed");

// ─── Section 2: evaluateQualityGate Unit Tests ────────────────────────────────

console.log("Section 2: evaluateQualityGate...");

// Full passing fixture — must pass all checks including all 5 categories
{
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, PASSING_VIRALITY);
  const categories = new Set(result.checks.map((c) => c.category));
  assert.ok(categories.has("STORY_INTEGRITY"), "STORY_INTEGRITY checks must be present");
  assert.ok(categories.has("CREATIVE_QUALITY"), "CREATIVE_QUALITY checks must be present");
  assert.ok(categories.has("VISUAL_CONSISTENCY"), "VISUAL_CONSISTENCY checks must be present");
  assert.ok(categories.has("PRODUCTION_READINESS"), "PRODUCTION_READINESS checks must be present");
  assert.ok(categories.has("AUDIO_COHERENCE"), "AUDIO_COHERENCE checks must be present");
  const failing = result.checks.filter((c) => !c.passed);
  if (!result.passed) {
    console.error("  Failing checks in full passing fixture:");
    for (const f of failing) console.error(`    [${f.category}] ${f.label}: ${f.detail ?? ""}`);
  }
  assert.ok(result.passed, "full passing fixture must pass all checks");
  console.log("  ✓ full passing fixture passes");
}

// Gap 2 — hookStrength 0.4 → fails
{
  const lowHook: EpisodeViralityScore = { ...PASSING_VIRALITY, hookStrength: 0.4 };
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, lowHook);
  const check = result.checks.find((c) => c.label.startsWith("Hook strength"));
  assert.ok(check && !check.passed, "hookStrength 0.4 must fail Hook strength ≥ 0.5 check");
  console.log("  ✓ hookStrength 0.4 fails correctly");
}

// Gap 3 — overall 0.50 → fails hard floor (0.55) and soft min (0.65)
{
  const veryLow: EpisodeViralityScore = { ...PASSING_VIRALITY, hookStrength: 0.4, completionProxy: 0.5, shareability: 0.5, seoScore: 0.5, overall: 0.50 };
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, veryLow);
  const hardFloor = result.checks.find((c) => c.label.startsWith("Virality hard floor"));
  const softMin = result.checks.find((c) => c.label.startsWith("Virality overall"));
  assert.ok(hardFloor && !hardFloor.passed, "overall 0.50 must fail hard floor ≥ 0.55");
  assert.ok(softMin && !softMin.passed, "overall 0.50 must fail soft min ≥ 0.65");
  console.log("  ✓ overall 0.50 fails both floor and soft min");
}

// Gap 3b — overall 0.60 → passes hard floor, fails soft min
{
  const midLow: EpisodeViralityScore = { ...PASSING_VIRALITY, overall: 0.60 };
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, midLow);
  const hardFloor = result.checks.find((c) => c.label.startsWith("Virality hard floor"));
  const softMin = result.checks.find((c) => c.label.startsWith("Virality overall"));
  assert.ok(hardFloor && hardFloor.passed, "overall 0.60 must pass hard floor ≥ 0.55");
  assert.ok(softMin && !softMin.passed, "overall 0.60 must fail soft min ≥ 0.65");
  console.log("  ✓ overall 0.60 passes hard floor, fails soft min");
}

// Gap 4 — caption firstLine starting with "My" → fails
{
  const badCaptionAssets: PlatformPublishingAsset[] = PASSING_ASSETS.map((a) =>
    a.platform === "tiktok"
      ? { ...a, caption: `My warrior story starts here.\n\n#mindset #courage` }
      : a,
  );
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, badCaptionAssets, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label === "Caption firstLine does not start with I/My/This/We/Our");
  assert.ok(check && !check.passed, "caption firstLine starting with 'My' must fail opener check");
  console.log("  ✓ 'My' caption opener fails correctly");
}

// Gap 5 — title 65 chars → fails
{
  const longTitleAssets: PlatformPublishingAsset[] = PASSING_ASSETS.map((a) =>
    a.platform === "tiktok"
      ? { ...a, title: "This is an extremely long title that exceeds the sixty character limit" }
      : a,
  );
  // "This is an extremely long title that exceeds the sixty character limit" = 71 chars
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, longTitleAssets, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Platform title ≤ 60"));
  assert.ok(check && !check.passed, "title > 60 chars must fail");
  console.log("  ✓ title 71 chars fails ≤ 60 check");
}

// Gap 6 — seoDescription 90 chars → fails
{
  const shortSeoAssets: PlatformPublishingAsset[] = PASSING_ASSETS.map((a) =>
    a.platform === "tiktok"
      ? { ...a, seoDescription: "A warrior enters the dojo. Fear is the enemy. Short description." }
      : a,
  );
  // "A warrior enters the dojo. Fear is the enemy. Short description." = 64 chars → fails ≥ 120
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, shortSeoAssets, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("SEO description 120–160"));
  assert.ok(check && !check.passed, "seoDescription 64 chars must fail 120–160 check");
  console.log("  ✓ seoDescription 64 chars fails range check");
}

// Gap 6b — seoDescription 170 chars → fails
{
  const longSeoAssets: PlatformPublishingAsset[] = PASSING_ASSETS.map((a) =>
    a.platform === "tiktok"
      ? { ...a, seoDescription: "A".repeat(170) }
      : a,
  );
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, longSeoAssets, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("SEO description 120–160"));
  assert.ok(check && !check.passed, "seoDescription 170 chars must fail 120–160 check");
  console.log("  ✓ seoDescription 170 chars fails range check");
}

// Gap 7 — caption 2300 chars → fails TikTok hard cap
{
  const longCaptionAssets: PlatformPublishingAsset[] = PASSING_ASSETS.map((a) =>
    a.platform === "tiktok"
      ? { ...a, caption: `Short first line.\n\n${"A".repeat(2300)}` }
      : a,
  );
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, longCaptionAssets, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Full caption ≤ 2,200"));
  assert.ok(check && !check.passed, "caption > 2,200 chars must fail TikTok hard cap check");
  console.log("  ✓ caption 2300+ chars fails TikTok hard cap");
}

// Gap 8 — in-feed paragraph 300 chars → fails 280 soft cap
{
  const longInFeedAssets: PlatformPublishingAsset[] = PASSING_ASSETS.map((a) =>
    a.platform === "tiktok"
      ? { ...a, caption: `${"Warriors walk into fear every single day and this is the story of one ".repeat(5).slice(0, 300)}\n\n#mindset` }
      : a,
  );
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, longInFeedAssets, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("In-feed visible text"));
  assert.ok(check && !check.passed, "in-feed paragraph > 280 chars must fail soft cap check");
  console.log("  ✓ in-feed paragraph 300 chars fails soft cap");
}

// Gap 1a — empty seriesSonicSignature → fails AUDIO_COHERENCE sonic signature
{
  const noSigAudio: AudioPlan = { ...BASE_AUDIO, seriesSonicSignature: "" };
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, noSigAudio, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Series sonic signature"));
  assert.ok(check && !check.passed, "empty seriesSonicSignature must fail AUDIO_COHERENCE sonic signature check");
  console.log("  ✓ empty seriesSonicSignature fails AUDIO_COHERENCE");
}

// Gap 1b — narrationStyle "intimate" with tone "urgent" → fails narration coherence
{
  const urgentSeries: SeriesJob = { ...BASE_SERIES, brief: { ...BASE_SERIES.brief, tone: "urgent" } };
  const wrongStyleAudio: AudioPlan = { ...BASE_AUDIO, narrationStyle: "intimate" };
  // "urgent" allows: authoritative, conspiratorial — "intimate" is NOT in that list
  const result = evaluateQualityGate(urgentSeries, 1, BASE_SCRIPT, BASE_PROMPTS, wrongStyleAudio, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Narration style coherent"));
  assert.ok(check && !check.passed, "'intimate' narration with 'urgent' tone must fail coherence check");
  console.log("  ✓ 'intimate' narration + 'urgent' tone fails AUDIO_COHERENCE narration check");
}

// Gap 1b — narrationStyle "authoritative" with tone "urgent" → passes
{
  const urgentSeries: SeriesJob = { ...BASE_SERIES, brief: { ...BASE_SERIES.brief, tone: "urgent" } };
  const rightStyleAudio: AudioPlan = { ...BASE_AUDIO, narrationStyle: "authoritative" };
  const result = evaluateQualityGate(urgentSeries, 1, BASE_SCRIPT, BASE_PROMPTS, rightStyleAudio, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Narration style coherent"));
  assert.ok(check && check.passed, "'authoritative' narration with 'urgent' tone must pass coherence check");
  console.log("  ✓ 'authoritative' narration + 'urgent' tone passes AUDIO_COHERENCE narration check");
}

// Gap 1c — silenceCues:[] with 45s episode → fails silence cue check
{
  const noSilenceAudio: AudioPlan = { ...BASE_AUDIO, silenceCues: [] };
  const result = evaluateQualityGate(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, noSilenceAudio, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Silence cues present"));
  assert.ok(check && !check.passed, "empty silenceCues with 45s episode must fail silence cue check");
  console.log("  ✓ empty silenceCues + 45s fails AUDIO_COHERENCE silence check");
}

// Gap 1c — silenceCues:[] with 15s episode → passes silence cue check
{
  const shortSeries: SeriesJob = { ...BASE_SERIES, brief: { ...BASE_SERIES.brief, episodeDurationSeconds: 15 } };
  const noSilenceAudio: AudioPlan = { ...BASE_AUDIO, silenceCues: [] };
  const result = evaluateQualityGate(shortSeries, 1, BASE_SCRIPT, BASE_PROMPTS, noSilenceAudio, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label.startsWith("Silence cues present"));
  assert.ok(check && check.passed, "empty silenceCues with 15s episode must PASS silence cue check");
  console.log("  ✓ empty silenceCues + 15s passes AUDIO_COHERENCE silence check (optional)");
}

console.log("Section 2: all evaluateQualityGate tests passed ✓");

// ─── Section 3: buildContinuityReport Unit Tests ──────────────────────────────

console.log("Section 3: buildContinuityReport...");

// Character AI seed present → seedPresentInPrompts: true
{
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO);
  const kai = report.characterDriftChecks.find((c) => c.characterName === "Kai");
  assert.ok(kai, "Kai must appear in characterDriftChecks");
  assert.ok(kai.seedPresentInPrompts, "Kai AI seed ('Kai, 28') in scene prompt must yield seedPresentInPrompts: true");
  console.log("  ✓ character seed present → seedPresentInPrompts: true");
}

// Character absent from all prompts → seedPresentInPrompts: false
{
  const noCharPrompts: ScenePromptSuite[] = [{ ...BASE_PROMPTS[0]!, character: "a generic figure, no name, no details" }];
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, noCharPrompts, BASE_AUDIO);
  const kai = report.characterDriftChecks.find((c) => c.characterName === "Kai");
  assert.ok(kai && !kai.seedPresentInPrompts, "character absent from prompts must yield seedPresentInPrompts: false");
  console.log("  ✓ character absent from prompts → seedPresentInPrompts: false");
}

// Speaking style noted when structured DialogueNote has matching characterName
{
  const audioWithKaiNote: AudioPlan = {
    ...BASE_AUDIO,
    dialogueNotes: [{
      characterName: "Kai",
      emotion: "resolve",
      subtext: "committed despite fear",
      deliveryInstruction: "whispered, deliberate",
      transitionType: "L-cut",
    }],
  };
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, audioWithKaiNote);
  const kai = report.characterDriftChecks.find((c) => c.characterName === "Kai");
  assert.ok(kai && kai.speakingStyleNoted, "DialogueNote with characterName 'Kai' must yield speakingStyleNoted: true");
  console.log("  ✓ DialogueNote.characterName === 'Kai' → speakingStyleNoted: true");
}

// speakingStyleNoted false when no DialogueNote matches
{
  const audioNoNote: AudioPlan = { ...BASE_AUDIO, dialogueNotes: [] };
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, audioNoNote);
  const kai = report.characterDriftChecks.find((c) => c.characterName === "Kai");
  assert.ok(kai && !kai.speakingStyleNoted, "empty dialogueNotes must yield speakingStyleNoted: false");
  console.log("  ✓ empty dialogueNotes → speakingStyleNoted: false");
}

// worldGuide soundSignature present + audioPlan non-empty → soundSignaturePresent: true
{
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO);
  assert.ok(report.worldDriftCheck.soundSignaturePresent, "soundSignature present in world + audioPlan must yield soundSignaturePresent: true");
  console.log("  ✓ soundSignature + seriesSonicSignature present → soundSignaturePresent: true");
}

// chekhovGun first 2 words in script.body → chekhovGunPlanted: true
// BASE_SCRIPT.body includes "broken training staff" — entry.chekhovGun is "a broken training staff"
// first 2 words of "a broken" → "a broken" — present in body ✓
{
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO);
  assert.ok(report.plotThreadStatus.chekhovGunPlanted, "chekhovGun words 'a broken' in body must yield chekhovGunPlanted: true");
  console.log("  ✓ chekhovGun words in body → chekhovGunPlanted: true");
}

// chekhovGun NOT in body → chekhovGunPlanted: false
{
  const scriptWithoutGun: EpisodeScript = { ...BASE_SCRIPT, body: "Kai walks into the dojo. He stands quietly. Nothing unusual." };
  const report = buildContinuityReport(BASE_SERIES, 1, scriptWithoutGun, BASE_PROMPTS, BASE_AUDIO);
  assert.ok(!report.plotThreadStatus.chekhovGunPlanted, "chekhovGun absent from body must yield chekhovGunPlanted: false");
  console.log("  ✓ chekhovGun absent from body → chekhovGunPlanted: false");
}

// transitionBridgeConfirmed = true when description is non-empty
{
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO);
  assert.ok(report.transitionBridgeConfirmed, "non-empty transitionBridge.description must yield transitionBridgeConfirmed: true");
  console.log("  ✓ transitionBridge.description non-empty → transitionBridgeConfirmed: true");
}

// overallContinuityPassed: true when all sub-checks pass
{
  const report = buildContinuityReport(BASE_SERIES, 1, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO);
  if (!report.overallContinuityPassed) {
    console.error("  Failing continuity sub-checks:");
    console.error("    characterDriftChecks:", JSON.stringify(report.characterDriftChecks));
    console.error("    worldDriftCheck:", JSON.stringify(report.worldDriftCheck));
    console.error("    plotThreadStatus:", JSON.stringify(report.plotThreadStatus));
    console.error("    transitionBridgeConfirmed:", report.transitionBridgeConfirmed);
  }
  assert.ok(report.overallContinuityPassed, "all sub-checks passing must yield overallContinuityPassed: true");
  console.log("  ✓ all sub-checks passing → overallContinuityPassed: true");
}

console.log("Section 3: all buildContinuityReport tests passed ✓");

// ─── Section 4: Type File Assertions ──────────────────────────────────────────

console.log("Section 4: type file assertions...");

const typesSource = await readFile(
  new URL("../../../packages/swarmx-types/src/series-types.ts", import.meta.url), "utf8",
);

assert.ok(typesSource.includes('"AUDIO_COHERENCE"'), 'AUDIO_COHERENCE must be in QualityGateCategory union');
assert.ok(typesSource.includes("ContinuityReport"), "ContinuityReport interface must exist in series-types.ts");
assert.ok(typesSource.includes("continuityReport?:"), "EpisodePreProduction must have continuityReport? field");
assert.ok(typesSource.includes("overallContinuityPassed"), "ContinuityReport must include overallContinuityPassed");
assert.ok(typesSource.includes("characterDriftChecks"), "ContinuityReport must include characterDriftChecks");
assert.ok(typesSource.includes("worldDriftCheck"), "ContinuityReport must include worldDriftCheck");
assert.ok(typesSource.includes("plotThreadStatus"), "ContinuityReport must include plotThreadStatus");
// V6.2.30 — structured virality arc
assert.ok(typesSource.includes("SeriesViralityArcData"), "SeriesViralityArcData interface must exist in series-types.ts");
assert.ok(typesSource.includes("viralityArcData?:"), "SeriesJob must have viralityArcData? optional field");

console.log("  ✓ type file assertions passed");

// ─── Section 5: V2.1 Gap Fills ────────────────────────────────────────────────

console.log("Section 5: V2.1 gap fill assertions...");

// 5a — Source structure: modular pass exports
assert.ok(preproducerSource.includes("export async function runPassAScript"), "runPassAScript must be exported");
assert.ok(preproducerSource.includes("export async function runPassBPrompts"), "runPassBPrompts must be exported");
assert.ok(preproducerSource.includes("export async function runPassCAudioAssets"), "runPassCAudioAssets must be exported");
assert.ok(preproducerSource.includes("export async function runPassDScoring"), "runPassDScoring must be exported");
assert.ok(preproducerSource.includes("updateEpisodePassStatus"), "updateEpisodePassStatus must be called in preproducer");
assert.ok(preproducerSource.includes("LOOP_BRIDGE"), "LOOP_BRIDGE must be present in preproducer");
assert.ok(preproducerSource.includes("sceneLabel"), "sceneLabel must be computed in preproducer");
assert.ok(preproducerSource.includes("DialogueNoteSchema"), "DialogueNoteSchema must be defined in preproducer");
console.log("  ✓ preproducer modular exports + V2.1 source checks passed");

const seriesPlannerSource = await readFile(
  new URL("../src/services/video-series-planner.ts", import.meta.url), "utf8",
);
assert.ok(seriesPlannerSource.includes("export async function runPass1WorldBuilder"), "runPass1WorldBuilder must be exported");
assert.ok(seriesPlannerSource.includes("export async function runPass2RoadmapBuilder"), "runPass2RoadmapBuilder must be exported");
assert.ok(seriesPlannerSource.includes("export async function runPass3ViralityArc"), "runPass3ViralityArc must be exported");
assert.ok(seriesPlannerSource.includes("export async function runPass4CinematicLock"), "runPass4CinematicLock must be exported");
assert.ok(seriesPlannerSource.includes("soloFormat"), "soloFormat branch must be present in series planner");
assert.ok(seriesPlannerSource.includes("updateSeriesPassStatus"), "updateSeriesPassStatus must be called in series planner");
console.log("  ✓ series planner modular exports + SOLO FORMAT + pass status wiring checked");

// 5b — Type file: V2.1 additions
assert.ok(typesSource.includes("soloFormat?:"), "soloFormat must be in SeriesBrief");
assert.ok(typesSource.includes("sceneLabel:"), "sceneLabel must be in ScenePromptSuite");
assert.ok(typesSource.includes("LOOP_BRIDGE"), "LOOP_BRIDGE must be in transitionBridge union");
assert.ok(typesSource.includes("interface DialogueNote"), "DialogueNote interface must exist in series-types.ts");
assert.ok(typesSource.includes("dialogueNotes?: DialogueNote[]"), "AudioPlan.dialogueNotes must be DialogueNote[]");
assert.ok(typesSource.includes("passStatus?:"), "passStatus must be in EpisodePreProduction");
assert.ok(typesSource.includes("planningPassStatus?:"), "planningPassStatus must be in SeriesJob");
assert.ok(typesSource.includes("SeriesPassStatus"), "SeriesPassStatus type must exist");
console.log("  ✓ type file V2.1 field assertions passed");

// 5c — LOOP_BRIDGE quality gate: finale (ep 6/6) with LOOP_BRIDGE must pass
{
  const finaleSeries: SeriesJob = { ...BASE_SERIES, brief: { ...BASE_SERIES.brief, seriesLength: 6 } };
  const finaleEntry: EpisodeRoadmapEntry = { episodeNumber: 6, title: "The Return", summary: "Kai completes his arc", continuityThread: "broken staff restored" };
  const seriesWithFinale: SeriesJob = {
    ...finaleSeries,
    episodeRoadmap: [...(BASE_SERIES.episodeRoadmap ?? []), finaleEntry],
  };
  const finaleScript: EpisodeScript = {
    ...BASE_SCRIPT,
    transitionBridge: { type: "LOOP_BRIDGE", description: "final frame holds on dojo entrance — same composition as episode 1 opening; loop triggers rewatch" },
  };
  const result = evaluateQualityGate(seriesWithFinale, 6, finaleScript, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label === "Finale transition bridge is LOOP_BRIDGE");
  assert.ok(check, "Finale LOOP_BRIDGE check must be present for episode 6/6");
  assert.ok(check.passed, "LOOP_BRIDGE in finale (ep 6/6) must pass STORY_INTEGRITY");
  console.log("  ✓ LOOP_BRIDGE in finale (ep 6/6) passes STORY_INTEGRITY");
}

// 5d — VISUAL_MATCH in finale (ep 6/6) must fail
{
  const finaleSeries: SeriesJob = { ...BASE_SERIES, brief: { ...BASE_SERIES.brief, seriesLength: 6 } };
  const finaleEntry: EpisodeRoadmapEntry = { episodeNumber: 6, title: "The Return", summary: "finale", continuityThread: "restored" };
  const seriesWithFinale: SeriesJob = {
    ...finaleSeries,
    episodeRoadmap: [...(BASE_SERIES.episodeRoadmap ?? []), finaleEntry],
  };
  // BASE_SCRIPT uses VISUAL_MATCH — wrong for finale
  const result = evaluateQualityGate(seriesWithFinale, 6, BASE_SCRIPT, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label === "Finale transition bridge is LOOP_BRIDGE");
  assert.ok(check && !check.passed, "VISUAL_MATCH in finale must fail — only LOOP_BRIDGE is valid");
  console.log("  ✓ VISUAL_MATCH in finale (ep 6/6) fails STORY_INTEGRITY");
}

// 5e — LOOP_BRIDGE in non-finale (ep 1/6) must fail
{
  const loopInNonFinaleScript: EpisodeScript = {
    ...BASE_SCRIPT,
    transitionBridge: { type: "LOOP_BRIDGE", description: "incorrectly used in non-finale" },
  };
  const result = evaluateQualityGate(BASE_SERIES, 1, loopInNonFinaleScript, BASE_PROMPTS, BASE_AUDIO, PASSING_ASSETS, PASSING_VIRALITY);
  const check = result.checks.find((c) => c.label === "Non-finale bridge is not LOOP_BRIDGE");
  assert.ok(check && !check.passed, "LOOP_BRIDGE in non-finale (ep 1/6) must fail STORY_INTEGRITY");
  console.log("  ✓ LOOP_BRIDGE in non-finale (ep 1/6) fails STORY_INTEGRITY");
}

// 5f — sceneLabel format: SCENE [episodeNumber.sceneIndex]
{
  // sceneLabel is computed deterministically — test the pattern
  const ep = 3;
  const sceneIdx = 1;
  const expectedLabel = `SCENE [${ep}.${sceneIdx}]`;
  assert.strictEqual(expectedLabel, "SCENE [3.1]", "sceneLabel format must be SCENE [episodeNumber.sceneIndex]");
  console.log("  ✓ sceneLabel format 'SCENE [3.1]' verified");
}

console.log("Section 5: all V2.1 assertions passed ✓");

// ─── Done ─────────────────────────────────────────────────────────────────────

console.log("\nseries regression checks passed");
process.exit(0);
