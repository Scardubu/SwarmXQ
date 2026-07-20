/**
 * apps/swarmx-api/src/services/video-episode-preproducer.ts
 * SwarmXQ Series Engine V2.0 — Episode Pre-Production Pipeline
 * V6.2.25 — Series Director spec injected: hook-position rules (Pass A),
 *            full camera/lighting vocabulary (Pass B), dialogue direction (Pass C).
 *
 * Four-pass LLM pipeline per episode:
 *   Pass A (Architect) — 5-part episode script
 *   Pass B (Architect) — 9-type scene AI prompt suites
 *   Pass C (Pilot)     — audio plan + platform assets (all 5 platforms)
 *   Pass D (Pilot)     — virality score (overall computed here, not by LLM)
 *
 * Followed by a deterministic quality gate (no LLM call).
 *
 * SINGLE-7B LOCK: every 7B model call routes through ModelOrchestrator.requestModel().
 * All Ollama responses: sanitizeReasoningOutput() then extractJson() (.data field).
 */

import { z } from "zod";
import { ModelOrchestrator } from "./model-orchestrator.js";
import { generateOllamaText } from "./ollama.js";
import { sanitizeReasoningOutput, extractJson } from "./reasoning-sanitizer.js";
import { resolveCanonicalTag } from "@swarmx/types/operator-map";
import {
  getSeries,
  setPreProduction,
  patchPreProduction,
  updateEpisodePassStatus,
} from "./series-registry.js";
import { log } from "../lib/logger.js";
import type {
  SeriesJob,
  EpisodeScript,
  ScenePromptSuite,
  AudioPlan,
  PlatformPublishingAsset,
  EpisodeViralityScore,
  QualityGateResult,
  QualityGateCheckItem,
  EpisodePreProduction,
  ContinuityReport,
} from "@swarmx/types/series-types";

// ─── Model tags ───────────────────────────────────────────────────────────────

const PILOT_TAG     = resolveCanonicalTag("instruct-phi4-pro-q8-prod");
const ARCHITECT_TAG = resolveCanonicalTag("plan-qwen25-pro-q5km-prod");

// ─── Virality formula constants (CLAUDE.md invariant — never alter weights) ──

const VIRALITY_WEIGHTS = { hookStrength: 0.35, completionProxy: 0.25, shareability: 0.25, seoScore: 0.15 } as const;

// ─── Narration style coherence table (spec Phase 8, AUDIO_COHERENCE) ─────────

const NARRATION_STYLE_BY_TONE: Record<string, AudioPlan["narrationStyle"][]> = {
  educational:    ["authoritative", "intimate"],
  urgent:         ["authoritative", "conspiratorial"],
  warm:           ["intimate", "poetic"],
  contrarian:     ["conspiratorial", "authoritative"],
  cinematic:      ["poetic", "intimate"],
  minimal:        ["intimate", "poetic"],
  faceless_broll: ["intimate", "authoritative"],
  kinetic_text:   ["authoritative", "conspiratorial"],
};

// ─── Hook quality constraints ─────────────────────────────────────────────────

const HOOK_BLOCKLIST = [
  "welcome back", "in this video", "make sure to", "don't forget to", "stay tuned",
  "as i mentioned", "like i said", "before we begin", "quick disclaimer",
  "in today's episode", "you're not going to believe",
  "in today's video", "welcome to", "hi everyone", "today we", "let's",
  "we're going to",
];

// ─── LLM runner (mirrors planSeries pattern) ─────────────────────────────────

async function runPass(
  modelTag: string,
  prompt: string,
  maxTokens: number,
  signal: AbortSignal,
): Promise<string> {
  const mo = ModelOrchestrator.getInstance();
  const { modelTag: resolvedTag, keepAlive, overrides } = await mo.requestModel(modelTag);
  try {
    const raw = await generateOllamaText({
      model: resolvedTag,
      prompt,
      maxTokens,
      keepAlive,
      overrides,
      signal,
    });
    const { text } = sanitizeReasoningOutput(raw);
    return text;
  } finally {
    mo.onModelCallComplete(resolvedTag);
  }
}

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const EpisodeScriptSchema = z.object({
  hook: z.string().min(1),
  body: z.string().min(1),
  emotionalPeak: z.string().min(1),
  cliffhanger: z.object({
    type: z.enum(["REVELATION", "JEOPARDY", "MYSTERY", "IDENTITY", "CHOICE"]),
    text: z.string().min(1),
  }),
  transitionBridge: z.object({
    type: z.enum(["VISUAL_MATCH", "AUDIO_THREAD", "QUESTION_ECHO", "SMASH_CUT_TEASE", "LOOP_BRIDGE"]),
    description: z.string().min(1),
  }),
  sceneCount: z.number().int().min(1).default(3),
});

const ScenePromptSuiteSchema = z.object({
  sceneIndex: z.number().int().min(0),
  sceneTitle: z.string().min(1),
  master: z.string().min(1),
  character: z.string().min(1),
  environment: z.string().min(1),
  camera: z.string().min(1),
  lighting: z.string().min(1),
  motion: z.string().min(1),
  style: z.string().min(1),
  animation: z.string().min(1),
  negative: z.string().min(1),
});

const PassBSchema = z.object({
  scenes: z.array(ScenePromptSuiteSchema).min(1),
});

// V2.1 — structured per-character dialogue direction
const DialogueNoteSchema = z.object({
  characterName: z.string().min(1),
  emotion: z.string().min(1),
  subtext: z.string().min(1),
  deliveryInstruction: z.string().min(1),
  transitionType: z.enum(["J-cut", "L-cut", "musical-bridge", "silence-as-tension", "hard-cut"]),
});

const AudioPlanSchema = z.object({
  narrationStyle: z.enum(["intimate", "authoritative", "conspiratorial", "poetic"]),
  musicDescription: z.string().min(1),
  soundEffects: z.array(z.string()).default([]),
  silenceCues: z.array(z.string()).default([]),
  seriesSonicSignature: z.string().min(1),
  dialogueNotes: z.array(DialogueNoteSchema).optional(),
});

