/**
 * apps/swarmx-api/src/services/video-episode-preproducer.ts
 * SwarmXQ Series Engine V2.0 — Episode Pre-Production Pipeline
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
} from "@swarmx/types/series-types";

// ─── Model tags ───────────────────────────────────────────────────────────────

const PILOT_TAG     = resolveCanonicalTag("instruct-phi4-pro-q8-prod");
const ARCHITECT_TAG = resolveCanonicalTag("plan-qwen25-pro-q5km-prod");

// ─── Virality formula constants (CLAUDE.md invariant — never alter weights) ──

const VIRALITY_WEIGHTS = { hookStrength: 0.35, completionProxy: 0.25, shareability: 0.25, seoScore: 0.15 } as const;

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
    type: z.enum(["VISUAL_MATCH", "AUDIO_THREAD", "QUESTION_ECHO", "SMASH_CUT_TEASE"]),
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

const AudioPlanSchema = z.object({
  narrationStyle: z.enum(["intimate", "authoritative", "conspiratorial", "poetic"]),
  musicDescription: z.string().min(1),
  soundEffects: z.array(z.string()).default([]),
  silenceCues: z.array(z.string()).default([]),
  seriesSonicSignature: z.string().min(1),
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
  const bridgeTypes = "VISUAL_MATCH | AUDIO_THREAD | QUESTION_ECHO | SMASH_CUT_TEASE";

  return `You are a series script writer. Write the five-part script for Episode ${episodeNumber} of this series.

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
- body: every sentence escalates stakes or deepens understanding; active voice only
- emotionalPeak: ONE dominant emotion moment (tension OR revelation OR humour OR inspiration OR grief OR wonder) — pick one and commit
- cliffhanger type must be one of: ${cliffhangerTypes} — end on the unresolved state, NEVER say "find out next time"
- transitionBridge type must be one of: ${bridgeTypes}
- sceneCount: how many distinct visual scenes this script contains (min 2, max 6)

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
    "type": "VISUAL_MATCH",
    "description": "the last frame mirrors the color and framing of episode ${episodeNumber + 1}'s opening"
  },
  "sceneCount": 3
}`;
}

function buildPassBPrompt(
  series: SeriesJob,
  episodeNumber: number,
  script: EpisodeScript,
): string {
  const characterSeeds = (series.characterBible ?? [])
    .map((c) => `${c.name}: "${c.aiPromptSeed}"`)
    .join("\n");
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
- character: copy AI seed verbatim + scene-specific expression/costume delta only
- environment: location + time-of-day + weather + atmosphere
- camera: shot type (ECU/CU/MCU/MS/WS/EWS) + movement + lens + framing
- lighting: key light + colour temp + contrast + motivation
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
    "seriesSonicSignature": "${sonicSig}"
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

  // ── VISUAL_CONSISTENCY ─────────────────────────────────────────────────────
  const allNineFields = prompts.every((s) =>
    s.master && s.character && s.environment && s.camera &&
    s.lighting && s.motion && s.style && s.animation && s.negative,
  );
  check("VISUAL_CONSISTENCY", "All 9 prompt types populated for each scene", allNineFields);

  const characterNames = (series.characterBible ?? []).map((c) => c.name.toLowerCase());
  const seedPresent = characterNames.length === 0 ||
    prompts.some((s) => characterNames.some((name) => s.character.toLowerCase().includes(name)));
  check("VISUAL_CONSISTENCY", "Character AI seed present in scene prompts", seedPresent,
    !seedPresent ? "No character name found in any scene character prompt" : undefined);

  // ── PRODUCTION_READINESS ───────────────────────────────────────────────────
  check("PRODUCTION_READINESS", "Audio plan has required fields",
    !!(audioPlan.narrationStyle && audioPlan.musicDescription && audioPlan.seriesSonicSignature));

  check("PRODUCTION_READINESS", "Assets present for all 5 platforms",
    ["tiktok", "reels", "youtube_shorts", "facebook", "x"].every(
      (p) => assets.some((a) => a.platform === p),
    ));

  const urlRegex = /https?:\/\//i;
  const badSound = assets.find((a) => urlRegex.test(a.soundSuggestion));
  check("PRODUCTION_READINESS", "soundSuggestion contains no URLs", !badSound,
    badSound ? `Platform ${badSound.platform} soundSuggestion contains a URL` : undefined);

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
  }

  return { passed: checks.every((c) => c.passed), checks };
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

  const entry = series.episodeRoadmap?.find((e) => e.episodeNumber === episodeNumber);
  if (!entry) {
    log.warn({ seriesId, episodeNumber }, "preproducer: episode not in roadmap");
    patchPreProduction(seriesId, episodeNumber, {
      status: "failed",
      error: `Episode ${episodeNumber} not found in series roadmap`,
    });
    return;
  }

  const ac = new AbortController();

  try {
    // ── Pass A: Architect → 5-part episode script ─────────────────────────────
    log.info({ seriesId, episodeNumber, pass: "A" }, "preproducer: Pass A (episode script)");
    const passARaw = await runPass(
      ARCHITECT_TAG,
      buildPassAPrompt(series, episodeNumber),
      1500,
      ac.signal,
    );
    const passAResult = extractJson<unknown>(passARaw);
    const passAParsed = EpisodeScriptSchema.safeParse(passAResult.data);
    if (!passAParsed.success) {
      const msg = `Pass A JSON invalid: ${passAParsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass A failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", error: msg });
      return;
    }
    const script = passAParsed.data as EpisodeScript;
    patchPreProduction(seriesId, episodeNumber, { script, status: "prompting" });

    // ── Pass B: Architect → scene AI prompt suites ────────────────────────────
    log.info({ seriesId, episodeNumber, pass: "B" }, "preproducer: Pass B (scene prompts)");

    // Refresh series to get any registry changes after Pass A
    const seriesForB = getSeries(seriesId) ?? series;

    const passBRaw = await runPass(
      ARCHITECT_TAG,
      buildPassBPrompt(seriesForB, episodeNumber, script),
      2000,
      ac.signal,
    );
    const passBResult = extractJson<unknown>(passBRaw);
    const passBParsed = PassBSchema.safeParse(passBResult.data);
    if (!passBParsed.success) {
      const msg = `Pass B JSON invalid: ${passBParsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass B failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", error: msg });
      return;
    }
    const scenePrompts = passBParsed.data.scenes as ScenePromptSuite[];
    patchPreProduction(seriesId, episodeNumber, { scenePrompts, status: "audio_assets" });

    // ── Pass C: Pilot → audio plan + platform assets ──────────────────────────
    log.info({ seriesId, episodeNumber, pass: "C" }, "preproducer: Pass C (audio + assets)");
    const seriesForC = getSeries(seriesId) ?? series;
    const passCRaw = await runPass(
      PILOT_TAG,
      buildPassCPrompt(seriesForC, episodeNumber, script),
      1000,
      ac.signal,
    );
    const passCResult = extractJson<unknown>(passCRaw);
    const passCParsed = PassCSchema.safeParse(passCResult.data);
    if (!passCParsed.success) {
      const msg = `Pass C JSON invalid: ${passCParsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass C failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", error: msg });
      return;
    }
    const audioPlan = passCParsed.data.audioPlan as AudioPlan;
    const platformAssets = passCParsed.data.platformAssets as PlatformPublishingAsset[];
    patchPreProduction(seriesId, episodeNumber, { audioPlan, platformAssets, status: "scoring" });

    // ── Pass D: Pilot → virality score ────────────────────────────────────────
    log.info({ seriesId, episodeNumber, pass: "D" }, "preproducer: Pass D (virality score)");
    const passDRaw = await runPass(
      PILOT_TAG,
      buildPassDPrompt(series, episodeNumber, script),
      300,
      ac.signal,
    );
    const passDResult = extractJson<unknown>(passDRaw);
    const passDParsed = PassDSchema.safeParse(passDResult.data);
    if (!passDParsed.success) {
      const msg = `Pass D JSON invalid: ${passDParsed.error.message}`;
      log.error({ seriesId, episodeNumber, error: msg }, "preproducer: Pass D failed");
      patchPreProduction(seriesId, episodeNumber, { status: "failed", error: msg });
      return;
    }
    const { hookStrength, completionProxy, shareability, seoScore, recommendations } = passDParsed.data;
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

    // ── Quality gate ─────────────────────────────────────────────────────────
    const seriesFinal = getSeries(seriesId) ?? series;
    const qualityGateResult = evaluateQualityGate(
      seriesFinal, episodeNumber, script, scenePrompts, audioPlan, platformAssets, viralityScore,
    );

    const now = new Date().toISOString();
    patchPreProduction(seriesId, episodeNumber, {
      viralityScore,
      qualityGateResult,
      status: "complete",
      completedAt: now,
    });

    log.info(
      { seriesId, episodeNumber, overall: viralityScore.overall, gatePassed: qualityGateResult.passed },
      "preproducer: episode pre-production complete",
    );

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, episodeNumber, err: msg }, "preproducer: pipeline error");
    patchPreProduction(seriesId, episodeNumber, { status: "failed", error: msg });
  }
}
