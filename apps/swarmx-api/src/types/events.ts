/**
 * apps/swarmx-api/src/types/events.ts
 * SwarmXQ — Canonical SSE Event Union
 *
 * Extends the existing event surface with video job lifecycle events.
 * All events are discriminated by `type` and carry an ISO 8601 `timestamp`.
 */

import type {
  VideoJob,
  VideoJobStatus,
  VideoJobStage,
  VideoStageProgress,
  VideoJobError,
} from "./video.js";

// ─── Base ────────────────────────────────────────────────────────────────────

interface BaseEvent {
  timestamp: string; // ISO 8601
  /** Correlation ID for tracing across Python and TypeScript layers. */
  traceId?: string;
}

// ─── System Events ────────────────────────────────────────────────────────────

export interface GovernorEvent extends BaseEvent {
  type: "system:governor";
  payload: {
    pressureLevel: "normal" | "high" | "critical";
    availableMb: number;
    zramUsedPct: number;
    concurrencyLimit: number;
    observeOnly: boolean;
    tokenCeilings: Record<string, number>;
  };
}

export interface StartupEvent extends BaseEvent {
  type: "system:startup";
  payload: {
    status: "ready" | "degraded" | "failed";
    narrative: string;
    pressureLevel: "normal" | "high" | "critical";
    availableMb: number;
    zramUsedPct: number;
    concurrencyLimit: number;
    ollamaReachable: boolean;
    warmupDone: boolean;
    evolverSynced: boolean;
    durationMs: number;
  };
}

export interface HeartbeatEvent extends BaseEvent {
  type: "system:heartbeat";
  payload: { uptime: number };
}

// ─── Mission / Run / Task Events (existing) ───────────────────────────────────

export interface MissionEvent extends BaseEvent {
  type: "mission:started" | "mission:completed" | "mission:failed";
  payload: {
    missionId: string;
    goal?: string;
    durationMs?: number;
    error?: string;
  };
}

export interface RunEvent extends BaseEvent {
  type: "run:started" | "run:completed" | "run:failed";
  payload: {
    runId: string;
    taskId?: string;
    model?: string;
    durationMs?: number;
    error?: string;
  };
}

export interface TaskEvent extends BaseEvent {
  type: "task:started" | "task:completed" | "task:failed";
  payload: {
    taskId: string;
    prompt?: string;
    result?: string;
    durationMs?: number;
    error?: string;
  };
}

export interface EvolutionEvent extends BaseEvent {
  type:
    | "evolution:observed"
    | "evolution:critiqued"
    | "evolution:proposed"
    | "evolution:approved"
    | "evolution:rejected"
    | "evolution:applied";
  payload: {
    proposalId: string;
    risk?: "low" | "medium" | "high";
    fitnessScore?: number;
    description?: string;
  };
}

// ─── Video Job Events (NEW) ───────────────────────────────────────────────────

/**
 * Emitted when a video job transitions to "queued".
 */
export interface VideoJobCreatedEvent extends BaseEvent {
  type: "video:created";
  payload: {
    jobId: string;
    prompt: string;
    platform?: string;
    niche?: string;
    queueDepth: number;
    estimatedWaitMs?: number;
  };
}

/**
 * Emitted when the job moves from "queued" to "running".
 */
export interface VideoJobQueuedEvent extends BaseEvent {
  type: "video:queued";
  payload: {
    jobId: string;
    queuePosition: number;
    estimatedWaitMs?: number;
  };
}

/**
 * Emitted when a stage transitions to active.
 */
export interface VideoStageStartedEvent extends BaseEvent {
  type: "video:stage_started";
  payload: {
    jobId: string;
    stage: VideoJobStage;
    stageIndex: number;
    totalStages: number;
    modelTag?: string;
    estimatedDurationMs?: number;
  };
}

/**
 * Emitted periodically within a stage to report granular progress.
 */
export interface VideoProgressEvent extends BaseEvent {
  type: "video:progress";
  payload: {
    jobId: string;
    stage: VideoJobStage;
    stageProgress: VideoStageProgress;
    overallProgress: number;
    message?: string;
  };
}

/**
 * Emitted when the job transitions to "completed".
 */
