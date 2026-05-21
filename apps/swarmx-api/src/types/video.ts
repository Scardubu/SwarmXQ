/**
 * apps/swarmx-api/src/types/video.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Video Generation — Type contracts
 *
 * Job lifecycle (happy path):
 *   queued → preflight → planning → scripting → storyboard →
 *   rendering → assembling → exporting → completed
 *
 * Degraded paths:
 *   * → degraded        (partial output preserved)
 *   * → failed          (unrecoverable error)
 *   * → cancelled       (user-initiated)
 *   planning → script_only     (renderer unavailable)
 *   scripting → storyboard_only (pressure critical mid-pipe)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Job state ────────────────────────────────────────────────────────────────

export type VideoJobStatus =
  | "queued"
  | "preflight"
  | "planning"
  | "scripting"
  | "storyboard"
  | "rendering"
  | "assembling"
  | "exporting"
  | "completed"
  | "failed"
  | "cancelled"
  | "degraded";

export type VideoDegradeMode =
  | "none"           // full pipeline ran
  | "script_only"    // script produced, no storyboard/render
  | "storyboard_only"// script + storyboard, no render
  | "render_deferred"// full content ready, render queued for later
  | "intent_only";   // just parsed the intent, models unavailable

export type VideoStyle =
  | "motivational"
  | "educational"
  | "narrative"
  | "documentary"
  | "explainer"
  | "abstract"
  | "custom";

export type VideoAspect = "9:16" | "16:9" | "1:1";

export type VideoLength = "short" | "medium" | "long"; // <30s, 30–90s, >90s

// ─── Job data structures ──────────────────────────────────────────────────────

export interface VideoJobIntent {
  topic: string;
  style: VideoStyle;
  aspect: VideoAspect;
  length: VideoLength;
  targetPlatform?: "tiktok" | "youtube_shorts" | "reels" | "generic";
  tone?: string;
  keyPoints?: string[];
  rawPrompt: string;
}

export interface VideoScript {
  title: string;
  hook: string;                // first 3 seconds
  body: string;                // main narrative
  cta: string;                 // call to action
  estimatedDurationSec: number;
  wordCount: number;
  narrationText: string;       // full voiceover script
}

export interface StoryboardShot {
  index: number;
  durationSec: number;
  visualDescription: string;
  narrationSegment: string;
  cameraMotion?: string;       // e.g. "slow zoom in", "static"
  colorMood?: string;          // e.g. "warm golden", "dark blue"
  textOverlay?: string;
  comfyPrompt?: string;        // ready-to-use ComfyUI text2video prompt
}

export interface VideoStoryboard {
  shots: StoryboardShot[];
  totalDurationSec: number;
  style: VideoStyle;
  aspect: VideoAspect;
  resolution: "480p" | "720p";
  renderNotes: string;         // guidance for operator / ComfyUI
}

export interface RenderManifest {
  jobId: string;
  comfyWorkflowJson?: Record<string, unknown>; // ComfyUI API workflow
  outputDir?: string;
  clips?: RenderClip[];
  assembledPath?: string;
  rendererUsed?: "comfyui" | "ltx" | "wan" | "none";
  renderStartedAt?: string;
  renderCompletedAt?: string;
  renderError?: string;
}

export interface RenderClip {
  shotIndex: number;
  status: "queued" | "generating" | "done" | "failed";
  path?: string;
  promptId?: string;           // ComfyUI prompt_id
  durationSec: number;
}

// ─── The job record ───────────────────────────────────────────────────────────

export interface VideoJob {
  jobId: string;
  correlationId: string;       // links to SSE and workflow traces
  status: VideoJobStatus;
  degradeMode: VideoDegradeMode;
  progress: number;            // 0–100
  createdAt: string;           // ISO-8601
  updatedAt: string;
  completedAt?: string;
  cancelledAt?: string;

  // Input
  prompt: string;              // raw user prompt
  intent?: VideoJobIntent;     // classified intent

  // Pipeline outputs (accumulated as stages complete)
  plan?: string;               // free-form planning notes
  script?: VideoScript;
  storyboard?: VideoStoryboard;
  render?: RenderManifest;

  // Diagnostics
  stages: VideoStageLog[];
  error?: string;
  warnings: string[];
  pressureAtStart?: string;    // pressure level when job was created
  modelTrace?: string[];       // which models were called
}

export interface VideoStageLog {
  stage: VideoJobStatus;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  success: boolean;
  notes?: string;
  error?: string;
}

// ─── API contracts ────────────────────────────────────────────────────────────

export interface CreateVideoJobRequest {
  prompt: string;
  style?: VideoStyle;
  aspect?: VideoAspect;
  length?: VideoLength;
  targetPlatform?: VideoJobIntent["targetPlatform"];
}

export interface CreateVideoJobResponse {
  jobId: string;
  correlationId: string;
  status: VideoJobStatus;
  message: string;
  estimatedDurationSec?: number;
  degradeWarning?: string;
}

export interface VideoJobListItem {
  jobId: string;
  correlationId: string;
  status: VideoJobStatus;
  degradeMode: VideoDegradeMode;
  progress: number;
  prompt: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  hasScript: boolean;
  hasStoryboard: boolean;
  hasRender: boolean;
  error?: string;
}
