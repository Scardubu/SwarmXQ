/**
 * apps/swarmx-api/src/services/video-series-planner.ts
 * SwarmXQ Series Engine — AI Planning Pipeline
 * V6.2.25 — Series Director spec injected: stronger persona (Pass 1),
 *            algorithm signal + recency loop + 600 tok (Pass 3),
 *            full shot vocabulary hint (Pass 4).
 * V6.2.30 — Pass 3 switched to structured JSON (SeriesViralityArcData);
 *            prose string fallback preserved for backward compatibility.
 *
 * Four-pass LLM pipeline that converts a SeriesBrief into a full series plan:
 *   Pass 1 (Pilot)     — character bible + world guide (JSON)
 *   Pass 2 (Architect) — episode roadmap, N entries (JSON)
 *   Pass 3 (Pilot)     — structured virality arc → SeriesViralityArcData (optional, prose fallback)
 *   Pass 4 (Pilot)     — cinematic language lock: color grade + shot grammar (optional)
 *
 * Each pass uses ModelOrchestrator.requestModel() for SINGLE-7B LOCK compliance.
 * Every Ollama response is wrapped in sanitizeReasoningOutput() before parsing.
 * Passes 3 and 4 are non-fatal; Passes 1 or 2 failure marks the series as failed.
 */

import { z } from "zod";
import { ModelOrchestrator } from "./model-orchestrator.js";
import { generateOllamaText } from "./ollama.js";
import { sanitizeReasoningOutput, extractJson } from "./reasoning-sanitizer.js";
import { resolveCanonicalTag } from "@swarmx/types/operator-map";
import {
  getSeries,
  setSeriesStatus,
  updateSeries,
} from "./series-registry.js";
import { log } from "../lib/logger.js";
import type {
  CharacterProfile,
  EpisodeRoadmapEntry,
  SeriesViralityArcData,
  WorldRegistry,
} from "@swarmx/types/series-types";

// ─── Model tags ───────────────────────────────────────────────────────────────

const PILOT_TAG     = resolveCanonicalTag("instruct-phi4-pro-q8-prod");
const ARCHITECT_TAG = resolveCanonicalTag("plan-qwen25-pro-q5km-prod");

// ─── Zod schemas for LLM output validation ───────────────────────────────────

const CharacterProfileSchema = z.object({
  name:           z.string().min(1),
  appearance:     z.string().min(1),
  face:           z.string().min(1),
  defaultOutfit:  z.string().min(1),
  voice:          z.string().min(1),
  personality:    z.string().min(1),
  relationships:  z.record(z.string(), z.string()).default({}),
  emotionalArc:   z.string().min(1),
  signatureCues:  z.string().min(1),
  speakingStyle:  z.string().min(1),
  aiPromptSeed:   z.string().min(1),
});

const WorldRegistrySchema = z.object({
  keyLocations: z.array(z.object({
    name:             z.string(),
    description:      z.string(),
    lightingDefault:  z.string(),
    timeOfDayDefault: z.string(),
  })).default([]),
  architecture:   z.string().default("contemporary"),
  colorPalette:   z.array(z.string()).min(1).max(8),
  cameraLanguage: z.object({
    defaultLens:        z.string(),
    defaultMovementStyle: z.string(),
    shotGrammarRules:   z.string(),
  }),
  visualMotifs:   z.array(z.string()).default([]),
  era:            z.string().default("contemporary"),
  toneMap:        z.string().default("neutral"),
  soundSignature: z.string().default("ambient"),
});

const Pass1Schema = z.object({
  seriesTitle:    z.string().min(1),
  characterBible: z.array(CharacterProfileSchema),
  worldGuide:     WorldRegistrySchema,
});

const EpisodeRoadmapEntrySchema = z.object({
  episodeNumber:        z.number().int().min(1),
  title:                z.string().min(1),
  summary:              z.string().min(1),
  continuityThread:     z.string().default(""),
  chekhovGun:           z.string().optional(),
  chekhovPayoffEpisode: z.number().int().optional(),
});

const Pass2Schema = z.object({
  episodes: z.array(EpisodeRoadmapEntrySchema).min(1),
});

const Pass3Schema = z.object({
  curiosityGap:       z.string().min(1),
  microRewardCadence: z.string().min(1),
  loyaltySignal:      z.string().min(1),
  socialProofHook:    z.string().min(1),
  loopEnding:         z.string().min(1),
  algorithmSignal:    z.string().min(1),
  recencyLoop:        z.string().min(1),
});

