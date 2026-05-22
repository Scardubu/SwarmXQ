/**
 * apps/swarmx-api/src/services/video-orchestrator.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Video Orchestrator — Pipeline execution
 *
 * Stage pipeline (happy path):
 *   preflight → planning → scripting → storyboard → rendering → completed
 *
 * Pressure-aware degradation:
 *   critical pressure  → script_only (skip storyboard + render)
 *   high pressure      → storyboard_only (skip render)
 *   ComfyUI absent     → render_deferred (content preserved, no render)
 *   model unavailable  → intent_only + degraded status
 *
 * Model assignments (respecting sequential loading on 8 GB):
 *   intent_classify   → phi4-fast    (router, fast 3–6s)
 *   planning          → deepseek-reasoner (reasoning, 60–90s)
 *   scripting         → qwen-worker  (execution/generation, 50–80s)
 *   storyboard        → qwen-worker  (same session, no re-load)
 *   render dispatch   → no model     (HTTP call to ComfyUI)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  currentPressureLevel,
  getTimeout,
  withTimeout,
  recordSuccess,
  recordFailure,
  getModelOverrides,
  type PressureLevel,
} from "./adaptive-timeout-config.js";
import {
  getOllamaBaseUrl,
  checkOllamaHealth,
} from "./ollama.js";
import {
  setActiveModel,
  recordLatency,
} from "./swarm-pressure-monitor.js";
import { sanitizeReasoningOutput } from "./reasoning-sanitizer.js";
import {
  getJob,
  updateJob,
  transitionStatus,
  markStageError,
  addWarning,
  addModelTrace,
  cancelJob,
} from "./video-queue.js";
import type {
  VideoJob,
  VideoJobIntent,
  VideoScript,
  VideoStoryboard,
  StoryboardShot,
  RenderManifest,
  RenderClip,
  VideoStyle,
  VideoAspect,
  VideoLength,
} from "../types/video.js";

// ─── Config ───────────────────────────────────────────────────────────────────

const MODELS = {
  router:  process.env["SWARMX_MODEL_ROUTER"]  ?? "phi4-fast",
  reason:  process.env["SWARMX_MODEL_REASON"]  ?? "deepseek-reasoner",
  code:    process.env["SWARMX_MODEL_CODE"]    ?? "qwen-worker",
} as const;

const COMFYUI_BASE = process.env["SWARMX_COMFYUI_URL"] ?? "http://127.0.0.1:8188";
const VIDEO_OUTPUT_DIR = process.env["SWARMX_VIDEO_OUTPUT_DIR"]
  ?? path.resolve(process.cwd(), "../../.swarmx/video-output");

// ─── Main orchestrator entry (registered with video-queue) ────────────────────

export async function runVideoJob(job: VideoJob): Promise<void> {
  const jobId = job.jobId;

  // ── Preflight ──────────────────────────────────────────────────────────────
  transitionStatus(jobId, "preflight", 5, "Checking system state");

  const pressure = currentPressureLevel();
  const ollamaOk = await probeOllama();

  if (!ollamaOk) {
    // Models unreachable — produce intent-only output
    updateJob(jobId, {
      status: "degraded",
      degradeMode: "intent_only",
      progress: 10,
      completedAt: new Date().toISOString(),
      error: "Ollama is not reachable. Script and storyboard require a running model.",
      intent: inferIntentOffline(job.prompt),
    });
    return;
  }

  if (pressure === "critical") {
    addWarning(jobId, "System is under critical memory pressure — skipping storyboard and render.");
  } else if (pressure === "high") {
    addWarning(jobId, "System memory is high — render will be deferred.");
  }

  // ── Planning ───────────────────────────────────────────────────────────────
  transitionStatus(jobId, "planning", 15, "Classifying intent and planning video");

  let intent: VideoJobIntent;
  try {
    intent = await classifyAndPlan(job, pressure);
    updateJob(jobId, { intent });
    addModelTrace(jobId, MODELS.router);
  } catch (err) {
    markStageError(jobId, String(err));
    updateJob(jobId, {
      status: "failed",
      error: `Planning failed: ${err instanceof Error ? err.message : String(err)}`,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  // ── Scripting ──────────────────────────────────────────────────────────────
  transitionStatus(jobId, "scripting", 35, "Generating script");

  let script: VideoScript;
  try {
    script = await generateScript(job, intent, pressure);
    updateJob(jobId, { script });
    addModelTrace(jobId, MODELS.code);
  } catch (err) {
    markStageError(jobId, String(err));
    // Partial result — degraded with intent only
    updateJob(jobId, {
      status: "degraded",
      degradeMode: "intent_only",
      completedAt: new Date().toISOString(),
      error: `Scripting failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return;
  }

  // Bail here if critical pressure
  if (pressure === "critical") {
    updateJob(jobId, {
      status: "degraded",
      degradeMode: "script_only",
      progress: 55,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  // ── Storyboard ─────────────────────────────────────────────────────────────
  transitionStatus(jobId, "storyboard", 55, "Building storyboard");

  let storyboard: VideoStoryboard;
  try {
    storyboard = await generateStoryboard(job, intent, script, pressure);
    updateJob(jobId, { storyboard });
  } catch (err) {
    markStageError(jobId, String(err));
    addWarning(jobId, "Storyboard generation failed — delivering script only.");
    updateJob(jobId, {
      status: "degraded",
      degradeMode: "script_only",
      progress: 55,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  // ── Render dispatch ────────────────────────────────────────────────────────
  const rendererAvailable = await probeComfyUI();

  if (!rendererAvailable || pressure === "high" || pressure === "critical") {
    const reason = !rendererAvailable
      ? "ComfyUI not reachable"
      : "High memory pressure";
    addWarning(jobId, `${reason} — full render deferred. Script and storyboard are ready.`);

    const manifest = await buildDeferredManifest(job, storyboard);
    updateJob(jobId, {
      render: manifest,
      status: "completed",
      degradeMode: "render_deferred",
      progress: 100,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  transitionStatus(jobId, "rendering", 65, "Dispatching render jobs");

  let renderManifest: RenderManifest;
  try {
    renderManifest = await dispatchRender(job, storyboard);
    updateJob(jobId, { render: renderManifest });
  } catch (err) {
    markStageError(jobId, String(err));
    addWarning(jobId, "Render dispatch failed — delivering storyboard only.");
    const manifest = await buildDeferredManifest(job, storyboard);
    updateJob(jobId, {
      render: manifest,
      status: "degraded",
      degradeMode: "storyboard_only",
      progress: 75,
      completedAt: new Date().toISOString(),
    });
    return;
  }

  // ── Assemble + export ──────────────────────────────────────────────────────
  transitionStatus(jobId, "assembling", 85, "Assembling clips");
  transitionStatus(jobId, "exporting", 95, "Exporting manifest");

  await exportManifest(job, renderManifest);

  updateJob(jobId, {
    status: "completed",
    degradeMode: "none",
    progress: 100,
    completedAt: new Date().toISOString(),
  });
}

// ─── Stage: classify intent + plan ────────────────────────────────────────────

async function classifyAndPlan(
  job: VideoJob,
  pressure: PressureLevel,
): Promise<VideoJobIntent> {
  const ollamaBase = await getOllamaBaseUrl();
  const overrides = getModelOverrides(MODELS.router, pressure);
  const timeoutMs = getTimeout("routing", pressure);

  const systemPrompt = `You are a video production planner for SwarmXQ. 
Analyze the user's video request and extract structured intent.
Respond ONLY with valid JSON — no preamble, no markdown, no explanation.
Required JSON shape:
{
  "topic": "string",
  "style": "motivational|educational|narrative|documentary|explainer|abstract|custom",
  "aspect": "9:16|16:9|1:1",
  "length": "short|medium|long",
  "targetPlatform": "tiktok|youtube_shorts|reels|generic",
  "tone": "string",
  "keyPoints": ["string"],
  "rawPrompt": "string"
}`;

  const userMsg = `Video request: "${job.prompt}"
Default aspect: 9:16 (vertical, social media). Default length: short. 
If style is unclear, default to motivational. Extract 3–5 key points.`;

  const startMs = Date.now();
  setActiveModel(MODELS.router);

  try {
    const response = await withTimeout(
      ollamaGenerate(ollamaBase, MODELS.router, systemPrompt, userMsg, overrides),
      timeoutMs,
      "routing",
    );

    recordLatency(Date.now() - startMs);
    recordSuccess(MODELS.router);

    const raw = sanitizeReasoningOutput(response);
    const parsed = safeParseJSON<VideoJobIntent>(raw);

    return {
      topic: parsed?.topic ?? job.prompt.slice(0, 100),
      style: (parsed?.style as VideoStyle) ?? "motivational",
      aspect: (parsed?.aspect as VideoAspect) ?? "9:16",
      length: (parsed?.length as VideoLength) ?? "short",
      targetPlatform: parsed?.targetPlatform ?? "tiktok",
      tone: parsed?.tone ?? "engaging",
      keyPoints: Array.isArray(parsed?.keyPoints) ? parsed.keyPoints.slice(0, 5) : [],
      rawPrompt: job.prompt,
    };
  } catch (err) {
    recordFailure(MODELS.router);
    recordLatency(Date.now() - startMs);
    throw err;
  }
}

// ─── Stage: generate script ───────────────────────────────────────────────────

async function generateScript(
  job: VideoJob,
  intent: VideoJobIntent,
  pressure: PressureLevel,
): Promise<VideoScript> {
  const ollamaBase = await getOllamaBaseUrl();
  const overrides = getModelOverrides(MODELS.code, pressure);
  const timeoutMs = getTimeout("code_generation", pressure);

  const lengthGuide = { short: "15–45 seconds", medium: "45–90 seconds", long: "90–180 seconds" };
  const platformGuide = {
    tiktok: "TikTok (hook-first, trending style)",
    youtube_shorts: "YouTube Shorts (search-friendly, value-first)",
    reels: "Instagram Reels (aesthetic, emotional)",
    generic: "social media",
  };

  const systemPrompt = `You are a professional video scriptwriter for faceless social media content.
Write engaging, high-retention scripts optimized for ${platformGuide[intent.targetPlatform ?? "generic"]}.
Respond ONLY with valid JSON — no preamble, no markdown fences.
Required JSON shape:
{
  "title": "string (catchy title, max 60 chars)",
  "hook": "string (first 3 seconds — the opening hook)",
  "body": "string (main narrative content)",
  "cta": "string (call to action)",
  "estimatedDurationSec": number,
  "wordCount": number,
  "narrationText": "string (full voiceover — everything hook+body+cta joined)"
}`;

  const userMsg = `Topic: ${intent.topic}
Style: ${intent.style} | Tone: ${intent.tone ?? "engaging"} | Target length: ${lengthGuide[intent.length]}
Key points to cover: ${(intent.keyPoints ?? []).join(", ")}
Platform: ${platformGuide[intent.targetPlatform ?? "generic"]}

Write a complete, production-ready script. The hook must grab attention in the first 3 seconds.
The body must deliver real value. The CTA must be specific.`;

  const startMs = Date.now();
  setActiveModel(MODELS.code);

  try {
    const response = await withTimeout(
      ollamaGenerate(ollamaBase, MODELS.code, systemPrompt, userMsg, overrides),
      timeoutMs,
      "code_generation",
    );

    recordLatency(Date.now() - startMs);
    recordSuccess(MODELS.code);

    const raw = sanitizeReasoningOutput(response);
    const parsed = safeParseJSON<VideoScript>(raw);

    if (!parsed?.narrationText) {
      throw new Error("Script generation returned incomplete data");
    }

    return {
      title: parsed.title ?? intent.topic,
      hook: parsed.hook ?? "",
      body: parsed.body ?? "",
      cta: parsed.cta ?? "Follow for more.",
      estimatedDurationSec: parsed.estimatedDurationSec ?? 45,
      wordCount: parsed.wordCount ?? parsed.narrationText.split(/\s+/).length,
      narrationText: parsed.narrationText,
    };
  } catch (err) {
    recordFailure(MODELS.code);
    recordLatency(Date.now() - startMs);
    throw err;
  }
}

// ─── Stage: generate storyboard ───────────────────────────────────────────────

async function generateStoryboard(
  job: VideoJob,
  intent: VideoJobIntent,
  script: VideoScript,
  pressure: PressureLevel,
): Promise<VideoStoryboard> {
  const ollamaBase = await getOllamaBaseUrl();
  const overrides = getModelOverrides(MODELS.code, pressure);
  const timeoutMs = getTimeout("supervisor_planning", pressure);

  const shotCount = intent.length === "short" ? 4 : intent.length === "medium" ? 6 : 8;
  const resolution: "480p" | "720p" = pressure === "normal" || pressure === "low" ? "720p" : "480p";

  const systemPrompt = `You are a video director creating a storyboard for faceless AI-generated video.
Generate exactly ${shotCount} shots. Each shot should be 3–8 seconds.
Respond ONLY with valid JSON — no preamble, no markdown fences.
Required JSON shape:
{
  "shots": [
    {
      "index": 0,
      "durationSec": 5,
      "visualDescription": "string (describe what the viewer sees — abstract, text-based, or illustrative)",
      "narrationSegment": "string (the words spoken during this shot)",
      "cameraMotion": "string (e.g. slow zoom in, static, pan right)",
      "colorMood": "string (e.g. warm golden, dark blue, vibrant)",
      "textOverlay": "string or null",
      "comfyPrompt": "string (ComfyUI text2video prompt for this shot)"
    }
  ],
  "totalDurationSec": number,
  "renderNotes": "string (guidance for the render operator)"
}`;

  const userMsg = `Script title: ${script.title}
Full narration: ${script.narrationText}
Style: ${intent.style} | Aspect: ${intent.aspect} | Platform: ${intent.targetPlatform}
Target: ${shotCount} shots, ${resolution} resolution.

Create a shot-by-shot storyboard. Each comfyPrompt should be a detailed, cinematic text2video prompt
describing abstract, metaphorical, or illustrative visuals suitable for faceless content.
No human faces. Focus on concepts, textures, light, motion, typography overlays.`;

  const startMs = Date.now();

  try {
    const response = await withTimeout(
      ollamaGenerate(ollamaBase, MODELS.code, systemPrompt, userMsg, overrides),
      timeoutMs,
      "supervisor_planning",
    );

    recordLatency(Date.now() - startMs);
    recordSuccess(MODELS.code);

    const raw = sanitizeReasoningOutput(response);
    const parsed = safeParseJSON<{ shots: StoryboardShot[]; totalDurationSec: number; renderNotes: string }>(raw);

    if (!parsed?.shots?.length) {
      throw new Error("Storyboard returned no shots");
    }

    return {
      shots: parsed.shots.slice(0, shotCount),
      totalDurationSec: parsed.totalDurationSec ?? script.estimatedDurationSec,
      style: intent.style,
      aspect: intent.aspect,
      resolution,
      renderNotes: parsed.renderNotes ?? "Use ComfyUI LTX-Video GGUF or Wan 2.2 with tiled VAE.",
    };
  } catch (err) {
    recordFailure(MODELS.code);
    recordLatency(Date.now() - startMs);
    throw err;
  }
}

// ─── Stage: dispatch render ───────────────────────────────────────────────────

async function dispatchRender(job: VideoJob, storyboard: VideoStoryboard): Promise<RenderManifest> {
  const outputDir = path.join(VIDEO_OUTPUT_DIR, job.jobId);
  await mkdir(outputDir, { recursive: true });

  const clips: RenderClip[] = storyboard.shots.map((shot) => ({
    shotIndex: shot.index,
    status: "queued",
    durationSec: shot.durationSec,
  }));

  // Build ComfyUI workflow for each shot and fire off non-blocking requests
  const manifests: RenderClip[] = [];

  for (const shot of storyboard.shots) {
    const clip = clips[shot.index];
    if (!clip) continue;

    try {
      const promptId = await submitComfyUIPrompt(shot, storyboard, job);
      clip.status = "generating";
      clip.promptId = promptId;
    } catch {
      clip.status = "failed";
    }

    manifests.push(clip);
  }

  return {
    jobId: job.jobId,
    outputDir,
    clips,
    rendererUsed: "comfyui",
    renderStartedAt: new Date().toISOString(),
  };
}

async function submitComfyUIPrompt(
  shot: StoryboardShot,
  storyboard: VideoStoryboard,
  job: VideoJob,
): Promise<string> {
  const [width, height] = storyboard.aspect === "9:16"
    ? storyboard.resolution === "720p" ? [832, 1472] : [512, 896]
    : storyboard.resolution === "720p" ? [1280, 720] : [896, 512];

  const workflow = {
    "1": {
      class_type: "LTXVLoader",
      inputs: { model: "ltx-video-2b-v0.9.1_fp8_e4m3fn.safetensors", dtype: "fp8_e4m3fn" },
    },
    "2": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: shot.comfyPrompt ?? shot.visualDescription,
        clip: ["1", 1],
      },
    },
    "3": {
      class_type: "LTXVSampler",
      inputs: {
        model: ["1", 0], positive: ["2", 0],
        width, height,
        num_frames: Math.ceil(shot.durationSec * 24),
        steps: 6, cfg: 3.0, seed: Math.floor(Math.random() * 1e9),
      },
    },
    "4": {
      class_type: "VHSVideoCombine",
      inputs: {
        images: ["3", 0],
        frame_rate: 24,
        loop_count: 0,
        filename_prefix: `swarmx_video_${job.jobId}_shot${shot.index}`,
        format: "video/mp4",
      },
    },
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);

  try {
    const res = await fetch(`${COMFYUI_BASE}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow }),
      signal: controller.signal,
    });

    if (!res.ok) throw new Error(`ComfyUI returned ${res.status}`);
    const data = await res.json() as { prompt_id?: string };
    return data.prompt_id ?? "unknown";
  } finally {
    clearTimeout(timer);
  }
}

// ─── Deferred manifest (no live renderer) ────────────────────────────────────

async function buildDeferredManifest(job: VideoJob, storyboard: VideoStoryboard): Promise<RenderManifest> {
  const outputDir = path.join(VIDEO_OUTPUT_DIR, job.jobId);
  await mkdir(outputDir, { recursive: true });

  // Save a ComfyUI-ready JSON the operator can run manually
  const shotPrompts = storyboard.shots.map((s) => ({
    shot: s.index,
    durationSec: s.durationSec,
    prompt: s.comfyPrompt ?? s.visualDescription,
    narration: s.narrationSegment,
  }));

  await writeFile(
    path.join(outputDir, "render-ready.json"),
    JSON.stringify({ jobId: job.jobId, shots: shotPrompts, notes: storyboard.renderNotes }, null, 2),
    "utf8",
  );

  return {
    jobId: job.jobId,
    outputDir,
    clips: storyboard.shots.map((s) => ({ shotIndex: s.index, status: "queued", durationSec: s.durationSec })),
    rendererUsed: "none",
  };
}

// ─── Export manifest ──────────────────────────────────────────────────────────

async function exportManifest(job: VideoJob, render: RenderManifest): Promise<void> {
  if (!render.outputDir) return;
  await mkdir(render.outputDir, { recursive: true });
  const summary = { jobId: job.jobId, intent: job.intent, script: job.script, storyboard: job.storyboard, render };
  await writeFile(
    path.join(render.outputDir, "manifest.json"),
    JSON.stringify(summary, null, 2),
    "utf8",
  );
}

// ─── Health probes ────────────────────────────────────────────────────────────

async function probeOllama(): Promise<boolean> {
  try {
    const health = await checkOllamaHealth();
    return health.isHealthy;
  } catch {
    return false;
  }
}

async function probeComfyUI(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3_000);
    try {
      const res = await fetch(`${COMFYUI_BASE}/system_stats`, { signal: controller.signal });
      return res.ok;
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return false;
  }
}

// ─── Ollama generate helper ───────────────────────────────────────────────────

async function ollamaGenerate(
  baseUrl: string,
  model: string,
  system: string,
  prompt: string,
  overrides?: Record<string, number | string>,
): Promise<string> {
  const body = {
    model,
    prompt,
    system,
    stream: false,
    options: {
      num_ctx: overrides?.num_ctx ?? 8192,
      num_predict: overrides?.num_predict ?? 2048,
      temperature: overrides?.temperature ?? 0.3,
    },
  };

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Ollama ${model} returned ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json() as { response?: string };
  return data.response ?? "";
}

// ─── Offline intent inference ─────────────────────────────────────────────────

function inferIntentOffline(prompt: string): VideoJobIntent {
  const q = prompt.toLowerCase();
  const style: VideoJobIntent["style"] =
    q.includes("finance") || q.includes("money") ? "educational"
    : q.includes("story") || q.includes("narrative") ? "narrative"
    : q.includes("explain") || q.includes("how to") ? "explainer"
    : "motivational";

  const length: VideoJobIntent["length"] =
    q.includes("long") || q.includes("minute") ? "long"
    : q.includes("medium") ? "medium"
    : "short";

  return {
    topic: prompt.slice(0, 80),
    style,
    aspect: "9:16",
    length,
    targetPlatform: "tiktok",
    tone: "engaging",
    keyPoints: [],
    rawPrompt: prompt,
  };
}

// ─── Safe JSON parse ──────────────────────────────────────────────────────────

function safeParseJSON<T>(raw: string): Partial<T> | null {
  if (!raw) return null;
  // Strip markdown fences if present
  const clean = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();

  // Find the first complete JSON object/array
  const firstBrace = clean.indexOf("{");
  const firstBracket = clean.indexOf("[");
  const start = firstBrace === -1 ? firstBracket
    : firstBracket === -1 ? firstBrace
    : Math.min(firstBrace, firstBracket);

  if (start === -1) return null;

  const lastBrace = clean.lastIndexOf("}");
  const lastBracket = clean.lastIndexOf("]");
  const end = Math.max(lastBrace, lastBracket);
  if (end === -1) return null;

  try {
    return JSON.parse(clean.slice(start, end + 1)) as Partial<T>;
  } catch {
    return null;
  }
}