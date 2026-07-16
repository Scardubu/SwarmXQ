/**
 * apps/swarmx-api/src/services/video-orchestrator.ts
 * SwarmXQ Video Subsystem — Pressure-Aware Orchestrator
 *
 * Version : v2026.5.24-apex17-r7
 *
 * Fixes applied in r7 (correctness pass on r6):
 *   [VOT-09] stageRenderAssembly() now fully destructures { modelTag, overrides }
 *            from acquireModel() for consistency. Previously only `modelTag` was
 *            destructured; `overrides` was silently dropped. This stage does not
 *            call ollamaGenerate() so overrides are not forwarded — they are
 *            captured with an underscore-prefixed binding and a comment explaining
 *            why. This removes the inconsistency and prevents future developers
 *            from re-introducing the pattern without noticing.
 *   [VOT-10] modelsUsed recording moved from runStage() into each individual
 *            stage function. Previously runStage() called resolveModelTag() a
 *            second time after the stage fn completed. This meant:
 *            (a) If resolveCanonicalTag() produced a different result between
 *            the acquireModel() call and the runStage() bookkeeping call (e.g.
 *            during alias map hot-reload), modelsUsed would record a different
 *            tag than was actually used.
 *            (b) stageFinalizing() correctly had no modelsUsed entry because it
 *            calls no model — this is preserved.
 *            Fix: each stage fn sets ctx.modelsUsed[stage] = model immediately
 *            after acquireModel() resolves. The assignment in runStage() is
 *            removed entirely.
 *   [VOT-11] high pressure level now triggers a configurable backoff delay
 *            instead of silently passing through. On an 8 GB RAM system, "high"
 *            means between 1500 MB and 2500 MB available — a real signal that
 *            a 7B model load could trigger OOM without sufficient headroom.
 *            Behavior: 3-second delay (overridable via HIGH_PRESSURE_DELAY_MS
 *            env var), then a re-check. If the re-check is still "high", the
 *            job proceeds (graceful degradation). If it escalated to "critical",
 *            the job fails with PRESSURE_CRITICAL. This adds one network probe
 *            only on the high-pressure path.
 *   [VOT-12] comfyRunWorkflow() poll loop ceiling is now derived from
 *            STAGE_TIMEOUT_MS["render_assembly"] instead of being an independent
 *            literal. Previously the poll loop allowed up to 300 s (60 × 5 s)
 *            but the stage timeout was 240 s — they raced independently with no
 *            coordination. The corrected ceiling is
 *            Math.floor(STAGE_TIMEOUT_MS["render_assembly"] / COMFY_POLL_INTERVAL_MS)
 *            = 48 iterations. The constants are co-located with a comment so
 *            future edits to STAGE_TIMEOUT_MS["render_assembly"] automatically
 *            tighten the poll loop.
 *
 * Fixes applied in r6 (APEX-17 canonical rename + correctness pass):
 *   [VOT-07] Added resolveCanonicalTag import from model-orchestrator.
 *            resolveModelTag() now applies alias resolution as a final pass
 *            so callers that supply a legacy modelTier value (or any unrecognized
 *            tier key that falls through to STAGE_MODEL_TAG) always receive a
 *            canonical name. Without this, a caller passing modelTier: "qwen"
 *            would silently fall through to the STAGE_MODEL_TAG default, which
 *            is already canonical — but any external caller injecting a legacy
 *            tag string into modelTier would bypass the alias system entirely.
 *   [VOT-08] All STAGE_MODEL_TAG and tierMap values updated to canonical
 *            production names (APEX-17-r5 rename). Comments corrected.
 *
 * Fixes applied in r5:
 *   [VOT-01] Removed unused imports VIDEO_JOB_STAGE_ORDER / stageIndex /
 *            computeOverallProgress — caused TS2305 "no exported member" errors.
 *   [VOT-02] Removed REQUIRES_7B_LOCK constant — dead code.
 *   [VOT-03] ollamaGenerate() now accepts ModelOverrides and merges numCtx /
 *            numPredict from the orchestrator into Ollama options.
 *   [VOT-04] acquireModel() returns { modelTag, overrides } instead of bare
 *            string. All stage callers destructure and forward overrides.
 *   [VOT-05] stageController() uses { once: true } on both listeners to
 *            prevent indefinite listener accumulation on jobAbortSignal.
 *   [VOT-06] isComfyAvailable() stores abort listener reference and calls
 *            removeEventListener() in finally block.
 *
 * Responsibilities:
 *   - Stage-by-stage pipeline execution
 *   - Pressure monitor gating before each stage
 *   - SINGLE-7B LOCK enforcement via ModelOrchestrator
 *   - DeepSeek/Qwen output sanitization via reasoning-sanitizer
 *   - RAM-aware ctx/predict overrides applied per stage
 *   - AbortController per stage fetch (no connection leaks)
 *   - SSE event emission via broadcaster callback
 */

import type {
  VideoJob,
  VideoJobStage,
  VideoStageProgress,
  VideoJobError,
  VideoOutputMetadata,
  VideoJobRequest,
} from "../types/video.js";
import type { OperatorTraceEntry } from "@swarmx/types/video-types";
// [VOT-01] Removed: VIDEO_JOB_STAGE_ORDER, stageIndex, computeOverallProgress
// were imported but never used — caused TypeScript "no exported member" errors.
import type { SwarmXEvent } from "../types/events.js";
import {
  makeVideoProgressEvent,
  makeVideoCompletedEvent,
  makeVideoFailedEvent,
} from "../types/events.js";
import * as queue from "./video-queue.js";
import * as assets from "./video-assets.js";
import {
  ModelOrchestrator,
  type ModelOverrides,
} from "./model-orchestrator.js";
import { resolveOperatorName } from "@swarmx/types/operator-map";
import { getComfyUIClient } from "./comfyui-client.js";
import { generateLTXWorkflow } from "./video-workflows.js";
import { scoreVirality } from "./virality-scorer.js";
import { generateCaptionDraftWithValidation } from "./caption-generator.js";
import { generateOllamaText } from "./ollama.js";
import { renderWithFfmpeg } from "./ffmpeg-video-renderer.js";
import { sanitizeReasoningOutput } from "./reasoning-sanitizer.js";
import {
  resolveVideoModelTag,
  stageTimeoutMs,
  type TextVideoJobStage,
} from "./video-runtime-config.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const COMFY_BASE  = process.env.COMFY_HOST  ?? "http://localhost:8188";

