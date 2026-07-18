/**
 * apps/swarmx-api/src/services/video-cleanup.ts
 * SwarmXQ Video Subsystem — Export Retention Cleanup
 *
 * Removes exported video files and their sidecar metadata when they are older
 * than SWARMX_VIDEO_EXPORT_TTL_DAYS (default 7 days). Runs as a periodic
 * background interval after API startup. Errors are logged but never thrown
 * — cleanup is best-effort and must not affect running jobs or the HTTP server.
 */

import { readdir, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadEnv } from "../lib/env.js";

const _clenv = loadEnv();
const EXPORT_DIR = resolve(_clenv.SWARMX_VIDEO_EXPORT_DIR);
const ARTIFACT_DIR = resolve(_clenv.SWARMX_VIDEO_ARTIFACT_DIR);
const TTL_DAYS = Math.max(1, _clenv.SWARMX_VIDEO_EXPORT_TTL_DAYS || 7);
const CLEANUP_INTERVAL_MS = Math.max(60_000, _clenv.SWARMX_VIDEO_CLEANUP_INTERVAL_MS || 6 * 60 * 60 * 1000);

async function cleanDirectory(dir: string, ttlMs: number, tag: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return; // directory doesn't exist yet — nothing to clean
  }

  const now = Date.now();
  let removed = 0;

  for (const name of entries) {
    const fullPath = join(dir, name);
    try {
      const fileStat = await stat(fullPath);
      const ageMs = now - fileStat.mtimeMs;
      if (ageMs > ttlMs) {
        await rm(fullPath, { recursive: true, force: true });
        removed += 1;
      }
    } catch {
      // File may have been removed between readdir and stat — skip.
    }
  }

  if (removed > 0) {
    process.stderr.write(
      `[video-cleanup] ${tag}: removed ${removed} file(s) older than ${TTL_DAYS}d\n`,
    );
  }
}

async function runCleanup(): Promise<void> {
  const ttlMs = TTL_DAYS * 24 * 60 * 60 * 1000;
  await Promise.all([
    cleanDirectory(EXPORT_DIR, ttlMs, "exports"),
    cleanDirectory(ARTIFACT_DIR, ttlMs, "artifacts"),
  ]);
}

let cleanupTimer: NodeJS.Timeout | undefined;

export function startVideoCleanup(): void {
  if (cleanupTimer) return;

  // Run once shortly after startup, then on the configured interval.
  const firstRun = setTimeout(() => {
    void runCleanup().catch((err: unknown) => {
      process.stderr.write(`[video-cleanup] startup run failed: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }, 30_000);
  firstRun.unref();

  cleanupTimer = setInterval(() => {
    void runCleanup().catch((err: unknown) => {
      process.stderr.write(`[video-cleanup] interval run failed: ${err instanceof Error ? err.message : String(err)}\n`);
    });
  }, CLEANUP_INTERVAL_MS);
  cleanupTimer.unref();
}

export function stopVideoCleanup(): void {
  if (cleanupTimer) {
    clearInterval(cleanupTimer);
    cleanupTimer = undefined;
  }
}