const Pass4Schema = z.object({
  colorGradeContract: z.object({
    shadowTone:    z.string().min(1),
    highlight:     z.string().min(1),
    saturation:    z.string().min(1),
    filmEmulation: z.string().min(1),
  }),
  cinematicShotGrammar: z.string().min(1),
});

// ─── Per-pass helper ──────────────────────────────────────────────────────────

async function runPlannerPass(
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

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildPass1Prompt(
  storyTheme: string,
  coreMessage: string,
  emotionalJourney: string,
  primaryConflict: string,
  targetAudience: string,
  tone: string,
  seriesLength: number,
  arcStructure: string,
  recurringSymbols?: string,
): string {
  return `You are a series director building the foundational bible. Lock character and world to enforce visual and emotional consistency across all ${seriesLength} episodes.

SERIES BRIEF:
Story/Theme: ${storyTheme}
Core message: ${coreMessage}
Emotional journey: ${emotionalJourney}
Primary conflict: ${primaryConflict}
Target audience: ${targetAudience}
Tone: ${tone}
Episodes: ${seriesLength}
Arc structure: ${arcStructure}
${recurringSymbols ? `Recurring symbols: ${recurringSymbols}` : ""}

Create a series title, 1–3 characters with full profiles, and a world guide.
Respond with STRICT JSON only, no other text:

{
  "seriesTitle": "...",
  "characterBible": [
    {
      "name": "...",
      "appearance": "precise height, build, skin tone, hair description",
      "face": "specific facial features — jawline, eyes, nose, distinguishing marks",
      "defaultOutfit": "colour palette, fabric type, style — AI-prompt-ready",
      "voice": "tone, pace, accent, register",
      "personality": "3 traits + 1 contradiction",
      "relationships": {},
      "emotionalArc": "where they start → where they end",
      "signatureCues": "a gesture, phrase, or object recurring every episode",
      "speakingStyle": "cadence, vocabulary level, what they never say",
      "aiPromptSeed": "one master visual consistency prompt, max 40 words"
    }
  ],
  "worldGuide": {
    "keyLocations": [{"name":"...","description":"...","lightingDefault":"...","timeOfDayDefault":"..."}],
    "architecture": "design language",
    "colorPalette": ["#hex1","#hex2","#hex3"],
    "cameraLanguage": {
      "defaultLens": "e.g. 35mm standard",
      "defaultMovementStyle": "e.g. slow push-in",
      "shotGrammarRules": "e.g. ECU on tension, WS on wonder"
    },
    "visualMotifs": ["motif1","motif2"],
    "era": "time period",
    "toneMap": "palette name or description",
    "soundSignature": "recurring audio element"
  }
}`;
}

function buildPass2Prompt(
  seriesTitle: string,
  storyTheme: string,
  coreMessage: string,
  emotionalJourney: string,
  arcStructure: string,
  seriesLength: number,
  episodeDurationSeconds: number,
  characterNames: string[],
  pass1Summary: string,
): string {
  return `You are a story architect. Create an episode roadmap for this ${seriesLength}-episode series.

SERIES: "${seriesTitle}"
Theme: ${storyTheme}
Core message: ${coreMessage}
Emotional journey: ${emotionalJourney}
Arc structure: ${arcStructure}
Episode duration: ${episodeDurationSeconds} seconds
Characters: ${characterNames.join(", ")}

World and character context:
${pass1Summary}

Rules:
- Every episode advances the narrative — no recap or filler episodes
- Every episode introduces new value (revelation, shift, new dimension)
- Every episode ends with earned curiosity
- Plant Chekhov's guns 2–3 episodes before their payoff
- Verify no plot holes across the full arc

Respond with STRICT JSON only:
{
  "episodes": [
    {
      "episodeNumber": 1,
      "title": "...",
      "summary": "one-line story advance",
      "continuityThread": "what carries from the prior episode",
      "chekhovGun": "optional element planted here",
      "chekhovPayoffEpisode": 4
    }
  ]
}`;
}

function buildPass3Prompt(
  seriesTitle: string,
  seriesLength: number,
  tone: string,
  platformPrimary: string,
  episodeTitles: string[],
): string {
  return `You are a viral content strategist. Define the binge-loop virality arc for this series.

SERIES: "${seriesTitle}"
Episodes: ${seriesLength}
Tone: ${tone}
Platform: ${platformPrimary}
Episode titles: ${episodeTitles.map((t, i) => `${i + 1}. ${t}`).join(" | ")}

Respond with STRICT JSON only — one field per mechanic. Each field: 1–2 sentences, specific to this series. No generic advice.

{
  "curiosityGap": "unanswered question planted in Ep1 that resolves only in Ep${seriesLength}",
  "microRewardCadence": "small revelation delivered every 2–3 episodes to reward returning viewers",
  "loyaltySignal": "recurring element that only viewers who have watched from Ep1 will recognise",
  "socialProofHook": "the one moment per episode so specific and shareable that viewers post it as a reaction",
  "loopEnding": "why Ep${seriesLength}'s final frame creates the urge to rewatch Ep1 immediately",
  "algorithmSignal": "how Ep1 is engineered for maximum completion rate — it is the unlock for the rest of the series",
  "recencyLoop": "how the release cadence and each episode's ending make waiting feel costly"
}`;
}

function buildPass4Prompt(
  seriesTitle: string,
  tone: string,
  colorPalette: string[],
  architecture: string,
  era: string,
): string {
  return `You are a cinematographer. Define the locked cinematic language for this video series.

SERIES: "${seriesTitle}"
Tone: ${tone}
Architecture/setting: ${architecture}
Era: ${era}
Established color palette: ${colorPalette.join(", ")}

Using the established color palette as your base, define the series-locked cinematic grade and shot grammar.
Respond with STRICT JSON only:

{
  "colorGradeContract": {
    "shadowTone": "derived from darkest palette value or implied shadow (e.g. '#0a0a0a warm charcoal')",
    "highlight": "derived from lightest or accent palette value (e.g. '#f5e6c8 golden highlight')",
    "saturation": "one of: desaturated cinematic | vibrant social | muted editorial | punchy pop",
    "filmEmulation": "one of: none | S-Log2 | LOG-C | Kodak 2383 | Fuji 3513"
  },
  "cinematicShotGrammar": "2–3 rules using: shot-type (ECU/CU/MCU/MS/MWS/WS/EWS/aerial/POV/OTS) + movement (push-in/crane/Steadicam/handheld) + lens. e.g. ECU+push-in+85mm on tension; WS+crane+16mm on revelation; OTS+Steadicam+50mm for intimacy"
}`;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Runs the three-pass planning pipeline for a series.
 * Intended to be called fire-and-forget from the route handler.
 * Updates the series-registry directly with results.
 */
export async function planSeries(seriesId: string): Promise<void> {
  const series = getSeries(seriesId);
  if (!series) {
    log.warn({ seriesId }, "planSeries: series not found in registry");
    return;
  }

  const brief = series.brief;
  const ac = new AbortController();

  try {
    // ── Pass 1: Pilot → character bible + world guide ─────────────────────────
    log.info({ seriesId, pass: 1 }, "series planner: starting Pass 1 (character bible + world guide)");
    const pass1Raw = await runPlannerPass(
      PILOT_TAG,
      buildPass1Prompt(
        brief.storyTheme,
        brief.coreMessage,
        brief.emotionalJourney,
        brief.primaryConflict,
        brief.targetAudience,
        brief.tone,
        brief.seriesLength,
        brief.arcStructure,
        brief.recurringSymbols,
      ),
      1200,
      ac.signal,
    );

    const pass1Result = extractJson<unknown>(pass1Raw);
    const pass1Parsed = Pass1Schema.safeParse(pass1Result.data);
    if (!pass1Parsed.success) {
      const msg = `Pass 1 JSON invalid: ${pass1Parsed.error.message}`;
      log.error({ seriesId, error: msg }, "series planner: Pass 1 failed");
      setSeriesStatus(seriesId, "failed", msg);
      return;
    }
    const { seriesTitle, characterBible, worldGuide } = pass1Parsed.data;
    updateSeries(seriesId, {
      characterBible: characterBible as CharacterProfile[],
      worldGuide: worldGuide as WorldRegistry,
    });

    // ── Pass 2: Architect → episode roadmap ───────────────────────────────────
    log.info({ seriesId, pass: 2 }, "series planner: starting Pass 2 (episode roadmap)");
    const pass1Summary = `Title: ${seriesTitle}. Characters: ${characterBible.map((c) => c.name).join(", ")}. World: ${worldGuide.architecture}, ${worldGuide.era}.`;
    const pass2Raw = await runPlannerPass(
      ARCHITECT_TAG,
      buildPass2Prompt(
        seriesTitle,
        brief.storyTheme,
        brief.coreMessage,
        brief.emotionalJourney,
        brief.arcStructure,
        brief.seriesLength,
        brief.episodeDurationSeconds,
        characterBible.map((c) => c.name),
        pass1Summary,
      ),
      2000,
      ac.signal,
    );

    const pass2Result = extractJson<unknown>(pass2Raw);
    const pass2Parsed = Pass2Schema.safeParse(pass2Result.data);
    if (!pass2Parsed.success) {
      const msg = `Pass 2 JSON invalid: ${pass2Parsed.error.message}`;
      log.error({ seriesId, error: msg }, "series planner: Pass 2 failed");
      setSeriesStatus(seriesId, "failed", msg);
      return;
    }
    const episodeRoadmap = pass2Parsed.data.episodes as EpisodeRoadmapEntry[];
    updateSeries(seriesId, { episodeRoadmap });

    // ── Pass 3: Pilot → virality arc (optional) ───────────────────────────────
    log.info({ seriesId, pass: 3 }, "series planner: starting Pass 3 (virality arc)");
    try {
      const pass3Raw = await runPlannerPass(
        PILOT_TAG,
        buildPass3Prompt(
          seriesTitle,
          brief.seriesLength,
          brief.tone,
          brief.platformPrimary,
          episodeRoadmap.map((e) => e.title),
        ),
        600,
        ac.signal,
      );
      const pass3Result = extractJson<unknown>(pass3Raw);
      const pass3Parsed = Pass3Schema.safeParse(pass3Result.data);
      if (pass3Parsed.success) {
        const viralityArcData: SeriesViralityArcData = pass3Parsed.data;
        updateSeries(seriesId, { viralityArcData });
        log.info({ seriesId }, "series planner: Pass 3 structured virality arc stored");
      } else {
        // Fallback: store as prose string for backward compatibility
        const { text: viralityArc } = sanitizeReasoningOutput(pass3Raw);
        updateSeries(seriesId, { viralityArc: viralityArc.trim() });
        log.warn({ seriesId, error: pass3Parsed.error.message }, "series planner: Pass 3 JSON invalid — stored as prose fallback");
      }
    } catch (err) {
      // Pass 3 failure is non-fatal — log and continue
      log.warn({ seriesId, err: err instanceof Error ? err.message : String(err) }, "series planner: Pass 3 failed (non-fatal)");
    }

    // ── Pass 4: Pilot → cinematic language lock (optional) ────────────────────
    log.info({ seriesId, pass: 4 }, "series planner: starting Pass 4 (cinematic lock)");
    try {
      const pass4Raw = await runPlannerPass(
        PILOT_TAG,
        buildPass4Prompt(
          seriesTitle,
          brief.tone,
          worldGuide.colorPalette,
          worldGuide.architecture,
          worldGuide.era,
        ),
        400,
        ac.signal,
      );
      const pass4Result = extractJson<unknown>(pass4Raw);
      const pass4Parsed = Pass4Schema.safeParse(pass4Result.data);
      if (pass4Parsed.success) {
        const currentWorld = getSeries(seriesId)?.worldGuide;
        if (currentWorld) {
          updateSeries(seriesId, {
            worldGuide: {
              ...currentWorld,
              colorGradeContract: pass4Parsed.data.colorGradeContract,
              cinematicShotGrammar: pass4Parsed.data.cinematicShotGrammar,
            },
          });
        }
      } else {
        log.warn({ seriesId, error: pass4Parsed.error.message }, "series planner: Pass 4 JSON invalid (non-fatal)");
      }
    } catch (err) {
      log.warn({ seriesId, err: err instanceof Error ? err.message : String(err) }, "series planner: Pass 4 failed (non-fatal)");
    }

    setSeriesStatus(seriesId, "planned");
    log.info({ seriesId, episodes: episodeRoadmap.length }, "series planner: plan complete");

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ seriesId, err: msg }, "series planner: planning failed");
    setSeriesStatus(seriesId, "failed", msg);
  }
}