/**
 * [VOT-11] Backoff delay (ms) applied when governor reports "high" pressure.
 * Configurable via env so staging can tune without a code change.
 * Default: 3000ms (3 seconds). Acceptable range: 1000–30000 ms.
 */
const HIGH_PRESSURE_DELAY_MS = Math.min(
  30_000,
  Math.max(1_000, parseInt(process.env.HIGH_PRESSURE_DELAY_MS ?? "3000", 10))
);

/** Per-stage timeout matrix (ms) — aligned with architecture review §3. */
const STAGE_TIMEOUT_MS: Record<VideoJobStage, number> = {
  intent_classification:  stageTimeoutMs("intent_classification"),
  planning:              stageTimeoutMs("planning"),
  scripting:             stageTimeoutMs("scripting"),
  storyboard_generation: stageTimeoutMs("storyboard_generation"),
  render_assembly:      stageTimeoutMs("render_assembly"),
  finalizing:            stageTimeoutMs("finalizing"),
};

/**
 * [VOT-12] ComfyUI polling constants — co-located so edits to
 * STAGE_TIMEOUT_MS["render_assembly"] automatically tighten the poll ceiling.
 *
 * Previously the poll loop ran up to 60 × 5s = 300s but the stage timeout
 * was 240s — independent literals that raced with no shared contract.
 * Now COMFY_POLL_MAX_ATTEMPTS is derived from the stage timeout so the two
 * are always in sync. At 240s / 5s = 48 iterations maximum.
 */
const COMFY_POLL_INTERVAL_MS   = 5_000;
const COMFY_POLL_MAX_ATTEMPTS  = Math.floor(
  STAGE_TIMEOUT_MS["render_assembly"] / COMFY_POLL_INTERVAL_MS
); // = 48

// ─── Types ────────────────────────────────────────────────────────────────────

export type BroadcastFn = (event: SwarmXEvent) => void;

interface OrchestratorContext {
  job: VideoJob;
  broadcast: BroadcastFn;
  /** Abort signal for the entire job — set externally when cancel is requested. */
  jobAbortSignal: AbortSignal;
  startedAt: number;
  modelsUsed: Partial<Record<VideoJobStage, string>>;
  scriptText?: string;
  storyboardFrames?: string[];
  viralitySummary?: string;
}

function toPublicStatus(stage: VideoJobStage): string {
  const map: Record<VideoJobStage, string> = {
    intent_classification: "classifying",
    planning: "staging",
    scripting: "scripting",
    storyboard_generation: "staging",
    render_assembly: "generating",
    finalizing: "reviewing",
  };
  return map[stage];
}

function pushOperatorTrace(
  job: VideoJob,
  entry: OperatorTraceEntry,
): void {
  if (!job.operatorTrace) {
    job.operatorTrace = [];
  }
  job.operatorTrace.push(entry);
}

function recordOperatorTrace(
  ctx: OrchestratorContext,
  stage: VideoJobStage,
  model: string,
  startedAt: string,
  success: boolean,
): void {
  pushOperatorTrace(ctx.job, {
    stage: toPublicStatus(stage),
    operatorTag: model,
    modelTag: model,
    operator: traceOperatorFor(model),
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs: 0,
    tokenCount: 0,
    success,
    timestamp: startedAt,
  });
}

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) {
      throw new Error("no JSON object found");
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

function parseIntentClassification(raw: string): { intent: string; complexity: number } {
  const parsed = extractJsonObject(raw);
  if (!parsed || typeof parsed !== "object") {
    throw new Error("intent classification is not an object");
  }
  const candidate = parsed as Record<string, unknown>;

  // Base intent from the "intent" key.
  let intent = typeof candidate["intent"] === "string" ? candidate["intent"].trim() : "";

  // The 3.8B model often outputs ARC and TAKEAWAY as separate top-level keys
  // instead of packing them into the intent string. Repack them when they appear.
  if (intent && !intent.includes("| ARC:") && !intent.includes("| TAKEAWAY:")) {
    const arc      = typeof candidate["ARC"]      === "string" ? candidate["ARC"].trim()      : "";
    const takeaway = typeof candidate["TAKEAWAY"] === "string" ? candidate["TAKEAWAY"].trim() : "";
    if (arc)      intent += ` | ARC: ${arc}`;
    if (takeaway) intent += ` | TAKEAWAY: ${takeaway}`;
  }

  if (!intent) throw new Error("intent classification failed schema validation");

  // complexity is optional — model frequently omits it; default to 0.5.
  const rawC = candidate["complexity"];
  const complexity =
    typeof rawC === "number" && Number.isFinite(rawC) && rawC >= 0 && rawC <= 1 ? rawC : 0.5;

  return { intent, complexity };
}

// ─── Pressure Guard ───────────────────────────────────────────────────────────

interface GovernorSnapshot {
  pressureLevel:    "normal" | "high" | "critical";
  concurrencyLimit: number;
}

/**
 * Read the live governor snapshot from the Python sidecar.
 * On failure, falls back to local MemAvailable instead of failing open to normal.
 */
async function readPressure(): Promise<GovernorSnapshot> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2_000);
  try {
    const res = await fetch(
      `${process.env.SWARMX_API_INTERNAL ?? "http://localhost:7380"}/api/governor`,
      { signal: controller.signal }
    );
    if (!res.ok) throw new Error(`governor probe: ${res.status}`);
    return (await res.json()) as GovernorSnapshot;
  } catch {
    try {
      const { readFile } = await import("node:fs/promises");
      const meminfo = await readFile("/proc/meminfo", "utf8");
      const match = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/);
      const availableMb = match?.[1] ? Math.floor(Number(match[1]) / 1024) : 0;
      if (availableMb < 800) return { pressureLevel: "critical", concurrencyLimit: 1 };
      if (availableMb < 2_500) return { pressureLevel: "high", concurrencyLimit: 1 };
      return { pressureLevel: "normal", concurrencyLimit: 1 };
    } catch {
      return { pressureLevel: "high", concurrencyLimit: 1 };
    }
  } finally {
    clearTimeout(timer);
  }
}

