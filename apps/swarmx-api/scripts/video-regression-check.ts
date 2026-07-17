import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  FULL_PIPELINE_MIN_AVAILABLE_MB,
  LOW_RAM_VIDEO_MODEL,
  detectAvailableMemoryMb,
  minimumRamRequiredForVideoRequest,
  resolveVideoModelTag,
  shouldAutoEnableLowRamMode,
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

delete process.env["SWARMX_VIDEO_LOW_RAM_MODE"];
delete process.env["SWARMX_VIDEO_INTENT_MODEL"];
delete process.env["SWARMX_VIDEO_PLAN_MODEL"];
delete process.env["SWARMX_VIDEO_SCRIPT_MODEL"];
delete process.env["SWARMX_VIDEO_STORYBOARD_MODEL"];
const defaultProfileRequiredMb = minimumRamRequiredForVideoRequest(request);
assert.equal(defaultProfileRequiredMb, 6170);

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
assert.equal(stageTimeoutMs("planning"), 180000);
delete process.env["VIDEO_PLANNING_TIMEOUT_MS"];

// V6.2.15 — new defaults are CPU-safe (cover cold-load latency on any host).
delete process.env["VIDEO_INTENT_CLASSIFY_TIMEOUT_MS"];
delete process.env["VIDEO_PLANNING_TIMEOUT_MS"];
delete process.env["VIDEO_SCRIPTING_TIMEOUT_MS"];
delete process.env["VIDEO_STORYBOARD_TIMEOUT_MS"];
assert.equal(stageTimeoutMs("intent_classification"), 30_000);
assert.equal(stageTimeoutMs("planning"), 60_000);
assert.equal(stageTimeoutMs("scripting"), 90_000);
assert.equal(stageTimeoutMs("storyboard_generation"), 120_000);

// V6.2.15 — shouldAutoEnableLowRamMode never overrides an explicit env value.
process.env["SWARMX_VIDEO_LOW_RAM_MODE"] = "0";
assert.equal(shouldAutoEnableLowRamMode(), false, "explicit=0 must block auto-enable");
process.env["SWARMX_VIDEO_LOW_RAM_MODE"] = "1";
assert.equal(shouldAutoEnableLowRamMode(), false, "explicit=1 must block auto-enable (already forced)");
delete process.env["SWARMX_VIDEO_LOW_RAM_MODE"];
// Threshold constant is stable and referenced by docs.
assert.equal(FULL_PIPELINE_MIN_AVAILABLE_MB, 6170);
// detectAvailableMemoryMb returns a positive number on Linux, null elsewhere.
const detected = detectAvailableMemoryMb();
assert.ok(detected === null || (typeof detected === "number" && detected > 0));

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
// V6.2.15 — SSE handler must close cleanly on terminal jobs, not hang forever.
assert.ok(routesSource.includes("isTerminalStatus(job.status)"), "SSE must short-circuit on already-terminal jobs");
assert.ok(routesSource.includes('event.type === "video:completed"'), "SSE must close on terminal lifecycle events");

// V6.2.15 — server auto-configures LOW_RAM_MODE and prewarms video model on constrained hosts.
const serverSource = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
assert.ok(serverSource.includes("shouldAutoEnableLowRamMode()"), "server must auto-enable low-RAM mode");
assert.ok(serverSource.includes("LOW_RAM_VIDEO_MODEL"), "server must reference the video prewarm model");

const composerSource = await readFile(new URL("../src/routes/composer.ts", import.meta.url), "utf8");
const preloadStart = composerSource.indexOf("function startModelPreload");
const preloadEnd = composerSource.indexOf("function timeoutBucketFor");
assert.ok(preloadStart > 0 && preloadEnd > preloadStart);
const preloadBody = composerSource.slice(preloadStart, preloadEnd);
assert.ok(preloadBody.includes('keep_alive: "30s"'));
assert.equal(preloadBody.includes('keep_alive: "10m"'), false);

const sseSource = await readFile(new URL("../src/plugins/sse.ts", import.meta.url), "utf8");
assert.ok(sseSource.includes("function removeSubscriber"));
assert.ok(sseSource.includes("reply.raw.destroy()"));

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
assert.equal(assets.outputDir(), tempOutput);
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

// ── Video auth failthrough regression (Phase-1 fix) ───────────────────────────
// Verify the auth middleware returns after sending 401 (no void discards the reply).
const authSource = await readFile(new URL("../src/services/video-auth.ts", import.meta.url), "utf8");
assert.ok(
  authSource.includes("return reply.code(401).send("),
  "video-auth must use 'return reply.code(401).send()' (not void) so the handler stops on auth failure",
);
assert.equal(
  authSource.includes("void reply.code(401)"),
  false,
  "video-auth must not use 'void reply.code(401)' — execution would continue past auth failure",
);

// ── Sanitizer integration regression (Phase-1 fix) ────────────────────────────
// All four text stages must pipe raw model output through sanitizeReasoningOutput.
const orchestratorSourceV2 = await readFile(new URL("../src/services/video-orchestrator.ts", import.meta.url), "utf8");
assert.ok(
  orchestratorSourceV2.includes("sanitizeReasoningOutput"),
  "video-orchestrator must import and use sanitizeReasoningOutput",
);
// Verify each stage calls it
for (const stage of ["stageIntentClassification", "stagePlanning", "stageScripting", "stageStoryboardGeneration"]) {
  const start = orchestratorSourceV2.indexOf(`async function ${stage}`);
  assert.ok(start >= 0, `stage function ${stage} not found`);
  const nextFn = orchestratorSourceV2.indexOf("async function stage", start + 1);
  const end = nextFn > 0 ? nextFn : orchestratorSourceV2.length;
  const body = orchestratorSourceV2.slice(start, end);
  assert.ok(
    body.includes("sanitizeReasoningOutput"),
    `${stage} must call sanitizeReasoningOutput() on raw model output`,
  );
}

