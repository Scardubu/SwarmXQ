/**
 * apps/swarmx-api/src/types/video.ts
 * SwarmXQ Video Subsystem — Shared Domain Types
 * Phase 1: Canonical contracts for queue, routes, orchestrator, and dashboard.
 */

import type {
  VideoHealthEventData,
  VideoJobEventData,
  VideoJob as CanonicalVideoJob,
  VideoExportPlatform,
  VideoJobStatus as CanonicalVideoJobStatus,
  VideoArtifacts,
  OperatorTraceEntry,
  ViralitySignal,
  VideoError,
  PublishResult,
  VideoTone,
} from "@swarmx/types/video-types";
import type { SeriesEpisodeContext } from "@swarmx/types/series-types";

// ─── Job Lifecycle ────────────────────────────────────────────────────────────

export type VideoJobStatus = CanonicalVideoJobStatus | "running" | "completed";

export type VideoJobStage =
  | "intent_classification"
  | "planning"
  | "scripting"
  | "storyboard_generation"
  | "render_assembly"
  | "finalizing";

export const VIDEO_JOB_STAGE_ORDER: VideoJobStage[] = [
  "intent_classification",
  "planning",
  "scripting",
  "storyboard_generation",
  "render_assembly",
  "finalizing",
];

export const VIDEO_JOB_STAGE_LABELS: Record<VideoJobStage, string> = {
  intent_classification: "Intent Classification",
  planning: "Planning",
  scripting: "Scripting",
  storyboard_generation: "Storyboard Generation",
  render_assembly: "Render & Assembly",
  finalizing: "Finalizing",
};

// ─── Request / Response ───────────────────────────────────────────────────────

export interface VideoJobRequest {
  /** Plain-language description of the video to generate. */
  prompt: string;
  /** Target platform influencing style, aspect ratio, and length. */
  platform?: VideoExportPlatform | "youtube_shorts";
  /** Niche category — informs scripting model routing. */
  niche?: "motivational" | "finance" | "facts" | "true_crime" | "tech" | "other";
  /** Preferred output duration in seconds. Clamped to 15–180 by orchestrator. */
  targetDurationSeconds?: number;
  /** Model tier override — defaults to auto-routing via complexity score. */
  modelTier?: "fast" | "worker" | "supervisor" | "reasoner";
  /** Intended audience, used to shape script and caption guidance. */
  audience?: string;
  /** Creative tone for script and caption generation (8 variants). */
  tone?: VideoTone;
  /** Visual/story format guidance for local and ComfyUI render plans. */
  style?: "faceless_broll" | "kinetic_text" | "storytime" | "tutorial" | "myth_busting";
  /** Caption placement and density preference. */
  captionStyle?: "bold_center" | "lower_third" | "minimal";
  /** Voice style hint for local TTS/render metadata. */
  voice?: "default" | "calm" | "energetic" | "narrator";
  /** Client-supplied idempotency key. */
  clientRequestId?: string;
  // ── Series Engine fields (populated by series planner when producing an episode) ──
  seriesId?: string;
  episodeNumber?: number;
  totalEpisodes?: number;
  seriesContext?: SeriesEpisodeContext;
}

export interface VideoJobResponse {
  jobId: string;
  status: VideoJobStatus;
  createdAt: string; // ISO 8601
  estimatedDurationMs?: number;
  message?: string;
}

// ─── Progress ─────────────────────────────────────────────────────────────────

