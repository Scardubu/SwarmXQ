/**
 * apps/swarmx-api/src/services/virality-scorer.ts
 * VIDEO-ALPHA virality scoring and performance logging.
 */

import { resolveCanonicalTag } from "@swarmx/types/operator-map";
import type {
  VideoExportPlatform,
  ViralitySignal,
} from "@swarmx/types/video-types";
import { ModelOrchestrator } from "./model-orchestrator.js";
import {
  getAdaptiveCallConfig,
  recordFailure,
  recordSuccess,
  withTimeout,
} from "./adaptive-timeout-config.js";
import { extractJson, sanitizeReasoningOutput } from "./reasoning-sanitizer.js";
import { generateOllamaText } from "./ollama.js";

const ORACLE_TAG = resolveCanonicalTag(
  process.env["SWARMX_MODEL_REASON"] ??
    process.env["SWARMX_MODEL_REASONING"] ??
    process.env["SWARM_MODEL_REASON"] ??
    "reason-deepseekr1-pro-q5km-prod",
);

export const VIRALITY_SCORE_RUBRIC = `
HOOK_STRENGTH (0-1): Pattern interruption in first 3 seconds. Criteria:
unexpected contrast, unresolved tension, direct challenge to viewer assumption,
or bold claim requiring proof. 0 = generic opening. 1 = scroll-stop.

COMPLETION_PROXY (0-1): Incentive to watch to the end. Criteria: information
pacing (payoff revealed late), narrative arc, escalating stakes, promised reward.
0 = front-loaded, nothing left to see. 1 = strong end reward.

SHAREABILITY (0-1): Would someone forward this to a specific person? Criteria:
strong "this is so [person]" relatability, emotional trigger (laughter, surprise,
inspiration, validation), unique POV, or practical utility. 0 = generic.
1 = immediately forward-able.

SEO_SCORE (0-1): Evaluate caption draft only:
+0.30 if primary keyword appears in chars 0-40 of firstLine
+0.20 if hashtag count is 3-5 (not more, not fewer)
+0.20 if at least one niche hashtag is present (not #fyp, not #viral)
+0.20 if a CTA appears in the final line
+0.10 if total emoji count in full caption is 3 or fewer

OVERALL: hookStrength×0.35 + completionProxy×0.25 + shareability×0.25 + seoScore×0.15

Respond ONLY in this JSON schema, no think blocks, no prose:
{ "hookStrength": number, "completionProxy": number, "shareability": number,
  "seoScore": number, "overall": number, "recommendations": ["..."],
  "captionDraft": { "firstLine": "", "body": "", "cta": "",
    "hashtags": { "broad": [], "niche": [], "trending": [] },
    "soundSuggestion": "" } }
` as const;

export interface ViralityInput {
  topic: string;
  platform: VideoExportPlatform;
  durationSec: number;
  hook?: string;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 8);
}

