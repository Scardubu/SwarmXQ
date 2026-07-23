---
name: swarmxq-video-pipeline-architect
description: >
  Designs, audits, and implements the SwarmXQ 6-stage AI video generation pipeline:
  intent_classification → planning → scripting → storyboard_generation → render_assembly → finalizing.
  Covers stage contracts, AbortController lifecycle, modelsUsed recording, dual-timeout coordination,
  sanitizeReasoningOutput enforcement, BullMQ job persistence, render backend selection (FFmpeg vs
  ComfyUI), virality scoring, and caption generation. Use this skill for ANY change to
  video-orchestrator.ts, video-queue.ts, ffmpeg-video-renderer.ts, comfyui-client.ts,
  virality-scorer.ts, or caption-generator.ts. Triggers: "video stage", "video job",
  "pipeline stage", "storyboard", "scripting", "intent classification", "render assembly",
  "finalizing", "virality score", "hookStrength", "caption draft", "FFmpeg render",
  "ComfyUI workflow", "LTX-Video", "stage progress", "overallProgress", "stageViralityAndCaption",
  "video:progress", "video:completed", "video:failed", "SINGLE-VIDEO LOCK", "video queue",
  "clientRequestId", "render backend", "HOOK_BLOCKLIST", "faceless_broll", "kinetic_text".
  Always load swarmxq-model-orchestrator alongside this skill — model acquisition is
  inseparable from pipeline execution. For creative quality (script rules, virality rubric,
  caption generation, tone system), also load swarmxq-creative-director.
---

# SwarmXQ Video Pipeline Architect

Design and validate the 6-stage AI video generation pipeline. Every stage has an immutable
contract. Every Ollama response is sanitized. Every timeout is coordinated. Every model
acquisition is tracked. Violations of any invariant are Critical issues — fix them before
anything else in the session.

**Companion skills**: Always load `swarmxq-model-orchestrator` for model acquisition and
RAM pressure logic. Load `swarmxq-creative-director` for script quality gates, tone rules,
virality rubric, and caption contracts.

---

## Pipeline Architecture (Canonical — Immutable)

```
intent_classification → planning → scripting → storyboard_generation → render_assembly → finalizing
       [0–15%]            [15–30%]   [30–50%]         [50–75%]              [75–95%]         [95–100%]
```

Post-pipeline (non-blocking): `stageViralityAndCaption()` — runs after `finalizing`, appends
`viralitySignal` and `captionDraft` to the job record.

**This order is immutable. Never resequence. Never skip. Never merge stages.**

---

## Stage Contracts

| Stage | Model tier | Max tokens | Key output | Error code on failure |
|---|---|---|---|---|
| `intent_classification` | Pilot (`instruct-phi4-pro-q8-prod`) | 192 | `{intent: string, complexity: 0–1}` JSON | `INTENT_VALIDATION_FAILED` |
| `planning` | Architect (`plan-qwen25-pro-q5km-prod`) | 512 | 5 numbered production beats | graceful fallback to 3-item default |
| `scripting` | Architect (`plan-qwen25-pro-q5km-prod`) | 1024 | `[HOOK][BODY][RESOLUTION][CTA]` sections | `SCRIPTING_FAILED` |
| `storyboard_generation` | Architect (`plan-qwen25-pro-q5km-prod`) | 768 | 5–7 scene lines (bullet or numbered) | `STORYBOARD_FAILED` |
| `render_assembly` | System (no model) | — | `outputFilename` (MP4 or WebM) | `RENDER_FAILED`, `FFMPEG_UNAVAILABLE`, `COMFY_UNAVAILABLE` |
| `finalizing` | System (no model) | — | `VideoOutputMetadata` with checksum | `ARTIFACT_MISSING` / `ARTIFACT_EMPTY` |

---

## Core Invariants (Never Violate)

### Invariant 1 — modelsUsed Recording

`ctx.modelsUsed[stage]` must be set **inside the stage function**, immediately after
`acquireModel()` resolves. `runStage()` must never re-derive it.

```typescript
// ✅ CORRECT — inside intent classification stage fn
async function runIntentClassification(ctx: PipelineContext): Promise<IntentResult> {
  const modelTag = await ModelOrchestrator.acquireModel('Pilot', ctx.signal)
  ctx.modelsUsed['intent_classification'] = modelTag   // ← set here, immediately
  const raw = await ollamaGenerate(modelTag, buildIntentPrompt(ctx.request))
  const sanitized = sanitizeReasoningOutput(raw)       // ← always sanitize
  return parseIntentJson(sanitized)
}

// ✗ WRONG — deriving in runStage
async function runStage(stage: VideoStage, ctx: PipelineContext) {
  const result = await stageHandlers[stage](ctx)
  ctx.modelsUsed[stage] = resolveCurrentModel()  // ← NEVER do this
}
```