const PlatformAssetSchema = z.object({
  platform: z.enum(["tiktok", "reels", "youtube_shorts", "facebook", "x"]),
  title: z.string().min(1).max(100),
  seoDescription: z.string().min(1),
  caption: z.string().min(1),
  hashtags: z.array(z.string()).min(1).max(10),
  cta: z.string().min(1),
  thumbnailConcept: z.string().min(1),
  pinnedComment: z.string().min(1),
  soundSuggestion: z.string().min(1),
});

const PassCSchema = z.object({
  audioPlan: AudioPlanSchema,
  platformAssets: z.array(PlatformAssetSchema).min(1),
});

const PassDSchema = z.object({
  hookStrength: z.number().min(0).max(1),
  completionProxy: z.number().min(0).max(1),
  shareability: z.number().min(0).max(1),
  seoScore: z.number().min(0).max(1),
  recommendations: z.array(z.string()).min(1).max(6),
});

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildPassAPrompt(series: SeriesJob, episodeNumber: number): string {
  const entry = series.episodeRoadmap!.find((e) => e.episodeNumber === episodeNumber)!;
  const prev = series.episodeRoadmap!
    .filter((e) => e.episodeNumber < episodeNumber)
    .map((e) => `Ep${e.episodeNumber}: ${e.summary}`)
    .join(" | ");
  const characterNames = (series.characterBible ?? []).map((c) => c.name).join(", ");
  const durationSecs = series.brief.episodeDurationSeconds;
  const hookMaxWords = 18;
  const cliffhangerTypes = "REVELATION | JEOPARDY | MYSTERY | IDENTITY | CHOICE";
  const isFinale = episodeNumber === series.brief.seriesLength;
  const bridgeTypes = isFinale
    ? "LOOP_BRIDGE (REQUIRED for finale — final frame/sound echoes Episode 1 opening; makes viewer rewatch Ep1)"
    : "VISUAL_MATCH | AUDIO_THREAD | QUESTION_ECHO | SMASH_CUT_TEASE";

  return `You are a series director. Write the five-part script for Episode ${episodeNumber} of ${series.brief.seriesLength}.

SERIES BRIEF:
Theme: ${series.brief.storyTheme}
Tone: ${series.brief.tone}
Platform: ${series.brief.platformPrimary}
Episode duration: ${durationSecs} seconds
Total episodes: ${series.brief.seriesLength}

THIS EPISODE (${episodeNumber}/${series.brief.seriesLength}):
Title: "${entry.title}"
Story advance: ${entry.summary}
Continuity thread: ${entry.continuityThread}
${entry.chekhovGun ? `Chekhov's gun to plant: ${entry.chekhovGun}` : ""}

Characters: ${characterNames || "narrator only"}
Previous episode summaries: ${prev || "none (this is episode 1)"}

MANDATORY SCRIPT RULES:
- hook: ≤ ${hookMaxWords} words; NEVER starts with: "In today's video", "Welcome", "Hi everyone", "Today we", "I", "My", "This video", "Let's", "We're going to"
- hook position: Ep1 → PREMISE HOOK: one line stating the universe's central promise; Ep2–${series.brief.seriesLength - 1} → CONTINUATION HOOK: drop viewer INTO action, assume they know the world; Ep${series.brief.seriesLength} → PAYOFF HOOK: the hook IS the resolution — earned, not explained
- body: escalate stakes or deepen understanding; tag visual moments as [VISUAL: subject · motion · setting · mood · quality]; reference prior episodes via visual echo only — never narrate what happened; body advances, never recaps
- emotionalPeak: ONE dominant emotion moment (tension OR revelation OR humour OR inspiration OR grief OR wonder) — pick one and commit
- cliffhanger type must be one of: ${cliffhangerTypes} — end on the unresolved state, NEVER say "find out next time"
- transitionBridge: ${bridgeTypes}
- sceneCount: how many distinct visual scenes this script contains (min 2, max 6)
${isFinale ? `\nFINALE RULES (Episode ${episodeNumber} — series end):\n- transitionBridge.type MUST be "LOOP_BRIDGE"\n- transitionBridge.description must describe how the final frame or sound echoes Episode 1's opening composition\n- This is NOT a cliffhanger — it is a loop trigger designed to make the viewer immediately rewatch Episode 1` : ""}

Respond with STRICT JSON only:
{
  "hook": "...",
  "body": "...",
  "emotionalPeak": "...",
  "cliffhanger": {
    "type": "REVELATION",
    "text": "..."
  },
  "transitionBridge": {
    "type": ${isFinale ? '"LOOP_BRIDGE"' : '"VISUAL_MATCH"'},
    "description": "${isFinale ? `the final frame holds on the same composition as Episode 1's opening — colour grade, framing, and subject position are identical; the series loops` : `the last frame mirrors the color and framing of episode ${episodeNumber + 1}'s opening`}"
  },
  "sceneCount": 3
}`;
}

function buildPassBPrompt(
  series: SeriesJob,
  episodeNumber: number,
  script: EpisodeScript,
): string {
  const isSolo = (series.characterBible ?? []).length === 0 || series.brief.soloFormat;
  const characterSeeds = isSolo
    ? "SOLO FORMAT — narrator only; no on-camera characters; skip aiPromptSeed"
    : (series.characterBible ?? []).map((c) => `${c.name}: "${c.aiPromptSeed}"`).join("\n");
  const colorPalette = series.worldGuide?.colorPalette.join(", ") ?? "neutral tones";
  const defaultLens = series.worldGuide?.cameraLanguage.defaultLens ?? "35mm standard";
  const shotGrammar = series.worldGuide?.cameraLanguage.shotGrammarRules ?? "follow the emotion";
  const lightingDefault = series.worldGuide?.keyLocations[0]?.lightingDefault ?? "natural key";
  const colorGrade = series.worldGuide?.colorGradeContract;
  const architecture = series.worldGuide?.architecture ?? "contemporary";

  return `You are a cinematographer and AI prompt engineer. Generate a complete 9-type scene prompt suite for each scene in this episode.

EPISODE ${episodeNumber}: "${series.episodeRoadmap!.find((e) => e.episodeNumber === episodeNumber)!.title}"
Tone: ${series.brief.tone}
Script summary: HOOK: "${script.hook}" | BODY: "${script.body.slice(0, 100)}..." | CLIFFHANGER: "${script.cliffhanger.text}"
Scene count: ${script.sceneCount}

CHARACTER AI SEEDS (copy verbatim into every character prompt):
${characterSeeds || "narrator only — no on-camera characters"}

SERIES VISUAL LANGUAGE:
Color palette: ${colorPalette}
Camera grammar: ${shotGrammar}
Default lens: ${defaultLens}
Lighting default: ${lightingDefault}
Architecture: ${architecture}
${colorGrade ? `Color grade: shadow ${colorGrade.shadowTone}, highlight ${colorGrade.highlight}, ${colorGrade.saturation}, ${colorGrade.filmEmulation}` : ""}

PROMPT RULES:
- master: ≤ 150 words; complete self-contained scene; include subject, action, environment, lighting, camera, motion, quality
- character: ${isSolo ? 'set to "narrator only — no on-camera characters" for every scene; do NOT include any character description' : "copy AI seed verbatim + scene-specific expression/costume delta only"}
- environment: location + time-of-day + weather + atmosphere
- camera: shot type (ECU/CU/MCU/MS/MWS/WS/EWS/aerial/POV/OTS) + movement (static|push-in|pull-back|pan-L/R|tilt-U/D|dolly|crane|handheld|Steadicam|whip-pan|Dutch-angle) + lens (16mm-wide|35mm-std|50mm-natural|85mm-portrait|telephoto-compressed|macro) + depth-of-field (shallow|deep|rack-focus) + framing (rule-of-thirds|centred-symmetry|negative-space|leading-lines)
- lighting: key light + colour-temp (2700K-warm|4000K-neutral|6500K-cool|split-gel) + contrast + motivation
- motion: all movement in frame — camera, subject, elements
- style: aesthetic — cinematic grain | clean digital | graphic novel | documentary
- animation: frame rate, physics, particle effects if applicable; else "static scene — no keyframe animation"
- negative: exclude: blurry, watermark, duplicate limbs, text overlay, low resolution, distorted face, wrong costume, anachronistic props

Respond with STRICT JSON only:
{
  "scenes": [
    {
      "sceneIndex": 0,
      "sceneTitle": "brief scene descriptor",
      "master": "...",
      "character": "...",
      "environment": "...",
      "camera": "...",
      "lighting": "...",
      "motion": "...",
      "style": "...",
      "animation": "...",
      "negative": "..."
    }
  ]
}`;
}

function buildPassCPrompt(
  series: SeriesJob,
  episodeNumber: number,
  script: EpisodeScript,
): string {
  const platform = series.brief.platformPrimary;
  const tone = series.brief.tone;
  const sonicSig = series.worldGuide?.soundSignature ?? "ambient texture";

  return `You are an audio architect and social media strategist. Generate an audio plan and platform publishing assets for Episode ${episodeNumber}.

EPISODE: "${series.episodeRoadmap!.find((e) => e.episodeNumber === episodeNumber)!.title}"
Series theme: ${series.brief.storyTheme}
Tone: ${tone}
Platform primary: ${platform}
Episode duration: ${series.brief.episodeDurationSeconds}s
Hook: "${script.hook}"
Emotional peak: "${script.emotionalPeak}"
Series sonic signature: "${sonicSig}"

AUDIO PLAN RULES:
- narrationStyle: one of: intimate | authoritative | conspiratorial | poetic
- musicDescription: genre + tempo + instrumentation + emotional function
- soundEffects: list specific timed effects (not generic)
- silenceCues: list specific moments where silence is the audio design
- dialogueNotes: optional array; one object per significant character line; each object: { "characterName": "...", "emotion": "...", "subtext": "...", "deliveryInstruction": "...", "transitionType": "J-cut | L-cut | musical-bridge | silence-as-tension | hard-cut" }
- seriesSonicSignature: the recurring audio element that appears every episode

PLATFORM ASSET RULES:
- title: ≤ 60 chars; front-load search keyword
- seoDescription: 120–160 chars; for search preview
- caption: full TikTok-style caption; firstLine ≤ 40 chars; never starts with I/My/This/We/Our
- hashtags: exactly 3–5; no #fyp or #viral as standalone; at least 1 niche; at most 1 trending
- cta: exactly 5–8 words; specific to series narrative; never "like and subscribe"
- thumbnailConcept: frame + text overlay description + colour contrast
- pinnedComment: what to pin to seed discussion; asks a specific question
- soundSuggestion: describe audio mood/tempo/feel only — NEVER include URLs, artist names, or song titles
- Generate assets for ALL FIVE platforms: tiktok, reels, youtube_shorts, facebook, x

Respond with STRICT JSON only:
{
  "audioPlan": {
    "narrationStyle": "intimate",
    "musicDescription": "...",
    "soundEffects": ["..."],
    "silenceCues": ["..."],
    "seriesSonicSignature": "${sonicSig}",
    "dialogueNotes": [{ "characterName": "...", "emotion": "...", "subtext": "...", "deliveryInstruction": "...", "transitionType": "J-cut" }]
  },
  "platformAssets": [
    {
      "platform": "tiktok",
      "title": "...",
      "seoDescription": "...",
      "caption": "...",
      "hashtags": ["#example","#niche"],
      "cta": "5 to 8 words here",
      "thumbnailConcept": "...",
      "pinnedComment": "...",
      "soundSuggestion": "upbeat electronic tempo, building tension"
    },
    { "platform": "reels", ... },
    { "platform": "youtube_shorts", ... },
    { "platform": "facebook", ... },
    { "platform": "x", ... }
  ]
}`;
}

function buildPassDPrompt(
  series: SeriesJob,
  episodeNumber: number,
  script: EpisodeScript,
): string {
  const entry = series.episodeRoadmap!.find((e) => e.episodeNumber === episodeNumber)!;
  return `You are a virality analyst. Score this episode on four dimensions and give 2–4 actionable improvement recommendations.

EPISODE ${episodeNumber}: "${entry.title}"
Tone: ${series.brief.tone}
Platform: ${series.brief.platformPrimary}
Hook (first 3 seconds): "${script.hook}"
Body summary: "${script.body.slice(0, 150)}..."
Emotional peak: "${script.emotionalPeak}"
Cliffhanger: "${script.cliffhanger.text}"

SCORING RUBRIC:
hookStrength (0–1): scroll-stop power of the first 3 seconds; < 0.5 = weak
completionProxy (0–1): incentive to watch every second; 0 if any scene could be skipped without loss
shareability (0–1): "this is so [person]" trigger; one moment per episode
seoScore (0–1): title/description/hashtag alignment with search intent for ${series.brief.platformPrimary}

Respond with STRICT JSON only:
{
  "hookStrength": 0.82,
  "completionProxy": 0.74,
  "shareability": 0.68,
  "seoScore": 0.71,
  "recommendations": [
    "specific actionable improvement 1",
    "specific actionable improvement 2"
  ]
}`;
}

// ─── Quality gate (pure function — no LLM) ───────────────────────────────────

export function evaluateQualityGate(
  series: SeriesJob,
  episodeNumber: number,
  script: EpisodeScript,
  prompts: ScenePromptSuite[],
  audioPlan: AudioPlan,
  assets: PlatformPublishingAsset[],
  viralityScore: EpisodeViralityScore,
): QualityGateResult {
  const checks: QualityGateCheckItem[] = [];

  const check = (
    category: QualityGateCheckItem["category"],
    label: string,
    passed: boolean,
    detail?: string,
  ) => checks.push({ category, label, passed, ...(detail ? { detail } : {}) });

  // ── STORY_INTEGRITY ────────────────────────────────────────────────────────
  const roadmapEntry = series.episodeRoadmap?.find((e) => e.episodeNumber === episodeNumber);
  check("STORY_INTEGRITY", "Roadmap entry exists", !!roadmapEntry);
  check("STORY_INTEGRITY", "All 5 script sections populated",
    !!(script.hook && script.body && script.emotionalPeak && script.cliffhanger.text && script.transitionBridge.description));
  check("STORY_INTEGRITY", "Cliffhanger type is valid",
    ["REVELATION", "JEOPARDY", "MYSTERY", "IDENTITY", "CHOICE"].includes(script.cliffhanger.type));

  // V2.1 — finale must use LOOP_BRIDGE; non-finale must NOT use LOOP_BRIDGE
  const isFinaleEp = episodeNumber === series.brief.seriesLength;
  if (isFinaleEp) {
    check("STORY_INTEGRITY", "Finale transition bridge is LOOP_BRIDGE",
      script.transitionBridge.type === "LOOP_BRIDGE",
      script.transitionBridge.type !== "LOOP_BRIDGE"
        ? `Episode ${episodeNumber} is the finale — transitionBridge.type must be "LOOP_BRIDGE", got "${script.transitionBridge.type}"`
        : undefined);
  } else {
    check("STORY_INTEGRITY", "Non-finale bridge is not LOOP_BRIDGE",
      script.transitionBridge.type !== "LOOP_BRIDGE",
      script.transitionBridge.type === "LOOP_BRIDGE"
        ? `Episode ${episodeNumber} is not the finale — LOOP_BRIDGE is only valid for Episode ${series.brief.seriesLength}`
        : undefined);
  }

  // ── CREATIVE_QUALITY ───────────────────────────────────────────────────────
  const hookWords = script.hook.trim().split(/\s+/).length;
  check("CREATIVE_QUALITY", `Hook ≤ 18 words (actual: ${hookWords})`, hookWords <= 18,
    hookWords > 18 ? `Hook is ${hookWords} words — must be trimmed to ≤ 18` : undefined);

  const hookLower = script.hook.trim().toLowerCase();
  const blockedPhrase = HOOK_BLOCKLIST.find((phrase) => hookLower.startsWith(phrase));
  check("CREATIVE_QUALITY", "Hook passes HOOK_BLOCKLIST", !blockedPhrase,
    blockedPhrase ? `Hook starts with blocked phrase: "${blockedPhrase}"` : undefined);

  const primaryAsset = assets.find((a) => a.platform === series.brief.platformPrimary);
  const ctaWords = primaryAsset ? primaryAsset.cta.trim().split(/\s+/).length : 0;
  check("CREATIVE_QUALITY", `CTA is 5–8 words (actual: ${ctaWords})`,
    ctaWords >= 5 && ctaWords <= 8,
    primaryAsset ? undefined : "No primary platform asset found");

  check("CREATIVE_QUALITY", "Virality overall ≥ 0.65",
    viralityScore.overall >= 0.65,
    viralityScore.overall < 0.65
      ? `Overall score is ${viralityScore.overall.toFixed(2)} — must be ≥ 0.65`
      : undefined);

  // Gap 2 — hookStrength < 0.5 → hard fail (spec: "< 0.5 → rewrite the hook")
  check(
    "CREATIVE_QUALITY",
    `Hook strength ≥ 0.5 (actual: ${viralityScore.hookStrength.toFixed(2)})`,
    viralityScore.hookStrength >= 0.5,
    viralityScore.hookStrength < 0.5
      ? `hookStrength ${viralityScore.hookStrength.toFixed(2)} — rewrite the hook before delivery`
      : undefined,
  );

  // Gap 3 — virality hard floor 0.55 (separate from 0.65 soft minimum)
  check(
    "CREATIVE_QUALITY",
    `Virality hard floor ≥ 0.55 (actual: ${viralityScore.overall.toFixed(2)})`,
    viralityScore.overall >= 0.55,
    viralityScore.overall < 0.55
      ? `Overall ${viralityScore.overall.toFixed(2)} is below the 0.55 hard floor — episode must be revised`
      : undefined,
  );

  // ── VISUAL_CONSISTENCY ─────────────────────────────────────────────────────
  const allNineFields = prompts.every((s) =>
    s.master && s.character && s.environment && s.camera &&
    s.lighting && s.motion && s.style && s.animation && s.negative,
  );
  check("VISUAL_CONSISTENCY", "All 9 prompt types populated for each scene", allNineFields);

  check(
    "VISUAL_CONSISTENCY",
    `Scene prompt count matches script sceneCount (${script.sceneCount})`,
    prompts.length === script.sceneCount,
    prompts.length !== script.sceneCount
      ? `Expected ${script.sceneCount} scene prompts, got ${prompts.length}`
      : undefined,
  );

  const sceneLabelsContiguous = prompts.every(
    (scene, index) =>
      scene.sceneIndex === index &&
      scene.sceneLabel === `SCENE [${episodeNumber}.${index}]`,
  );
  check(
    "VISUAL_CONSISTENCY",
    "Scene indices and labels are contiguous",
    sceneLabelsContiguous,
    !sceneLabelsContiguous ? `Expected labels SCENE [${episodeNumber}.0..${Math.max(0, prompts.length - 1)}]` : undefined,
  );

  const characterNames = (series.characterBible ?? []).map((c) => c.name.toLowerCase());
  const seedPresent = characterNames.length === 0 ||
    prompts.some((s) => characterNames.some((name) => s.character.toLowerCase().includes(name)));
  check("VISUAL_CONSISTENCY", "Character AI seed present in scene prompts", seedPresent,
    !seedPresent ? "No character name found in any scene character prompt" : undefined);

  const exactSeedPreserved = (series.characterBible ?? []).length === 0 ||
    prompts.every((scene) =>
      (series.characterBible ?? []).some((character) =>
        scene.character.includes(character.aiPromptSeed),
      ),
    );
  check(
    "VISUAL_CONSISTENCY",
    "Exact character aiPromptSeed preserved in every character scene prompt",
    exactSeedPreserved,
    !exactSeedPreserved ? "At least one scene prompt omits the exact character aiPromptSeed" : undefined,
  );

  // ── PRODUCTION_READINESS ───────────────────────────────────────────────────
  check("PRODUCTION_READINESS", "Audio plan has required fields",
    !!(audioPlan.narrationStyle && audioPlan.musicDescription && audioPlan.seriesSonicSignature));

  check("PRODUCTION_READINESS", "Assets present for all 5 platforms",
    ["tiktok", "reels", "youtube_shorts", "facebook", "x"].every(
      (p) => assets.some((a) => a.platform === p),
    ));

  const urlRegex = /https?:\/\/|www\.|spotify|soundcloud|apple music/i;
  const badSound = assets.find((a) => urlRegex.test(a.soundSuggestion));
  check("PRODUCTION_READINESS", "soundSuggestion contains no URLs or streaming links", !badSound,
    badSound ? `Platform ${badSound.platform} soundSuggestion contains a URL or streaming link` : undefined);

  // V6.2.26 — mirror caption-generator.validateCaptionDraft artist-pattern rule.
  // Prevents cross-platform assets from smuggling artist attribution into the
  // audio suggestion, which downstream publishing would flag as a copyright risk.
  const artistRegex = /\b(feat\.?|ft\.?|by\s+[A-Z][a-z]+|"[^"]+"|song|track|album)\b/;
  const artistSound = assets.find((a) => artistRegex.test(a.soundSuggestion));
  check("PRODUCTION_READINESS", "soundSuggestion contains no artist or track attribution", !artistSound,
    artistSound ? `Platform ${artistSound.platform} soundSuggestion names a song/track/artist` : undefined);

  // Caption firstLine ≤ 40 chars — check primary platform
  if (primaryAsset) {
    const firstLine = primaryAsset.caption.split("\n")[0] ?? "";
    check("PRODUCTION_READINESS", `Caption firstLine ≤ 40 chars (actual: ${firstLine.length})`,
      firstLine.length <= 40,
      firstLine.length > 40 ? `"${firstLine.slice(0, 44)}…" is ${firstLine.length} chars` : undefined);

    const hashCount = primaryAsset.hashtags.length;
    check("PRODUCTION_READINESS", `Hashtag count 3–5 (actual: ${hashCount})`,
      hashCount >= 3 && hashCount <= 5);

    // Count emojis via Unicode property
    const emojiCount = (primaryAsset.caption.match(/\p{Emoji_Presentation}/gu) ?? []).length;
    check("PRODUCTION_READINESS", `Emoji count ≤ 3 (actual: ${emojiCount})`, emojiCount <= 3);

    // Gap 4 — Caption firstLine opener (spec CAPTION_RULES: never I/My/This/We/Our)
    const captionFirstLine = primaryAsset.caption.split("\n")[0] ?? "";
    const CAPTION_OPENER_BLOCKLIST = ["i ", "i'", "my ", "this ", "we ", "our "];
    const badOpener = CAPTION_OPENER_BLOCKLIST.find((w) =>
      captionFirstLine.toLowerCase().startsWith(w),
    );
    check(
      "PRODUCTION_READINESS",
      "Caption firstLine does not start with I/My/This/We/Our",
      !badOpener,
      badOpener ? `Caption firstLine starts with blocked opener "${captionFirstLine.slice(0, 20)}…"` : undefined,
    );

    // Gap 5 — Platform title ≤ 60 chars
    const titleLen = primaryAsset.title.length;
    check(
      "PRODUCTION_READINESS",
      `Platform title ≤ 60 chars (actual: ${titleLen})`,
      titleLen <= 60,
      titleLen > 60 ? `Title is ${titleLen} chars — must be trimmed to ≤ 60` : undefined,
    );

    // Gap 6 — SEO description 120–160 chars
    const seoLen = primaryAsset.seoDescription.length;
    check(
      "PRODUCTION_READINESS",
      `SEO description 120–160 chars (actual: ${seoLen})`,
      seoLen >= 120 && seoLen <= 160,
      seoLen < 120
        ? `SEO description is ${seoLen} chars — must be ≥ 120`
        : seoLen > 160 ? `SEO description is ${seoLen} chars — must be ≤ 160` : undefined,
    );

    // Gap 7 — Full caption ≤ 2,200 chars (TikTok hard cap)
    const captionLen = primaryAsset.caption.length;
    check(
      "PRODUCTION_READINESS",
      `Full caption ≤ 2,200 chars (actual: ${captionLen})`,
      captionLen <= 2200,
      captionLen > 2200 ? `Caption is ${captionLen} chars — TikTok hard cap is 2,200` : undefined,
    );

    // Gap 8 — In-feed visible ≤ 280 chars (first paragraph, before double-newline)
    const inFeedVisible = primaryAsset.caption.split("\n\n")[0]?.length ?? captionLen;
    check(
      "PRODUCTION_READINESS",
      `In-feed visible text ≤ 280 chars (actual: ${inFeedVisible})`,
      inFeedVisible <= 280,
      inFeedVisible > 280 ? `In-feed first paragraph is ${inFeedVisible} chars — soft cap is 280` : undefined,
    );
  }

  // ── AUDIO_COHERENCE ────────────────────────────────────────────────────────

  // Gap 1a — Sonic signature echoes worldGuide.soundSignature (first-3-word check)
  const worldSonicSig = series.worldGuide?.soundSignature ?? "";
  const worldSigWords = worldSonicSig.split(" ").slice(0, 3).join(" ").toLowerCase();
  const sonicSigPresent = worldSonicSig.length === 0 ||
    audioPlan.seriesSonicSignature.toLowerCase().includes(worldSigWords);
  check(
    "AUDIO_COHERENCE",
    "Series sonic signature consistent with worldGuide.soundSignature",
    sonicSigPresent,
    !sonicSigPresent
      ? `audioPlan.seriesSonicSignature does not echo worldGuide.soundSignature ("${worldSonicSig.slice(0, 40)}")`
      : undefined,
  );

  // Gap 1b — Narration style coherent with series tone
  const allowedStyles = NARRATION_STYLE_BY_TONE[series.brief.tone] ?? [];
  const narrationCoherent = allowedStyles.length === 0 ||
    allowedStyles.includes(audioPlan.narrationStyle);
  check(
    "AUDIO_COHERENCE",
    `Narration style coherent with tone "${series.brief.tone}" (actual: ${audioPlan.narrationStyle})`,
    narrationCoherent,
    !narrationCoherent
      ? `"${audioPlan.narrationStyle}" not valid for tone "${series.brief.tone}"; expected: ${allowedStyles.join(", ")}`
      : undefined,
  );

  // Gap 1c — Silence cues required for episodes ≥ 30s
  const durationSecs = series.brief.episodeDurationSeconds;
  check(
    "AUDIO_COHERENCE",
    `Silence cues present (${durationSecs >= 30 ? "required" : "optional"} for ${durationSecs}s)`,
    durationSecs < 30 || audioPlan.silenceCues.length >= 1,
    durationSecs >= 30 && audioPlan.silenceCues.length === 0
      ? `Episode is ${durationSecs}s — spec requires at least 1 intentional silence cue`
      : undefined,
  );

  return { passed: checks.every((c) => c.passed), checks };
}

// ─── Continuity Report Builder (pure function — no LLM calls) ────────────────

export function buildContinuityReport(
  series: SeriesJob,
  episodeNumber: number,
  script: EpisodeScript,
  prompts: ScenePromptSuite[],
  audioPlan: AudioPlan,
): ContinuityReport {
  const entry = series.episodeRoadmap?.find((e) => e.episodeNumber === episodeNumber);

  const characterDriftChecks = (series.characterBible ?? []).map((char) => {
    const nameLower = char.name.toLowerCase();
    const seedPrefix = char.aiPromptSeed.toLowerCase().slice(0, 60);
    const seedPresentInPrompts = prompts.some((p) =>
      p.character.toLowerCase().includes(nameLower) ||
      p.character.toLowerCase().includes(seedPrefix),
    );
    const speakingStyleNoted = (audioPlan.dialogueNotes ?? []).some((note) =>
      note.characterName.toLowerCase() === nameLower,
    );
    return { characterName: char.name, seedPresentInPrompts, speakingStyleNoted };
  });

  const worldDriftCheck = {
    colorPaletteReferenced: (series.worldGuide?.colorPalette ?? []).some((color) =>
      prompts.some((p) =>
        p.style.toLowerCase().includes(color.toLowerCase()) ||
        p.lighting.toLowerCase().includes(color.toLowerCase()),
      ),
    ),
    soundSignaturePresent: (series.worldGuide?.soundSignature?.length ?? 0) > 0 &&
      audioPlan.seriesSonicSignature.length > 0,
    locationUsed: (series.worldGuide?.keyLocations ?? []).length === 0 ||
      prompts.some((p) =>
        (series.worldGuide!.keyLocations).some((loc) =>
          p.environment.toLowerCase().includes(loc.name.toLowerCase()),
        ),
      ),
  };

  const threadKeyword = (entry?.continuityThread ?? "").toLowerCase().split(" ")[0] ?? "";
  const plotThreadStatus = {
    continuityThreadAddressed: !threadKeyword || (
      script.body.toLowerCase().includes(threadKeyword) ||
      script.emotionalPeak.toLowerCase().includes(threadKeyword)
    ),
    chekhovGunPlanted: !entry?.chekhovGun ||
      script.body.toLowerCase().includes(
        entry.chekhovGun.toLowerCase().split(" ").slice(0, 2).join(" "),
      ),
    transitionBridgeSpecified: script.transitionBridge.description.length > 0,
  };

  const transitionBridgeConfirmed = script.transitionBridge.description.length > 0;

  const overallContinuityPassed =
    (characterDriftChecks.length === 0 || characterDriftChecks.every((c) => c.seedPresentInPrompts)) &&
    worldDriftCheck.colorPaletteReferenced &&
    worldDriftCheck.soundSignaturePresent &&
    plotThreadStatus.continuityThreadAddressed &&
    plotThreadStatus.chekhovGunPlanted &&
    plotThreadStatus.transitionBridgeSpecified &&
    transitionBridgeConfirmed;

  return {
    characterDriftChecks,
    worldDriftCheck,
    plotThreadStatus,
    transitionBridgeConfirmed,
    overallContinuityPassed,
  };
}

// ─── Exported pass functions ──────────────────────────────────────────────────

/**
 * Pass A — Architect → 5-part episode script.
 * Can be called independently for per-pass re-runs.
 * Prerequisite: preProduction entry must exist in the registry.
 */
export async function runPassAScript(seriesId: string, episodeNumber: number): Promise<boolean> {
  const series = getSeries(seriesId);
  if (!series) {
    log.warn({ seriesId, episodeNumber }, "passA: series not found");
    return false;
  }
  const entry = series.episodeRoadmap?.find((e) => e.episodeNumber === episodeNumber);
  if (!entry) {
    log.warn({ seriesId, episodeNumber }, "passA: episode not in roadmap");
    patchPreProduction(seriesId, episodeNumber, {
      status: "failed",
      errorCode: "EPISODE_NOT_FOUND",
      error: `Episode ${episodeNumber} not found in series roadmap`,
    });
    return false;
  }

  updateEpisodePassStatus(seriesId, episodeNumber, "passA", "running");
  const ac = new AbortController();
  try {
    log.info({ seriesId, episodeNumber, pass: "A" }, "preproducer: Pass A (episode script)");
    const raw = await runPass(ARCHITECT_TAG, buildPassAPrompt(series, episodeNumber), 1500, ac.signal);
    const parsed = EpisodeScriptSchema.safeParse(extractJson<unknown>(raw).data);
    if (!parsed.success) {
      const msg = `Pass A JSON invalid: ${parsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass A failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_A_INVALID_JSON", error: msg });
      updateEpisodePassStatus(seriesId, episodeNumber, "passA", "failed");
      return false;
    }
    patchPreProduction(seriesId, episodeNumber, { script: parsed.data as EpisodeScript, status: "prompting" });
    updateEpisodePassStatus(seriesId, episodeNumber, "passA", "complete");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, episodeNumber, err: msg }, "preproducer: Pass A error");
    patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_A_EXECUTION_FAILED", error: msg });
    updateEpisodePassStatus(seriesId, episodeNumber, "passA", "failed");
    return false;
  }
}