// ─── Model Acquisition with SINGLE-7B LOCK ───────────────────────────────────

/**
 * [VOT-04] Returns both the resolved model tag AND the RAM-aware overrides
 * from ModelOrchestrator so callers can forward them to ollamaGenerate().
 *
 * Previously acquireModel() returned only the string tag, silently discarding
 * the overrides computed by getRamAwareOverrides() inside requestModel().
 */
async function acquireModel(
  stage: TextVideoJobStage,
  request: VideoJobRequest
): Promise<{ modelTag: string; keepAlive: string; overrides: ModelOverrides }> {
  const tag = resolveModelTag(request, stage);
  const mo  = ModelOrchestrator.getInstance();
  const { modelTag: resolvedTag, keepAlive, evictedModels, overrides } = await mo.requestModel(tag);

  if (evictedModels.length > 0) {
    // Expected on 8 GB RAM — log for observability via stderr (no fastify logger in service scope)
    process.stderr.write(
      `[video-orchestrator] SINGLE-7B eviction before stage "${stage}": ${evictedModels.join(", ")}\n`
    );
  }

  return { modelTag: resolvedTag, keepAlive, overrides };
}

// ─── Ollama Fetch Helper ──────────────────────────────────────────────────────

/**
 * [VOT-03] Now accepts optional ModelOverrides from the orchestrator.
 *
 * Previously: `options: { num_predict: maxTokens, temperature: 0.3 }` — fixed.
 * Now: `numCtx` and `numPredict` from getRamAwareOverrides() are merged in,
 * so under low-ram / degraded modes the KV cache and predict budget are
 * automatically reduced before the Ollama request is sent.
 *
 * Accepts `signal` (from stage AbortController) so the connection is
 * cleanly torn down when the stage times out or the job is cancelled.
 */
async function ollamaGenerate(
  model:     string,
  prompt:    string,
  signal:    AbortSignal,
  maxTokens = 1024,
  overrides: ModelOverrides = {},
  keepAlive?: string,
): Promise<string> {
  return generateOllamaText({
    model,
    prompt,
    signal,
    maxTokens,
    overrides,
    ...(keepAlive !== undefined ? { keepAlive } : {}),
  });
}

/**
 * Submit a ComfyUI workflow and wait for completion.
 * All fetch calls are gated on the stage abort signal.
 *
 * [VOT-12] Poll ceiling derived from STAGE_TIMEOUT_MS["render_assembly"] /
 * COMFY_POLL_INTERVAL_MS (= 48 iterations at 240s / 5s). Previously this was
 * hardcoded as 60, giving a 300s ceiling that raced independently with the
 * 240s stage timeout.
 */
async function comfyRunWorkflow(
  workflowJson: Record<string, unknown>,
  signal:       AbortSignal
): Promise<string> {
  const submitRes = await fetch(`${COMFY_BASE}/prompt`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    signal,
    body: JSON.stringify({ prompt: workflowJson }),
  });

  if (!submitRes.ok) {
    throw Object.assign(
      new Error(`ComfyUI submission failed: ${submitRes.status}`),
      { code: "COMFY_UNAVAILABLE" }
    );
  }

  const { prompt_id } = (await submitRes.json()) as { prompt_id: string };

  // [VOT-12] Use coordinated ceiling — see COMFY_POLL_MAX_ATTEMPTS constant.
  for (let attempt = 0; attempt < COMFY_POLL_MAX_ATTEMPTS; attempt++) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, COMFY_POLL_INTERVAL_MS);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });

    const histRes = await fetch(`${COMFY_BASE}/history/${prompt_id}`, { signal });
    if (!histRes.ok) continue;

    const history = (await histRes.json()) as Record<
      string, { outputs?: Record<string, unknown> }
    >;
    if (history[prompt_id]) {
      const outputs     = history[prompt_id].outputs ?? {};
      const firstOutput = Object.values(outputs)[0] as
        | { images?: { filename: string }[] } | undefined;
      return firstOutput?.images?.[0]?.filename ?? "output.mp4";
    }
  }

  throw Object.assign(new Error("ComfyUI workflow timed out"), { code: "RENDER_FAILED" });
}

// ─── Stage Implementations ───────────────────────────────────────────────────

async function stageIntentClassification(
  ctx: OrchestratorContext
): Promise<{ intent: string; complexity: number }> {
  // [VOT-04] Destructure modelTag + overrides from acquireModel
  const { modelTag: model, keepAlive, overrides } = await acquireModel("intent_classification", ctx.job.request);
  const startedAt = new Date().toISOString();
  // [VOT-10] Record actual resolved tag immediately — not re-derived later
  ctx.modelsUsed["intent_classification"] = model;
  const controller = stageController(ctx, "intent_classification");

  try {
    // [VOT-03] Pass overrides to ollamaGenerate
    // [VOT-13] Sanitize raw output before parsing so DeepSeek <think> blocks
    //          never corrupt intent JSON. Safe no-op on phi4/qwen outputs.
    const rawIntent = await ollamaGenerate(
      model,
      `Analyze this video generation brief and extract its creative strategy.

Brief: "${ctx.job.request.prompt}"

Respond as strict JSON only, no other text:
{"intent": "HOOK: [one-sentence contrarian or surprising angle] | ARC: [what viewer feels start→middle→end] | TAKEAWAY: [specific actionable conclusion]", "complexity": 0.0}

complexity: 0.0 = simple topic, minimal narrative arc; 1.0 = nuanced multi-beat storytelling with strong identity challenge required.`,
      controller.signal,
      192,
      overrides,
      keepAlive,
    );
    const { text: raw } = sanitizeReasoningOutput(rawIntent);
    try {
      const parsed = parseIntentClassification(raw);
      recordOperatorTrace(ctx, "intent_classification", model, startedAt, true);
      return parsed;
    } catch (err) {
      if (process.env["SWARMX_VIDEO_ALLOW_UNSTRUCTURED_INTENT"] === "1") {
        recordOperatorTrace(ctx, "intent_classification", model, startedAt, true);
        return { intent: raw.slice(0, 200), complexity: 0.5 };
      }
      recordOperatorTrace(ctx, "intent_classification", model, startedAt, false);
      throw Object.assign(
        new Error(`Intent classification did not return valid JSON: ${err instanceof Error ? err.message : String(err)}`),
        { code: "INTENT_VALIDATION_FAILED" },
      );
    }
  } finally {
    controller.abort();
    ModelOrchestrator.getInstance().onModelCallComplete(model);
  }
}

