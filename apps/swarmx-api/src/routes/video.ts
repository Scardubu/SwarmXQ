/**
 * apps/swarmx-api/src/routes/video.ts
 * SwarmXQ Video Subsystem — Fastify Route Plugin
 *
 * Exposes:
 *   POST   /api/video/jobs
 *   GET    /api/video/jobs
 *   GET    /api/video/jobs/:id
 *   POST   /api/video/jobs/:id/cancel
 *   GET    /api/video/files/:filename   (static output serving)
 */

import type { FastifyInstance, FastifyPluginOptions } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { VideoJobRequest, VideoJobListQuery } from "../types/video.js";
import * as queue from "../services/video-queue.js";
import * as assets from "../services/video-assets.js";
import { runOrchestration } from "../services/video-orchestrator.js";
import type { BroadcastFn } from "../services/video-orchestrator.js";

// ─── Schema ───────────────────────────────────────────────────────────────────

const VideoJobRequestSchema = {
  type: "object",
  required: ["prompt"],
  properties: {
    prompt: { type: "string", minLength: 1, maxLength: 2000 },
    platform: {
      type: "string",
      enum: ["tiktok", "youtube_shorts", "reels", "generic"],
    },
    niche: {
      type: "string",
      enum: ["motivational", "finance", "facts", "true_crime", "tech", "other"],
    },
    targetDurationSeconds: { type: "number", minimum: 15, maximum: 180 },
    modelTier: {
      type: "string",
      enum: ["fast", "worker", "supervisor", "reasoner"],
    },
    clientRequestId: { type: "string", maxLength: 128 },
  },
} as const;

const JobIdParamSchema = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string" } },
} as const;

const ListQuerySchema = {
  type: "object",
  properties: {
    status: {
      type: "string",
      enum: ["queued", "running", "completed", "failed", "cancelled"],
    },
    platform: { type: "string" },
    limit: { type: "number", minimum: 1, maximum: 100 },
    offset: { type: "number", minimum: 0 },
  },
} as const;

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function videoRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & { broadcast?: BroadcastFn }
): Promise<void> {
  const broadcast: BroadcastFn =
    opts.broadcast ??
    ((event) => fastify.log.debug({ event }, "video:event (no broadcaster)"));

  // ── POST /api/video/jobs ───────────────────────────────────────────────────
  fastify.post<{ Body: VideoJobRequest }>(
    "/api/video/jobs",
    {
      schema: {
        body: VideoJobRequestSchema,
        response: {
          201: {
            type: "object",
            properties: {
              jobId: { type: "string" },
              status: { type: "string" },
              createdAt: { type: "string" },
              message: { type: "string" },
            },
          },
          422: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
          503: {
            type: "object",
            properties: {
              error: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      let job;
      try {
        job = queue.enqueue(request.body);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "Queue error";
        return reply.status(503).send({ error: "queue_full", message });
      }

      // Kick off orchestration asynchronously — do not await.
      setImmediate(() => {
        const started = queue.startJob(job.id);
        if (started) {
          void runOrchestration(job.id, broadcast).catch((err) => {
            fastify.log.error({ err, jobId: job.id }, "video orchestration crashed");
          });
        }
      });

      return reply.status(201).send({
        jobId: job.id,
        status: job.status,
        createdAt: job.createdAt,
        message: `Video job created. Track progress via SSE or GET /api/video/jobs/${job.id}`,
      });
    }
  );

  // ── GET /api/video/jobs ────────────────────────────────────────────────────
  fastify.get<{ Querystring: VideoJobListQuery }>(
    "/api/video/jobs",
    {
      schema: { querystring: ListQuerySchema },
    },
    async (request, reply) => {
      const { status, limit = 20, offset = 0 } = request.query;
      const result = queue.listJobs({
        limit,
        offset,
        ...(status !== undefined ? { status } : {}),
      });
      return reply.send({
        jobs: result.jobs,
        total: result.total,
        limit,
        offset,
        queueDepth: queue.queuedCount(),
        runningCount: queue.runningCount(),
      });
    }
  );

  // ── GET /api/video/jobs/:id ────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    "/api/video/jobs/:id",
    {
      schema: { params: JobIdParamSchema },
    },
    async (request, reply) => {
      const job = queue.getJob(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "not_found",
          message: `Video job ${request.params.id} not found`,
        });
      }
      return reply.send(job);
    }
  );

  // ── POST /api/video/jobs/:id/cancel ───────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/api/video/jobs/:id/cancel",
    {
      schema: { params: JobIdParamSchema },
    },
    async (request, reply) => {
      const job = queue.getJob(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "not_found",
          message: `Video job ${request.params.id} not found`,
        });
      }

      const previousStatus = job.status;
      const cancelled = queue.cancelJob(request.params.id);

      if (!cancelled) {
        return reply.status(409).send({
          error: "already_terminal",
          message: `Job is already in terminal state '${previousStatus}'`,
        });
      }

      broadcast({
        type: "video:cancelled",
        timestamp: new Date().toISOString(),
        data: {
          jobId: job.id,
          cancelledAt: new Date().toISOString(),
          requestedBy: "user",
          ...(job.currentStage !== undefined ? { stage: job.currentStage } : {}),
        },
      });

      return reply.send({
        jobId: job.id,
        cancelled: true,
        previousStatus,
        message: "Job cancelled",
      });
    }
  );

  // ── GET /api/video/files/:filename ─────────────────────────────────────────
  fastify.get<{ Params: { filename: string } }>(
    "/api/video/files/:filename",
    {
      schema: {
        params: {
          type: "object",
          required: ["filename"],
          properties: { filename: { type: "string" } },
        },
      },
    },
    async (request, reply) => {
      // Prevent path traversal
      const { filename } = request.params;
      if (filename.includes("..") || filename.includes("/")) {
        return reply.status(400).send({ error: "invalid_filename" });
      }

      const filePath = join(assets.outputDir(), filename);
      if (!existsSync(filePath)) {
        return reply.status(404).send({ error: "not_found" });
      }

      const ext = filename.split(".").pop()?.toLowerCase();
      const contentType =
        ext === "webm" ? "video/webm" : "video/mp4";

      reply.header("Content-Type", contentType);
      reply.header("Cache-Control", "public, max-age=3600");
      return reply.send(createReadStream(filePath));
    }
  );
}