/**
 * Pass B — Architect → scene AI prompt suites.
 * Prerequisite: Pass A complete (script present in preProduction).
 */
export async function runPassBPrompts(seriesId: string, episodeNumber: number): Promise<boolean> {
  const series = getSeries(seriesId);
  const script = series?.preProduction?.[episodeNumber]?.script;
  if (!series || !script) {
    log.warn({ seriesId, episodeNumber }, "passB: missing series or Pass A script");
    return false;
  }

  updateEpisodePassStatus(seriesId, episodeNumber, "passB", "running");
  const ac = new AbortController();
  try {
    log.info({ seriesId, episodeNumber, pass: "B" }, "preproducer: Pass B (scene prompts)");
    const raw = await runPass(ARCHITECT_TAG, buildPassBPrompt(series, episodeNumber, script), 2000, ac.signal);
    const parsed = PassBSchema.safeParse(extractJson<unknown>(raw).data);
    if (!parsed.success) {
      const msg = `Pass B JSON invalid: ${parsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass B failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_B_INVALID_JSON", error: msg });
      updateEpisodePassStatus(seriesId, episodeNumber, "passB", "failed");
      return false;
    }
    const scenePrompts: ScenePromptSuite[] = parsed.data.scenes.map((scene) => ({
      ...scene,
      sceneLabel: `SCENE [${episodeNumber}.${scene.sceneIndex}]`,
    }));
    patchPreProduction(seriesId, episodeNumber, { scenePrompts, status: "audio_assets" });
    updateEpisodePassStatus(seriesId, episodeNumber, "passB", "complete");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, episodeNumber, err: msg }, "preproducer: Pass B error");
    patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_B_EXECUTION_FAILED", error: msg });
    updateEpisodePassStatus(seriesId, episodeNumber, "passB", "failed");
    return false;
  }
}

/**
 * Pass C — Pilot → audio plan + platform assets (all 5 platforms).
 * Prerequisite: Pass A complete (script present).
 */
export async function runPassCAudioAssets(seriesId: string, episodeNumber: number): Promise<boolean> {
  const series = getSeries(seriesId);
  const script = series?.preProduction?.[episodeNumber]?.script;
  if (!series || !script) {
    log.warn({ seriesId, episodeNumber }, "passC: missing series or Pass A script");
    return false;
  }

  updateEpisodePassStatus(seriesId, episodeNumber, "passC", "running");
  const ac = new AbortController();
  try {
    log.info({ seriesId, episodeNumber, pass: "C" }, "preproducer: Pass C (audio + assets)");
    const raw = await runPass(PILOT_TAG, buildPassCPrompt(series, episodeNumber, script), 1000, ac.signal);
    const parsed = PassCSchema.safeParse(extractJson<unknown>(raw).data);
    if (!parsed.success) {
      const msg = `Pass C JSON invalid: ${parsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass C failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_C_INVALID_JSON", error: msg });
      updateEpisodePassStatus(seriesId, episodeNumber, "passC", "failed");
      return false;
    }
    const audioPlan = parsed.data.audioPlan as AudioPlan;
    const platformAssets = parsed.data.platformAssets as PlatformPublishingAsset[];
    patchPreProduction(seriesId, episodeNumber, { audioPlan, platformAssets, status: "scoring" });
    updateEpisodePassStatus(seriesId, episodeNumber, "passC", "complete");
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, episodeNumber, err: msg }, "preproducer: Pass C error");
    patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_C_EXECUTION_FAILED", error: msg });
    updateEpisodePassStatus(seriesId, episodeNumber, "passC", "failed");
    return false;
  }
}