async function stagePlanning(
  ctx:    OrchestratorContext,
  intent: string
): Promise<{ plan: string[] }> {
  const { modelTag: model, keepAlive, overrides } = await acquireModel("planning", ctx.job.request);
  const startedAt = new Date().toISOString();
  // [VOT-10] Record actual resolved tag immediately — not re-derived later
  ctx.modelsUsed["planning"] = model;
  const controller = stageController(ctx, "planning");

  try {
    // [VOT-13] Sanitize output before parsing so <think> blocks never
    //          produce hallucinated plan lines.
    const rawPlan = await ollamaGenerate(
      model,
      buildPlanningPrompt(ctx.job.request, intent),
      controller.signal,
      512,
      overrides,
      keepAlive,
    );
    const { text: raw } = sanitizeReasoningOutput(rawPlan);
    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\s*[\d.-]+[\s.)]*/, "").trim())
      .filter(Boolean);
    const result = {
      plan: lines.length > 0
        ? lines
        : ["Generate visuals", "Add narration", "Assemble final video"],
    };
    pushOperatorTrace(ctx.job, {
      stage: toPublicStatus("planning"),
      operatorTag: model,
      modelTag: model,
      operator: traceOperatorFor(model),
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      tokenCount: 0,
      success: true,
      timestamp: startedAt,
    });
    return result;
  } finally {
    controller.abort();
    ModelOrchestrator.getInstance().onModelCallComplete(model);
  }
}

async function stageScripting(
  ctx:  OrchestratorContext,
  plan: string[]
): Promise<{ scriptText: string }> {
  const { modelTag: model, keepAlive, overrides } = await acquireModel("scripting", ctx.job.request);
  const startedAt = new Date().toISOString();
  // [VOT-10] Record actual resolved tag immediately — not re-derived later
  ctx.modelsUsed["scripting"] = model;
  const controller = stageController(ctx, "scripting");

  try {
    // [VOT-13] Sanitize output so <think> artifacts never appear in the
    //          generated script that feeds the storyboard and render stages.
    const rawScript = await ollamaGenerate(
      model,
      buildScriptingPrompt(ctx.job.request, plan),
      controller.signal,
      1024,
      overrides,
      keepAlive,
    );
    const { text: scriptText } = sanitizeReasoningOutput(rawScript);
    pushOperatorTrace(ctx.job, {
      stage: toPublicStatus("scripting"),
      operatorTag: model,
      modelTag: model,
      operator: traceOperatorFor(model),
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      tokenCount: 0,
      success: true,
      timestamp: startedAt,
    });
    return { scriptText };
  } finally {
    controller.abort();
    ModelOrchestrator.getInstance().onModelCallComplete(model);
  }
}

async function stageStoryboardGeneration(
  ctx:        OrchestratorContext,
  scriptText: string
): Promise<{ frames: string[] }> {
  const { modelTag: model, keepAlive, overrides } = await acquireModel("storyboard_generation", ctx.job.request);
  const startedAt = new Date().toISOString();
  // [VOT-10] Record actual resolved tag immediately — not re-derived later
  ctx.modelsUsed["storyboard_generation"] = model;
  const controller = stageController(ctx, "storyboard_generation");

  try {
    // [VOT-13] Sanitize raw output before frame extraction so DeepSeek
    //          <think> content never becomes a storyboard frame description.
    const rawStoryboard = await ollamaGenerate(
      model,
      buildStoryboardPrompt(ctx.job.request, scriptText),
      controller.signal,
      768,
      overrides,
      keepAlive,
    );
    const { text: raw } = sanitizeReasoningOutput(rawStoryboard);
    const frames = raw
      .split("\n")
      .filter((l) => l.trim().startsWith("-") || /^\d+\./.test(l.trim()))
      .map((l)    => l.replace(/^[-\d.]+\s*/, "").trim())
      .filter(Boolean);
    const result = {
      frames: frames.length > 0
        ? frames
        : ["Abstract cinematic opener", "Key message frame", "CTA closing frame"],
    };
    pushOperatorTrace(ctx.job, {
      stage: toPublicStatus("storyboard_generation"),
      operatorTag: model,
      modelTag: model,
      operator: traceOperatorFor(model),
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      tokenCount: 0,
      success: true,
      timestamp: startedAt,
    });
    return result;
  } finally {
    controller.abort();
    ModelOrchestrator.getInstance().onModelCallComplete(model);
  }
}