### Invariant 2 — AbortController Lifecycle

Every stage gets its own `AbortController` via `stageController()`. All listeners
must use `{ once: true }` to prevent accumulation.

```typescript
// ✅ CORRECT — once listener, no leak
function stageController(parentSignal: AbortSignal): AbortController {
  const ctrl = new AbortController()
  parentSignal.addEventListener('abort', () => ctrl.abort(), { once: true })  // ← once
  return ctrl
}

// ✗ WRONG — listener accumulates across stage retries
parentSignal.addEventListener('abort', () => ctrl.abort())  // no { once: true }
```

### Invariant 3 — Reasoning Sanitization

Every Ollama response passes through `sanitizeReasoningOutput()` before any parsing.
DeepSeek `<think>` blocks must never reach intent JSON, script text, or storyboard frames.

```typescript
// ✅ CORRECT — always sanitize before parsing
const raw = await ollamaGenerate(modelTag, prompt, { signal })
const clean = sanitizeReasoningOutput(raw)      // ← strip <think> blocks
const parsed = parseStoryboardJson(clean)

// ✗ WRONG — parsing raw output
const parsed = parseStoryboardJson(raw)         // DeepSeek think blocks corrupt JSON
```

### Invariant 4 — Dual-Timeout Coordination

`COMFY_POLL_MAX_ATTEMPTS` must always be derived from the stage timeout — never an
independent literal.

```typescript
// ✅ CORRECT — derived, not hardcoded
const COMFY_POLL_MAX_ATTEMPTS = Math.floor(
  STAGE_TIMEOUT_MS['render_assembly'] / COMFY_POLL_INTERVAL_MS
)

// ✗ WRONG — independent literal breaks when STAGE_TIMEOUT_MS changes
const COMFY_POLL_MAX_ATTEMPTS = 120
```

### Invariant 5 — FFmpeg Model Eviction

FFmpeg render must evict all Ollama models before starting. Concurrent FFmpeg
transcoding and LLM inference share the same CPU core pool and both degrade.
The Pilot's 5m keep-alive does **not** exempt it from FFmpeg eviction.

```typescript
// ✅ CORRECT — evict before render (including Pilot)
async function runRenderAssembly(ctx: PipelineContext): Promise<RenderResult> {
  for (const modelTag of await ModelOrchestrator.loadedModels()) {
    await ModelOrchestrator.unloadModel(modelTag)
  }
  return renderWithFfmpeg(ctx.storyboard, ctx.script, ctx.outputDir)
}
```

### Invariant 6 — HOOK_BLOCKLIST Enforcement

The `scripting` stage must validate `[HOOK]` output against `HOOK_BLOCKLIST` before
returning. If the hook matches a blocklisted opener:
1. Regenerate once with explicit "do not use preamble" reinforcement
2. If second attempt also matches: log at `warn`, pass through with annotation
3. Never fail `SCRIPTING_FAILED` solely for a blocklisted hook — degraded creative > no content

```typescript
const HOOK_BLOCKLIST = [
  'In today\'s video', 'Welcome to', 'Hi everyone', 'Today we\'re going to',
  'Let\'s talk about', 'In this video', 'My name is', 'Before we start',
  "Don't forget to", 'Make sure to subscribe',
]

function validateHook(hookText: string): { valid: boolean; violation?: string } {
  const trimmed = hookText.trim()
  const violation = HOOK_BLOCKLIST.find(phrase =>
    trimmed.toLowerCase().startsWith(phrase.toLowerCase())
  )
  return violation ? { valid: false, violation } : { valid: true }
}
```

---

## Render Backend Selection

| Condition | Backend | Notes |
|---|---|---|
| `SWARMX_VIDEO_RENDER_BACKEND=comfyui` + ComfyUI reachable + output dir set | ComfyUI (LTX-Video) | Poll ceiling derived from `render_assembly` timeout |
| `SWARMX_VIDEO_RENDER_BACKEND=comfyui` + not reachable | `COMFY_UNAVAILABLE` | No FFmpeg fallback when explicit |
| `SWARMX_VIDEO_RENDER_BACKEND=ffmpeg` | FFmpeg | Always CPU path |
| `SWARMX_VIDEO_RENDER_BACKEND=auto` + ComfyUI reachable + dir configured | ComfyUI first | Falls back to FFmpeg if ComfyUI workflow fails |
| `SWARMX_VIDEO_RENDER_BACKEND=auto` + ComfyUI not available | FFmpeg | Standard CPU-only path |
| `SWARMX_VIDEO_RENDER_BACKEND=<anything else>` | `RENDER_BACKEND_INVALID` | Fail fast |

### ComfyUI Frame Budget (16 GB host)

