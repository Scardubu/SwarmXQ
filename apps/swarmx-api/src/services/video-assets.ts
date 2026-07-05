/**
 * apps/swarmx-api/src/services/video-assets.ts
 * SwarmXQ Video Subsystem — Output Storage Abstraction
 *
 * Responsibilities:
 *  - Build VideoOutputMetadata from raw orchestrator results
 *  - Resolve file paths and public URLs
 *  - Verify output file existence
 *  - Artifact cleanup for old/cancelled jobs
 */

import { createHash } from "node:crypto";
import { stat, unlink, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import type { VideoOutputMetadata, VideoJobRequest, VideoJobStage } from "../types/video.js";
import type { VideoPerformanceMetrics } from "@swarmx/types/video-types";

// ─── Config ───────────────────────────────────────────────────────────────────

const OUTPUT_DIR = resolve(
  process.env.SWARMX_VIDEO_EXPORT_DIR ??
    process.env.VIDEO_OUTPUT_DIR ??
    join(process.cwd(), ".swarmx", "video", "output")
);

const ARTIFACT_DIR = resolve(
  process.env.SWARMX_VIDEO_ARTIFACT_DIR ??
    join(process.cwd(), ".swarmx", "video", "artifacts"),
);

const PUBLIC_URL_BASE = process.env.VIDEO_PUBLIC_URL_BASE ?? "/api/video/files";

const STUB_DURATION_SECONDS = 30;
const STUB_WIDTH = 720;
const STUB_HEIGHT = 1280;
const STUB_FPS = 24;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BuildMetadataInput {
  jobId: string;
  outputFilename: string;
  scriptText?: string;
  storyboardFrames?: string[];
  modelsUsed: Record<string, string>;
  request: VideoJobRequest;
}

// ─── Path Resolution ──────────────────────────────────────────────────────────

export function outputDir(): string {
  return OUTPUT_DIR;
}

export function resolveOutputPath(filename: string): string {
  return join(OUTPUT_DIR, filename);
}

export function resolvePublicUrl(filename: string): string {
  return `${PUBLIC_URL_BASE}/${filename}`;
}

// ─── Metadata Builder ─────────────────────────────────────────────────────────

/**
 * Build a VideoOutputMetadata record.
 * If the file exists on disk, reads real stats.
 * If not (stub/ComfyUI not running), fills in reasonable defaults
 * so the pipeline can complete without crashing in dev.
 */
export async function buildOutputMetadata(
  input: BuildMetadataInput
): Promise<VideoOutputMetadata> {
  const absolutePath = resolveOutputPath(input.outputFilename);
  const publicUrl = resolvePublicUrl(input.outputFilename);
  const relativePath = input.outputFilename;

  let fileSizeBytes = 0;
  let checksum = "stub";
  let durationSeconds = STUB_DURATION_SECONDS;
  let widthPx = STUB_WIDTH;
  let heightPx = STUB_HEIGHT;

  if (existsSync(absolutePath)) {
    const fileStat = await stat(absolutePath);
    fileSizeBytes = fileStat.size;

    const buf = await readFile(absolutePath);
    checksum = createHash("sha256").update(buf).digest("hex");

    // Attempt to read duration from file metadata.
    // In a real implementation, pipe through ffprobe here.
    durationSeconds = await probeDuration(absolutePath);
    const dims = await probeDimensions(absolutePath);
    widthPx = dims.width;
    heightPx = dims.height;
  }

  const format: "mp4" | "webm" = input.outputFilename.endsWith(".webm")
    ? "webm"
    : "mp4";

  return {
    relativePath,
    absolutePath,
    publicUrl,
    fileSizeBytes,
    durationSeconds,
    widthPx,
    heightPx,
    fps: STUB_FPS,
    format,
    checksum,
    generatedAt: new Date().toISOString(),
    ...(input.scriptText !== undefined ? { scriptText: input.scriptText } : {}),
    ...(input.storyboardFrames !== undefined ? { storyboardFrames: input.storyboardFrames } : {}),
    modelsUsed: input.modelsUsed,
  };
}

// ─── Cleanup ──────────────────────────────────────────────────────────────────

/**
 * Delete output artifact for a given job.
 * Safe to call even if the file does not exist.
 */
export async function deleteArtifact(filename: string): Promise<boolean> {
  const path = resolveOutputPath(filename);
  try {
    await unlink(path);
    return true;
  } catch {
    return false;
  }
}

// ─── Probes (ffprobe stubs) ───────────────────────────────────────────────────

/**
 * Probe video duration via ffprobe.
 * Returns STUB_DURATION_SECONDS if ffprobe is unavailable.
 */
async function probeDuration(filePath: string): Promise<number> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_format",
      filePath,
    ]);

    const parsed = JSON.parse(stdout) as {
      format?: { duration?: string };
    };
    const dur = parseFloat(parsed.format?.duration ?? "0");
    return dur > 0 ? dur : STUB_DURATION_SECONDS;
  } catch {
    return STUB_DURATION_SECONDS;
  }
}

async function probeDimensions(
  filePath: string
): Promise<{ width: number; height: number }> {
  try {
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const execFileAsync = promisify(execFile);

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "quiet",
      "-print_format", "json",
      "-show_streams",
      filePath,
    ]);

    const parsed = JSON.parse(stdout) as {
      streams?: { width?: number; height?: number; codec_type?: string }[];
    };
    const video = parsed.streams?.find((s) => s.codec_type === "video");
    return {
      width: video?.width ?? STUB_WIDTH,
      height: video?.height ?? STUB_HEIGHT,
    };
  } catch {
    return { width: STUB_WIDTH, height: STUB_HEIGHT };
  }
}

// ─── Manifest ─────────────────────────────────────────────────────────────────

export interface ArtifactManifestEntry {
  jobId: string;
  filename: string;
  publicUrl: string;
  createdAt: string;
}

/**
 * List all video artifacts in the output directory.
 */
export async function listArtifacts(): Promise<ArtifactManifestEntry[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(OUTPUT_DIR);
    return files
      .filter((f) => f.endsWith(".mp4") || f.endsWith(".webm"))
      .map((f) => ({
        jobId: f.split("_")[1]?.split(".")[0] ?? f,
        filename: f,
        publicUrl: resolvePublicUrl(f),
        createdAt: new Date().toISOString(),
      }));
  } catch {
    return [];
  }
}

/**
 * r2 evolution handoff stub.
 * Persists publish-time metrics without coupling to Lab in VIDEO-ALPHA r1.
 */
export async function recordVideoPerformance(
  jobId: string,
  metrics: VideoPerformanceMetrics,
): Promise<string> {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const outputPath = resolve(ARTIFACT_DIR, `${jobId}.performance.json`);
  await writeFile(outputPath, `${JSON.stringify(metrics, null, 2)}\n`, "utf8");
  return outputPath;
}