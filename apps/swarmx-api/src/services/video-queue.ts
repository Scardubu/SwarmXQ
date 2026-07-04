/**
 * apps/swarmx-api/src/services/video-queue.ts
 * SwarmXQ Video Subsystem — In-Memory Job Queue
 *
 * Responsibilities:
 *  - Job registry (Map<id, VideoJob>)
 *  - State transitions with invariant enforcement
 *  - Retry / terminal-state handling
 *  - Concurrency gating via pressure monitor
 */

import { randomUUID } from "node:crypto";
import type {
  VideoJob,
  VideoJobRequest,
  VideoJobStatus,
  VideoJobStage,
  VideoStageProgress,
  VideoJobError,
} from "../types/video.js";
import { isTerminalStatus, VIDEO_JOB_STAGE_ORDER } from "../types/video.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = parseInt(process.env.VIDEO_QUEUE_MAX_SIZE ?? "20", 10);
const MAX_CONCURRENT_JOBS = parseInt(
  process.env.VIDEO_MAX_CONCURRENT_JOBS ?? "1",
  10
);
const MAX_RETRIES = parseInt(process.env.VIDEO_MAX_RETRIES ?? "1", 10);
const JOB_TTL_MS = parseInt(
  process.env.VIDEO_JOB_TTL_MS ?? String(4 * 60 * 60 * 1000), // 4 h
  10
);

// ─── Internal ─────────────────────────────────────────────────────────────────

const registry = new Map<string, VideoJob>();

function now(): string {
  return new Date().toISOString();
}