async function stageRenderAssembly(
  ctx:    OrchestratorContext,
  frames: string[]
): Promise<{ outputFilename: string }> {
  const startedAt = new Date().toISOString();
  const controller = stageController(ctx, "render_assembly");

  try {
    for (const model of Object.values(ctx.modelsUsed)) {
      if (model) {
        await ModelOrchestrator.getInstance().unloadModel(model);
      }
    }

    const backend = process.env["SWARMX_VIDEO_RENDER_BACKEND"] ?? "auto";
    const comfyClient = getComfyUIClient();
    const comfyAvailable = await comfyClient.isAvailable(controller.signal);
    const comfyConfigured = Boolean(process.env["SWARMX_COMFYUI_OUTPUT_DIR"]);
    if ((backend === "auto" || backend === "comfyui") && comfyAvailable && comfyConfigured) {
      const ram = ModelOrchestrator.getInstance().getRamSnapshot();
      const workflow = generateLTXWorkflow({
        seed: Math.floor(Math.random() * 1_000_000_000),
        prompt: frames[0] ?? ctx.job.request.prompt,
        negativePrompt: "low quality, blurry, watermark, artifact",
        resolution: "512x896",
        totalFrames: Math.max(16, Math.min(96, frames.length * 8)),
        outputFps: 24,
        availableMb: ram.availableMb,
      });

      const run = await comfyClient.runWorkflow(workflow, {
        signal: controller.signal,
        onProgress: (progress) => {
          const stageProgress: VideoStageProgress = {
            stage: "render_assembly",
            stageProgress: progress.pct,
            overallProgress: Math.round(75 + (progress.pct * 0.2)),
            message: progress.message,
            startedAt: new Date().toISOString(),
          };
          queue.recordStageProgress(ctx.job.id, "render_assembly", stageProgress);
          ctx.broadcast(makeVideoProgressEvent(
            ctx.job.id,
            "render_assembly",
            stageProgress,
            stageProgress.overallProgress,
            progress.message,
          ));
          ctx.broadcast({
            type: "video:stream",
            timestamp: new Date().toISOString(),
            data: {
              jobId: ctx.job.id,
              stage: "generating",
              pct: Math.max(0, Math.min(100, progress.pct)),
              operatorTag: "forge",
              message: progress.message,
            },
          });
        },
      });

      const outputFilename = await assets.importComfyOutput(run.outputFilename);
      pushOperatorTrace(ctx.job, {
        stage: toPublicStatus("render_assembly"),
        operatorTag: "system",
        modelTag: "system",
        operator: "System",
        startedAt,
        completedAt: new Date().toISOString(),
        latencyMs: 0,
        tokenCount: 0,
        success: true,
        timestamp: startedAt,
      });

      return { outputFilename };
    }

    if (backend === "comfyui") {
      throw Object.assign(new Error("ComfyUI is unavailable or SWARMX_COMFYUI_OUTPUT_DIR is not configured"), {
        code: "COMFY_UNAVAILABLE",
      });
    }

    if (backend !== "auto" && backend !== "ffmpeg") {
      throw Object.assign(new Error(`Unknown video render backend: ${backend}`), {
        code: "RENDER_BACKEND_INVALID",
      });
    }

    const rendered = await renderWithFfmpeg({
      jobId: ctx.job.id,
      request: ctx.job.request,
      storyboardFrames: frames,
      signal: controller.signal,
      ...(ctx.scriptText !== undefined ? { scriptText: ctx.scriptText } : {}),
    });
    pushOperatorTrace(ctx.job, {
      stage: toPublicStatus("render_assembly"),
      operatorTag: "system",
      modelTag: "system",
      operator: "System",
      startedAt,
      completedAt: new Date().toISOString(),
      latencyMs: 0,
      tokenCount: 0,
      success: true,
      timestamp: startedAt,
    });
    return rendered;
  } finally {
    controller.abort();
  }
}

async function stageFinalizing(
  ctx:            OrchestratorContext,
  scriptText:     string,
  frames:         string[],
  outputFilename: string
): Promise<VideoOutputMetadata> {
  // stageFinalizing calls no model — no modelsUsed entry, no acquireModel().
  const startedAt = new Date().toISOString();
  pushOperatorTrace(ctx.job, {
    stage: toPublicStatus("finalizing"),
    operatorTag: "system",
    modelTag: "system",
    operator: "System",
    startedAt,
    completedAt: new Date().toISOString(),
    latencyMs: 0,
    tokenCount: 0,
    success: true,
    timestamp: startedAt,
  });
  return assets.buildOutputMetadata({
    jobId:            ctx.job.id,
    outputFilename,
    scriptText,
    storyboardFrames: frames,
    modelsUsed:       ctx.modelsUsed as Record<string, string>,
    request:          ctx.job.request,
  });
}

