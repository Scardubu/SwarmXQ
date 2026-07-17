/**
 * apps/swarmx-api/src/workers/video-worker.ts
 * BullMQ Worker for video job processing.
 *
 * Runs in the same process as the API (co-located on 16 GB host).
 * Uses a dedicated IORedis connection — never shares with the Queue connection.
 */

import { Worker, type Job } from "bullmq";
import { loadEnv } from "../lib/env.js";
import { log } from "../lib/logger.js";
import type { VideoJobRequest } from "../types/video.js";
import {
  getJob,
  restoreJobFromBullMQ,
  VIDEO_QUEUE_NAME,
} from "../services/video-queue.js";
import { runOrchestration } from "../services/video-orchestrator.js";
import { broadcastEvent } from "../plugins/sse.js";

let worker: Worker<VideoJobRequest> | null = null;

async function processJob(job: Job<VideoJobRequest>): Promise<void> {
  const jobId = job.id!;
  // Restore registry entry if the API restarted between enqueue and dequeue
  const videoJob = getJob(jobId) ?? restoreJobFromBullMQ(jobId, job.data);
  log.info({ jobId }, "video-worker: processing job");
  await runOrchestration(videoJob.id, broadcastEvent);
}

export function startVideoWorker(): void {
  const { REDIS_URL } = loadEnv();
  // Pass connection options object — BullMQ creates its own IORedis instance,
  // keeping the Worker connection separate from the Queue connection (CLAUDE.md invariant).
  const connection = { url: REDIS_URL, maxRetriesPerRequest: null as null };

  worker = new Worker<VideoJobRequest>(VIDEO_QUEUE_NAME, processJob, {
    connection,
    concurrency: 1, // Mirrors MAX_CONCURRENT_JOBS — CPU inference is serial
  });

  worker.on("completed", (job) =>
    log.info({ jobId: job.id }, "video-worker: job completed"),
  );
  worker.on("failed", (job, err) =>
    log.error(
      { jobId: job?.id, err: String(err) },
      "video-worker: job failed",
    ),
  );
  worker.on("error", (err) =>
    log.error({ err: String(err) }, "video-worker: connection error"),
  );

  log.info({ queue: VIDEO_QUEUE_NAME }, "video-worker: started");
}

export async function stopVideoWorker(): Promise<void> {
  if (!worker) return;
  await worker.close();
  worker = null;
  log.info("video-worker: stopped");
}