// ── Preflight checks regression (Phase-2 fix) ─────────────────────────────────
// The video route must check ffmpeg, ffprobe, and espeak-ng before enqueuing.
const routesSourceV2 = await readFile(new URL("../src/routes/video.ts", import.meta.url), "utf8");
assert.ok(
  routesSourceV2.includes("ffmpeg_unavailable"),
  "video route must return 503 ffmpeg_unavailable when ffmpeg is absent",
);
assert.ok(
  routesSourceV2.includes("ffprobe_unavailable"),
  "video route must return 503 ffprobe_unavailable when ffprobe is absent",
);
assert.ok(
  routesSourceV2.includes("espeak_unavailable"),
  "video route must return 503 espeak_unavailable when espeak-ng is absent",
);
// The preflight block must come before queue.enqueue() so jobs are not created on failure
const preflightPos = routesSourceV2.indexOf("ffmpeg_unavailable");
const enqueuePos = routesSourceV2.indexOf("queue.enqueue(request.body)");
assert.ok(
  preflightPos < enqueuePos,
  "preflight checks must appear before queue.enqueue() in the route handler",
);

// ── V6.2.16 — Rate limiting on POST /jobs ─────────────────────────────────────
assert.ok(
  routesSourceV2.includes("exceedsJobSubmitLimit"),
  "video route must rate-limit POST /jobs via exceedsJobSubmitLimit()",
);
assert.ok(
  routesSourceV2.includes("jobSubmitRateLimit"),
  "video route must define a configurable jobSubmitRateLimit",
);
// Rate-limit check must precede both RAM check and preflight so we never
// charge a submission slot for a request we'd reject anyway on RAM/preflight.
const rateLimitPos = routesSourceV2.indexOf("exceedsJobSubmitLimit");
const ramCheckPos  = routesSourceV2.indexOf("insufficient_ram_for_video");
assert.ok(
  rateLimitPos < ramCheckPos,
  "rate-limit check must come before RAM check in the POST /jobs handler",
);

// ── V6.2.16 — Range request support in GET /files/:filename ──────────────────
assert.ok(
  routesSourceV2.includes("Content-Range"),
  "video file route must emit Content-Range header for partial content",
);
assert.ok(
  routesSourceV2.includes("Accept-Ranges"),
  "video file route must advertise Accept-Ranges: bytes",
);
assert.ok(
  routesSourceV2.includes("reply.status(206)"),
  "video file route must respond 206 Partial Content for range requests",
);
assert.ok(
  routesSourceV2.includes("range_not_satisfiable"),
  "video file route must return 416 Range Not Satisfiable for invalid ranges",
);

// ── V6.2.16 — FFmpeg renderer: tone palette and script-section extraction ────
const rendererSource = await readFile(new URL("../src/services/ffmpeg-video-renderer.ts", import.meta.url), "utf8");
assert.ok(
  rendererSource.includes("TONE_BACKGROUNDS"),
  "renderer must define tone-based background palette",
);
assert.ok(
  rendererSource.includes("TONE_ACCENTS"),
  "renderer must define tone-based accent colors for progress bar",
);
assert.ok(
  rendererSource.includes("CAPTION_STYLE_CONFIGS"),
  "renderer must define per-captionStyle layout configs",
);
assert.ok(
  rendererSource.includes("extractScriptSections"),
  "renderer must extract [HOOK]/[BODY]/[RESOLUTION]/[CTA] from script text",
);
assert.ok(
  rendererSource.includes("fontSizeForText"),
  "renderer must scale font size based on card text length",
);
// Progress bar drawn via drawbox with time-varying width expression.
assert.ok(
  rendererSource.includes("drawbox=x=0:y=ih-8"),
  "renderer must emit an animated progress bar via drawbox",
);

// ── V6.2.16 — Export cleanup service ─────────────────────────────────────────
const cleanupSource = await readFile(new URL("../src/services/video-cleanup.ts", import.meta.url), "utf8");
assert.ok(
  cleanupSource.includes("startVideoCleanup"),
  "cleanup service must export startVideoCleanup()",
);
assert.ok(
  cleanupSource.includes("stopVideoCleanup"),
  "cleanup service must export stopVideoCleanup()",
);
assert.ok(
  cleanupSource.includes("SWARMX_VIDEO_EXPORT_TTL_DAYS"),
  "cleanup service TTL must be configurable via SWARMX_VIDEO_EXPORT_TTL_DAYS",
);
// Server must import and call the cleanup service.
const serverSource2 = await readFile(new URL("../src/server.ts", import.meta.url), "utf8");
assert.ok(
  serverSource2.includes("startVideoCleanup()"),
  "server must call startVideoCleanup() after pollers are started",
);
assert.ok(
  serverSource2.includes("stopVideoCleanup()"),
  "server must call stopVideoCleanup() during graceful shutdown",
);

console.log("video regression checks passed");
process.exit(0);