After model eviction, `availableMb` typically reads > 8 000 MB on 16 GB.

```typescript
function resolveFrameBudget(availableMb: number, sceneCount: number): number {
  if (availableMb > 10_000) {
    return Math.max(32, Math.min(96, sceneCount * 8))  // 16 GB: up to 96 frames
  }
  if (availableMb > 6_000) {
    return Math.max(16, Math.min(48, sceneCount * 4))  // 8 GB: up to 48 frames
  }
  return 16  // minimum viable budget
}

function resolveResolution(availableMb: number): '720p' | '480p' | '360p' {
  if (availableMb > 10_000) return '720p'
  if (availableMb > 6_000) return '480p'
  return '360p'
}
```

### FFmpeg Process Rules

- Use `execFile()`, never `exec()` — prevents shell injection
- Set `timeout` and `maxBuffer` caps on every call
- FFmpeg version probe: use `-version`, not `--version` (FFmpeg 6+ rejects `--version`)
- Font discovery: scan `/usr/share/fonts/truetype/` candidates in order; throw `FONT_UNAVAILABLE` if none found
- Path traversal: `resolveOutputPath()` must validate the resolved path is under `SWARMX_VIDEO_OUTPUT_DIR`

---

## Video Job Queue

### SINGLE-VIDEO LOCK

`MAX_CONCURRENT_JOBS = 1` is a protected constant. CPU inference is serial.

```typescript
// ✅ CORRECT
if (activeJobCount >= MAX_CONCURRENT_JOBS) {
  return { queued: true, jobId, position: queueDepth }
}

// ✗ WRONG — never bypass for "urgent" jobs
if (priority === 'urgent') startJob(request)
```

### Idempotency via clientRequestId

When BullMQ is enabled, `clientRequestId` is the dedup key.

```typescript
// ✅ CORRECT
const existing = await bullQueue.getJob(clientRequestId)
if (existing && !['failed', 'completed'].includes(await existing.getState())) {
  return { jobId: existing.id, deduplicated: true }
}
await bullQueue.add('video-job', payload, { jobId: clientRequestId, removeOnComplete: false })
```

### BullMQ Worker Connection Isolation

Worker and Queue must use separate `ioredis` connections — sharing causes deadlocks.

```typescript
// ✅ CORRECT — separate connections
const queueConnection = new Redis(redisUrl, { maxRetriesPerRequest: null })
const workerConnection = new Redis(redisUrl, { maxRetriesPerRequest: null })

const queue  = new Queue('video-jobs', { connection: queueConnection })
const worker = new Worker('video-jobs', processJob, { connection: workerConnection })
```

### Redis Fallback to In-Memory

```typescript
async function createVideoQueue(): Promise<VideoQueue> {
  try {
    const redis = new Redis(redisUrl)
    await redis.ping()
    log.info({ msg: 'BullMQ enabled — Redis reachable' })
    return new BullMQVideoQueue(redis)
  } catch (err) {
    log.warn({ msg: 'Redis unreachable — falling back to in-memory queue', err })
    return new InMemoryVideoQueue()
  }
}
```

---

## resumeJob() Contract

`resumeJob()` must validate artifact availability **before** re-queueing. A resume from
`storyboard_generation` without a `scripting` artifact will fail late with a confusing
`ARTIFACT_MISSING` — validate early, fail fast.

```typescript
async function resumeJob(jobId: string, fromStage: VideoStage): Promise<void> {
  const job = registry.get(jobId)
  if (!job) throw new VideoError('JOB_NOT_FOUND', `Job ${jobId} not in registry`)

  const ARTIFACT_STAGES: VideoStage[] = ['scripting', 'storyboard_generation', 'render_assembly', 'finalizing']
  const priorArtifacts = ARTIFACT_STAGES.filter(s => stageIndex(s) < stageIndex(fromStage))

  for (const stage of priorArtifacts) {
    if (!job.artifacts?.[stage]) {
      throw new VideoError(
        'RESUME_INVALID_STAGE',
        `Cannot resume from ${fromStage}: artifact for ${stage} missing. Resume from an earlier stage.`
      )
    }
  }

  job.status = 'queued'
  job.resumeFromStage = fromStage
  job.overallProgress = STAGE_PROGRESS_START[fromStage]
  await videoQueue.enqueue(job)
  log.info({ msg: 'Job resumed', jobId, fromStage })
}
```

---

## video-cleanup.ts Contract

Must start on server boot. Failure to start means disk fills with video output files.
The cleanup interval timer **must be `unref()`'d** — must not prevent SIGTERM exit.

