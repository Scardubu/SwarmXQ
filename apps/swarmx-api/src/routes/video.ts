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
import { z } from "zod";
import type { VideoJobRequest, VideoJobListQuery } from "../types/video.js";
import * as queue from "../services/video-queue.js";
import * as assets from "../services/video-assets.js";
import { runOrchestration } from "../services/video-orchestrator.js";
import type { BroadcastFn } from "../services/video-orchestrator.js";
import { getAvailableRamMb } from "../services/adaptive-timeout-config.js";
import { minimumRamRequiredForVideoRequest } from "../services/video-runtime-config.js";
import { requireVideoWriteAuth } from "../services/video-auth.js";
import { generateCaptionDraftWithValidation } from "../services/caption-generator.js";
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
import { recordVideoPerformance } from "../services/video-assets.js";
import { resolveCanonicalTag } from "@swarmx/types/operator-map";
import type { CaptionDraft } from "@swarmx/types/video-types";

const PublishRequestSchema = {
  type: "object",
  required: ["platform"],
  properties: {
    platform: { type: "string", enum: ["tiktok", "reels", "shorts", "generic"] },
    scheduledAt: { type: "string" },
  },
} as const;

const ResumeRequestSchema = {
  type: "object",
  required: ["fromStage"],
  properties: {
    fromStage: { type: "string" },
  },
} as const;

const ReprioritizeSchema = {
  type: "object",
  required: ["orderedIds"],
  properties: {
    orderedIds: {
      type: "array",
      items: { type: "string" },
      minItems: 1,
    },
  },
} as const;

const CaptionScoreSchema = z.object({
  prompt: z.string().min(1).max(2000),
  platform: z.enum(["tiktok", "reels", "shorts", "generic"]),
  tone: z.string().min(1).max(120).optional(),
  durationSec: z.number().int().min(5).max(600).optional(),
});

const CaptionScoreDraftSchema = z.object({
  draft: z.object({
    firstLine: z.string().min(1),
    body: z.string(),
    cta: z.string(),
    hashtags: z.object({
      broad: z.array(z.string()),
      niche: z.array(z.string()),
      trending: z.array(z.string()),
    }),
    soundSuggestion: z.string().optional(),
  }),
  platform: z.enum(["tiktok", "reels", "shorts", "generic"]),
  durationSec: z.number().int().min(5).max(600).optional(),
  jobId: z.string().min(1).optional(),
});

const ResumeBodySchema = z.object({
  fromStage: z.string().min(1).max(64),
});

const ReprioritizeBodySchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1),
});

const captionScoreRateWindowMs = 60_000;
const captionScoreRateLimit = Number.parseInt(
  process.env["SWARMX_VIDEO_CAPTION_SCORE_LIMIT_PER_MIN"] ?? "10",
  10,
) || 10;
const captionScoreBuckets = new Map<string, number[]>();

function getConnectionKey(request: FastifyRequest): string {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]?.trim() ?? request.ip;
  }
  return request.ip;
}