function assertMutable(job: VideoJob, op: string): void {
  if (isTerminalStatus(job.status)) {
    throw new Error(
      `VideoQueue: cannot perform '${op}' on job ${job.id} — already in terminal state '${job.status}'`
    );
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Create a new job and place it in 'queued' state.
 * Throws if the queue is full.
 */
export function enqueue(request: VideoJobRequest): VideoJob {
  const queued = [...registry.values()].filter(
    (j) => j.status === "queued" || j.status === "running"
  );

  if (queued.length >= MAX_QUEUE_SIZE) {
    throw new Error(
      `VideoQueue: queue is full (${MAX_QUEUE_SIZE} active jobs). Try again later.`
    );
  }

  // Idempotency: if client re-submits the same clientRequestId and the prior
  // job is non-terminal, return the existing job.
  if (request.clientRequestId) {
    for (const existing of registry.values()) {
      if (
        existing.clientRequestId === request.clientRequestId &&
        !isTerminalStatus(existing.status)
      ) {
        return existing;
      }
    }
  }

  const job: VideoJob = {
    id: randomUUID(),
    status: "queued",
    request,
    stages: {},
    overallProgress: 0,
    retryCount: 0,
    createdAt: now(),
    updatedAt: now(),
    ...(request.clientRequestId !== undefined
      ? { clientRequestId: request.clientRequestId }
      : {}),
  };

  registry.set(job.id, job);
  scheduleCleanup(job.id);
  return job;
}

/**
 * Retrieve a job by id.
 */
export function getJob(id: string): VideoJob | undefined {
  return registry.get(id);
}

/**
 * List jobs, optionally filtered by status.
 */
export function listJobs(filter?: {
  status?: VideoJobStatus;
  limit?: number;
  offset?: number;
}): { jobs: VideoJob[]; total: number } {
  let all = [...registry.values()].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );

  if (filter?.status) {
    all = all.filter((j) => j.status === filter.status);
  }

  const total = all.length;
  const offset = filter?.offset ?? 0;
  const limit = Math.min(filter?.limit ?? 50, 100);
  return { jobs: all.slice(offset, offset + limit), total };
}

/**
 * Transition a job from 'queued' → 'running'.
 * Returns null if concurrency limit is reached or job is not in queued state.
 */
export function startJob(id: string): VideoJob | null {
  const job = registry.get(id);
  if (!job || job.status !== "queued") return null;

  const running = [...registry.values()].filter(
    (j) => j.status === "running"
  ).length;
  if (running >= MAX_CONCURRENT_JOBS) return null;

  job.status = "running";
  job.startedAt = now();
  job.updatedAt = now();
  return job;
}

/**
 * Record progress for a stage.
 */
export function recordStageProgress(
  id: string,
  stage: VideoJobStage,
  progress: VideoStageProgress
): VideoJob {
  const job = registry.get(id);
  if (!job) throw new Error(`VideoQueue: job ${id} not found`);
  assertMutable(job, "recordStageProgress");

  job.stages[stage] = progress;
  job.currentStage = stage;
  job.overallProgress = progress.overallProgress;
  job.updatedAt = now();
  return job;
}

/**
 * Mark stage as completed.
 */
export function completeStage(
  id: string,
  stage: VideoJobStage
): VideoJob {
  const job = registry.get(id);
  if (!job) throw new Error(`VideoQueue: job ${id} not found`);
  assertMutable(job, "completeStage");

  const existing = job.stages[stage] ?? {
    stage,
    stageProgress: 0,
    overallProgress: 0,
  };

  const stageIdx = VIDEO_JOB_STAGE_ORDER.indexOf(stage);
  const total = VIDEO_JOB_STAGE_ORDER.length;
  const overallProgress = Math.round(((stageIdx + 1) / total) * 100);

  job.stages[stage] = {
    ...existing,
    stage,
    stageProgress: 100,
    overallProgress,
    completedAt: now(),
    ...(existing.startedAt
      ? { durationMs: Date.now() - Date.parse(existing.startedAt) }
      : {}),
  };
  job.overallProgress = overallProgress;
  job.updatedAt = now();
  return job;
}

/**
 * Transition a job to 'completed'.
 */
export function completeJob(
  id: string,
  output: VideoJob["output"]
): VideoJob {
  const job = registry.get(id);
  if (!job) throw new Error(`VideoQueue: job ${id} not found`);
  assertMutable(job, "completeJob");

  job.status = "completed";
  if (output !== undefined) {
    job.output = output;
  }
  job.overallProgress = 100;
  job.completedAt = now();
  job.updatedAt = now();
  delete job.currentStage;
  return job;
}

/**
 * Transition a job to 'failed'.
 * If retries remain and the error is retryable, re-queues the job.
 * Returns the updated job (either failed or re-queued).
 */
export function failJob(id: string, error: VideoJobError): VideoJob {
  const job = registry.get(id);
  if (!job) throw new Error(`VideoQueue: job ${id} not found`);
  assertMutable(job, "failJob");

  if (error.retryable && job.retryCount < MAX_RETRIES) {
    job.status = "queued";
    job.retryCount += 1;
    job.error = error;
    delete job.currentStage;
    delete job.startedAt;
    job.stages = {};
    job.overallProgress = 0;
    job.updatedAt = now();
    return job;
  }

  job.status = "failed";
  job.error = error;
  job.completedAt = now();
  job.updatedAt = now();
  delete job.currentStage;
  return job;
}

/**
 * Cancel a job.
 * Returns false if the job is already in a terminal state.
 */
export function cancelJob(id: string): boolean {
  const job = registry.get(id);
  if (!job || isTerminalStatus(job.status)) return false;

  job.status = "cancelled";
  job.completedAt = now();
  job.updatedAt = now();
  delete job.currentStage;
  return true;
}

/**
 * Pick the next queued job that fits concurrency limits.
 * Returns undefined if nothing is available or concurrency is saturated.
 */
export function dequeueNext(): VideoJob | undefined {
  const running = [...registry.values()].filter(
    (j) => j.status === "running"
  ).length;
  if (running >= MAX_CONCURRENT_JOBS) return undefined;

  return [...registry.values()]
    .filter((j) => j.status === "queued")
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
}

/**
 * Number of jobs currently running.
 */
export function runningCount(): number {
  return [...registry.values()].filter((j) => j.status === "running").length;
}

/**
 * Number of jobs currently queued.
 */
export function queuedCount(): number {
  return [...registry.values()].filter((j) => j.status === "queued").length;
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

function scheduleCleanup(id: string): void {
  setTimeout(() => {
    const job = registry.get(id);
    if (job && isTerminalStatus(job.status)) {
      registry.delete(id);
    }
  }, JOB_TTL_MS);
}