/**
 * Pass D — Pilot → virality score + quality gate + continuity report.
 * Prerequisite: Passes A, B, C complete.
 * Terminal pass — writes "complete" or "failed" episode status.
 */
export async function runPassDScoring(seriesId: string, episodeNumber: number): Promise<void> {
  const series = getSeries(seriesId);
  const preProduction = series?.preProduction?.[episodeNumber];
  const script       = preProduction?.script;
  const scenePrompts = preProduction?.scenePrompts;
  const audioPlan    = preProduction?.audioPlan;
  const platformAssets = preProduction?.platformAssets;

  if (!series || !script || !scenePrompts || !audioPlan || !platformAssets) {
    log.warn({ seriesId, episodeNumber }, "passD: missing prerequisites (A, B, C)");
    return;
  }

  updateEpisodePassStatus(seriesId, episodeNumber, "passD", "running");
  const ac = new AbortController();
  try {
    log.info({ seriesId, episodeNumber, pass: "D" }, "preproducer: Pass D (virality score)");
    const raw = await runPass(PILOT_TAG, buildPassDPrompt(series, episodeNumber, script), 300, ac.signal);
    const parsed = PassDSchema.safeParse(extractJson<unknown>(raw).data);
    if (!parsed.success) {
      const msg = `Pass D JSON invalid: ${parsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass D failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_D_INVALID_JSON", error: msg });
      updateEpisodePassStatus(seriesId, episodeNumber, "passD", "failed");
      return;
    }
    const { hookStrength, completionProxy, shareability, seoScore, recommendations } = parsed.data;
    const overall =
      hookStrength * VIRALITY_WEIGHTS.hookStrength +
      completionProxy * VIRALITY_WEIGHTS.completionProxy +
      shareability * VIRALITY_WEIGHTS.shareability +
      seoScore * VIRALITY_WEIGHTS.seoScore;

    const viralityScore: EpisodeViralityScore = {
      hookStrength, completionProxy, shareability, seoScore,
      overall: Math.round(overall * 100) / 100,
      recommendations,
    };

    const seriesFinal = getSeries(seriesId) ?? series;
    const qualityGateResult = evaluateQualityGate(
      seriesFinal, episodeNumber, script, scenePrompts, audioPlan, platformAssets, viralityScore,
    );
    const continuityReport = buildContinuityReport(
      seriesFinal, episodeNumber, script, scenePrompts, audioPlan,
    );
    const gateFailure = qualityGateResult.passed
      ? undefined
      : "Mandatory episode quality gate failed. Review qualityGateResult before re-running revision.";

    patchPreProduction(seriesId, episodeNumber, {
      viralityScore,
      qualityGateResult,
      continuityReport,
      status: qualityGateResult.passed ? "complete" : "failed",
      ...(gateFailure ? { errorCode: "QUALITY_GATE_FAILED", error: gateFailure } : {}),
      ...(qualityGateResult.passed ? { completedAt: new Date().toISOString() } : {}),
    });
    updateEpisodePassStatus(seriesId, episodeNumber, "passD", qualityGateResult.passed ? "complete" : "failed");

    log.info(
      { seriesId, episodeNumber, overall: viralityScore.overall, gatePassed: qualityGateResult.passed },
      qualityGateResult.passed
        ? "preproducer: episode pre-production complete"
        : "preproducer: episode pre-production failed quality gate",
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, episodeNumber, err: msg }, "preproducer: Pass D error");
    patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PASS_D_EXECUTION_FAILED", error: msg });
    updateEpisodePassStatus(seriesId, episodeNumber, "passD", "failed");
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs the 4-pass episode pre-production pipeline for episode N of a series.
 * Fire-and-forget from the route handler — updates the series registry directly.
 */
export async function runEpisodePreProduction(
  seriesId: string,
  episodeNumber: number,
): Promise<void> {
  const series = getSeries(seriesId);
  if (!series) {
    log.warn({ seriesId, episodeNumber }, "preproducer: series not found");
    return;
  }
  if (!series.episodeRoadmap?.find((e) => e.episodeNumber === episodeNumber)) {
    log.warn({ seriesId, episodeNumber }, "preproducer: episode not in roadmap");
    patchPreProduction(seriesId, episodeNumber, {
      status: "failed",
      errorCode: "EPISODE_NOT_FOUND",
      error: `Episode ${episodeNumber} not found in series roadmap`,
    });
    return;
  }

  try {
    if (!await runPassAScript(seriesId, episodeNumber)) return;
    if (!await runPassBPrompts(seriesId, episodeNumber)) return;
    if (!await runPassCAudioAssets(seriesId, episodeNumber)) return;
    await runPassDScoring(seriesId, episodeNumber);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, episodeNumber, err: msg }, "preproducer: pipeline error");
    patchPreProduction(seriesId, episodeNumber, { status: "failed", errorCode: "PREPRODUCTION_PIPELINE_FAILED", error: msg });
  }
}
