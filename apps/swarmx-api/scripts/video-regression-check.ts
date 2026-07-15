import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  LOW_RAM_VIDEO_MODEL,
  minimumRamRequiredForVideoRequest,
  resolveVideoModelTag,
  stageTimeoutMs,
} from "../src/services/video-runtime-config.js";
import { buildOllamaGenerateBody } from "../src/services/ollama.js";
import type { VideoJobRequest } from "../src/types/video.js";

const request: VideoJobRequest = {
  prompt: "Create a 30-second faceless TikTok video about focus.",
  platform: "tiktok",
  niche: "tech",
  targetDurationSeconds: 30,
  clientRequestId: "video-regression-check",
};

process.env["SWARMX_VIDEO_LOW_RAM_MODE"] = "1";
assert.equal(resolveVideoModelTag(request, "intent_classification"), LOW_RAM_VIDEO_MODEL);
assert.equal(resolveVideoModelTag(request, "planning"), LOW_RAM_VIDEO_MODEL);
assert.equal(resolveVideoModelTag(request, "scripting"), LOW_RAM_VIDEO_MODEL);
assert.equal(resolveVideoModelTag(request, "storyboard_generation"), LOW_RAM_VIDEO_MODEL);
assert.equal(minimumRamRequiredForVideoRequest(request), 3300);

process.env["SWARMX_VIDEO_LOW_RAM_MODE"] = "0";
process.env["SWARMX_VIDEO_PLAN_MODEL"] = "plan-phi4-pro-q8-prod";
assert.equal(resolveVideoModelTag(request, "planning"), "plan-phi4-pro-q8-prod");
delete process.env["SWARMX_VIDEO_PLAN_MODEL"];

const reasonerRequest = { ...request, modelTier: "reasoner" as const };
const reasonerRequiredMb = minimumRamRequiredForVideoRequest(reasonerRequest);
assert.ok(
  reasonerRequiredMb > 3300,
  `expected reasoner workflow to require more RAM than pilot mode, got ${reasonerRequiredMb}`,
);

process.env["VIDEO_PLANNING_TIMEOUT_MS"] = "999999";
assert.equal(stageTimeoutMs("planning"), 120000);
delete process.env["VIDEO_PLANNING_TIMEOUT_MS"];

const body = buildOllamaGenerateBody({
  model: LOW_RAM_VIDEO_MODEL,
  prompt: "hello",
  keepAlive: "30s",
});
assert.equal(body.keep_alive, "30s");

const orchestratorSource = await readFile(new URL("../src/services/video-orchestrator.ts", import.meta.url), "utf8");
assert.ok(orchestratorSource.includes("parseIntentClassification"));
assert.ok(orchestratorSource.includes("INTENT_VALIDATION_FAILED"));
assert.ok(orchestratorSource.includes("SWARMX_VIDEO_ALLOW_UNSTRUCTURED_INTENT"));
const renderStart = orchestratorSource.indexOf("async function stageRenderAssembly");
const renderEnd = orchestratorSource.indexOf("async function stageFinalizing");
assert.ok(renderStart > 0 && renderEnd > renderStart);
const renderBody = orchestratorSource.slice(renderStart, renderEnd);
assert.equal(renderBody.includes("acquireModel("), false);
assert.equal(renderBody.includes('ctx.modelsUsed["render_assembly"]'), false);

const routesSource = await readFile(new URL("../src/routes/video.ts", import.meta.url), "utf8");
assert.ok(routesSource.includes('"/files/:filename"'));
assert.equal(routesSource.includes('"/api/video/files/:filename"'), false);

const typesSource = await readFile(new URL("../src/types/video.ts", import.meta.url), "utf8");
for (const errorCode of [
  "ARTIFACT_MISSING",
  "ARTIFACT_EMPTY",
  "ARTIFACT_INVALID",
  "STUB_RENDER_DISABLED",
  "FFMPEG_UNAVAILABLE",
  "FFPROBE_UNAVAILABLE",
  "ESPEAK_UNAVAILABLE",
  "FONT_UNAVAILABLE",
  "COMFY_OUTPUT_PATH_TRAVERSAL",
  "RENDER_BACKEND_INVALID",
  "INTENT_VALIDATION_FAILED",
]) {
  assert.ok(typesSource.includes(`"${errorCode}"`), `missing VideoErrorCode ${errorCode}`);
}

const tempOutput = await mkdtemp(join(tmpdir(), "swarmx-video-regression-"));
process.env["SWARMX_VIDEO_EXPORT_DIR"] = tempOutput;
process.env["SWARMX_VIDEO_ALLOW_STUB_RENDER"] = "0";
const assets = await import("../src/services/video-assets.js");
await assert.rejects(
  () => assets.buildOutputMetadata({
    jobId: "missing",
    outputFilename: "missing.mp4",
    modelsUsed: {},
    request,
  }),
  /Video artifact missing/,
);

await assert.rejects(
  () => assets.buildOutputMetadata({
    jobId: "stub",
    outputFilename: "stub_stub.mp4",
    modelsUsed: {},
    request,
  }),
  /Stub render output is disabled/,
);

const realFile = join(tempOutput, "real.mp4");
await writeFile(realFile, "not-a-real-video", "utf8");
await assert.rejects(
  () => assets.buildOutputMetadata({
    jobId: "real",
    outputFilename: "real.mp4",
    modelsUsed: { intent_classification: LOW_RAM_VIDEO_MODEL },
    request,
  }),
  /Video artifact media probe failed/,
);

process.env["VIDEO_MAX_RETRIES"] = "1";
const queue = await import("../src/services/video-queue.js");
const first = queue.enqueue({ ...request, clientRequestId: "queue-first" });
const second = queue.enqueue({ ...request, clientRequestId: "queue-second" });
assert.equal(queue.startJob(first.id)?.status, "running");
assert.equal(queue.startJob(second.id), null);
queue.failJob(first.id, {
  code: "TRANSIENT",
  message: "retry",
  retryable: true,
  stage: "planning",
  timestamp: new Date().toISOString(),
});
assert.equal(queue.getJob(first.id)?.status, "queued");
assert.equal(queue.startJob(first.id)?.status, "running");
queue.failJob(first.id, {
  code: "TRANSIENT",
  message: "retry exhausted",
  retryable: true,
  stage: "planning",
  timestamp: new Date().toISOString(),
});
assert.equal(queue.getJob(first.id)?.status, "failed");
assert.equal(queue.dequeueNext()?.id, second.id);

console.log("video regression checks passed");
process.exit(0);
