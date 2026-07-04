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
import { extractJson, sanitizeReasoningOutput } from "./reasoning-sanitizer.js";

const OLLAMA_BASE = process.env["SWARMX_OLLAMA_URL"] ?? process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434";

export interface ViralityInput {
  topic: string;
  platform: VideoExportPlatform;
  durationSec: number;
  hook?: string;
}

export interface RecordedVideoPerformanceInput {
  jobId: string;
  platform: VideoExportPlatform;
  views: number;
  likes: number;
  shares: number;
  watchTimeSec: number;
  postedAtIso: string;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function safeRecommendations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, 5);
}

function normalizeVirality(score: Partial<ViralitySignal>): ViralitySignal {
  const recommendations = safeRecommendations(score.recommendations);

  return {
    hookStrength: clampScore(score.hookStrength ?? 0),
    completionProxy: clampScore(score.completionProxy ?? 0),
    shareability: clampScore(score.shareability ?? 0),
    seoScore: clampScore(score.seoScore ?? 0),
    overall: clampScore(score.overall ?? 0),
    scoredBy: typeof score.scoredBy === "string" && score.scoredBy.length > 0
      ? score.scoredBy
      : "oracle",
    recommendations,
    captionDraft: {
      firstLine: "",
      body: "",
      cta: "",
      hashtags: { broad: [], niche: [], trending: [] },
    },
  };
}

function scoreFromHeuristics(input: ViralityInput): ViralitySignal {
  const durationPenalty = input.durationSec <= 15 ? 0 : Math.min(20, (input.durationSec - 15) * 1.5);
  const hookBoost = input.hook && input.hook.length >= 8 ? 8 : 0;
  const baseHook = clampScore(62 + hookBoost - durationPenalty);
  const completion = clampScore(58 + hookBoost - Math.floor(durationPenalty * 0.8));
  const shareability = clampScore(input.platform === "tiktok" || input.platform === "reels" ? 74 : 68);
  const seoScore = clampScore(66);
  const overall = clampScore((baseHook * 0.3) + (completion * 0.3) + (shareability * 0.2) + (seoScore * 0.2));

  return {
    hookStrength: baseHook,
    completionProxy: completion,
    shareability,
    seoScore,
    overall,
    scoredBy: "heuristic-fallback",
    recommendations: durationPenalty > 10
      ? ["Tighten runtime to improve completion rate", "Strengthen first 2 seconds with a stronger hook"]
      : ["Keep visual transitions every 1-2 seconds", "Use concise CTA in final beat"],
    captionDraft: {
      firstLine: "",
      body: "",
      cta: "",
      hashtags: { broad: [], niche: [], trending: [] },
    },
  };
}

async function callOracle(prompt: string): Promise<string> {
  const orchestrator = ModelOrchestrator.getInstance();
  const requestedTag = resolveCanonicalTag(
    process.env["SWARMX_MODEL_REASONING"] ?? process.env["SWARM_MODEL_REASONING"] ?? "reason-deepseekr1-pro-q5km-prod",
  );

  const modelRequest = await orchestrator.requestModel(requestedTag);
  try {
    const response = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: modelRequest.modelTag,
        keep_alive: modelRequest.keepAlive,
        stream: false,
        options: {
          num_predict: modelRequest.overrides.num_predict ?? 640,
          ...(modelRequest.overrides.num_ctx !== undefined
            ? { num_ctx: modelRequest.overrides.num_ctx }
            : {}),
          temperature: 0.1,
        },
        messages: [
          {
            role: "system",
            content:
              "Return strict JSON only for virality analysis with fields: hookStrength, completionProxy, shareability, seoScore, overall, scoredBy, recommendations.",
          },
          {
            role: "user",
            content: prompt,
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`Virality scorer failed with status ${response.status}`);
    }

    const payload = (await response.json()) as { message?: { content?: string } };
    const raw = payload.message?.content ?? "";
    const { text } = sanitizeReasoningOutput(raw);
    return text;
  } finally {
    orchestrator.onModelCallComplete(modelRequest.modelTag);
  }
}

function buildPrompt(input: ViralityInput): string {
  return [
    `Platform: ${input.platform}`,
    `Topic: ${input.topic}`,
    `Duration seconds: ${input.durationSec}`,
    `Hook: ${input.hook ?? "N/A"}`,
    "Score each dimension 0-100.",
    "Include up to 5 concise recommendations.",
  ].join("\n");
}

export async function scoreVirality(input: ViralityInput): Promise<ViralitySignal> {
  const fallback = scoreFromHeuristics(input);

  try {
    const response = await callOracle(buildPrompt(input));
    const extracted = extractJson<Partial<ViralitySignal>>(response);
    if (!extracted.ok || !extracted.data) {
      return fallback;
    }

    return normalizeVirality(extracted.data);
  } catch {
    return fallback;
  }
}

export async function recordVideoPerformance(_input: RecordedVideoPerformanceInput): Promise<void> {
  // Persistence wiring is intentionally decoupled; orchestration can call this now
  // without requiring schema migration in this phase.
}
