import { readFileSync } from "node:fs";
import { MODEL_OPERATOR_MAP, resolveCanonicalTag } from "@swarmx/types/operator-map";
import type { VideoJobRequest, VideoJobStage } from "../types/video.js";
import { loadEnv } from "../lib/env.js";

export const LOW_RAM_VIDEO_MODEL = "instruct-phi4-lite-q4km-prod";
/** Full Pilot model tag used for intent_classification and prewarm on 16 GB hosts. */
export const PILOT_VIDEO_MODEL = "instruct-phi4-pro-q8-prod";
export const VIDEO_RAM_RESERVE_MB = 800;

/** Threshold below which the full 7B planning path cannot start safely. */
export const FULL_PIPELINE_MIN_AVAILABLE_MB = 6170;

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

// Defaults sized so BOTH GPU (cold model load takes 5–15s) and CPU (warm 3.8B
// Q4_K_M at ~5 tok/s) can complete each text stage without env overrides. GPU
// hosts wanting tighter bounds can still override via VIDEO_*_TIMEOUT_MS.
// intent_classification uses 240 s: cold Q8 Pilot load (30–60 s) + inference
// (10–30 s) + marshaling leaves enough slack for a busy bare-metal CPU host.
const STAGE_TIMEOUT_DEFAULTS: Record<VideoJobStage, number> = {
  intent_classification: 240_000,
  planning: 300_000,
  scripting: 600_000,
  storyboard_generation: 600_000,
  render_assembly: 1_800_000,
  finalizing: 120_000,
};

const STAGE_TIMEOUT_BOUNDS: Record<VideoJobStage, { min: number; max: number }> = {
  // Upper bounds account for CPU-only inference on 2-core constrained laptops.
  // A 3.8B Q4_K_M model at ~5–6 tok/s with 200-600 token prompts and up to
  // 1024 tokens output needs 5–15 min per stage. GPU operators can override
  // via VIDEO_*_TIMEOUT_MS env vars; the max bounds only clamp the ceiling.
  intent_classification: { min: 1_000, max: 600_000 },
  planning: { min: 5_000, max: 900_000 },
  scripting: { min: 10_000, max: 1_800_000 },
  storyboard_generation: { min: 10_000, max: 1_200_000 },
  render_assembly: { min: 30_000, max: 7_200_000 },
  finalizing: { min: 5_000, max: 600_000 },
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
  return loadEnv().SWARMX_VIDEO_LOW_RAM_MODE === "1";
}

/** Read /proc/meminfo once and return current physical RAM in MB, or null on non-Linux hosts. */
export function detectAvailableMemoryMb(): number | null {
  try {
    const raw = readFileSync("/proc/meminfo", "utf8");
    const availKb = Number(raw.match(/MemAvailable:\s+(\d+)\s+kB/)?.[1] ?? 0);
    return availKb > 0 ? Math.floor(availKb / 1024) : null;
  } catch {
    return null;
  }
}

/**
 * Recommend LOW_RAM_MODE when the operator has NOT explicitly opted in or out
 * and physical MemAvailable is below the full-7B admission threshold. Used by
 * server startup to auto-configure CPU-constrained hosts; never overrides an
 * explicit env value.
 */
export function shouldAutoEnableLowRamMode(): boolean {
  if (loadEnv().SWARMX_VIDEO_LOW_RAM_MODE) return false;
  const available = detectAvailableMemoryMb();
  return available !== null && available < FULL_PIPELINE_MIN_AVAILABLE_MB;
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