export interface VideoStageProgress {
  stage: VideoJobStage;
  /** 0–100 fractional progress within this stage. */
  stageProgress: number;
  /** Overall job progress 0–100. */
  overallProgress: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

// ─── Output Metadata ──────────────────────────────────────────────────────────

export interface VideoOutputMetadata {
  /** Relative path under SWARMX_VIDEO_EXPORT_DIR. */
  relativePath: string;
  /** Absolute path on-disk — API-internal only. */
  absolutePath: string;
  /** Public URL served by the API. */
  publicUrl: string;
  fileSizeBytes: number;
  durationSeconds: number;
  widthPx: number;
  heightPx: number;
  fps: number;
  format: "mp4" | "webm";
  /** SHA-256 of the output file. */
  checksum: string;
  generatedAt: string; // ISO 8601
  /** Script text used during scripting stage. */
  scriptText?: string;
  /** List of storyboard frame descriptions. */
  storyboardFrames?: string[];
  /** Ollama model tags actually used per stage. */
  modelsUsed: Partial<Record<VideoJobStage, string>>;
}

// ─── Full Job Record ──────────────────────────────────────────────────────────

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  request: VideoJobRequest;
  stages: Partial<Record<VideoJobStage, VideoStageProgress>>;
  currentStage?: VideoJobStage;
  /** Overall progress 0–100. */
  overallProgress: number;
  output?: VideoOutputMetadata;
  error?: VideoJobError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Retry count against the same job id (v1: 0 or 1). */
  retryCount: number;
  resumeFromStage?: VideoJobStage;
  /** Pressure tier at job start. */
  pressureTierAtStart?: "normal" | "high" | "critical";
  clientRequestId?: string;

  // VIDEO-ALPHA compatibility bridge fields (gradually becoming canonical).
  operatorTrace?: OperatorTraceEntry[];
  viralitySignal?: ViralitySignal;
  outputArtifacts?: VideoArtifacts;
  publishHistory?: PublishResult[];
  errorLog?: VideoError[];
}

// ─── Errors ───────────────────────────────────────────────────────────────────

export interface VideoJobError {
  code: VideoErrorCode;
  message: string;
  stage?: VideoJobStage;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export type VideoErrorCode =
  | "PRESSURE_CRITICAL"
  | "TIMEOUT"
  | "OLLAMA_UNAVAILABLE"
  | "COMFY_UNAVAILABLE"
  | "COMFY_OUTPUT_DIR_MISSING"
  | "COMFY_OUTPUT_PATH_TRAVERSAL"
  | "COMFY_PROTOCOL_ERROR"
  | "SCRIPTING_FAILED"
  | "STORYBOARD_FAILED"
  | "RENDER_FAILED"
  | "RENDER_BACKEND_INVALID"
  | "ASSET_WRITE_FAILED"
  | "ARTIFACT_PATH_TRAVERSAL"
  | "ARTIFACT_MISSING"
  | "ARTIFACT_EMPTY"
  | "ARTIFACT_INVALID"
  | "STUB_RENDER_DISABLED"
  | "FFMPEG_UNAVAILABLE"
  | "FFPROBE_UNAVAILABLE"
  | "ESPEAK_UNAVAILABLE"
  | "FONT_UNAVAILABLE"
  | "FRAME_BUDGET_EXCEEDED"
  | "comfyui_ram_budget_exceeded"
  | "INTENT_VALIDATION_FAILED"
  | "CANCELLED_BY_USER"
  | "UNKNOWN";

// ─── List / Filter ────────────────────────────────────────────────────────────

export interface VideoJobListQuery {
  status?: VideoJobStatus;
  platform?: VideoJobRequest["platform"];
  limit?: number;
  offset?: number;
}

export interface VideoJobListResponse {
  jobs: VideoJob[];
  total: number;
  limit: number;
  offset: number;
}

// ─── Cancel ───────────────────────────────────────────────────────────────────

export interface VideoJobCancelResponse {
  jobId: string;
  cancelled: boolean;
  previousStatus: VideoJobStatus;
  message: string;
}

// Canonical export alias for bridge migration.
export type VideoJobCanonical = CanonicalVideoJob;
export type { VideoJobEventData, VideoHealthEventData };

// ─── Utility ──────────────────────────────────────────────────────────────────

export function isTerminalStatus(status: VideoJobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function stageIndex(stage: VideoJobStage): number {
  return VIDEO_JOB_STAGE_ORDER.indexOf(stage);
}

/**
 * Compute overall progress (0–100) from individual stage progresses.
 * Each stage is weighted equally; completed stages count as 100%.
 */
export function computeOverallProgress(
  stages: Partial<Record<VideoJobStage, VideoStageProgress>>
): number {
  const total = VIDEO_JOB_STAGE_ORDER.length;
  let sum = 0;
  for (const stage of VIDEO_JOB_STAGE_ORDER) {
    const sp = stages[stage];
    if (sp) {
      sum += sp.stageProgress;
    }
  }
  return Math.round(sum / total);
}