export interface VideoJobCompletedEvent extends BaseEvent {
  type: "video:completed";
  payload: {
    jobId: string;
    outputPublicUrl: string;
    durationSeconds: number;
    fileSizeBytes: number;
    totalDurationMs: number;
    modelsUsed: Record<string, string>;
  };
}

/**
 * Emitted when the job transitions to "failed".
 */
export interface VideoJobFailedEvent extends BaseEvent {
  type: "video:failed";
  payload: {
    jobId: string;
    error: VideoJobError;
    stage?: VideoJobStage;
    retryCount: number;
    totalDurationMs: number;
  };
}

/**
 * Emitted when the job is cancelled by the user or orchestrator.
 */
export interface VideoJobCancelledEvent extends BaseEvent {
  type: "video:cancelled";
  payload: {
    jobId: string;
    cancelledAt: string;
    requestedBy: "user" | "orchestrator" | "pressure_governor";
    stage?: VideoJobStage;
  };
}

/**
 * Full job snapshot — emitted after any status transition.
 * Allows dashboard to re-hydrate from a single event.
 */
export interface VideoJobSnapshotEvent extends BaseEvent {
  type: "video:snapshot";
  payload: {
    job: VideoJob;
  };
}

// ─── Union ────────────────────────────────────────────────────────────────────

export type VideoEvent =
  | VideoJobCreatedEvent
  | VideoJobQueuedEvent
  | VideoStageStartedEvent
  | VideoProgressEvent
  | VideoJobCompletedEvent
  | VideoJobFailedEvent
  | VideoJobCancelledEvent
  | VideoJobSnapshotEvent;

export type SwarmXEvent =
  | GovernorEvent
  | StartupEvent
  | HeartbeatEvent
  | MissionEvent
  | RunEvent
  | TaskEvent
  | EvolutionEvent
  | VideoEvent;

// ─── Type Guards ──────────────────────────────────────────────────────────────

export function isVideoEvent(event: SwarmXEvent): event is VideoEvent {
  return event.type.startsWith("video:");
}

export function isGovernorEvent(event: SwarmXEvent): event is GovernorEvent {
  return event.type === "system:governor";
}

// ─── SSE Wire Format ──────────────────────────────────────────────────────────

/**
 * Serialise a SwarmXEvent to the SSE wire format.
 * `event:` line is the discriminator; `data:` line is JSON-encoded payload.
 */
export function toSSEFrame(event: SwarmXEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/**
 * Parse an SSE data line back into a SwarmXEvent.
 * Returns null on parse failure so callers can skip malformed frames.
 */
export function parseSSEFrame(raw: string): SwarmXEvent | null {
  try {
    return JSON.parse(raw) as SwarmXEvent;
  } catch {
    return null;
  }
}

// ─── Event Factory Helpers ────────────────────────────────────────────────────

export function makeVideoCreatedEvent(
  jobId: string,
  prompt: string,
  queueDepth: number,
  extra?: Partial<VideoJobCreatedEvent["payload"]>
): VideoJobCreatedEvent {
  return {
    type: "video:created",
    timestamp: new Date().toISOString(),
    payload: { jobId, prompt, queueDepth, ...extra },
  };
}

export function makeVideoProgressEvent(
  jobId: string,
  stage: VideoJobStage,
  stageProgress: VideoStageProgress,
  overallProgress: number,
  message?: string
): VideoProgressEvent {
  return {
    type: "video:progress",
    timestamp: new Date().toISOString(),
    payload: { jobId, stage, stageProgress, overallProgress, message },
  };
}

export function makeVideoCompletedEvent(
  jobId: string,
  payload: Omit<VideoJobCompletedEvent["payload"], "jobId">
): VideoJobCompletedEvent {
  return {
    type: "video:completed",
    timestamp: new Date().toISOString(),
    payload: { jobId, ...payload },
  };
}

export function makeVideoFailedEvent(
  jobId: string,
  error: VideoJobError,
  retryCount: number,
  totalDurationMs: number,
  stage?: VideoJobStage
): VideoJobFailedEvent {
  return {
    type: "video:failed",
    timestamp: new Date().toISOString(),
    payload: { jobId, error, stage, retryCount, totalDurationMs },
  };
}