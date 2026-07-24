import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { VideoJobRequest } from "../src/types/video.js";

const repoRoot = resolve(new URL("../../../", import.meta.url).pathname);
const goldenRoot = resolve(repoRoot, ".swarmx/video/artifacts/golden-path");
const exportDir = resolve(goldenRoot, "exports");
const packageDir = resolve(goldenRoot, "packages");

await mkdir(exportDir, { recursive: true });
await mkdir(packageDir, { recursive: true });

process.env["SWARMX_HOST_PROFILE"] = "constrained_cpu_8gb";
process.env["OLLAMA_NUM_PARALLEL"] = "1";
process.env["OLLAMA_MAX_LOADED_MODELS"] = "1";
process.env["OLLAMA_KEEP_ALIVE"] = "0";
process.env["SWARMX_MODEL_STARTUP_PREWARM"] = "0";
process.env["SWARMX_VIDEO_EXPORT_DIR"] = exportDir;
process.env["SWARMX_VIDEO_ARTIFACT_DIR"] = packageDir;
process.env["SWARMX_VIDEO_ALLOW_STUB_RENDER"] = "0";
process.env["SWARMX_VIDEO_ALLOW_SILENT_AUDIO"] = "0";
process.env["SWARMX_VIDEO_FFMPEG_TIMEOUT_MS"] = "240000";
process.env["SWARMX_TTS_PROVIDER"] = process.env["SWARMX_TTS_PROVIDER"] ?? "auto";

const { renderWithFfmpeg } = await import("../src/services/ffmpeg-video-renderer.js");
const { buildOutputMetadata } = await import("../src/services/video-assets.js");
const { certifyProductionPack } = await import("../src/services/creative-factory-certification.js");

const request: VideoJobRequest = {
  prompt: "Create a short kinetic text video titled \"Daily Systems Beat Motivation\".",
  platform: "tiktok",
  niche: "tech",
  targetDurationSeconds: 18,
  tone: "kinetic_text",
  style: "kinetic_text",
  captionStyle: "bold_center",
  voice: "narrator",
  clientRequestId: "golden-path-first-video-v2",
};

const scriptText = [
  "[HOOK]",
  "Motivation loses by Wednesday. A visible system keeps going.",
  "[BODY]",
  "One trigger turns intention into motion. [VISUAL: glowing trigger card snaps into place, kinetic type, dark workspace, high contrast]",
  "Make the next action impossible to miss. [VISUAL: oversized arrow points to a two-minute task, rapid text reveal, amber accent]",
  "Track the streak, not the mood. [VISUAL: progress line climbs across five days, punchy motion typography, clean grid]",
  "[RESOLUTION]",
  "Design the first step before you need discipline. The system carries you when motivation leaves.",
  "[CTA]",
  "Build the trigger tonight.",
].join("\n");

const storyboardFrames = [
  "Pattern-interrupt hook over black canvas with amber motion type and a progress bar.",
  "Trigger card snaps into place beside a single highlighted next action.",
  "Two-minute timer pulses while the arrow points to the first step.",
  "Five-day streak line climbs with completed task chips.",
  "Final loop frame repeats the trigger with a concise CTA in safe-zone text.",
];

const result = await renderWithFfmpeg({
  jobId: "first-video-v2",
  request,
  scriptText,
  storyboardFrames,
});

const metadata = await buildOutputMetadata({
  jobId: "first-video-v2",
  outputFilename: result.outputFilename,
  scriptText,
  storyboardFrames,
  modelsUsed: {},
  request,
  renderPackage: result.renderPackage,
});

const certification = certifyProductionPack({ output: metadata });
assert.ok(metadata.fileSizeBytes > 0, "golden output must be non-empty");
assert.equal(metadata.format, "mp4");
assert.ok(metadata.durationSeconds > 0, "golden output must have duration");
assert.equal(certification.certificationTier, "PRODUCTION_PACK_VALID");

await writeFile(
  resolve(goldenRoot, "golden-path-summary.json"),
  `${JSON.stringify({ output: metadata, certification }, null, 2)}\n`,
  "utf8",
);

console.log(JSON.stringify({
  mp4: metadata.absolutePath,
  packageDir: metadata.productionPackageDir,
  certificationTier: certification.certificationTier,
  voiceProvider: metadata.voiceArtifact?.providerId,
  voiceQualityTier: metadata.voiceArtifact?.qualityTier,
}, null, 2));