```typescript
// server.ts — after server.listen()
startCleanupService({
  intervalMs: env.SWARMX_VIDEO_CLEANUP_INTERVAL_MS,  // default: 6h
  ttlDays:    env.SWARMX_VIDEO_EXPORT_TTL_DAYS,       // default: 7d
  outputDir:  env.SWARMX_VIDEO_OUTPUT_DIR,
  registry:   videoQueue.getRegistry(),
})
log.info({ msg: 'Video cleanup service started', intervalMs: env.SWARMX_VIDEO_CLEANUP_INTERVAL_MS })
```

A cleanup failure must log at `error` but never crash the API process.

---

## Storyboard Validation

Storyboard scene count must be validated before the stage returns `STORYBOARD_COMPLETE`.

```typescript
const SCENE_COUNT_LIMITS: Record<JobLength, { min: number; max: number }> = {
  short:  { min: 5, max: 7 },
  medium: { min: 6, max: 10 },
  long:   { min: 11, max: 18 },
}

function validateStoryboardSceneCount(scenes: StoryboardScene[], length: JobLength): void {
  const limits = SCENE_COUNT_LIMITS[length]
  if (scenes.length < limits.min) {
    throw new VideoError('STORYBOARD_FAILED',
      `Storyboard has only ${scenes.length} scenes for ${length} video (min: ${limits.min})`
    )
  }
  if (scenes.length > limits.max) {
    log.warn({ msg: 'Storyboard over max scenes — truncating', count: scenes.length, max: limits.max })
    scenes.splice(limits.max)   // mutate in-place; log truncation
  }
}
```

---

## SSE / Progress Events Contract

| Event type | UI action |
|---|---|
| `video:progress` | Update progress bar + stage label + message |
| `video:stream` | Stage-specific overlay message |
| `video:completed` | Show output player, virality panel, caption editor |
| `video:failed` | Show error alert with code + hint + retry/resubmit buttons |
| `video:cancelled` | Show cancellation state; enable resubmit |

### Reconnection Contract

The SSE stream is not resumable:
1. `GET /api/video/jobs/:id` — re-fetch full job state (authoritative)
2. Re-render from fetched state
3. Resubscribe to `GET /api/video/jobs/:id/events`

Never resume from a prior offset. Never assume last SSE event is current state.

---

## High-Pressure Handling

```typescript
async function waitForPressureRelief(ctx: PipelineContext): Promise<void> {
  const pressure = await ModelOrchestrator.readPressure()

  if (pressure === 'critical') {
    throw new VideoError('PRESSURE_CRITICAL', 'System RAM critical — cannot start pipeline')
  }

  if (pressure === 'high') {
    const delayMs = Math.min(30_000, Math.max(1_000, HIGH_PRESSURE_DELAY_MS))
    log.warn({ msg: 'High RAM pressure — backing off', delayMs })
    await sleep(delayMs)

    const recheck = await ModelOrchestrator.readPressure()
    if (recheck === 'critical') {
      throw new VideoError('PRESSURE_CRITICAL', 'Pressure escalated to critical after backoff')
    }
    // 'high' or 'normal' after recheck → proceed
  }
}
```

---

## Autonomous Scanning — Video Pipeline Violations

### Critical (fix before committing anything else)
- `console.*` in `src/services/` or `src/routes/` → migrate to `log.*`
- Ollama response parsed without `sanitizeReasoningOutput()` → wrap it
- `ctx.modelsUsed[stage]` set in `runStage()` instead of inside stage fn → move it
- AbortController listener without `{ once: true }` → add the flag
- `COMFY_POLL_MAX_ATTEMPTS` as a hardcoded literal → derive from stage timeout
- FFmpeg render without `ModelOrchestrator.unloadModel()` loop → add eviction
- `[HOOK]` generation prompt missing word-count constraint → add ≤18 word limit
- Missing tone variant in `TONE_RULES` → add before running pipeline

### High Impact (add to next session queue if found)
- `video-cleanup.ts` cleanup interval not started at server boot
- `resumeJob()` not validating `fromStage` against artifact availability
- `stageViralityAndCaption()` result not persisted to BullMQ job data
- `OLLAMA_MAX_LOADED_MODELS` still at 1 (blocks 16 GB dual-resident path)
- ComfyUI `totalFrames` hard-floored at 16 when `availableMb` > 8 000
- `HOOK_BLOCKLIST` not enforced in scripting stage (regeneration on blocklist match)
- Storyboard scene count not validated before stage completion

### Medium Impact (log to memory note)
- Virality `overall` absent from job list API response
- Dashboard `VideoJobCard` missing `viralitySignal.overall` badge
- Caption `soundSuggestion` not validated for URL/artist patterns at generation time
- Missing OTel trace spans around `runOrchestration()` lifecycle
- `faceless_broll` / `kinetic_text` tone variants not in `TONE_BACKGROUNDS` / `TONE_ACCENTS`
