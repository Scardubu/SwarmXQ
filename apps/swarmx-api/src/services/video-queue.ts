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
import { Queue } from "bullmq";
import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import type {
  VideoJob,
  VideoJobRequest,
  VideoJobStatus,
  VideoJobStage,
  VideoStageProgress,
  VideoJobError,
} from "../types/video.js";
import { isTerminalStatus, VIDEO_JOB_STAGE_ORDER } from "../types/video.js";
import type { SwarmXEvent } from "../types/events.js";
import { subscribeToEvents } from "../plugins/sse.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const MAX_QUEUE_SIZE = parseInt(process.env.VIDEO_QUEUE_MAX_SIZE ?? "20", 10);
// SINGLE-VIDEO LOCK: 8 GB RAM cannot support parallel generation
const MAX_CONCURRENT_JOBS = 1;
const concurrency = MAX_CONCURRENT_JOBS;
const CONFIGURED_CONCURRENCY = parseInt(
  process.env.VIDEO_MAX_CONCURRENT_JOBS ?? "1",
  10,
);
const MAX_RETRIES = parseInt(process.env.VIDEO_MAX_RETRIES ?? "1", 10);
const JOB_TTL_MS = parseInt(
  process.env.VIDEO_JOB_TTL_MS ?? String(4 * 60 * 60 * 1000), // 4 h
  10
);
const VIDEO_QUEUE_NAME = process.env.SWARMX_VIDEO_QUEUE_NAME ?? "swarmx:video";
const BULLMQ_ENABLED = process.env.SWARMX_VIDEO_USE_BULLMQ === "1";
const REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";
const ARTIFACT_DIR = resolve(
  process.env.SWARMX_VIDEO_ARTIFACT_DIR ??
    resolve(process.cwd(), ".swarmx", "video", "artifacts"),
);

// ─── Internal ─────────────────────────────────────────────────────────────────

const registry = new Map<string, VideoJob>();
let bullQueue: Queue<VideoJobRequest> | null = null;

function getBullQueue(): Queue<VideoJobRequest> {
  if (!bullQueue) {
    bullQueue = new Queue<VideoJobRequest>(VIDEO_QUEUE_NAME, {
      connection: { url: REDIS_URL },
      defaultJobOptions: {
        attempts: MAX_RETRIES + 1,
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 1000 },
      },
    });
  }
  return bullQueue;
}

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

  if (BULLMQ_ENABLED) {
    void getBullQueue().add("video-job", request, {
      jobId: job.id,
      priority: 5,
    });
  }

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

  if (CONFIGURED_CONCURRENCY > 1) {
    console.warn(
      `[video-queue] ignoring VIDEO_MAX_CONCURRENT_JOBS=${CONFIGURED_CONCURRENCY}; SINGLE-VIDEO LOCK enforced`,
    );
  }

  // SINGLE-VIDEO LOCK: 8 GB RAM cannot support parallel generation
  if (running >= concurrency) return null;

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
  if (running >= concurrency) return undefined;

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

export function isBullMQEnabled(): boolean {
  return BULLMQ_ENABLED;
}

export async function reprioritizeQueue(orderedIds: string[]): Promise<void> {
  const queuedJobs = [...registry.values()].filter((job) => job.status === "queued");
  const indexed = new Map(orderedIds.map((id, idx) => [id, idx]));

  const sorted = queuedJobs.sort((left, right) => {
    const leftIdx = indexed.get(left.id);
    const rightIdx = indexed.get(right.id);
    if (leftIdx === undefined && rightIdx === undefined) {
      return Date.parse(left.createdAt) - Date.parse(right.createdAt);
    }
    if (leftIdx === undefined) return 1;
    if (rightIdx === undefined) return -1;
    return leftIdx - rightIdx;
  });

  for (const job of sorted) {
    registry.delete(job.id);
    registry.set(job.id, job);
  }

  if (BULLMQ_ENABLED) {
    const q = getBullQueue();
    for (let i = 0; i < sorted.length; i += 1) {
      const jobAtIndex = sorted[i];
      if (!jobAtIndex) continue;
      const priority = Math.max(1, sorted.length - i);
      const bullJob = await q.getJob(jobAtIndex.id);
      if (bullJob) {
        await bullJob.changePriority({ priority });
      }
    }
  }
}

export async function resumeJob(id: string, fromStage: VideoJobStatus): Promise<VideoJob> {
  const job = registry.get(id);
  if (!job) {
    throw new Error(`VideoQueue: job ${id} not found`);
  }
  if (job.status !== "failed" && job.status !== "cancelled" && job.status !== "completed") {
    throw new Error(`VideoQueue: job ${id} is not terminal and cannot be resumed`);
  }

  const artifactEntries = await readdir(ARTIFACT_DIR).catch(() => [] as string[]);
  const hasPartialArtifacts = artifactEntries.some((entry) => entry.startsWith(job.id));
  if (!hasPartialArtifacts) {
    throw new Error("no_partial_artifacts");
  }

  job.status = "queued";
  job.resumeFromStage = fromStage;
  job.retryCount += 1;
  job.updatedAt = now();
  delete job.error;
  delete job.completedAt;
  return job;
}

export function subscribeToJob(jobId: string): AsyncIterable<SwarmXEvent> {
  return {
    [Symbol.asyncIterator](): AsyncIterator<SwarmXEvent> {
      const queueItems: SwarmXEvent[] = [];
      let pendingPromise: Promise<IteratorResult<SwarmXEvent>> | null = null;
      let pendingResolver: ((value: IteratorResult<SwarmXEvent>) => void) | null = null;
      let closed = false;

      const createPending = (): Promise<IteratorResult<SwarmXEvent>> => {
        pendingPromise = new Promise<IteratorResult<SwarmXEvent>>((resolveNext) => {
          pendingResolver = resolveNext;
        });
        return pendingPromise;
      };

      const resolvePending = (value: IteratorResult<SwarmXEvent>): void => {
        const resolver = pendingResolver;
        pendingResolver = null;
        pendingPromise = null;
        if (resolver) {
          resolver(value);
        }
      };

      const unsubscribe = subscribeToEvents((event) => {
        if (!event.type.startsWith("video:")) return;
        const data = (event as { data?: unknown }).data;
        const matches = Boolean(
          data && typeof data === "object" && (
            ("jobId" in data && (data as { jobId?: string }).jobId === jobId) ||
            ("job" in data &&
              typeof (data as { job?: unknown }).job === "object" &&
              (data as { job: { id?: string } }).job.id === jobId)
          ),
        );
        if (!matches || closed) return;

        if (pendingResolver) {
          resolvePending({ value: event, done: false });
        } else {
          queueItems.push(event);
        }

        if (["video:completed", "video:failed", "video:cancelled"].includes(event.type)) {
          closed = true;
          unsubscribe();
          if (pendingResolver) {
            resolvePending({ value: undefined, done: true });
          }
        }
      });

      return {
        next(): Promise<IteratorResult<SwarmXEvent>> {
          if (queueItems.length > 0) {
            const nextItem = queueItems.shift();
            if (nextItem) return Promise.resolve({ value: nextItem, done: false });
          }
          if (closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return pendingPromise ?? createPending();
        },
        return(): Promise<IteratorResult<SwarmXEvent>> {
          closed = true;
          unsubscribe();
          if (pendingResolver) {
            resolvePending({ value: undefined, done: true });
          }
          return Promise.resolve({ value: undefined, done: true });
        },
      };
    },
  };
}

export function queueName(): string {
  return VIDEO_QUEUE_NAME;
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