async function stageViralityAndCaption(ctx: OrchestratorContext): Promise<void> {
  const targetPlatform =
    ctx.job.request.platform === "youtube_shorts"
      ? "shorts"
      : (ctx.job.request.platform ?? "generic");

  const virality = await scoreVirality({
    topic: ctx.job.request.prompt,
    platform: targetPlatform,
    durationSec: ctx.job.request.targetDurationSeconds ?? 30,
    ...(extractHookLine(ctx.scriptText)
      ? { hook: extractHookLine(ctx.scriptText) as string }
      : {}),
  });

  const viralitySummary = virality?.recommendations.join("; ") ?? "No virality recommendations available";

  let captionDraft = virality?.captionDraft;

  try {
    const captionResult = await generateCaptionDraftWithValidation({
      topic: ctx.job.request.prompt,
      tone: ctx.job.request.tone ?? "educational",
      platform: targetPlatform,
      viralitySummary,
    });
    captionDraft = captionResult.draft;
  } catch (error) {
    ctx.broadcast({
      type: "video:stream",
      timestamp: new Date().toISOString(),
      data: {
        jobId: ctx.job.id,
        stage: "caption_generation",
        pct: 1,
        operatorTag: "system",
        message: error instanceof Error ? error.message : "caption_generation_failed",
      },
    });
  }

  if (virality && captionDraft) {
    ctx.job.viralitySignal = {
      ...virality,
      captionDraft,
    };
    ctx.viralitySummary = virality.recommendations.join("; ");
  } else if (virality) {
    ctx.job.viralitySignal = virality;
    ctx.viralitySummary = virality.recommendations.join("; ");
  } else {
    ctx.viralitySummary = viralitySummary;
  }

  if (captionDraft && !ctx.job.outputArtifacts) {
    ctx.job.outputArtifacts = {};
  }
  if (captionDraft && ctx.job.outputArtifacts) {
    ctx.job.outputArtifacts.captionPath = "inline:caption-draft";
  }
  ctx.job.updatedAt = new Date().toISOString();
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Execute the full video generation pipeline for a job.
 * Emits SSE events at each stage boundary.
 * Handles abort signals from the job controller.
 */
export async function runOrchestration(
  jobId:     string,
  broadcast: BroadcastFn
): Promise<void> {
  const job = queue.getJob(jobId);
  if (!job) throw new Error(`Orchestrator: job ${jobId} not found`);

  const jobAbortController = new AbortController();

  const cancelWatcher = setInterval(() => {
    const current = queue.getJob(jobId);
    if (current?.status === "cancelled") {
      jobAbortController.abort();
      clearInterval(cancelWatcher);
    }
  }, 500);

  const ctx: OrchestratorContext = {
    job,
    broadcast,
    jobAbortSignal: jobAbortController.signal,
    startedAt:      Date.now(),
    modelsUsed:     {},
  };
  let retryScheduled = false;

  try {
    const pressure = await readPressure();

    if (pressure.pressureLevel === "critical") {
      throw makeError(
        "PRESSURE_CRITICAL",
        "System is under critical memory pressure. Try again shortly.",
        false
      );
    }

    // [VOT-11] Apply backoff on "high" pressure before starting the pipeline.
    // On 8 GB RAM, "high" means 1500–2500 MB free — a real signal that a 7B
    // model load could push us into OOM territory without a grace period.
    // After the delay, re-check: if escalated to critical, fail fast.
    // If still high or recovered to normal, proceed (graceful degradation).
    if (pressure.pressureLevel === "high") {
      console.warn(
        `[video-orchestrator] Job ${jobId}: system pressure is HIGH — ` +
        `delaying ${HIGH_PRESSURE_DELAY_MS}ms before pipeline start`
      );
      await new Promise<void>((resolve) => setTimeout(resolve, HIGH_PRESSURE_DELAY_MS));

      const recheck = await readPressure();
      if (recheck.pressureLevel === "critical") {
        throw makeError(
          "PRESSURE_CRITICAL",
          "System escalated to critical memory pressure during high-pressure backoff. Try again shortly.",
          true  // retryable: pressure may recover
        );
      }
      // Still "high" or recovered to "normal" — proceed with degraded awareness
      console.warn(
        `[video-orchestrator] Job ${jobId}: pressure re-check → "${recheck.pressureLevel}", proceeding`
      );
    }

    // Sync ModelOrchestrator with live Ollama /api/ps state before starting.
    // This gives the SINGLE-7B LOCK an accurate baseline snapshot.
    // [MOT-05] Names are normalized inside syncFromOllama via resolveCanonicalTag.
    await ModelOrchestrator.getInstance().syncFromOllama();

    job.pressureTierAtStart = pressure.pressureLevel;

    let intent = ctx.job.request.prompt;
    await runStage(ctx, "intent_classification", 0, 15, async () => {
      const result = await stageIntentClassification(ctx);
      intent = result.intent;
    });

    let plan: string[] = [];
    await runStage(ctx, "planning", 15, 30, async () => {
      const result = await stagePlanning(ctx, intent);
      plan = result.plan;
    });

    let scriptText = "";
    await runStage(ctx, "scripting", 30, 50, async () => {
      const result = await stageScripting(ctx, plan);
      scriptText = result.scriptText;
      ctx.scriptText = scriptText;
    });

    let frames: string[] = [];
    await runStage(ctx, "storyboard_generation", 50, 75, async () => {
      const result = await stageStoryboardGeneration(ctx, scriptText);
      frames = result.frames;
      ctx.storyboardFrames = frames;
    });

    let outputFilename = "";
    await runStage(ctx, "render_assembly", 75, 95, async () => {
      const result = await stageRenderAssembly(ctx, frames);
      outputFilename = result.outputFilename;
    });

    let output: VideoOutputMetadata | undefined;
    await runStage(ctx, "finalizing", 95, 100, async () => {
      output = await stageFinalizing(ctx, scriptText, frames, outputFilename);
    });

    await stageViralityAndCaption(ctx);

    if (!output) {
      throw makeError("UNKNOWN", "finalizing stage did not produce output", false, "finalizing");
    }

    if (!ctx.job.outputArtifacts) {
      ctx.job.outputArtifacts = {};
    }
    ctx.job.outputArtifacts.outputPath = output.absolutePath;
    ctx.job.outputArtifacts.outputPublicUrl = output.publicUrl;

    const completedJob = queue.completeJob(jobId, output);
    broadcast(makeVideoCompletedEvent(jobId, {
      outputPublicUrl: output.publicUrl,
      durationSeconds: output.durationSeconds,
      fileSizeBytes:   output.fileSizeBytes,
      totalDurationMs: Date.now() - ctx.startedAt,
      modelsUsed:      output.modelsUsed as Record<string, string>,
    }));
    void completedJob;

  } catch (err: unknown) {
    clearInterval(cancelWatcher);
    const current = queue.getJob(jobId);
    if (current?.status === "cancelled") return;

    const videoError = toVideoError(err);
    const failedJob  = queue.failJob(jobId, videoError);

    broadcast(makeVideoFailedEvent(
      jobId, videoError, failedJob.retryCount,
      Date.now() - ctx.startedAt, ctx.job.currentStage
    ));

    if (failedJob.status === "queued") {
      retryScheduled = true;
      broadcast({
        type: "video:stream",
        timestamp: new Date().toISOString(),
        data: {
          jobId,
          stage: "retry",
          pct: 0,
          operatorTag: "system",
          message: `Retry attempt ${failedJob.retryCount} queued`,
        },
      });
      setTimeout(() => {
        const retryJob = queue.startJob(jobId);
        if (retryJob) {
          void runOrchestration(jobId, broadcast);
        }
      }, 5_000);
    }
  } finally {
    clearInterval(cancelWatcher);
    jobAbortController.abort();
    if (!retryScheduled) {
      scheduleNextQueuedJob(broadcast);
    }
  }
}

function scheduleNextQueuedJob(broadcast: BroadcastFn): void {
  const next = queue.dequeueNext();
  if (!next) return;
  setImmediate(() => {
    const started = queue.startJob(next.id);
    if (started) {
      void runOrchestration(next.id, broadcast).catch((err) => {
        process.stderr.write(
          `[video-orchestrator] queued job ${next.id} crashed: ${err instanceof Error ? err.message : String(err)}\n`,
        );
      });
    }
  });
}

// ─── Stage Runner ─────────────────────────────────────────────────────────────

/**
 * [VOT-10] modelsUsed assignment removed from runStage().
 *
 * Previously: `ctx.modelsUsed[stage] = resolveModelTag(ctx.job.request, stage)`
 * was called here after fn() completed. This caused two problems:
 *   (a) Double tag resolution — the actual model used came from acquireModel()
 *       inside the stage fn, but bookkeeping re-derived it via resolveModelTag().
 *       If resolveCanonicalTag() returns different results between the two calls
 *       (possible during alias map migration), modelsUsed records the wrong tag.
 *   (b) stageFinalizing has no model — a re-derivation call there would silently
 *       record whichever STAGE_MODEL_TAG was configured for "finalizing", even
 *       though no model call was made.
 *
 * Fix: each individual stage fn now sets ctx.modelsUsed[stage] = model
 * immediately after acquireModel() resolves with the actual tag. stageFinalizing
 * sets nothing (correct — it makes no model call).
 */
async function runStage(
  ctx:           OrchestratorContext,
  stage:         VideoJobStage,
  progressStart: number,
  progressEnd:   number,
  fn:            () => Promise<void>
): Promise<void> {
  if (ctx.jobAbortSignal.aborted) {
    throw new DOMException("Job aborted before stage start", "AbortError");
  }

  const stageStart     = Date.now();
  const stageTimeoutMs = STAGE_TIMEOUT_MS[stage];

  const startProgress: VideoStageProgress = {
    stage,
    stageProgress:   0,
    overallProgress: progressStart,
    startedAt:       new Date().toISOString(),
    message:         `Starting ${stage.replace(/_/g, " ")}…`,
  };
  queue.recordStageProgress(ctx.job.id, stage, startProgress);
  ctx.broadcast(makeVideoProgressEvent(ctx.job.id, stage, startProgress, progressStart));

  await withTimeout(fn(), stageTimeoutMs, `Stage ${stage} timed out after ${stageTimeoutMs}ms`);

  const completedProgress: VideoStageProgress = {
    stage,
    stageProgress:   100,
    overallProgress: progressEnd,
    completedAt:     new Date().toISOString(),
    durationMs:      Date.now() - stageStart,
    ...(startProgress.startedAt !== undefined
      ? { startedAt: startProgress.startedAt }
      : {}),
  };
  queue.recordStageProgress(ctx.job.id, stage, completedProgress);
  ctx.broadcast(makeVideoProgressEvent(ctx.job.id, stage, completedProgress, progressEnd));

  // [VOT-10] modelsUsed[stage] is now set inside each stage fn after acquireModel(),
  // not re-derived here. See individual stage implementations above.
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * [VOT-05] Fixed: Both listeners now use { once: true } so they
 * self-remove after firing. Previously anonymous lambdas on jobAbortSignal
 * were never cleaned up — one leaked listener per stage × per job.
 */
function stageController(
  ctx:   OrchestratorContext,
  stage: VideoJobStage
): AbortController {
  const controller = new AbortController();
  const timeout    = STAGE_TIMEOUT_MS[stage];
  const timer      = setTimeout(() => controller.abort(), timeout);

  // Auto-removes after first fire — no manual cleanup needed
  controller.signal.addEventListener(
    "abort",
    () => clearTimeout(timer),
    { once: true }
  );
  ctx.jobAbortSignal.addEventListener(
    "abort",
    () => controller.abort(),
    { once: true }
  );

  return controller;
}

/**
 * Resolve the model tag for a given stage and request.
 *
 * [VOT-07] resolveCanonicalTag() applied as final pass to normalize any
 * legacy -scar tag that may be supplied via request.modelTier during the
 * migration cutover window. The tierMap keys are human-readable tier names
 * ("fast", "worker", "supervisor", "reasoner") — unknown keys fall through
 * to the STAGE_MODEL_TAG default, which is already canonical. The
 * resolveCanonicalTag() call handles the edge case where a caller injects
 * a legacy tag string directly as the modelTier value.
 */
function resolveModelTag(request: VideoJobRequest, stage: TextVideoJobStage): string {
  return resolveVideoModelTag(request, stage);
}

function traceOperatorFor(model: string): string {
  const operator = resolveOperatorName(model);
  return operator === model ? "System" : operator;
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(Object.assign(new Error(message), { code: "TIMEOUT" })),
      ms
    );
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); }
    );
  });
}

