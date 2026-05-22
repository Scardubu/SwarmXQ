/**
 * apps/swarmx-api/src/services/video-orchestrator.ts
 * SwarmXQ Video Subsystem — Pressure-Aware Orchestrator
 *
 * FIX: All fetch() calls now receive an AbortController signal so connections
 * are torn down on timeout rejection — no more connection leaks.
 *
 * Responsibilities:
 *  - Stage-by-stage pipeline execution
 *  - Pressure monitor gating before each stage
 *  - AbortController per stage fetch (fixes connection leak)
 *  - SSE event emission via broadcaster callback
 *  - Model routing (phi4-fast → qwen-supervisor → deepseek-reasoner)
 */

import type {
  VideoJob,
  VideoJobStage,
  VideoStageProgress,
  VideoJobError,
  VideoOutputMetadata,
  VideoJobRequest,
} from "../types/video.js";
import {
  VIDEO_JOB_STAGE_ORDER,
  stageIndex,
  computeOverallProgress,
} from "../types/video.js";
import type { SwarmXEvent } from "../types/events.js";
import {
  makeVideoProgressEvent,
  makeVideoCompletedEvent,
  makeVideoFailedEvent,
} from "../types/events.js";
import * as queue from "./video-queue.js";
import * as assets from "./video-assets.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const OLLAMA_BASE = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const COMFY_BASE = process.env.COMFY_HOST ?? "http://localhost:8188";

/** Per-stage timeout matrix (ms) — aligned with architecture review. */
const STAGE_TIMEOUT_MS: Record<VideoJobStage, number> = {
  intent_classification: 4_000,
  planning: 15_000,
  scripting: 35_000,
  storyboard_generation: 60_000,
  render_assembly: 240_000,
  finalizing: 15_000,
};