function normalizeVirality(value: unknown): ViralitySignal | undefined {
  if (!value || typeof value !== "object") return undefined;
  const parsed = value as Partial<ViralitySignal>;

  const recommendations = toStringArray(parsed.recommendations);
  const scoredBy = typeof parsed.scoredBy === "string" && parsed.scoredBy.trim().length > 0
    ? resolveCanonicalTag(parsed.scoredBy)
    : ORACLE_TAG;

  const captionDraft = parsed.captionDraft;
  if (!captionDraft || typeof captionDraft !== "object") return undefined;

  return {
    hookStrength: clamp01(Number(parsed.hookStrength ?? 0)),
    completionProxy: clamp01(Number(parsed.completionProxy ?? 0)),
    shareability: clamp01(Number(parsed.shareability ?? 0)),
    seoScore: clamp01(Number(parsed.seoScore ?? 0)),
    overall: clamp01(Number(parsed.overall ?? 0)),
    recommendations,
    scoredBy,
    captionDraft: {
      firstLine: typeof (captionDraft as { firstLine?: unknown }).firstLine === "string"
        ? (captionDraft as { firstLine: string }).firstLine
        : "",
      body: typeof (captionDraft as { body?: unknown }).body === "string"
        ? (captionDraft as { body: string }).body
        : "",
      cta: typeof (captionDraft as { cta?: unknown }).cta === "string"
        ? (captionDraft as { cta: string }).cta
        : "",
      hashtags: {
        broad: toStringArray((captionDraft as { hashtags?: { broad?: unknown } }).hashtags?.broad),
        niche: toStringArray((captionDraft as { hashtags?: { niche?: unknown } }).hashtags?.niche),
        trending: toStringArray((captionDraft as { hashtags?: { trending?: unknown } }).hashtags?.trending).slice(0, 1),
      },
      ...(typeof (captionDraft as { soundSuggestion?: unknown }).soundSuggestion === "string"
        ? { soundSuggestion: (captionDraft as { soundSuggestion: string }).soundSuggestion }
        : {}),
    },
  };
}

function buildPrompt(input: ViralityInput, strictJsonSuffix?: string): string {
  return [
    `Platform: ${input.platform}`,
    `Topic: ${input.topic}`,
    `Duration seconds: ${input.durationSec}`,
    `Hook: ${input.hook ?? "N/A"}`,
    VIRALITY_SCORE_RUBRIC,
    strictJsonSuffix ?? "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

async function callOracle(prompt: string): Promise<string> {
  const orchestrator = ModelOrchestrator.getInstance();
  const callConfig = getAdaptiveCallConfig(ORACLE_TAG, "deep_reasoning");

  if (callConfig.circuitOpen) {
    throw new Error("virality_oracle_circuit_open");
  }

  const modelRequest = await orchestrator.requestModel(callConfig.modelTag);

  try {
    const raw = await withTimeout(
      generateOllamaText({
        model: modelRequest.modelTag,
        prompt: [
          "Respond with valid JSON only. Do not include markdown, prose, or reasoning blocks.",
          prompt,
        ].join("\n\n"),
        maxTokens: modelRequest.overrides.num_predict ?? callConfig.overrides.num_predict ?? 640,
        overrides: {
          ...callConfig.overrides,
          ...modelRequest.overrides,
          temperature: 0.0,
        },
      }),
      callConfig.timeoutMs,
      "virality_oracle_deep_reasoning",
    );
    recordSuccess(modelRequest.modelTag);
    return raw;
  } catch (error) {
    recordFailure(modelRequest.modelTag);
    throw error;
  } finally {
    orchestrator.onModelCallComplete(modelRequest.modelTag);
  }
}

async function parseOracleOutput(rawText: string): Promise<ViralitySignal | undefined> {
  const sanitized = sanitizeReasoningOutput(rawText);
  const extracted = extractJson<unknown>(sanitized.text);
  if (!extracted.ok) {
    return undefined;
  }
  return normalizeVirality(extracted.data);
}

export async function scoreVirality(input: ViralityInput): Promise<ViralitySignal | undefined> {
  if (getAdaptiveCallConfig(ORACLE_TAG, "deep_reasoning").circuitOpen) {
    console.warn("virality_oracle_circuit_open", { modelTag: ORACLE_TAG });
    return undefined;
  }

  try {
    const firstRaw = await callOracle(buildPrompt(input));
    const firstParsed = await parseOracleOutput(firstRaw);
    if (firstParsed) {
      return { ...firstParsed, scoredBy: ORACLE_TAG };
    }

    const secondRaw = await callOracle(
      buildPrompt(input, "Output ONLY valid JSON. No other text."),
    );
    const secondParsed = await parseOracleOutput(secondRaw);
    if (secondParsed) {
      return { ...secondParsed, scoredBy: ORACLE_TAG };
    }

    return undefined;
  } catch {
    return undefined;
  }
}