function makeError(
  code:      VideoJobError["code"],
  message:   string,
  retryable: boolean,
  stage?:    VideoJobStage
): VideoJobError {
  return {
    code,
    message,
    retryable,
    ...(stage !== undefined ? { stage } : {}),
  };
}

function toVideoError(err: unknown): VideoJobError {
  if (err instanceof DOMException && err.name === "AbortError") {
    return makeError("CANCELLED_BY_USER", "Stage was aborted", false);
  }
  const e         = err as { message?: string; code?: string };
  const code      = (e.code as VideoJobError["code"]) ?? "UNKNOWN";
  const message   = e.message ?? "An unknown error occurred";
  const retryable = ["TIMEOUT", "OLLAMA_UNAVAILABLE", "COMFY_UNAVAILABLE"].includes(code);
  return { code, message, retryable };
}

/**
 * [VOT-06] Fixed: The abort listener reference is now stored so
 * removeEventListener() can clean it up in the finally block.
 * Previously the listener on the incoming signal was never removed.
 */
async function isComfyAvailable(signal: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  const onAbort    = () => controller.abort();
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    const res = await fetch(`${COMFY_BASE}/system_stats`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function extractHookLine(scriptText: string | undefined): string | undefined {
  if (!scriptText) return undefined;
  const lines = scriptText.split("\n");
  const hookIdx = lines.findIndex((l) => l.trim().startsWith("[HOOK]"));
  if (hookIdx >= 0) {
    return lines.slice(hookIdx + 1).find((l) => l.trim().length > 0)?.trim();
  }
  return lines[0]?.trim() || undefined;
}

function creativeBriefLines(req: VideoJobRequest): string {
  return [
    `Audience: ${req.audience ?? "general viewers"}`,
    `Tone: ${req.tone ?? "educational"}`,
    `Style: ${req.style ?? "faceless_broll"}`,
    `Caption style: ${req.captionStyle ?? "bold_center"}`,
    `Voice: ${req.voice ?? "default"}`,
  ].join("\n");
}

function buildPlanningPrompt(req: VideoJobRequest, intent: string): string {
  const dur = req.targetDurationSeconds ?? 60;
  const hookEnd = Math.min(4, Math.round(dur * 0.07));
  const contextEnd = Math.round(dur * 0.25);
  const insightEnd = Math.round(dur * 0.65);
  const proofEnd = dur - 7;
  return `You are a short-form video production planner. Plan this ${dur}-second faceless video as 5 precise production beats.

Platform: ${req.platform ?? "tiktok"} | Niche: ${req.niche ?? "general"} | Tone: ${req.tone ?? "educational"} | Style: ${req.style ?? "faceless_broll"}
Audience: ${req.audience ?? "general viewers"}
Intent: ${intent}
Creative brief: "${req.prompt}"

Write exactly 5 numbered beats — not generic labels, but specific production instructions for this topic:
1. HOOK (0-${hookEnd}s): The scroll-stopping opener. What specific claim, question, or visual contrast starts the video?
2. CONTEXT (${hookEnd}-${contextEnd}s): The familiar pain or premise the viewer already feels. How is it framed?
3. INSIGHT (${contextEnd}-${insightEnd}s): The reframe, data point, or unexpected truth. What specifically is revealed?
4. PROOF (${insightEnd}-${proofEnd}s): The concrete illustration — example, stat, or micro-story beat.
5. CTA (last 7s): The specific next action. Not generic — a genuine behavior change or save-worthy moment tied to this topic.

One line per beat.`;
}

const TONE_RULES: Record<string, string> = {
  contrarian: 'Open with "Everyone says X, but..." or a direct inversion of conventional wisdom. Name the belief, then refute it.',
  urgent: "Use present-tense immediacy: 'right now', 'today', 'before it's too late'. Create time pressure without hyperbole.",
  educational: "Open with a curiosity gap: 'Here's why...', 'The reason is...', 'What most people miss...'. Teach, don't preach.",
  cinematic: "Slower pacing. Declarative, atmospheric sentences. Build mood before information. Pauses implied.",
  warm: "Conversational and personal. Speak to one person, not a crowd. Use 'you' and 'your'. No jargon.",
  minimal: "Maximum impact per word. Short sentences. One idea per sentence. Cut every filler word.",
};

function buildScriptingPrompt(req: VideoJobRequest, plan: string[]): string {
  const dur = req.targetDurationSeconds ?? 60;
  const toneInstruction = TONE_RULES[req.tone ?? "educational"] ?? TONE_RULES["educational"];
  return `You are an expert short-form video scriptwriter for ${req.platform ?? "tiktok"}.
Niche: ${req.niche ?? "general"} | Tone: ${req.tone ?? "educational"} | Style: ${req.style ?? "faceless_broll"} | Voice: ${req.voice ?? "default"}
Audience: ${req.audience ?? "general viewers"}
Original brief: "${req.prompt}"

Production plan:
${plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Tone instruction: ${toneInstruction}

Write a ${dur}-second narration script using EXACTLY this structure with section markers:

[HOOK]
(12-18 words maximum. The single most pattern-interrupting sentence. No preamble. Start with the contrast, claim, or question.)

[BODY]
(${Math.round(dur * 0.6)}-second section. 3-4 sentences. Each increases stakes or deepens understanding. Insert [VISUAL: abstract description] cues after sentences needing visual emphasis.)

[RESOLUTION]
(8-10 seconds. Land the specific takeaway in 1-2 concrete, actionable sentences.)

[CTA]
(5-8 words. Direct and specific. Avoid 'like and subscribe'.)

Output the full script with section markers intact. No other text.`;
}

function buildStoryboardPrompt(req: VideoJobRequest, scriptText: string): string {
  const isKinetic = req.style === "kinetic_text";
  const styleNote = isKinetic
    ? "Bold typography on dark or high-contrast backgrounds. Text appears in sync with narration. Minimal motion blur."
    : "Abstract b-roll: particles, flowing light, slow-motion textures, data visualizations. No faces, no people.";
  const colorMoods: Record<string, string> = {
    contrarian: "high-contrast black and white with one sharp accent color (red or electric blue)",
    urgent: "warm reds and amber, high saturation, strong vignette",
    educational: "cool blues and greens, clean gradients, trustworthy palette",
    cinematic: "desaturated with warm golden undertone, subtle film grain feel",
    warm: "soft warm tones, gentle gradients, pastel highlights",
    minimal: "pure black or white background, single color accent",
  };
  const colorMood = colorMoods[req.tone ?? "educational"] ?? colorMoods["educational"];
  return `You are a visual director for ${isKinetic ? "kinetic typography" : "faceless b-roll"} short-form video.
Platform: ${req.platform ?? "tiktok"} | Tone: ${req.tone ?? "educational"}
Visual style: ${styleNote}
Color palette direction: ${colorMood}

Script:
${scriptText.slice(0, 1400)}

Extract 5-7 visual scenes that map in sequence to the script's beats: HOOK → CONTEXT → INSIGHT → PROOF → CTA.

For each scene, output on one line:
- [SCENE N | BEAT] ${isKinetic ? 'Text: "exact words on screen" | ' : ""}Motion: [what moves and how] | Color: [dominant palette note] | Pacing: [fast cut / hold / slow fade]

Be specific to this script's content. No generic descriptions.`;
}

function buildComfyWorkflow(
  req:    VideoJobRequest,
  frames: string[]
): Record<string, unknown> {
  return {
    "1": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: `${frames[0] ?? req.prompt}, vertical 9:16, abstract, cinematic, no faces, ${req.niche ?? "motivational"}`,
        clip: ["2", 1],
      },
    },
    // Additional workflow nodes loaded from workflows/video-generation.yaml
  };
}
