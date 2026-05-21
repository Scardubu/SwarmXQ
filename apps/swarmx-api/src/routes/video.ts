/**
 * apps/swarmx-api/src/routes/video.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Video Generation — Fastify route handlers
 *
 * Endpoints:
 *   POST   /api/video/jobs                       — create a job
 *   GET    /api/video/jobs                       — list jobs (limit param)
 *   GET    /api/video/jobs/:id                   — full job detail
 *   DELETE /api/video/jobs/:id                   — cancel a job
 *   POST   /api/video/jobs/:id/retry             — clone and re-queue a failed job
 *   GET    /api/video/health                     — Ollama + ComfyUI reachability
 *
 * BUG-FIX [VIDEO-ROUTE-01]:
 *   The previous version of this file contained the VideoPageLoading React
 *   component (loading.tsx) instead of Fastify route definitions. This was a
 *   copy-paste error during the bundle merge. The correct content is here.
 *
 * The router is registered in server.ts under the /api/video prefix.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  createJob,
  getJob,
  listJobs,
  cancelJob,
} from "../services/video-queue.js";
import { runVideoJob } from "../services/video-orchestrator.js";
import { registerVideoProcessor } from "../services/video-queue.js";
import { checkOllamaHealth, getOllamaBaseUrl } from "../services/ollama.js";
import { currentPressureLevel } from "../services/adaptive-timeout-config.js";
import type { CreateVideoJobRequest } from "../types/video.js";

// ── Register orchestrator as the queue processor once (idempotent) ─────────────
registerVideoProcessor(runVideoJob);

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateJobBody {
  prompt: string;
  style?: string;
  aspect?: string;
  length?: string;
  targetPlatform?: string;
}

interface JobParams {
  id: string;
}

interface ListQuery {
  limit?: string;
}

// ─── Validation helpers ────────────────────────────────────────────────────────

const VALID_STYLES = new Set(["motivational","educational","narrative","documentary","explainer","abstract","custom"]);
const VALID_ASPECTS = new Set(["9:16","16:9","1:1"]);
const VALID_LENGTHS = new Set(["short","medium","long"]);
const VALID_PLATFORMS = new Set(["tiktok","youtube_shorts","reels","generic"]);

function validateCreateBody(body: unknown): { valid: true; req: CreateVideoJobRequest } | { valid: false; error: string } {
  if (!body || typeof body !== "object") return { valid: false, error: "Request body is required" };
  const b = body as Record<string, unknown>;

  if (!b["prompt"] || typeof b["prompt"] !== "string" || !b["prompt"].trim()) {
    return { valid: false, error: "prompt is required and must be a non-empty string" };
  }
  if (b["style"] && !VALID_STYLES.has(String(b["style"]))) {
    return { valid: false, error: `style must be one of: ${[...VALID_STYLES].join(", ")}` };
  }
  if (b["aspect"] && !VALID_ASPECTS.has(String(b["aspect"]))) {
    return { valid: false, error: `aspect must be one of: ${[...VALID_ASPECTS].join(", ")}` };
  }
  if (b["length"] && !VALID_LENGTHS.has(String(b["length"]))) {
    return { valid: false, error: `length must be one of: ${[...VALID_LENGTHS].join(", ")}` };
  }
  if (b["targetPlatform"] && !VALID_PLATFORMS.has(String(b["targetPlatform"]))) {
    return { valid: false, error: `targetPlatform must be one of: ${[...VALID_PLATFORMS].join(", ")}` };
  }

  return {
    valid: true,
    req: {
      prompt: String(b["prompt"]).trim().slice(0, 2000),
      style: b["style"] ? (String(b["style"]) as CreateVideoJobRequest["style"]) : undefined,
      aspect: b["aspect"] ? (String(b["aspect"]) as CreateVideoJobRequest["aspect"]) : undefined,
      length: b["length"] ? (String(b["length"]) as CreateVideoJobRequest["length"]) : undefined,
      targetPlatform: b["targetPlatform"] ? (String(b["targetPlatform"]) as CreateVideoJobRequest["targetPlatform"]) : undefined,
    },
  };
}

// ─── ComfyUI probe ────────────────────────────────────────────────────────────

const COMFYUI_BASE = process.env["SWARMX_COMFYUI_URL"] ?? "http://127.0.0.1:8188";

async function probeComfyUI(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${COMFYUI_BASE}/system_stats`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

// ─── Route plugin ─────────────────────────────────────────────────────────────

export async function videoRouter(server: FastifyInstance): Promise<void> {

  // ── POST /api/video/jobs — create a new video job ──────────────────────────
  server.post<{ Body: CreateJobBody }>(
    "/jobs",
    {
      schema: {
        description: "Create a new video generation job",
        tags: ["video"],
        body: {
          type: "object",
          required: ["prompt"],
          properties: {
            prompt: { type: "string", minLength: 1, maxLength: 2000 },
            style: { type: "string" },
            aspect: { type: "string" },
            length: { type: "string" },
            targetPlatform: { type: "string" },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Body: CreateJobBody }>, reply: FastifyReply) => {
      const validated = validateCreateBody(req.body);
      if (!validated.valid) {
        return reply.status(400).send({ error: validated.error });
      }

      const pressure = currentPressureLevel();
      const job = createJob(validated.req, pressure);

      // Warn on degraded-mode paths at submission time so the client can surface
      // a message before any SSE events arrive.
      let degradeWarning: string | undefined;
      if (pressure === "critical") {
        degradeWarning = "System is under critical memory pressure. Only script output is expected.";
      } else if (pressure === "high") {
        degradeWarning = "System memory is elevated. Video render may be deferred.";
      }

      return reply.status(201).send({
        jobId: job.jobId,
        correlationId: job.correlationId,
        status: job.status,
        message: "Job queued",
        ...(degradeWarning ? { degradeWarning } : {}),
      });
    },
  );

  // ── GET /api/video/jobs — list jobs ────────────────────────────────────────
  server.get<{ Querystring: ListQuery }>(
    "/jobs",
    {
      schema: {
        description: "List video generation jobs",
        tags: ["video"],
        querystring: {
          type: "object",
          properties: {
            limit: { type: "string" },
          },
        },
      },
    },
    async (req: FastifyRequest<{ Querystring: ListQuery }>, reply: FastifyReply) => {
      const rawLimit = req.query.limit;
      const limit = rawLimit ? Math.min(Math.max(parseInt(rawLimit, 10) || 50, 1), 200) : 50;
      const jobs = listJobs(limit);
      return reply.send({ jobs, count: jobs.length });
    },
  );

  // ── GET /api/video/jobs/:id — full job detail ──────────────────────────────
  server.get<{ Params: JobParams }>(
    "/jobs/:id",
    {
      schema: {
        description: "Get full detail for a single video job",
        tags: ["video"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const job = getJob(req.params.id);
      if (!job) {
        return reply.status(404).send({ error: `Job ${req.params.id} not found` });
      }
      return reply.send(job);
    },
  );

  // ── DELETE /api/video/jobs/:id — cancel a job ──────────────────────────────
  // Dashboard uses DELETE (not POST /cancel) — kept consistent with that expectation.
  server.delete<{ Params: JobParams }>(
    "/jobs/:id",
    {
      schema: {
        description: "Cancel a video generation job",
        tags: ["video"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const job = getJob(req.params.id);
      if (!job) {
        return reply.status(404).send({ error: `Job ${req.params.id} not found` });
      }

      const cancelled = cancelJob(req.params.id);
      if (!cancelled) {
        return reply.status(409).send({
          error: `Job ${req.params.id} is already in a terminal state (${job.status}) and cannot be cancelled`,
        });
      }

      return reply.send({ jobId: req.params.id, status: "cancelled" });
    },
  );

  // ── POST /api/video/jobs/:id/cancel — canonical cancel (alias) ─────────────
  // The implementation plan specified POST /:id/cancel. Both routes work.
  server.post<{ Params: JobParams }>(
    "/jobs/:id/cancel",
    {
      schema: {
        description: "Cancel a video generation job (POST alias)",
        tags: ["video"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const job = getJob(req.params.id);
      if (!job) {
        return reply.status(404).send({ error: `Job ${req.params.id} not found` });
      }

      const cancelled = cancelJob(req.params.id);
      if (!cancelled) {
        return reply.status(409).send({
          error: `Job ${req.params.id} cannot be cancelled (current status: ${job.status})`,
        });
      }

      return reply.send({ jobId: req.params.id, status: "cancelled" });
    },
  );

  // ── POST /api/video/jobs/:id/retry — clone and re-queue ────────────────────
  // Copies the original prompt + options into a new job so the user doesn't
  // have to re-submit the form. Only allowed on terminal states.
  server.post<{ Params: JobParams }>(
    "/jobs/:id/retry",
    {
      schema: {
        description: "Retry a failed or cancelled video job",
        tags: ["video"],
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string" } },
        },
      },
    },
    async (req: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      const original = getJob(req.params.id);
      if (!original) {
        return reply.status(404).send({ error: `Job ${req.params.id} not found` });
      }

      const retryable = ["failed", "degraded", "cancelled"];
      if (!retryable.includes(original.status)) {
        return reply.status(409).send({
          error: `Job ${req.params.id} cannot be retried (current status: ${original.status}). Only failed, degraded, or cancelled jobs can be retried.`,
        });
      }

      const pressure = currentPressureLevel();
      const newJob = createJob(
        {
          prompt: original.prompt,
          style: original.intent?.style,
          aspect: original.intent?.aspect,
          length: original.intent?.length,
          targetPlatform: original.intent?.targetPlatform,
        },
        pressure,
      );

      return reply.status(201).send({
        jobId: newJob.jobId,
        correlationId: newJob.correlationId,
        status: newJob.status,
        retriedFrom: req.params.id,
        message: "Retry job queued",
      });
    },
  );

  // ── GET /api/video/health — Ollama + ComfyUI reachability ─────────────────
  server.get(
    "/health",
    {
      schema: {
        description: "Check video subsystem health (Ollama + ComfyUI)",
        tags: ["video"],
      },
    },
    async (_req: FastifyRequest, reply: FastifyReply) => {
      const [ollamaHealth, comfyuiReachable] = await Promise.all([
        checkOllamaHealth().catch(() => ({ isHealthy: false, models: [] as string[] })),
        probeComfyUI(),
      ]);

      const pressureLevel = currentPressureLevel();

      return reply.send({
        ollama: {
          reachable: ollamaHealth.isHealthy,
          models: (ollamaHealth as { isHealthy: boolean; models?: string[] }).models ?? [],
        },
        comfyui: {
          reachable: comfyuiReachable,
          baseUrl: COMFYUI_BASE,
        },
        pressure: pressureLevel,
        renderCapable: ollamaHealth.isHealthy && comfyuiReachable && pressureLevel !== "critical",
        timestamp: new Date().toISOString(),
      });
    },
  );
}