function exceedsCaptionScoreLimit(connectionKey: string, nowMs: number): boolean {
  const events = captionScoreBuckets.get(connectionKey) ?? [];
  const inWindow = events.filter((ts) => nowMs - ts <= captionScoreRateWindowMs);
  if (inWindow.length >= captionScoreRateLimit) {
    captionScoreBuckets.set(connectionKey, inWindow);
    return true;
  }
  inWindow.push(nowMs);
  captionScoreBuckets.set(connectionKey, inWindow);
  return false;
}

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

  // ── POST /jobs ─────────────────────────────────────────────────────────────
  fastify.post<{ Body: VideoJobRequest }>(
    "/jobs",
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
      const minimumRequired = minimumRamRequiredForVideoRequest(request.body);
      if (availableMb < minimumRequired) {
        return reply.status(503).send({
          error: "insufficient_ram_for_video",
          message: "Insufficient RAM for video generation",
          availableMb,
          minimumRequired,
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

  // ── GET /jobs ──────────────────────────────────────────────────────────────
  fastify.get<{ Querystring: VideoJobListQuery }>(
    "/jobs",
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

  // ── GET /jobs/:id ──────────────────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    "/jobs/:id",
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
    "/jobs/:id/sse",
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

      let closed = false;

      const sseForwarder = (async () => {
        for await (const event of queue.subscribeToJob(request.params.id)) {
          if (closed) break;
          try {
            writeSseEvent(reply, event);
          } catch {
            break;
          }
        }
      })();

      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
        } catch {
          clearInterval(heartbeat);
          closed = true;
        }
      }, 15_000);

      request.raw.on("close", () => {
        closed = true;
        clearInterval(heartbeat);
      });

      void sseForwarder;
      await new Promise<void>((resolve) => {
        request.raw.on("close", resolve);
      });
    },
  );

  // ── POST /jobs/:id/cancel ─────────────────────────────────────────────────
  fastify.post<{ Params: { id: string } }>(
    "/jobs/:id/cancel",
    {
      preHandler: requireVideoWriteAuth,
      schema: { params: JobIdParamSchema },
    },
    async (request, reply) => cancelVideoJob(request, reply, broadcast)
  );

  fastify.delete<{ Params: { id: string } }>(
    "/jobs/:id",
    {
      preHandler: requireVideoWriteAuth,
      schema: { params: JobIdParamSchema },
    },
    async (request, reply) => cancelVideoJob(request, reply, broadcast),
  );

  fastify.post<{ Params: { id: string }; Body: { fromStage: string } }>(
    "/jobs/:id/resume",
    {
      preHandler: requireVideoWriteAuth,
      schema: {
        params: JobIdParamSchema,
        body: ResumeRequestSchema,
      },
    },
    async (request, reply) => {
      const parsed = ResumeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          message: "Invalid resume payload",
          issues: parsed.error.issues,
        });
      }

      try {
        const resumed = await queue.resumeJob(request.params.id, parsed.data.fromStage as never);
        return reply.send({
          jobId: resumed.id,
          status: resumed.status,
          resumeFromStage: resumed.resumeFromStage,
          retryCount: resumed.retryCount,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "resume_failed";
        if (message === "no_partial_artifacts") {
          return reply.status(409).send({
            error: "no_partial_artifacts",
            message,
          });
        }
        return reply.status(400).send({
          error: "resume_failed",
          message,
        });
      }
    },
  );

  fastify.post<{ Body: { orderedIds: string[] } }>(
    "/jobs/reprioritize",
    {
      preHandler: requireVideoWriteAuth,
      schema: {
        body: ReprioritizeSchema,
      },
    },
    async (request, reply) => {
      const parsed = ReprioritizeBodySchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_request",
          message: "Invalid reprioritize payload",
          issues: parsed.error.issues,
        });
      }

      await queue.reprioritizeQueue(parsed.data.orderedIds);
      return reply.send({
        reprioritized: true,
        orderedIds: parsed.data.orderedIds,
      });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/jobs/:id/artifacts",
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
        frames: [
          ...(job.output?.storyboardFrames ?? []),
          ...(job.outputArtifacts?.frameDirectory ? [job.outputArtifacts.frameDirectory] : []),
          ...(job.outputArtifacts?.interpolatedFrameDirectory
            ? [job.outputArtifacts.interpolatedFrameDirectory]
            : []),
        ],
        thumbnail: job.outputArtifacts?.thumbnailPath ?? job.outputArtifacts?.firstFramePath ?? null,
      });
    },
  );

  fastify.get<{ Params: { id: string } }>(
    "/jobs/:id/analysis",
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
    "/jobs/:id/publish",
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

      if (job.viralitySignal) {
        const metrics = {
          jobId: job.id,
          platform: request.body.platform,
          publishedAt: job.updatedAt,
          viralityAtPublish: {
            ...job.viralitySignal,
            scoredBy: resolveCanonicalTag(job.viralitySignal.scoredBy),
          },
        };
        await recordVideoPerformance(job.id, metrics);
        broadcast({
          type: "video:performance",
          timestamp: job.updatedAt,
          data: {
            jobId: job.id,
            platform: request.body.platform,
            metrics,
          },
        });
      }

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
    "/caption-draft",
    {
      preHandler: requireVideoWriteAuth,
    },
    async (request, reply) => {
      try {
        const result = await generateCaptionDraftWithValidation({
          topic: request.body.prompt,
          platform: request.body.platform,
          tone: request.body.tone ?? "engaging",
        });
        return reply.send({
          captionDraft: result.draft,
          valid: result.validation.valid,
          violations: result.validation.violations,
        });
      } catch {
        return reply.status(503).send({
          error: "caption_generation_unavailable",
          valid: false,
          message: "Caption generator unavailable",
        });
      }
    },
  );

  fastify.post<{
    Body: { prompt: string; platform: "tiktok" | "reels" | "shorts" | "generic"; tone?: string; durationSec?: number };
  }>(
    "/caption/score",
    {
      preHandler: requireVideoWriteAuth,
      schema: {
        response: {
          200: { type: "object" },
          503: { type: "object" },
        },
      },
    },
    async (request, reply) => {
      const parsedPrompt = CaptionScoreSchema.safeParse(request.body);
      const parsedDraft = CaptionScoreDraftSchema.safeParse(request.body);
      if (!parsedPrompt.success && !parsedDraft.success) {
        return reply.status(400).send({
          error: "invalid_request",
          message: "Invalid caption score payload",
          issues: [...parsedPrompt.error.issues, ...parsedDraft.error.issues],
        });
      }

      const nowMs = Date.now();
      const connectionKey = getConnectionKey(request);
      if (exceedsCaptionScoreLimit(connectionKey, nowMs)) {
        return reply.status(429).send({
          error: "rate_limited",
          message: "Caption scoring limited to 10 requests per minute per connection",
        });
      }

      let captionDraft: CaptionDraft;
      let topicText: string;
      let platform: "tiktok" | "reels" | "shorts" | "generic";
      let durationSec: number;

      if (parsedDraft.success) {
        const draft = parsedDraft.data.draft;
        captionDraft = {
          firstLine: draft.firstLine,
          body: draft.body,
          cta: draft.cta,
          hashtags: draft.hashtags,
          ...(draft.soundSuggestion ? { soundSuggestion: draft.soundSuggestion } : {}),
        };
        topicText = `${captionDraft.firstLine} ${captionDraft.body} ${captionDraft.cta}`.trim();
        platform = parsedDraft.data.platform;
        durationSec = parsedDraft.data.durationSec ?? 30;
      } else if (parsedPrompt.success) {
        const promptData = parsedPrompt.data;
        try {
          const result = await generateCaptionDraftWithValidation({
            topic: promptData.prompt,
            platform: promptData.platform,
            tone: promptData.tone ?? "engaging",
          });
          captionDraft = result.draft;
        } catch {
          return reply.status(503).send({
            error: "caption_generation_unavailable",
            valid: false,
            message: "Caption generator unavailable",
          });
        }
        topicText = promptData.prompt;
        platform = promptData.platform;
        durationSec = promptData.durationSec ?? 30;
      } else {
        return reply.status(400).send({
          error: "invalid_request",
          message: "Invalid caption score payload",
        });
      }

      const viralitySignal = await scoreVirality({
        topic: topicText,
        platform,
        durationSec,
        hook: captionDraft.firstLine,
      });
      if (!viralitySignal) {
        return reply.status(503).send({
          error: "virality_unavailable",
          valid: false,
          message: "Virality scorer unavailable",
          captionDraft,
        });
      }
      return reply.send({ captionDraft, viralitySignal });
    },
  );

  fastify.post<{
    Body: { prompt: string; platform: "tiktok" | "reels" | "shorts" | "generic"; durationSec?: number; hook?: string };
  }>(
    "/virality-score",
    {
      preHandler: requireVideoWriteAuth,
      schema: {
        response: {
          200: { type: "object" },
          503: { type: "object" },
        },
      },
    },
    async (request, reply) => {
      const viralitySignal = await scoreVirality({
        topic: request.body.prompt,
        platform: request.body.platform,
        durationSec: request.body.durationSec ?? 30,
        ...(request.body.hook ? { hook: request.body.hook } : {}),
      });
      if (!viralitySignal) {
        return reply.status(503).send({
          error: "virality_unavailable",
          valid: false,
          message: "Virality scorer unavailable",
        });
      }
      return reply.send({ viralitySignal });
    },
  );

  fastify.get(
    "/templates",
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
          name: "LTX Video T2V",
          mode: "t2v",
          resolution: shared.resolution,
          fps: shared.outputFps,
          description: "Low-RAM text-to-video template using LTX sampler",
          requiresReferenceImage: false,
          workflow: generateLTXWorkflow(shared),
        },
        {
          id: "wan-t2v",
          name: "Wan T2V",
          mode: "t2v",
          resolution: shared.resolution,
          fps: shared.outputFps,
          description: "Wan text-to-video workflow with balanced quality",
          requiresReferenceImage: false,
          workflow: generateWanT2VWorkflow(shared),
        },
        {
          id: "wan-i2v",
          name: "Wan I2V",
          mode: "i2v",
          resolution: shared.resolution,
          fps: shared.outputFps,
          description: "Wan image-to-video workflow (single-model lock path)",
          requiresReferenceImage: true,
          workflow: generateWanI2VWorkflow({
            ...shared,
            imageInputPath: "reference.png",
          }),
        },
      ].map((template) => ({
        id: template.id,
        name: template.name,
        mode: template.mode,
        resolution: template.resolution,
        fps: template.fps,
        description: template.description,
        ramMb: template.workflow.ramBudgetMb,
        compatible: template.workflow.ramBudgetMb <= Math.max(0, availableMb - 800),
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
    "/files/:filename",
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