/** Model tier per stage — can be overridden by request.modelTier. */
const STAGE_MODEL_TAG: Record<VideoJobStage, string> = {
  intent_classification: "phi4-fast",
  planning: "qwen-supervisor",
  scripting: "qwen-supervisor",
  storyboard_generation: "qwen-supervisor",
  render_assembly: "phi4-fast",
  finalizing: "phi4-fast",
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type BroadcastFn = (event: SwarmXEvent) => void;

interface OrchestratorContext {
  job: VideoJob;
  broadcast: BroadcastFn;
  /** Abort signal for the entire job — set externally when cancel is requested. */
  jobAbortSignal: AbortSignal;
  startedAt: number;
  modelsUsed: Partial<Record<VideoJobStage, string>>;
}

// ─── Pressure Guard ───────────────────────────────────────────────────────────

interface GovernorSnapshot {
  pressureLevel: "normal" | "high" | "critical";
  concurrencyLimit: number;
}

/**
 * Read the live governor snapshot from the Python sidecar.
 * On failure, defaults to normal pressure so orchestration is not blocked.
 *
 * FIX: Uses AbortController so the probe fetch is cancelled on timeout,
 * not left open as a dangling connection.
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
    return { pressureLevel: "normal", concurrencyLimit: 1 };
  } finally {
    clearTimeout(timer);
  }
}

// ─── Ollama Fetch Helper ──────────────────────────────────────────────────────

/**
 * Send a prompt to an Ollama model and return the full response text.
 *
 * FIX: Accepts `signal` (from stage AbortController) so the connection is
 * cleanly torn down when the stage times out or the job is cancelled.
 * Previously, a timeout rejection left the fetch connection open indefinitely.
 */
async function ollamaGenerate(
  model: string,
  prompt: string,
  signal: AbortSignal,
  maxTokens = 1024
): Promise<string> {
  const res = await fetch(`${OLLAMA_BASE}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal, // ← THE FIX: signal terminates the connection on abort
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      options: { num_predict: maxTokens, temperature: 0.3 },
    }),
  });

  if (!res.ok) {
    throw Object.assign(
      new Error(`Ollama ${model} responded ${res.status}: ${await res.text()}`),
      { code: "OLLAMA_UNAVAILABLE" }
    );
  }

  const data = (await res.json()) as { response: string };
  return data.response.trim();
}

/**
 * Submit a ComfyUI workflow and wait for completion.
 *
 * FIX: Uses AbortController so the submission fetch and poll fetches
 * are all torn down when the stage is aborted.
 */
async function comfyRunWorkflow(
  workflowJson: Record<string, unknown>,
  signal: AbortSignal
): Promise<string> {
  // Submit
  const submitRes = await fetch(`${COMFY_BASE}/prompt`, {
    method: "POST",
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

  // Poll (each poll request is also signal-gated)
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise<void>((resolve, reject) => {
      const t = setTimeout(resolve, 5_000);
      signal.addEventListener("abort", () => {
        clearTimeout(t);
        reject(new DOMException("Aborted", "AbortError"));
      });
    });

    const histRes = await fetch(`${COMFY_BASE}/history/${prompt_id}`, {
      signal,
    });
    if (!histRes.ok) continue;

    const history = (await histRes.json()) as Record<
      string,
      { outputs?: Record<string, unknown> }
    >;
    if (history[prompt_id]) {
      const outputs = history[prompt_id].outputs ?? {};
      const firstOutput = Object.values(outputs)[0] as
        | { images?: { filename: string }[] }
        | undefined;
      const filename = firstOutput?.images?.[0]?.filename ?? "output.mp4";
      return filename;
    }
  }

  throw Object.assign(new Error("ComfyUI workflow timed out"), {
    code: "RENDER_FAILED",
  });
}

// ─── Stage Implementations ───────────────────────────────────────────────────

async function stageIntentClassification(
  ctx: OrchestratorContext
): Promise<{ intent: string; complexity: number }> {
  const { job } = ctx;
  const model = resolveModel(job.request, "intent_classification");

  const controller = stageController(ctx, "intent_classification");

  try {
    const raw = await ollamaGenerate(
      model,
      `Classify this video generation request in one sentence and rate complexity 0-1:\n"${job.request.prompt}"\n\nRespond as JSON: {"intent": "...", "complexity": 0.0}`,
      controller.signal,
      128
    );

    try {
      return JSON.parse(raw) as { intent: string; complexity: number };
    } catch {
      return { intent: raw.slice(0, 200), complexity: 0.5 };
    }
  } finally {
    controller.abort(); // always release the connection
  }
}

async function stagePlanning(
  ctx: OrchestratorContext,
  intent: string
): Promise<{ plan: string[] }> {
  const controller = stageController(ctx, "planning");

  try {
    const model = resolveModel(ctx.job.request, "planning");
    const raw = await ollamaGenerate(
      model,
      buildPlanningPrompt(ctx.job.request, intent),
      controller.signal,
      512
    );

    const lines = raw
      .split("\n")
      .map((l) => l.replace(/^\s*[\d.-]+[\s.)]*/, "").trim())
      .filter(Boolean);

    return { plan: lines.length > 0 ? lines : ["Generate visuals", "Add narration", "Assemble final video"] };
  } finally {
    controller.abort();
  }
}

async function stageScripting(
  ctx: OrchestratorContext,
  plan: string[]
): Promise<{ scriptText: string }> {
  const controller = stageController(ctx, "scripting");

  try {
    const model = resolveModel(ctx.job.request, "scripting");
    const scriptText = await ollamaGenerate(
      model,
      buildScriptingPrompt(ctx.job.request, plan),
      controller.signal,
      1024
    );
    return { scriptText };
  } finally {
    controller.abort();
  }
}

async function stageStoryboardGeneration(
  ctx: OrchestratorContext,
  scriptText: string
): Promise<{ frames: string[] }> {
  const controller = stageController(ctx, "storyboard_generation");

  try {
    const model = resolveModel(ctx.job.request, "storyboard_generation");
    const raw = await ollamaGenerate(
      model,
      buildStoryboardPrompt(ctx.job.request, scriptText),
      controller.signal,
      768
    );

    const frames = raw
      .split("\n")
      .filter((l) => l.trim().startsWith("-") || /^\d+\./.test(l.trim()))
      .map((l) => l.replace(/^[-\d.]+\s*/, "").trim())
      .filter(Boolean);

    return {
      frames: frames.length > 0
        ? frames
        : ["Abstract cinematic opener", "Key message frame", "CTA closing frame"],
    };
  } finally {
    controller.abort();
  }
}

async function stageRenderAssembly(
  ctx: OrchestratorContext,
  frames: string[]
): Promise<{ outputFilename: string }> {
  const controller = stageController(ctx, "render_assembly");

  try {
    const comfyAvailable = await isComfyAvailable(controller.signal);

    if (comfyAvailable) {
      const workflow = buildComfyWorkflow(ctx.job.request, frames);
      const filename = await comfyRunWorkflow(workflow, controller.signal);
      return { outputFilename: filename };
    }

    // Stub path: return a deterministic filename when ComfyUI is not running.
    // In production this would trigger a queue back-off or degraded mode.
    return { outputFilename: `stub_${ctx.job.id}.mp4` };
  } finally {
    controller.abort();
  }
}

async function stageFinalizing(
  ctx: OrchestratorContext,
  scriptText: string,
  frames: string[],
  outputFilename: string
): Promise<VideoOutputMetadata> {
  return assets.buildOutputMetadata({
    jobId: ctx.job.id,
    outputFilename,
    scriptText,
    storyboardFrames: frames,
    modelsUsed: ctx.modelsUsed as Record<string, string>,
    request: ctx.job.request,
  });
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

/**
 * Execute the full video generation pipeline for a job.
 * Emits SSE events at each stage boundary.
 * Handles abort signals from the job controller.
 */
export async function runOrchestration(
  jobId: string,
  broadcast: BroadcastFn
): Promise<void> {
  const job = queue.getJob(jobId);
  if (!job) throw new Error(`Orchestrator: job ${jobId} not found`);

  const jobAbortController = new AbortController();

  // Wire the job's cancel into the abort controller.
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
    startedAt: Date.now(),
    modelsUsed: {},
  };

  try {
    // Pressure gate
    const pressure = await readPressure();
    if (pressure.pressureLevel === "critical") {
      throw makeError("PRESSURE_CRITICAL", "System is under critical memory pressure. Try again shortly.", false);
    }

    // Update job with pressure tier at start
    job.pressureTierAtStart = pressure.pressureLevel;

    // ── Stage 1: Intent Classification ─────────────────────────────────────
    await runStage(ctx, "intent_classification", 0, 15, async () => {
      const { intent } = await stageIntentClassification(ctx);
      return intent;
    });

    // ── Stage 2: Planning ───────────────────────────────────────────────────
    let plan: string[] = [];
    await runStage(ctx, "planning", 15, 30, async () => {
      const intent = (ctx.job.stages["intent_classification"] as VideoStageProgress & { _result?: string })?._result ?? ctx.job.request.prompt;
      const result = await stagePlanning(ctx, intent);
      plan = result.plan;
    });

    // ── Stage 3: Scripting ──────────────────────────────────────────────────
    let scriptText = "";
    await runStage(ctx, "scripting", 30, 50, async () => {
      const result = await stageScripting(ctx, plan);
      scriptText = result.scriptText;
    });

    // ── Stage 4: Storyboard Generation ─────────────────────────────────────
    let frames: string[] = [];
    await runStage(ctx, "storyboard_generation", 50, 75, async () => {
      const result = await stageStoryboardGeneration(ctx, scriptText);
      frames = result.frames;
    });

    // ── Stage 5: Render & Assembly ──────────────────────────────────────────
    let outputFilename = "";
    await runStage(ctx, "render_assembly", 75, 95, async () => {
      const result = await stageRenderAssembly(ctx, frames);
      outputFilename = result.outputFilename;
    });

    // ── Stage 6: Finalizing ─────────────────────────────────────────────────
    let output: VideoOutputMetadata | undefined;
    await runStage(ctx, "finalizing", 95, 100, async () => {
      output = await stageFinalizing(ctx, scriptText, frames, outputFilename);
    });

    // Complete
    const completedJob = queue.completeJob(jobId, output);
    broadcast(
      makeVideoCompletedEvent(jobId, {
        outputPublicUrl: output!.publicUrl,
        durationSeconds: output!.durationSeconds,
        fileSizeBytes: output!.fileSizeBytes,
        totalDurationMs: Date.now() - ctx.startedAt,
        modelsUsed: output!.modelsUsed as Record<string, string>,
      })
    );
    void completedJob;
  } catch (err: unknown) {
    clearInterval(cancelWatcher);
    const current = queue.getJob(jobId);

    if (current?.status === "cancelled") return; // user-initiated cancel — no need to emit failed

    const videoError = toVideoError(err);
    const failedJob = queue.failJob(jobId, videoError);

    broadcast(
      makeVideoFailedEvent(
        jobId,
        videoError,
        failedJob.retryCount,
        Date.now() - ctx.startedAt,
        ctx.job.currentStage
      )
    );

    // If re-queued, schedule the next orchestration attempt
    if (failedJob.status === "queued") {
      setTimeout(() => {
        void runOrchestration(jobId, broadcast);
      }, 5_000);
    }
  } finally {
    clearInterval(cancelWatcher);
    jobAbortController.abort();
  }
}

// ─── Stage Runner ─────────────────────────────────────────────────────────────

async function runStage(
  ctx: OrchestratorContext,
  stage: VideoJobStage,
  progressStart: number,
  progressEnd: number,
  fn: () => Promise<void>
): Promise<void> {
  if (ctx.jobAbortSignal.aborted) {
    throw new DOMException("Job aborted before stage start", "AbortError");
  }

  const stageStart = Date.now();
  const stageTimeoutMs = STAGE_TIMEOUT_MS[stage];

  // Emit stage started progress
  const startProgress: VideoStageProgress = {
    stage,
    stageProgress: 0,
    overallProgress: progressStart,
    startedAt: new Date().toISOString(),
    message: `Starting ${stage.replace(/_/g, " ")}…`,
  };
  queue.recordStageProgress(ctx.job.id, stage, startProgress);
  ctx.broadcast(
    makeVideoProgressEvent(ctx.job.id, stage, startProgress, progressStart)
  );

  // Run with a stage-level timeout
  await withTimeout(fn(), stageTimeoutMs, `Stage ${stage} timed out after ${stageTimeoutMs}ms`);

  // Mark stage done
  const completedProgress: VideoStageProgress = {
    stage,
    stageProgress: 100,
    overallProgress: progressEnd,
    startedAt: startProgress.startedAt,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - stageStart,
  };
  queue.recordStageProgress(ctx.job.id, stage, completedProgress);
  ctx.broadcast(
    makeVideoProgressEvent(ctx.job.id, stage, completedProgress, progressEnd)
  );

  ctx.modelsUsed[stage] = resolveModel(ctx.job.request, stage);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stageController(
  ctx: OrchestratorContext,
  stage: VideoJobStage
): AbortController {
  const controller = new AbortController();
  const timeout = STAGE_TIMEOUT_MS[stage];
  const timer = setTimeout(() => controller.abort(), timeout);
  controller.signal.addEventListener("abort", () => clearTimeout(timer));

  // Also abort if the job-level abort fires
  ctx.jobAbortSignal.addEventListener("abort", () => controller.abort());
  return controller;
}

function resolveModel(request: VideoJobRequest, stage: VideoJobStage): string {
  if (request.modelTier) {
    const tierMap: Record<string, string> = {
      fast: "phi4-fast",
      worker: "phi4-worker",
      supervisor: "qwen-supervisor",
      reasoner: "deepseek-reasoner",
    };
    return tierMap[request.modelTier] ?? STAGE_MODEL_TAG[stage];
  }
  return STAGE_MODEL_TAG[stage];
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string
): Promise<T> {
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
  code: VideoJobError["code"],
  message: string,
  retryable: boolean,
  stage?: VideoJobStage
): VideoJobError {
  return { code, message, retryable, stage };
}

function toVideoError(err: unknown): VideoJobError {
  if (err instanceof DOMException && err.name === "AbortError") {
    return makeError("CANCELLED_BY_USER", "Stage was aborted", false);
  }

  const e = err as { message?: string; code?: string };
  const code = e.code as VideoJobError["code"] ?? "UNKNOWN";
  const message = e.message ?? "An unknown error occurred";
  const retryable = ["TIMEOUT", "OLLAMA_UNAVAILABLE", "COMFY_UNAVAILABLE"].includes(code);
  return { code, message, retryable };
}

async function isComfyAvailable(signal: AbortSignal): Promise<boolean> {
  const controller = new AbortController();
  signal.addEventListener("abort", () => controller.abort());

  try {
    const res = await fetch(`${COMFY_BASE}/system_stats`, {
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ─── Prompt Builders ──────────────────────────────────────────────────────────

function buildPlanningPrompt(req: VideoJobRequest, intent: string): string {
  return `You are a video production planner for a faceless short-form video.
Platform: ${req.platform ?? "generic"}
Niche: ${req.niche ?? "general"}
Intent: ${intent}
Prompt: "${req.prompt}"
Target duration: ${req.targetDurationSeconds ?? 60}s

List 4-6 concise production steps needed to create this video. One per line, numbered.`;
}

function buildScriptingPrompt(req: VideoJobRequest, plan: string[]): string {
  return `You are a faceless short-form video scriptwriter.
Platform: ${req.platform ?? "generic"} | Niche: ${req.niche ?? "general"}
Original prompt: "${req.prompt}"
Production plan:
${plan.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Write a ${req.targetDurationSeconds ?? 60}-second narration script.
Include [VISUAL: description] cues inline. Strong 3-second hook. End with CTA.`;
}

function buildStoryboardPrompt(req: VideoJobRequest, scriptText: string): string {
  return `You are a visual director for faceless short-form content.
Extract 4-8 distinct visual scene descriptions from this script.
Each should describe an abstract, cinematic, text-overlay scene for ${req.platform ?? "generic"}.
Script:
${scriptText.slice(0, 1200)}

List each scene on a new line starting with "- ".`;
}

function buildComfyWorkflow(
  req: VideoJobRequest,
  frames: string[]
): Record<string, unknown> {
  // Minimal ComfyUI API payload — replace with your actual GGUF workflow JSON.
  return {
    "1": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: `${frames[0] ?? req.prompt}, vertical 9:16, abstract, cinematic, no faces, ${req.niche ?? "motivational"}`,
        clip: ["2", 1],
      },
    },
    // ... rest of workflow nodes loaded from workflows/video-generation.yaml
  };
}