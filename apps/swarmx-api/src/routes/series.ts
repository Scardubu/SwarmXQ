/**
 * apps/swarmx-api/src/routes/series.ts
 * SwarmXQ Series Engine — Fastify Route Plugin
 *
 * Exposes:
 *   POST   /api/video/series                               — create series + fire planning
 *   GET    /api/video/series                               — list all series
 *   GET    /api/video/series/:id                           — get series detail
 *   POST   /api/video/series/:id/episodes/:n/produce       — start producing episode N
 *   POST   /api/video/series/:id/episodes/:n/preproduction — trigger episode pre-production (V2.0)
 *   GET    /api/video/series/:id/episodes/:n/preproduction — get pre-production status (V2.0)
 *   DELETE /api/video/series/:id                           — delete series
 */

import type { FastifyInstance, FastifyPluginOptions, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import type { SeriesBrief } from "@swarmx/types/series-types";
import type { SeriesEpisodeContext } from "@swarmx/types/series-types";
import type { BroadcastFn } from "../services/video-orchestrator.js";
import { runOrchestration } from "../services/video-orchestrator.js";
import {
  createSeries,
  getSeries,
  listSeries,
  deleteSeries,
  recordEpisodeJobId,
  getPreProduction,
  setPreProduction,
} from "../services/series-registry.js";
import { planSeries } from "../services/video-series-planner.js";
import { runEpisodePreProduction } from "../services/video-episode-preproducer.js";
import * as queue from "../services/video-queue.js";
import { requireVideoWriteAuth } from "../services/video-auth.js";
import { log } from "../lib/logger.js";

// ─── Request body validation ──────────────────────────────────────────────────

const SeriesBriefSchema = z.object({
  storyTheme:            z.string().min(1).max(500),
  coreMessage:           z.string().min(1).max(500),
  emotionalJourney:      z.string().min(1).max(300),
  primaryConflict:       z.enum(["internal", "interpersonal", "societal", "existential", "cosmic"]),
  targetAudience:        z.string().min(1).max(200),
  tone:                  z.enum(["educational","urgent","warm","contrarian","cinematic","minimal","faceless_broll","kinetic_text"]),
  seriesLength:          z.number().int().min(6).max(30),
  episodeDurationSeconds: z.union([z.literal(15), z.literal(30), z.literal(45), z.literal(60)]),
  platformPrimary:       z.enum(["tiktok","reels","youtube_shorts","facebook","x"]),
  recurringSymbols:      z.string().max(300).optional(),
  arcStructure:          z.enum(["3-act","heros_journey","episodic_anthology","mystery_reveal","character_transformation"]),
});

// ─── Plugin ───────────────────────────────────────────────────────────────────

export async function seriesRoutes(
  fastify: FastifyInstance,
  opts: FastifyPluginOptions & { broadcast?: BroadcastFn },
): Promise<void> {
  const broadcast: BroadcastFn =
    opts.broadcast ??
    ((event) => fastify.log.debug({ event }, "series:event (no broadcaster)"));

  // ── POST / — create series ─────────────────────────────────────────────────
  fastify.post<{ Body: SeriesBrief }>(
    "/",
    {
      preHandler: requireVideoWriteAuth,
      schema: {
        body: {
          type: "object",
          required: ["storyTheme", "coreMessage", "emotionalJourney", "primaryConflict",
                     "targetAudience", "tone", "seriesLength", "episodeDurationSeconds",
                     "platformPrimary", "arcStructure"],
        },
      },
    },
    async (request: FastifyRequest<{ Body: SeriesBrief }>, reply: FastifyReply) => {
      const parsed = SeriesBriefSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({
          error: "invalid_brief",
          message: "Series brief validation failed",
          details: parsed.error.flatten().fieldErrors,
        });
      }

      const series = createSeries(parsed.data as SeriesBrief);

      // Fire planning pipeline async — do not await
      void planSeries(series.id).catch((err) => {
        log.error({ seriesId: series.id, err: err instanceof Error ? err.message : String(err) }, "series planning fire-and-forget error");
      });

      return reply.status(201).send({
        seriesId: series.id,
        status: series.status,
        message: `Series planning started. Track progress via GET /api/video/series/${series.id}`,
      });
    },
  );

  // ── GET / — list series ────────────────────────────────────────────────────
  fastify.get(
    "/",
    async (_request, reply) => {
      const series = listSeries();
      return reply.send({ series, total: series.length });
    },
  );

  // ── GET /:id — series detail ───────────────────────────────────────────────
  fastify.get<{ Params: { id: string } }>(
    "/:id",
    async (request, reply) => {
      const series = getSeries(request.params.id);
      if (!series) {
        return reply.status(404).send({
          error: "not_found",
          message: `Series ${request.params.id} not found`,
        });
      }
      return reply.send(series);
    },
  );

  // ── POST /:id/episodes/:n/produce — produce an episode ────────────────────
  fastify.post<{ Params: { id: string; n: string } }>(
    "/:id/episodes/:n/produce",
    { preHandler: requireVideoWriteAuth },
    async (request, reply) => {
      const series = getSeries(request.params.id);
      if (!series) {
        return reply.status(404).send({ error: "not_found", message: `Series ${request.params.id} not found` });
      }
      if (series.status === "planning") {
        return reply.status(409).send({ error: "still_planning", message: "Series plan is still being generated." });
      }
      if (series.status === "failed") {
        return reply.status(409).send({ error: "planning_failed", message: series.planningError ?? "Series planning failed." });
      }

      const episodeNumber = Number.parseInt(request.params.n, 10);
      if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
        return reply.status(400).send({ error: "invalid_episode", message: "Episode number must be a positive integer." });
      }

      const roadmap = series.episodeRoadmap ?? [];
      const entry = roadmap.find((e) => e.episodeNumber === episodeNumber);
      if (!entry) {
        return reply.status(404).send({ error: "episode_not_found", message: `Episode ${episodeNumber} not found in roadmap.` });
      }

      // Idempotency: if already queued/running, return existing job
      const existingJobId = series.videoJobIds[episodeNumber];
      if (existingJobId) {
        const existingJob = queue.getJob(existingJobId);
        if (existingJob && !["failed", "cancelled"].includes(existingJob.status)) {
          return reply.send({
            seriesId: series.id,
            episodeNumber,
            jobId: existingJobId,
            status: existingJob.status,
            message: "Episode already in production.",
          });
        }
      }

      // Build series context for this episode
      const previousSummaries = roadmap
        .filter((e) => e.episodeNumber < episodeNumber)
        .map((e) => e.summary);

      const seriesContext: SeriesEpisodeContext = {
        seriesTitle: series.brief.storyTheme, // title derived from theme; planner sets it in brief
        episodeTitle: entry.title,
        episodeSummary: entry.summary,
        characterBible: series.characterBible ?? [],
        worldGuide: series.worldGuide ?? {
          keyLocations: [],
          architecture: "contemporary",
          colorPalette: ["#0a0a0a"],
          cameraLanguage: { defaultLens: "35mm standard", defaultMovementStyle: "static", shotGrammarRules: "" },
          visualMotifs: [],
          era: "contemporary",
          toneMap: "neutral",
          soundSignature: "ambient",
        },
        previousEpisodeSummaries: previousSummaries,
        ...(entry.chekhovGun ? { chekhovGun: entry.chekhovGun } : {}),
      };

      const jobRequest = {
        prompt: `${entry.title}: ${entry.summary}`,
        platform: series.brief.platformPrimary === "youtube_shorts" ? "youtube_shorts" as const
          : series.brief.platformPrimary === "tiktok" ? "tiktok" as const
          : series.brief.platformPrimary === "reels" ? "reels" as const
          : "generic" as const,
        tone: series.brief.tone,
        targetDurationSeconds: series.brief.episodeDurationSeconds,
        seriesId: series.id,
        episodeNumber,
        totalEpisodes: series.brief.seriesLength,
        seriesContext,
        clientRequestId: `${series.id}-ep${episodeNumber}`,
      };

      const job = queue.enqueue(jobRequest);
      recordEpisodeJobId(series.id, episodeNumber, job.id);

      void runOrchestration(job.id, broadcast).catch((err) => {
        log.error({ jobId: job.id, seriesId: series.id, episodeNumber, err: err instanceof Error ? err.message : String(err) }, "series episode orchestration error");
      });

      log.info({ seriesId: series.id, episodeNumber, jobId: job.id }, "series episode enqueued");

      return reply.status(201).send({
        seriesId: series.id,
        episodeNumber,
        jobId: job.id,
        status: job.status,
      });
    },
  );

  // ── POST /:id/episodes/:n/preproduction — trigger episode pre-production ──
  fastify.post<{ Params: { id: string; n: string } }>(
    "/:id/episodes/:n/preproduction",
    { preHandler: requireVideoWriteAuth },
    async (request, reply) => {
      const series = getSeries(request.params.id);
      if (!series) {
        return reply.status(404).send({ error: "not_found", message: `Series ${request.params.id} not found` });
      }
      if (series.status === "planning" || series.status === "failed") {
        return reply.status(409).send({
          error: "series_not_ready",
          message: "Series must be in planned, producing, or completed status to pre-produce an episode.",
        });
      }

      const episodeNumber = Number.parseInt(request.params.n, 10);
      if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
        return reply.status(400).send({ error: "invalid_episode", message: "Episode number must be a positive integer." });
      }

      const roadmap = series.episodeRoadmap ?? [];
      if (!roadmap.find((e) => e.episodeNumber === episodeNumber)) {
        return reply.status(404).send({ error: "episode_not_found", message: `Episode ${episodeNumber} not found in roadmap.` });
      }

      // Idempotency: reject if already running
      const existing = getPreProduction(request.params.id, episodeNumber);
      if (existing && ["scripting", "prompting", "audio_assets", "scoring"].includes(existing.status)) {
        return reply.status(409).send({
          error: "already_running",
          message: `Episode ${episodeNumber} pre-production is already in progress (status: ${existing.status}).`,
          preProduction: existing,
        });
      }

      const now = new Date().toISOString();
      const initial = {
        episodeNumber,
        status: "scripting" as const,
        startedAt: now,
      };
      setPreProduction(request.params.id, episodeNumber, initial);

      void runEpisodePreProduction(request.params.id, episodeNumber).catch((err) => {
        log.error({
          seriesId: request.params.id,
          episodeNumber,
          err: err instanceof Error ? err.message : String(err),
        }, "pre-production fire-and-forget error");
      });

      log.info({ seriesId: request.params.id, episodeNumber }, "series episode pre-production started");
      return reply.status(202).send({
        seriesId: request.params.id,
        episodeNumber,
        preProduction: initial,
      });
    },
  );

  // ── GET /:id/episodes/:n/preproduction — get pre-production status ─────────
  fastify.get<{ Params: { id: string; n: string } }>(
    "/:id/episodes/:n/preproduction",
    { preHandler: requireVideoWriteAuth },
    async (request, reply) => {
      const series = getSeries(request.params.id);
      if (!series) {
        return reply.status(404).send({ error: "not_found", message: `Series ${request.params.id} not found` });
      }

      const episodeNumber = Number.parseInt(request.params.n, 10);
      if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
        return reply.status(400).send({ error: "invalid_episode", message: "Episode number must be a positive integer." });
      }

      const preProduction = getPreProduction(request.params.id, episodeNumber);
      if (!preProduction) {
        return reply.status(404).send({
          error: "not_found",
          message: `No pre-production record for episode ${episodeNumber}.`,
        });
      }

      return reply.send({
        seriesId: request.params.id,
        episodeNumber,
        preProduction,
      });
    },
  );

  // ── DELETE /:id — delete series ───────────────────────────────────────────
  fastify.delete<{ Params: { id: string } }>(
    "/:id",
    { preHandler: requireVideoWriteAuth },
    async (request, reply) => {
      const existed = deleteSeries(request.params.id);
      if (!existed) {
        return reply.status(404).send({ error: "not_found", message: `Series ${request.params.id} not found` });
      }
      return reply.status(204).send();
    },
  );
}
