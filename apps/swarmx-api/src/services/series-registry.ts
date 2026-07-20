/**
 * apps/swarmx-api/src/services/series-registry.ts
 * SwarmXQ Series Engine — In-memory series registry with TTL cleanup.
 *
 * Mirrors the job-registry pattern in video-queue.ts: Map<id, SeriesJob>
 * with a background interval that evicts entries older than the configured
 * TTL. Cleanup timer is unref'd so it never prevents graceful shutdown.
 */

import { randomUUID } from "node:crypto";
import type {
  SeriesBrief,
  SeriesJob,
  SeriesJobStatus,
  SeriesPassStatus,
  EpisodePreProduction,
  EpisodePreProductionStatus,
} from "@swarmx/types/series-types";
import { log } from "../lib/logger.js";
import { loadEnv } from "../lib/env.js";
import { appendStateEvent, readSnapshot, writeSnapshot } from "./local-state-store.js";

const TTL_DAYS = loadEnv().SWARMX_VIDEO_EXPORT_TTL_DAYS; // reuse video TTL setting
const TTL_MS   = TTL_DAYS * 24 * 60 * 60 * 1000;

// Run cleanup every 6 hours (matching video-cleanup.ts cadence).
const CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000;

const registry = new Map<string, SeriesJob>();

let cleanupTimer: NodeJS.Timeout | undefined;
let hydrated = false;

function persistSeries(event: string, series: SeriesJob): void {
  appendStateEvent("series", event, series);
  writeSnapshot("series", [...registry.values()]);
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export function createSeries(brief: SeriesBrief): SeriesJob {
  const now = new Date().toISOString();
  const job: SeriesJob = {
    id: randomUUID(),
    status: "planning",
    brief,
    videoJobIds: {},
    createdAt: now,
    updatedAt: now,
  };
  registry.set(job.id, job);
  persistSeries("create", job);
  log.info({ seriesId: job.id, tone: brief.tone, episodes: brief.seriesLength }, "series created");
  return job;
}

export function getSeries(id: string): SeriesJob | undefined {
  return registry.get(id);
}

export function listSeries(): SeriesJob[] {
  return Array.from(registry.values()).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt),
  );
}

export function updateSeries(id: string, patch: Partial<Omit<SeriesJob, "id" | "createdAt">>): SeriesJob | undefined {
  const existing = registry.get(id);
  if (!existing) return undefined;
  const updated: SeriesJob = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  registry.set(id, updated);
  persistSeries("update", updated);
  return updated;
}

export function setSeriesStatus(id: string, status: SeriesJobStatus, planningError?: string): SeriesJob | undefined {
  return updateSeries(id, { status, ...(planningError !== undefined ? { planningError } : {}) });
}

export function recordEpisodeJobId(seriesId: string, episodeNumber: number, jobId: string): void {
  const series = registry.get(seriesId);
  if (!series) return;
  const videoJobIds = { ...series.videoJobIds, [episodeNumber]: jobId };
  const allEpisodes = series.episodeRoadmap?.length ?? 0;
  const produced = Object.keys(videoJobIds).length;
  const status: SeriesJobStatus =
    allEpisodes > 0 && produced >= allEpisodes ? "completed" : "producing";
  updateSeries(seriesId, { videoJobIds, status });
}

export function deleteSeries(id: string): boolean {
  const deleted = registry.delete(id);
  if (deleted) {
    writeSnapshot("series", [...registry.values()]);
  }
  return deleted;
}

// ─── Pre-production CRUD (V2.0) ───────────────────────────────────────────────

export function getPreProduction(
  seriesId: string,
  episodeNumber: number,
): EpisodePreProduction | undefined {
  return registry.get(seriesId)?.preProduction?.[episodeNumber];
}

export function setPreProduction(
  seriesId: string,
  episodeNumber: number,
  data: EpisodePreProduction,
): void {
  const series = registry.get(seriesId);
  if (!series) return;
  const preProduction = { ...(series.preProduction ?? {}), [episodeNumber]: data };
  const updated = { ...series, preProduction, updatedAt: new Date().toISOString() };
  registry.set(seriesId, updated);
  persistSeries("preproduction_set", updated);
}

