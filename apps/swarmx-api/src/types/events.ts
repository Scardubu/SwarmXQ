/**
 * apps/swarmx-api/src/types/events.ts
 * SwarmX API event contract
 *
 * Notes:
 * - Canonical wire shape for SSE events in this repo is { type, data }.
 * - Core event/data contracts are sourced from @swarmx/types.
 * - API-local video pipeline emits richer lifecycle events than the shared
 *   dashboard union, so those variants are defined here and merged into the
 *   local SwarmXEvent union.
 */

import type {
  AgentState,
  AgentStatus,
  CgroupScopeMetrics,
  LogEntry,
  LogLevel,
  RuntimeGovernorSnapshot,
  StartupSummary,
  SystemMetricsSnapshot,
  SwarmXEvent as SharedSwarmXEvent,
  WorkflowEventData,
} from "@swarmx/types";
import type {
  VideoJob,
  VideoJobStage,
  VideoStageProgress,
  VideoJobError,
} from "./video.js";

export type {
  AgentState,
  AgentStatus,
  CgroupScopeMetrics,
  LogEntry,
  LogLevel,
  RuntimeGovernorSnapshot,
  StartupSummary,
  SystemMetricsSnapshot,
  WorkflowEventData,
};

// API-local video lifecycle event shapes
export interface VideoJobCreatedEvent {
  type: "video:created";
  timestamp: string;
  data: {
    jobId: string;
    prompt: string;
    platform?: string;
    niche?: string;
    queueDepth: number;
    estimatedWaitMs?: number;
  };
}

export interface VideoJobQueuedEvent {
  type: "video:queued";
  timestamp: string;
  data: {
    jobId: string;
    queuePosition: number;
    estimatedWaitMs?: number;
  };
}

export interface VideoStageStartedEvent {
  type: "video:stage_started";
  timestamp: string;
  data: {
    jobId: string;
    stage: VideoJobStage;
    stageIndex: number;
    totalStages: number;
    modelTag?: string;
    estimatedDurationMs?: number;
  };
}

export interface VideoProgressEvent {
  type: "video:progress";
  timestamp: string;
  data: {
    jobId: string;
    stage: VideoJobStage;
    stageProgress: VideoStageProgress;
    overallProgress: number;
    message?: string;
  };
}

export interface VideoJobCompletedEvent {
  type: "video:completed";
  timestamp: string;
  data: {
    jobId: string;
    outputPublicUrl: string;
    durationSeconds: number;
    fileSizeBytes: number;
    totalDurationMs: number;
    modelsUsed: Record<string, string>;
  };
}

export interface VideoJobFailedEvent {
  type: "video:failed";
  timestamp: string;
  data: {
    jobId: string;
    error: VideoJobError;
    stage?: VideoJobStage;
    retryCount: number;
    totalDurationMs: number;
  };
}

export interface VideoJobCancelledEvent {
  type: "video:cancelled";
  timestamp: string;
  data: {
    jobId: string;
    cancelledAt: string;
    requestedBy: "user" | "orchestrator" | "pressure_governor";
    stage?: VideoJobStage;
  };
}

export interface VideoJobSnapshotEvent {
  type: "video:snapshot";
  timestamp: string;
  data: {
    job: VideoJob;
  };
}

export type VideoEvent =
  | VideoJobCreatedEvent
  | VideoJobQueuedEvent
  | VideoStageStartedEvent
  | VideoProgressEvent
  | VideoJobCompletedEvent
  | VideoJobFailedEvent
  | VideoJobCancelledEvent
  | VideoJobSnapshotEvent;

export type SwarmXEvent = SharedSwarmXEvent | VideoEvent;

export function isVideoEvent(event: SwarmXEvent): event is VideoEvent {
  return event.type.startsWith("video:");
}

export function toSSEFrame(event: SwarmXEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

export function parseSSEFrame(raw: string): SwarmXEvent | null {
  try {
    return JSON.parse(raw) as SwarmXEvent;
  } catch {
    return null;
  }
}

export function makeVideoCreatedEvent(
  jobId: string,
  prompt: string,
  queueDepth: number,
  extra?: Partial<VideoJobCreatedEvent["data"]>,
): VideoJobCreatedEvent {
  return {
    type: "video:created",
    timestamp: new Date().toISOString(),
    data: { jobId, prompt, queueDepth, ...extra },
  };
}

export function makeVideoProgressEvent(
  jobId: string,
  stage: VideoJobStage,
  stageProgress: VideoStageProgress,
  overallProgress: number,
  message?: string,
): VideoProgressEvent {
  return {
    type: "video:progress",
    timestamp: new Date().toISOString(),
    data: {
      jobId,
      stage,
      stageProgress,
      overallProgress,
      ...(message !== undefined ? { message } : {}),
    },
  };
}

export function makeVideoCompletedEvent(
  jobId: string,
  data: Omit<VideoJobCompletedEvent["data"], "jobId">,
): VideoJobCompletedEvent {
  return {
    type: "video:completed",
    timestamp: new Date().toISOString(),
    data: { jobId, ...data },
  };
}

export function makeVideoFailedEvent(
  jobId: string,
  error: VideoJobError,
  retryCount: number,
  totalDurationMs: number,
  stage?: VideoJobStage,
): VideoJobFailedEvent {
  return {
    type: "video:failed",
    timestamp: new Date().toISOString(),
    data: {
      jobId,
      error,
      retryCount,
      totalDurationMs,
      ...(stage !== undefined ? { stage } : {}),
    },
  };
}
