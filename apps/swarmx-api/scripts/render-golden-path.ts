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
  prompt: "Create a short narrator-led explainer about why small daily systems outperform motivation.",
  platform: "tiktok",
  niche: "tech",
  targetDurationSeconds: 18,
  tone: "educational",
  style: "faceless_broll",
  captionStyle: "bold_center",
  voice: "narrator",
  clientRequestId: "golden-path-first-video-v2",
};

const scriptText = [
  "Motivation is a spark. Systems are the wiring.",
  "Pick one daily trigger, then make the next action obvious.",
  "Reduce the decision to a two minute start.",
  "Track the streak, not the mood.",
  "When the system is visible, consistency stops needing drama.",
].join("\n");

const storyboardFrames = [
  "Opening title over a dark workspace with a moving focus ring and progress bar.",
  "Checklist frame showing a single daily trigger and one highlighted next action.",
  "Timer frame with a two minute countdown and kinetic caption emphasis.",
  "Progress frame showing a visible streak line and completed task chips.",
  "Final brand frame with a concise call to action and safe-zone caption placement.",
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