export function patchPreProduction(
  seriesId: string,
  episodeNumber: number,
  patch: Partial<EpisodePreProduction>,
): void {
  const series = registry.get(seriesId);
  if (!series) return;
  const existing = series.preProduction?.[episodeNumber];
  if (!existing) return;
  const updated: EpisodePreProduction = { ...existing, ...patch };
  const preProduction = { ...(series.preProduction ?? {}), [episodeNumber]: updated };
  const updatedSeries = { ...series, preProduction, updatedAt: new Date().toISOString() };
  registry.set(seriesId, updatedSeries);
  persistSeries("preproduction_patch", updatedSeries);
}

export function updatePreProductionStatus(
  seriesId: string,
  episodeNumber: number,
  status: EpisodePreProductionStatus,
): void {
  patchPreProduction(seriesId, episodeNumber, { status });
}

// ─── Pass Status (V2.1 — modular re-run support) ──────────────────────────────

export function updateSeriesPassStatus(
  id: string,
  pass: "pass1" | "pass2" | "pass3" | "pass4",
  status: SeriesPassStatus,
): void {
  const series = registry.get(id);
  if (!series) return;
  const current = series.planningPassStatus ?? {
    pass1: "idle", pass2: "idle", pass3: "idle", pass4: "idle",
  };
  const updated: SeriesJob = {
    ...series,
    planningPassStatus: { ...current, [pass]: status },
    updatedAt: new Date().toISOString(),
  };
  registry.set(id, updated);
  persistSeries("planning_pass_status", updated);
}

export function updateEpisodePassStatus(
  seriesId: string,
  episodeNumber: number,
  pass: "passA" | "passB" | "passC" | "passD",
  status: SeriesPassStatus,
): void {
  const series = registry.get(seriesId);
  if (!series) return;
  const existing = series.preProduction?.[episodeNumber];
  if (!existing) return;
  const current = existing.passStatus ?? {
    passA: "idle", passB: "idle", passC: "idle", passD: "idle",
  };
  const updated: EpisodePreProduction = {
    ...existing,
    passStatus: { ...current, [pass]: status },
  };
  const preProduction = { ...(series.preProduction ?? {}), [episodeNumber]: updated };
  const updatedSeries = { ...series, preProduction, updatedAt: new Date().toISOString() };
  registry.set(seriesId, updatedSeries);
  persistSeries("episode_pass_status", updatedSeries);
}

export function hydrateSeriesRegistryFromDisk(): number {
  if (hydrated) return registry.size;
  const records = readSnapshot<SeriesJob>("series");
  let restored = 0;
  for (const record of records) {
    if (!record?.id || !record.brief || !record.status) continue;
    registry.set(record.id, record);
    restored++;
  }
  hydrated = true;
  if (restored > 0) {
    log.info({ restored }, "series-registry: restored series from durable snapshot");
  }
  return restored;
}

// ─── Cleanup ─────────────────────────────────────────────────────────────────

function runCleanup(): void {
  const now = Date.now();
  let removed = 0;
  for (const [id, job] of registry.entries()) {
    if (now - Date.parse(job.createdAt) > TTL_MS) {
      registry.delete(id);
      removed++;
    }
  }
  if (removed > 0) {
    writeSnapshot("series", [...registry.values()]);
    log.info({ removed }, "series-registry: evicted expired series");
  }
}

export function startSeriesCleanup(): void {
  if (cleanupTimer) return;
  const firstRun = setTimeout(runCleanup, 60_000);
  firstRun.unref();
  cleanupTimer = setInterval(runCleanup, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function stopSeriesCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

export function _clearSeriesRegistryForTesting(): void {
  registry.clear();
  hydrated = false;
}

export function _runCleanupForTesting(): void {
  runCleanup();
}
