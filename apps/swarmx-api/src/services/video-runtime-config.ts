import { MODEL_OPERATOR_MAP, resolveCanonicalTag } from "@swarmx/types/operator-map";
import type { VideoJobRequest, VideoJobStage } from "../types/video.js";

export const LOW_RAM_VIDEO_MODEL = "instruct-phi4-lite-q4km-prod";
export const VIDEO_RAM_RESERVE_MB = 800;

export type TextVideoJobStage = Exclude<VideoJobStage, "render_assembly" | "finalizing">;

export const VIDEO_TEXT_STAGES: TextVideoJobStage[] = [
  "intent_classification",
  "planning",
  "scripting",
  "storyboard_generation",
];

const DEFAULT_TEXT_STAGE_MODEL_TAG: Record<TextVideoJobStage, string> = {
  intent_classification: "instruct-phi4-pro-q8-prod",
  planning: "plan-qwen25-pro-q5km-prod",
  scripting: "plan-qwen25-pro-q5km-prod",
  storyboard_generation: "plan-qwen25-pro-q5km-prod",
};

const TEXT_STAGE_MODEL_ENV: Record<TextVideoJobStage, string> = {
  intent_classification: "SWARMX_VIDEO_INTENT_MODEL",
  planning: "SWARMX_VIDEO_PLAN_MODEL",
  scripting: "SWARMX_VIDEO_SCRIPT_MODEL",
  storyboard_generation: "SWARMX_VIDEO_STORYBOARD_MODEL",
};

const STAGE_TIMEOUT_DEFAULTS: Record<VideoJobStage, number> = {
  intent_classification: 4_000,
  planning: 15_000,
  scripting: 35_000,
  storyboard_generation: 60_000,
  render_assembly: 240_000,
  finalizing: 15_000,
};

const STAGE_TIMEOUT_BOUNDS: Record<VideoJobStage, { min: number; max: number }> = {
  // Upper bounds sized for CPU-only inference on constrained laptops. A 3.8B
  // Q4_K_M model at ~5 tokens/sec needs headroom for structured-output stages
  // where the model may emit 100+ tokens. Operators on GPU-backed hosts can
  // still set lower per-env timeouts; the bounds only clamp the ceiling.
  intent_classification: { min: 1_000, max: 90_000 },
  planning: { min: 5_000, max: 180_000 },
  scripting: { min: 10_000, max: 240_000 },
  storyboard_generation: { min: 10_000, max: 300_000 },
  render_assembly: { min: 30_000, max: 900_000 },
  finalizing: { min: 5_000, max: 60_000 },
};

const STAGE_TIMEOUT_ENV: Record<VideoJobStage, string> = {
  intent_classification: "VIDEO_INTENT_CLASSIFY_TIMEOUT_MS",
  planning: "VIDEO_PLANNING_TIMEOUT_MS",
  scripting: "VIDEO_SCRIPTING_TIMEOUT_MS",
  storyboard_generation: "VIDEO_STORYBOARD_TIMEOUT_MS",
  render_assembly: "VIDEO_RENDER_TIMEOUT_MS",
  finalizing: "VIDEO_FINALIZING_TIMEOUT_MS",
};

export function isTextVideoStage(stage: VideoJobStage): stage is TextVideoJobStage {
  return stage !== "render_assembly" && stage !== "finalizing";
}

export function isLowRamVideoMode(): boolean {
  return process.env["SWARMX_VIDEO_LOW_RAM_MODE"] === "1";
}

export function readBoundedEnvInt(
  envName: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = process.env[envName];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function stageTimeoutMs(stage: VideoJobStage): number {
  const bounds = STAGE_TIMEOUT_BOUNDS[stage];
  return readBoundedEnvInt(
    STAGE_TIMEOUT_ENV[stage],
    STAGE_TIMEOUT_DEFAULTS[stage],
    bounds.min,
    bounds.max,
  );
}

export function resolveVideoModelTag(
  request: VideoJobRequest,
  stage: TextVideoJobStage,
): string {
  if (isLowRamVideoMode()) {
    return LOW_RAM_VIDEO_MODEL;
  }

  const envOverride = process.env[TEXT_STAGE_MODEL_ENV[stage]];
  if (envOverride?.trim()) {
    return resolveCanonicalTag(envOverride.trim());
  }

  if (request.modelTier) {
    const tierMap: Record<string, string> = {
      fast: "instruct-phi4-pro-q8-prod",
      worker: "plan-phi4-pro-q8-prod",
      supervisor: "plan-qwen25-pro-q5km-prod",
      reasoner: "reason-deepseekr1-pro-q5km-prod",
    };
    return resolveCanonicalTag(tierMap[request.modelTier] ?? DEFAULT_TEXT_STAGE_MODEL_TAG[stage]);
  }

  return DEFAULT_TEXT_STAGE_MODEL_TAG[stage];
}

export function selectedInitialVideoModelTag(request: VideoJobRequest): string {
  return resolveVideoModelTag(request, "intent_classification");
}

export function videoModelTagsForRequest(request: VideoJobRequest): string[] {
  if (isLowRamVideoMode()) {
    return VIDEO_TEXT_STAGES.map(() => LOW_RAM_VIDEO_MODEL);
  }

  return VIDEO_TEXT_STAGES.map((stage) => resolveVideoModelTag(request, stage));
}

export function modelEstimatedRamMb(modelTag: string): number | null {
  const canonical = resolveCanonicalTag(modelTag);
  return MODEL_OPERATOR_MAP[canonical]?.estimatedRamMb ?? null;
}

export function minimumRamRequiredForVideoRequest(request: VideoJobRequest): number {
  const estimates = videoModelTagsForRequest(request).map(
    (tag) => modelEstimatedRamMb(tag) ?? 2_500,
  );
  const maxEstimate = Math.max(2_500, ...estimates);
  return maxEstimate + VIDEO_RAM_RESERVE_MB;
}
