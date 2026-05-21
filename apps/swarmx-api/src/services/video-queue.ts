/**
 * apps/swarmx-api/src/services/video-queue.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Video Queue — In-memory job store + sequential processor
 *
 * Design:
 *   - All jobs live in a Map<jobId, VideoJob> — local-first, no Redis needed
 *   - A single-lane processor ensures models load sequentially (8 GB constraint)
 *   - Jobs are processed FIFO; cancellation is honoured at stage boundaries
 *   - SSE events are emitted on every state transition via broadcastEvent()
 *
 * Concurrency model:
 *   One job runs at a time (video generation is model-heavy). Subsequent queued
 *   jobs wait. Under critical pressure the processor defers new renders but still
 *   runs planning/scripting/storyboard stages which are lighter.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { randomUUID } from "node:crypto";
import { broadcastEvent } from "../plugins/sse.js";
import {
  type VideoJob,
  type VideoJobStatus,
  type VideoStageLog,
  type VideoJobListItem,
  type CreateVideoJobRequest,
  type VideoDegradeMode,
} from "../types/video.js";

// ─── In-memory store ──────────────────────────────────────────────────────────

const jobs = new Map<string, VideoJob>();
const pendingQueue: string[] = [];  // jobIds waiting to run
let processorRunning = false;

// Keep the last 200 completed/failed jobs; trim older ones to prevent unbounded growth
const MAX_COMPLETED = 200;

// ─── Processor callback ───────────────────────────────────────────────────────

let _processorFn: ((job: VideoJob) => Promise<void>) | null = null;

export function registerVideoProcessor(fn: (job: VideoJob) => Promise<void>): void {
  _processorFn = fn;
}

// ─── Job factory ─────────────────────────────────────────────────────────────

export function createJob(req: CreateVideoJobRequest, pressureLevel: string): VideoJob {
  const jobId = randomUUID();
  const correlationId = randomUUID();
  const now = new Date().toISOString();

  const job: VideoJob = {
    jobId,
    correlationId,
    status: "queued",
    degradeMode: "none",
    progress: 0,
    createdAt: now,
    updatedAt: now,
    prompt: req.prompt.trim().slice(0, 2000),
    stages: [],
    warnings: [],
    pressureAtStart: pressureLevel,
    modelTrace: [],
  };

  jobs.set(jobId, job);
  pendingQueue.push(jobId);

  emitVideoEvent(job);
  scheduleProcessor();

  return job;
}

// ─── Job accessors ────────────────────────────────────────────────────────────

export function getJob(jobId: string): VideoJob | undefined {
  return jobs.get(jobId);
}

export function listJobs(limit = 50): VideoJobListItem[] {
  const sorted = [...jobs.values()]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);

  return sorted.map(toListItem);
}

export function cancelJob(jobId: string): boolean {
  const job = jobs.get(jobId);
  if (!job) return false;
  if (["completed", "failed", "cancelled"].includes(job.status)) return false;

  updateJob(jobId, {
    status: "cancelled",
    cancelledAt: new Date().toISOString(),
    progress: job.progress,
  });

  // Remove from pending queue if not yet started
  const idx = pendingQueue.indexOf(jobId);
  if (idx >= 0) pendingQueue.splice(idx, 1);

  return true;
}

// ─── Job mutation helpers (used by orchestrator) ──────────────────────────────

export function transitionStatus(
  jobId: string,
  status: VideoJobStatus,
  progress: number,
  notes?: string,
): void {
  const job = jobs.get(jobId);
  if (!job) return;

  // Finalise previous stage log if any
  const lastStage = job.stages[job.stages.length - 1];
  if (lastStage && !lastStage.completedAt) {
    lastStage.completedAt = new Date().toISOString();
    lastStage.durationMs =
      new Date(lastStage.completedAt).getTime() -
      new Date(lastStage.startedAt).getTime();
    lastStage.success = true;
    lastStage.notes = notes;
  }

  // Open new stage log
  job.stages.push({
    stage: status,
    startedAt: new Date().toISOString(),
    success: false,
  });

  updateJob(jobId, { status, progress });
}

export function markStageError(jobId: string, error: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  const lastStage = job.stages[job.stages.length - 1];
  if (lastStage) {
    lastStage.completedAt = new Date().toISOString();
    lastStage.success = false;
    lastStage.error = error;
    lastStage.durationMs =
      new Date(lastStage.completedAt).getTime() -
      new Date(lastStage.startedAt).getTime();
  }
}

export function updateJob(jobId: string, patch: Partial<VideoJob>): void {
  const job = jobs.get(jobId);
  if (!job) return;
  Object.assign(job, patch, { updatedAt: new Date().toISOString() });
  emitVideoEvent(job);
  maybeTrimCompleted();
}

export function addWarning(jobId: string, warning: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.warnings.push(warning);
}

export function addModelTrace(jobId: string, model: string): void {
  const job = jobs.get(jobId);
  if (!job) return;
  job.modelTrace = [...(job.modelTrace ?? []), model];
}

// ─── SSE broadcasting ─────────────────────────────────────────────────────────

function emitVideoEvent(job: VideoJob): void {
  try {
    broadcastEvent({
      type: "video:progress",
      data: {
        jobId: job.jobId,
        correlationId: job.correlationId,
        status: job.status,
        degradeMode: job.degradeMode,
        progress: job.progress,
        error: job.error,
        timestamp: job.updatedAt,
      },
    });
  } catch {
    // Non-fatal — SSE subscriber may have disconnected
  }
}

// ─── Sequential processor ─────────────────────────────────────────────────────

function scheduleProcessor(): void {
  if (processorRunning) return;
  setImmediate(runProcessor);
}

async function runProcessor(): Promise<void> {
  if (processorRunning) return;
  processorRunning = true;

  while (pendingQueue.length > 0) {
    const jobId = pendingQueue[0];
    const job = jobs.get(jobId);

    if (!job || job.status === "cancelled") {
      pendingQueue.shift();
      continue;
    }

    // Dequeue and run
    pendingQueue.shift();

    try {
      if (_processorFn) {
        await _processorFn(job);
      } else {
        updateJob(jobId, {
          status: "failed",
          error: "No video processor registered",
          completedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      updateJob(jobId, {
        status: "failed",
        error,
        completedAt: new Date().toISOString(),
      });
    }
  }

  processorRunning = false;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toListItem(job: VideoJob): VideoJobListItem {
  return {
    jobId: job.jobId,
    correlationId: job.correlationId,
    status: job.status,
    degradeMode: job.degradeMode,
    progress: job.progress,
    prompt: job.prompt,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    completedAt: job.completedAt,
    hasScript: !!job.script,
    hasStoryboard: !!job.storyboard,
    hasRender: !!(job.render?.clips?.some((c) => c.status === "done")),
    error: job.error,
  };
}

function maybeTrimCompleted(): void {
  const terminal = [...jobs.values()].filter(
    (j) => j.status === "completed" || j.status === "failed" || j.status === "cancelled",
  );
  if (terminal.length > MAX_COMPLETED) {
    const toRemove = terminal
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, terminal.length - MAX_COMPLETED);
    for (const j of toRemove) {
      jobs.delete(j.jobId);
    }
  }
}
