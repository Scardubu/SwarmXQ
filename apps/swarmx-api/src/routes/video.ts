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

import type { FastifyInstance, FastifyPluginOptions, FastifyReply, FastifyRequest } from "fastify";
import { createReadStream, existsSync } from "node:fs";
import { join } from "node:path";
import type { VideoJobRequest, VideoJobListQuery } from "../types/video.js";
import * as queue from "../services/video-queue.js";
import * as assets from "../services/video-assets.js";
import { runOrchestration } from "../services/video-orchestrator.js";
import type { BroadcastFn } from "../services/video-orchestrator.js";
import { getAvailableRamMb } from "../services/adaptive-timeout-config.js";
import { requireVideoWriteAuth } from "../services/video-auth.js";
import { generateCaptionDraft } from "../services/caption-generator.js";
import { scoreVirality } from "../services/virality-scorer.js";
import {
  generateLTXWorkflow,
  generateWanI2VWorkflow,
  generateWanT2VWorkflow,
} from "../services/video-workflows.js";
import {
  getVideoPublisher,
  listSupportedPublishPlatforms,
} from "../services/video-publishers.js";
import type { PublishResult } from "@swarmx/types/video-types";
import { subscribeToEvents } from "../plugins/sse.js";

const PublishRequestSchema = {
  type: "object",
  required: ["platform"],
  properties: {
    platform: { type: "string", enum: ["tiktok", "reels", "shorts", "generic"] },
    scheduledAt: { type: "string" },
  },
} as const;

function mergePublishHistory(
  history: PublishResult[] | undefined,
  nextResult: PublishResult,
): PublishResult[] {
  const remaining = (history ?? []).filter((entry) => entry.publishId !== nextResult.publishId);
  return [nextResult, ...remaining].sort(
    (left, right) => Date.parse(right.requestedAt) - Date.parse(left.requestedAt),
  );
}

function writeSseEvent(reply: FastifyReply, event: unknown): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function initSseReply(reply: FastifyReply): void {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.setHeader("X-Accel-Buffering", "no");
  reply.raw.flushHeaders();
  reply.raw.write(": connected\n\n");
}

function eventMatchesJob(event: { type: string; data?: unknown }, jobId: string): boolean {
  if (!event.type.startsWith("video:")) {
    return false;
  }

  const data = event.data;
  if (!data || typeof data !== "object") {
    return false;
  }

  if ("jobId" in data && data.jobId === jobId) {
    return true;
  }

  if ("job" in data && data.job && typeof data.job === "object" && "id" in data.job) {
    return data.job.id === jobId;
  }

  return false;
}

