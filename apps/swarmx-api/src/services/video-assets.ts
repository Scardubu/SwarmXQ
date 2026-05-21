/**
 * apps/swarmx-api/src/services/video-assets.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal file-system helpers for video job artifacts.
 * Stores per-job outputs under SWARMX_VIDEO_OUTPUT_DIR (or .swarmx/video-output).
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";

const VIDEO_OUTPUT_DIR =
  process.env["SWARMX_VIDEO_OUTPUT_DIR"] ??
  path.resolve(process.cwd(), "../../.swarmx/video-output");

export function getVideoOutputRoot(): string {
  return VIDEO_OUTPUT_DIR;
}

export function getVideoJobDir(jobId: string): string {
  return path.join(VIDEO_OUTPUT_DIR, jobId);
}

export function getVideoArtifactPath(jobId: string, fileName: string): string {
  const safeName = path.basename(fileName).replace(/[^a-zA-Z0-9._-]/g, "_");
  return path.join(getVideoJobDir(jobId), safeName);
}

export async function ensureVideoJobDir(jobId: string): Promise<string> {
  const dir = getVideoJobDir(jobId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function writeVideoTextArtifact(
  jobId: string,
  fileName: string,
  contents: string,
): Promise<string> {
  const filePath = getVideoArtifactPath(jobId, fileName);
  await ensureVideoJobDir(jobId);
  await writeFile(filePath, contents, "utf8");
  return filePath;
}

export async function writeVideoJsonArtifact<T>(
  jobId: string,
  fileName: string,
  payload: T,
): Promise<string> {
  return writeVideoTextArtifact(jobId, fileName, `${JSON.stringify(payload, null, 2)}
`);
}

export async function readVideoArtifact(jobId: string, fileName: string): Promise<string | null> {
  try {
    return await readFile(getVideoArtifactPath(jobId, fileName), "utf8");
  } catch {
    return null;
  }
}

export async function removeVideoJobArtifacts(jobId: string): Promise<void> {
  try {
    await rm(getVideoJobDir(jobId), { recursive: true, force: true });
  } catch {
    // best-effort cleanup
  }
}

export function buildVideoArtifactUrl(jobId: string, fileName: string): string {
  return `/api/video/jobs/${encodeURIComponent(jobId)}/artifacts/${encodeURIComponent(fileName)}`;
}