async function cancelVideoJob(
  request: FastifyRequest<{ Params: { id: string } }>,
  reply: FastifyReply,
  broadcast: BroadcastFn,
) {
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
      preHandler: requireVideoWriteAuth,
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
              availableMb: { type: "number" },
              minimumRequired: { type: "number" },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const availableMb = getAvailableRamMb();
      if (availableMb < 1000) {
        return reply.status(503).send({
          error: "insufficient_ram",
          availableMb,
          minimumRequired: 1000,
        });
      }

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

  fastify.get<{ Params: { id: string } }>(
    "/api/video/jobs/:id/sse",
    {
      schema: { params: JobIdParamSchema },
    },
    async (request: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const job = queue.getJob(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "not_found",
          message: `Video job ${request.params.id} not found`,
        });
      }

      initSseReply(reply);
      writeSseEvent(reply, {
        type: "video:snapshot",
        timestamp: new Date().toISOString(),
        data: { job },
      });

      const unsubscribe = subscribeToEvents((event) => {
        if (!eventMatchesJob(event, request.params.id)) {
          return;
        }
        try {
          writeSseEvent(reply, event);
        } catch {
          unsubscribe();
        }
      });

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          clearInterval(heartbeat);
          unsubscribe();
        }
      }, 15_000);

      request.raw.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });

      await new Promise<void>((resolve) => {
        request.raw.on("close", resolve);
      });
    },
  );

  // ── POST /api/video/jobs/:id/cancel ───────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/api/video/jobs/:id/cancel",
    {
      preHandler: requireVideoWriteAuth,
      schema: { params: JobIdParamSchema },
    },
    async (request, reply) => cancelVideoJob(request, reply, broadcast)
  );

  fastify.delete<{ Params: { id: string } }>(
    "/api/video/jobs/:id",
    {
      preHandler: requireVideoWriteAuth,
      schema: { params: JobIdParamSchema },
    },
    async (request, reply) => cancelVideoJob(request, reply, broadcast),
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/video/jobs/:id/artifacts",
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

      return reply.send({
        jobId: job.id,
        artifacts: job.outputArtifacts ?? {},
        output: job.output ?? null,
      });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/api/video/jobs/:id/analysis",
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

      return reply.send({
        jobId: job.id,
        viralitySignal: job.viralitySignal ?? null,
        captionDraft: job.viralitySignal?.captionDraft ?? null,
      });
    },
  );

  fastify.post<{
    Params: { id: string };
    Body: { platform: "tiktok" | "reels" | "shorts" | "generic"; scheduledAt?: string };
  }>(
    "/api/video/jobs/:id/publish",
    {
      preHandler: requireVideoWriteAuth,
      schema: {
        params: JobIdParamSchema,
        body: PublishRequestSchema,
      },
    },
    async (request, reply) => {
      const job = queue.getJob(request.params.id);
      if (!job) {
        return reply.status(404).send({
          error: "not_found",
          message: `Video job ${request.params.id} not found`,
        });
      }

      if (job.status !== "completed" || !job.output) {
        return reply.status(409).send({
          error: "job_not_ready",
          message: "Video job must be completed before publishing",
        });
      }

      const publisher = getVideoPublisher(request.body.platform);
      const artifacts = job.outputArtifacts ?? {
        outputPath: job.output.absolutePath,
        outputPublicUrl: job.output.publicUrl,
      };
      const publishResult = request.body.scheduledAt
        ? await publisher.schedule(job, artifacts, request.body.scheduledAt)
        : await publisher.publish(job, artifacts);

      if (!job.outputArtifacts) {
        job.outputArtifacts = {};
      }
      job.publishHistory = mergePublishHistory(job.publishHistory, publishResult);
      job.outputArtifacts.publishHistory = job.publishHistory;
      job.outputArtifacts.exportPathByPlatform = {
        ...(job.outputArtifacts.exportPathByPlatform ?? {}),
        [request.body.platform]: publishResult.platformUrl ?? job.output.publicUrl,
      };
      job.updatedAt = new Date().toISOString();

      broadcast({
        type: "video:snapshot",
        timestamp: job.updatedAt,
        data: { job },
      });

      return reply.send({
        jobId: job.id,
        job,
        result: publishResult,
        supportedPlatforms: listSupportedPublishPlatforms(),
      });
    },
  );

  fastify.post<{
    Body: { prompt: string; platform: "tiktok" | "reels" | "shorts" | "generic"; tone?: string; durationSec?: number };
  }>(
    "/api/video/caption-draft",
    {
      preHandler: requireVideoWriteAuth,
    },
    async (request, reply) => {
      const captionDraft = await generateCaptionDraft({
        topic: request.body.prompt,
        platform: request.body.platform,
        tone: request.body.tone ?? "engaging",
      });
      return reply.send({ captionDraft });
    },
  );

  fastify.post<{
    Body: { prompt: string; platform: "tiktok" | "reels" | "shorts" | "generic"; tone?: string; durationSec?: number };
  }>(
    "/api/video/caption/score",
    {
      preHandler: requireVideoWriteAuth,
    },
    async (request, reply) => {
      const captionDraft = await generateCaptionDraft({
        topic: request.body.prompt,
        platform: request.body.platform,
        tone: request.body.tone ?? "engaging",
      });
      const viralitySignal = await scoreVirality({
        topic: request.body.prompt,
        platform: request.body.platform,
        durationSec: request.body.durationSec ?? 30,
        hook: captionDraft.firstLine,
      });
      return reply.send({ captionDraft, viralitySignal });
    },
  );

  fastify.post<{
    Body: { prompt: string; platform: "tiktok" | "reels" | "shorts" | "generic"; durationSec?: number; hook?: string };
  }>(
    "/api/video/virality-score",
    {
      preHandler: requireVideoWriteAuth,
    },
    async (request, reply) => {
      const viralitySignal = await scoreVirality({
        topic: request.body.prompt,
        platform: request.body.platform,
        durationSec: request.body.durationSec ?? 30,
        ...(request.body.hook ? { hook: request.body.hook } : {}),
      });
      return reply.send({ viralitySignal });
    },
  );

  fastify.get(
    "/api/video/templates",
    async (_request, reply) => {
      const availableMb = getAvailableRamMb();
      const shared = {
        seed: 42,
        prompt: "Template probe",
        resolution: "512x512" as const,
        totalFrames: 24,
        outputFps: 8,
        availableMb,
      };

      const templates = [
        {
          id: "ltx-t2v",
          mode: "t2v",
          requiresReferenceImage: false,
          workflow: generateLTXWorkflow(shared),
        },
        {
          id: "wan-t2v",
          mode: "t2v",
          requiresReferenceImage: false,
          workflow: generateWanT2VWorkflow(shared),
        },
        {
          id: "wan-i2v",
          mode: "i2v",
          requiresReferenceImage: true,
          workflow: generateWanI2VWorkflow({
            ...shared,
            imageInputPath: "reference.png",
          }),
        },
      ].map((template) => ({
        id: template.id,
        mode: template.mode,
        requiresReferenceImage: template.requiresReferenceImage,
        modelTag: template.workflow.modelTag,
        ramBudgetMb: template.workflow.ramBudgetMb,
        frameMath: template.workflow.frameMath,
      }));

      return reply.send({ templates, availableMb });
    },
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