# Video Generation Subsystem

> **SwarmX Video Pipeline** — pressure-aware, faceless video generation orchestrated through
> Ollama local models → storyboard → optional ComfyUI render.

---

## Table of contents

1. [Architecture overview](#architecture-overview)
2. [File map](#file-map)
3. [Environment setup](#environment-setup)
4. [Installation & startup](#installation--startup)
5. [API reference](#api-reference)
   - [POST /api/video/jobs](#post-apivideojobs)
   - [GET /api/video/jobs](#get-apivideojobs)
   - [GET /api/video/jobs/:id](#get-apivideojobsid)
   - [DELETE /api/video/jobs/:id](#delete-apivideojobsid)
   - [POST /api/video/jobs/:id/cancel](#post-apivideojobsidcancel)
   - [POST /api/video/jobs/:id/retry](#post-apivideojobsidretry)
   - [GET /api/video/health](#get-apivideohealth)
6. [SSE event lifecycle](#sse-event-lifecycle)
7. [Job lifecycle & state machine](#job-lifecycle--state-machine)
8. [Degradation modes](#degradation-modes)
9. [Model assignment](#model-assignment)
10. [Dashboard integration](#dashboard-integration)
11. [ComfyUI render setup](#comfyui-render-setup)
12. [Troubleshooting](#troubleshooting)
13. [Known bugs fixed in this release](#known-bugs-fixed-in-this-release)

---

## Architecture overview

```
Browser / API client
        │
        ▼ POST /api/video/jobs
┌───────────────────────┐
│   routes/video.ts     │  Fastify route handlers — validation, queue creation,
│   (Fastify plugin)    │  health probe, cancel/retry
└──────────┬────────────┘
           │ createJob()
           ▼
┌───────────────────────┐      SSE → dashboard
│   video-queue.ts      │ ──── broadcastEvent(video:progress) ────────────────►
│   (in-memory queue)   │
└──────────┬────────────┘
           │ registerVideoProcessor → runVideoJob()
           ▼
┌───────────────────────┐
│ video-orchestrator.ts │  Sequential, pressure-aware pipeline:
│                       │  preflight → planning → scripting → storyboard
│  Model calls          │    → [render dispatch] → assembling → exporting
│  via Ollama REST API  │
└──────────┬────────────┘
           │
    ┌──────┴──────────────────────────────────┐
    │                                          │
    ▼                                          ▼
Ollama (local)                          ComfyUI (optional)
phi4-fast (router)                      LTX-Video / Wan 2.2
deepseek-reasoner (planning)            POST /prompt per shot
qwen-worker (script + storyboard)
    │
    ▼
┌───────────────────────┐
│   video-assets.ts     │  Per-job artifact storage under
│                       │  SWARMX_VIDEO_OUTPUT_DIR/<jobId>/
│                       │    manifest.json
│                       │    render-ready.json  (deferred path)
└───────────────────────┘
```

The pipeline runs **one job at a time** (sequential queue). Under 8 GB RAM, parallel model
loads cause OOM. The queue drains FIFO; the orchestrator respects cancellation at every stage
boundary.

---

## File map

| Path | Role |
|------|------|
| `apps/swarmx-api/src/types/video.ts` | All video domain types — job, intent, script, storyboard, render, API contracts |
| `apps/swarmx-api/src/types/events.ts` | SSE event union — includes `video:progress` and `video:health` variants |
| `apps/swarmx-api/src/services/video-queue.ts` | In-memory job registry, FIFO processor, SSE emission |
| `apps/swarmx-api/src/services/video-orchestrator.ts` | Pressure-aware pipeline execution, Ollama calls, ComfyUI dispatch |
| `apps/swarmx-api/src/services/video-assets.ts` | File-system helpers for artifact storage / cleanup |
| `apps/swarmx-api/src/routes/video.ts` | Fastify route plugin — all `/api/video/*` endpoints |
| `apps/swarmx-api/src/server.ts` | Registers `videoRouter` under `/api/video` |
| `apps/swarmx-dashboard/src/stores/video.ts` | Zustand store — job map, SSE upsert, status helpers |
| `apps/swarmx-dashboard/src/stores/events.ts` | Routes `video:progress` events → video store |
| `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx` | Video workspace page — form + job list |
| `apps/swarmx-dashboard/src/app/(dashboard)/video/loading.tsx` | Suspense skeleton |
| `apps/swarmx-dashboard/src/app/(dashboard)/video/error.tsx` | Error boundary |
| `apps/swarmx-dashboard/src/components/video/VideoJobForm.tsx` | Job creation form |
| `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx` | Job card with progress, stage log, output preview |
| `apps/swarmx-dashboard/src/components/video/VideoJobTimeline.tsx` | Compact and full stage timeline components |
| `apps/swarmx-dashboard/src/components/layout/NavRail.tsx` | Sidebar nav — Video item at `⌘7` |
| `apps/swarmx-dashboard/src/app/(dashboard)/layout.tsx` | Breadcrumb mapping includes `/video` |
| `workflows/video-generation.yaml` | Workflow definition — stages, owners, models |
| `agents/catalog.yaml` | Agent catalog — includes `video-planner` entry |
| `agents/video-planner.md` | Video planner agent persona and stage output specs |

---

## Environment setup

Create or extend your `.env` / `apps/swarmx-api/.env.local`:

```bash
# ── API server ──────────────────────────────────────────────────────────────
SWARMX_API_PORT=3001
SWARMX_API_HOST=127.0.0.1

# ── Video model assignments ──────────────────────────────────────────────────
# These must match Ollama model names (run `ollama list` to verify)
SWARMX_MODEL_ROUTER=phi4-fast          # intent classification (fast, low RAM)
SWARMX_MODEL_REASON=deepseek-reasoner  # narrative planning
SWARMX_MODEL_CODE=qwen-worker          # script + storyboard generation

# ── Render target (optional — jobs degrade gracefully without it) ────────────
SWARMX_COMFYUI_URL=http://127.0.0.1:8188
SWARMX_VIDEO_OUTPUT_DIR=./.swarmx/video-output

# ── CORS ─────────────────────────────────────────────────────────────────────
SWARMX_DASHBOARD_ORIGIN=http://localhost:3000
```

Create or extend your `apps/swarmx-dashboard/.env.local`:

```bash
NEXT_PUBLIC_API_BASE=http://localhost:3001
```

### Ollama model requirements

Pull the required models before starting the API:

```bash
ollama pull phi4-fast           # or your SWARMX_MODEL_ROUTER value
ollama pull deepseek-r1:7b      # maps to deepseek-reasoner
ollama pull qwen2.5-coder:7b    # maps to qwen-worker
```

Verify they are available:

```bash
ollama list
```

---

## Installation & startup

From the monorepo root:

```bash
# 1. Install all workspace dependencies
pnpm install

# 2. (Optional) Ensure video output dir exists
mkdir -p .swarmx/video-output

# 3. Start the API
pnpm --filter @swarmx/api dev

# 4. Start the dashboard (separate terminal)
pnpm --filter @swarmx/dashboard dev
```

Verify the video subsystem is alive:

```bash
curl http://localhost:3001/api/video/health
```

Expected (Ollama running, no ComfyUI):

```json
{
  "ollama": { "reachable": true, "models": ["phi4-fast", "deepseek-reasoner", "qwen-worker"] },
  "comfyui": { "reachable": false, "baseUrl": "http://127.0.0.1:8188" },
  "pressure": "normal",
  "renderCapable": false,
  "timestamp": "2026-05-21T10:00:00.000Z"
}
```

`renderCapable: false` means jobs will complete in `render_deferred` mode — script and
storyboard are produced, but no video clips are generated until ComfyUI is started.

---

## API reference

All endpoints are under the `/api/video` prefix registered in `server.ts`.

---

### POST /api/video/jobs

Create a new video generation job and enqueue it.

**Request body:**

```json
{
  "prompt": "string (required, 1–2000 chars)",
  "style": "motivational | educational | narrative | documentary | explainer | abstract | custom",
  "aspect": "9:16 | 16:9 | 1:1",
  "length": "short | medium | long",
  "targetPlatform": "tiktok | youtube_shorts | reels | generic"
}
```

**Minimal request:**

```bash
curl -X POST http://localhost:3001/api/video/jobs \
  -H "Content-Type: application/json" \
  -d '{"prompt": "A 30-second motivational video about starting your first business"}'
```

**Full request:**

```bash
curl -X POST http://localhost:3001/api/video/jobs \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Explain compound interest in a way that makes a 25-year-old want to invest today",
    "style": "educational",
    "aspect": "9:16",
    "length": "short",
    "targetPlatform": "tiktok"
  }'
```

**Response `201`:**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "correlationId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "status": "queued",
  "message": "Job queued",
  "degradeWarning": "System memory is elevated. Video render may be deferred."
}
```

`degradeWarning` is only present when system pressure is `high` or `critical` at creation
time. It is informational — the job is still created and queued.

**Error `400`:**

```json
{ "error": "style must be one of: motivational, educational, narrative, documentary, explainer, abstract, custom" }
```

---

### GET /api/video/jobs

List video jobs, most-recent first.

**Query params:**

| Param | Type | Default | Max |
|-------|------|---------|-----|
| `limit` | integer | `50` | `200` |

```bash
curl "http://localhost:3001/api/video/jobs?limit=10"
```

**Response `200`:**

```json
{
  "jobs": [
    {
      "jobId": "550e8400-e29b-41d4-a716-446655440000",
      "correlationId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "status": "scripting",
      "degradeMode": "none",
      "progress": 35,
      "prompt": "A 30-second motivational video about starting your first business",
      "createdAt": "2026-05-21T09:55:00.000Z",
      "updatedAt": "2026-05-21T09:55:42.000Z",
      "hasScript": false,
      "hasStoryboard": false,
      "hasRender": false
    }
  ],
  "count": 1
}
```

---

### GET /api/video/jobs/:id

Full job detail including intent, script, storyboard, render manifest, stage log, and warnings.

```bash
curl http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000
```

**Response `200` (completed, render deferred):**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "correlationId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  "status": "completed",
  "degradeMode": "render_deferred",
  "progress": 100,
  "createdAt": "2026-05-21T09:55:00.000Z",
  "updatedAt": "2026-05-21T10:02:15.000Z",
  "completedAt": "2026-05-21T10:02:15.000Z",
  "prompt": "A 30-second motivational video about starting your first business",
  "intent": {
    "topic": "Starting your first business",
    "style": "motivational",
    "aspect": "9:16",
    "length": "short",
    "targetPlatform": "tiktok",
    "tone": "bold and encouraging",
    "keyPoints": ["start before you're ready", "first customer validates the idea", "execution beats perfection"],
    "rawPrompt": "A 30-second motivational video about starting your first business"
  },
  "script": {
    "title": "Start Before You're Ready",
    "hook": "The only business that fails for sure is the one you never start.",
    "body": "Every founder you admire started with nothing but an idea and a decision...",
    "cta": "Comment your business idea below. Right now. Go.",
    "estimatedDurationSec": 38,
    "wordCount": 112,
    "narrationText": "The only business that fails for sure is the one you never start. Every founder..."
  },
  "storyboard": {
    "shots": [
      {
        "index": 0,
        "durationSec": 4,
        "visualDescription": "Dark screen, single white text word appearing letter by letter",
        "narrationSegment": "The only business that fails for sure is the one you never start.",
        "cameraMotion": "static",
        "colorMood": "dark charcoal with sharp white",
        "textOverlay": "NEVER STARTED. NEVER FAILED.",
        "comfyPrompt": "minimal dark background, single bold white text appearing, cinematic slow reveal, high contrast, 4K"
      }
    ],
    "totalDurationSec": 38,
    "style": "motivational",
    "aspect": "9:16",
    "resolution": "720p",
    "renderNotes": "Use LTX-Video with --lowvram. Text-on-black shots are fast; shot 3 dissolve may need 2 passes."
  },
  "render": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "outputDir": "/home/user/.swarmx/video-output/550e8400-e29b-41d4-a716-446655440000",
    "rendererUsed": "none",
    "clips": [
      { "shotIndex": 0, "status": "queued", "durationSec": 4 }
    ]
  },
  "warnings": ["ComfyUI not reachable — full render deferred. Script and storyboard are ready."],
  "stages": [
    { "stage": "preflight", "startedAt": "2026-05-21T09:55:01.000Z", "completedAt": "2026-05-21T09:55:02.000Z", "durationMs": 980, "success": true },
    { "stage": "planning", "startedAt": "2026-05-21T09:55:02.000Z", "completedAt": "2026-05-21T09:55:14.000Z", "durationMs": 12340, "success": true },
    { "stage": "scripting", "startedAt": "2026-05-21T09:55:14.000Z", "completedAt": "2026-05-21T09:57:30.000Z", "durationMs": 136000, "success": true },
    { "stage": "storyboard", "startedAt": "2026-05-21T09:57:30.000Z", "completedAt": "2026-05-21T10:02:10.000Z", "durationMs": 280000, "success": true }
  ],
  "pressureAtStart": "normal",
  "modelTrace": ["phi4-fast", "qwen-worker"]
}
```

**Response `404`:**

```json
{ "error": "Job 550e8400-e29b-41d4-a716-446655440000 not found" }
```

---

### DELETE /api/video/jobs/:id

Cancel a job. Works on any non-terminal job (queued through exporting). No-op if already
terminal — returns `409`.

```bash
curl -X DELETE http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000
```

**Response `200`:**

```json
{ "jobId": "550e8400-e29b-41d4-a716-446655440000", "status": "cancelled" }
```

**Response `409`:**

```json
{ "error": "Job 550e8400... is already in a terminal state (completed) and cannot be cancelled" }
```

---

### POST /api/video/jobs/:id/cancel

Alias for `DELETE /:id`. Provided because the implementation plan specified a POST cancel
route. Both methods are valid; prefer `DELETE` for REST semantics.

---

### POST /api/video/jobs/:id/retry

Clone a failed, degraded, or cancelled job into a new job with the same prompt and options,
then enqueue it. The original job is not modified.

```bash
curl -X POST http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000/retry
```

**Response `201`:**

```json
{
  "jobId": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "correlationId": "de305d54-75b4-431b-adb2-eb6b9e546014",
  "status": "queued",
  "retriedFrom": "550e8400-e29b-41d4-a716-446655440000",
  "message": "Retry job queued"
}
```

**Response `409`:**

```json
{ "error": "Job 550e8400... cannot be retried (current status: scripting). Only failed, degraded, or cancelled jobs can be retried." }
```

---

### GET /api/video/health

Check subsystem health — Ollama reachability, available models, ComfyUI status, and current
memory pressure. Polled by the dashboard every 30 seconds.

```bash
curl http://localhost:3001/api/video/health
```

**Response `200` (fully capable):**

```json
{
  "ollama": { "reachable": true, "models": ["phi4-fast", "deepseek-reasoner", "qwen-worker"] },
  "comfyui": { "reachable": true, "baseUrl": "http://127.0.0.1:8188" },
  "pressure": "normal",
  "renderCapable": true,
  "timestamp": "2026-05-21T10:00:00.000Z"
}
```

`renderCapable` is `true` only when all three conditions hold: `ollama.reachable`, `comfyui.reachable`, and `pressure !== "critical"`.

---

## SSE event lifecycle

All video events are emitted on the existing `/api/events` SSE stream. No new SSE endpoint
is needed — the dashboard subscribes once and the events store routes `video:progress` events
to the `useVideoStore`.

### Event: `video:progress`

Emitted at every job state transition (queued → preflight → planning → etc.) and on every
`updateJob()` call.

```json
{
  "type": "video:progress",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "correlationId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
    "status": "scripting",
    "degradeMode": "none",
    "progress": 35,
    "timestamp": "2026-05-21T09:55:42.000Z"
  }
}
```

### Event: `video:health`

Reserved for future use — emitted by health probe results broadcast via SSE. Currently the
dashboard polls the HTTP health endpoint directly. The SSE variant exists in the type union
and can be wired once broadcast-on-change behaviour is added to the health probe.

### Full event sequence for a successful job

```
video:progress  status=queued     progress=0
video:progress  status=preflight  progress=5
video:progress  status=planning   progress=15
video:progress  status=scripting  progress=35
video:progress  status=storyboard progress=55
video:progress  status=rendering  progress=65
video:progress  status=assembling progress=85
video:progress  status=exporting  progress=95
video:progress  status=completed  progress=100
```

### Event sequence for render-deferred completion

```
video:progress  status=queued     progress=0
video:progress  status=preflight  progress=5
video:progress  status=planning   progress=15
video:progress  status=scripting  progress=35
video:progress  status=storyboard progress=55
video:progress  status=completed  progress=100  degradeMode=render_deferred
```

### Event sequence for critical-pressure degradation

```
video:progress  status=queued     progress=0
video:progress  status=preflight  progress=5
video:progress  status=planning   progress=15
video:progress  status=scripting  progress=35
video:progress  status=degraded   progress=55   degradeMode=script_only
```

---

## Job lifecycle & state machine

```
                        ┌──────────┐
                        │  queued  │
                        └────┬─────┘
                             │
                        ┌────▼─────┐
                        │ preflight│  Ollama health probe + pressure check
                        └────┬─────┘
                             │  Ollama unreachable
                             ├──────────────────────────► degraded (intent_only)
                             │
                        ┌────▼─────┐
                        │ planning │  phi4-fast → intent, deepseek-reasoner → plan
                        └────┬─────┘
                             │  planning error
                             ├──────────────────────────► failed
                             │  critical pressure
                             │
                        ┌────▼─────┐
                        │scripting │  qwen-worker → VideoScript
                        └────┬─────┘
                             │  scripting error
                             ├──────────────────────────► degraded (intent_only)
                             │  critical pressure
                             ├──────────────────────────► degraded (script_only)
                             │
                        ┌────▼─────┐
                        │storyboard│  qwen-worker → VideoStoryboard
                        └────┬─────┘
                             │  storyboard error / high pressure
                             ├──────────────────────────► degraded (script_only)
                             │  ComfyUI absent / high pressure
                             ├──────────────────────────► completed (render_deferred)
                             │
                        ┌────▼─────┐
                        │rendering │  ComfyUI /prompt per shot
                        └────┬─────┘
                             │  render dispatch error
                             ├──────────────────────────► degraded (storyboard_only)
                             │
                        ┌────▼──────┐
                        │assembling │  clip composition
                        └────┬──────┘
                             │
                        ┌────▼──────┐
                        │ exporting │  manifest.json written
                        └────┬──────┘
                             │
                        ┌────▼──────┐
                        │ completed │
                        └───────────┘

  At any stage: job.status === "cancelled" → processor stops immediately
```

Terminal states: `completed`, `failed`, `cancelled`, `degraded`

---

## Degradation modes

| `degradeMode` | Meaning | Artifacts available |
|---------------|---------|---------------------|
| `none` | Full pipeline ran | intent, plan, script, storyboard, render clips |
| `intent_only` | Models offline or planning failed | intent (offline inference only) |
| `script_only` | Critical pressure or storyboard failed | intent, plan, script |
| `storyboard_only` | Render dispatch failed | intent, plan, script, storyboard |
| `render_deferred` | ComfyUI absent or high pressure | intent, plan, script, storyboard + `render-ready.json` |

`render-ready.json` is written to `SWARMX_VIDEO_OUTPUT_DIR/<jobId>/render-ready.json` whenever
a job completes in `render_deferred` mode. It contains all ComfyUI-ready shot prompts so the
operator can render manually:

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "shots": [
    {
      "shot": 0,
      "durationSec": 4,
      "prompt": "minimal dark background, single bold white text appearing, cinematic slow reveal",
      "narration": "The only business that fails for sure is the one you never start."
    }
  ],
  "notes": "Use LTX-Video with --lowvram. Shot 3 dissolve may need 2 passes."
}
```

---

## Model assignment

| Stage | Model env var | Default | Typical latency (8 GB) |
|-------|--------------|---------|------------------------|
| Intent classification | `SWARMX_MODEL_ROUTER` | `phi4-fast` | 3–8 s |
| Planning | `SWARMX_MODEL_REASON` | `deepseek-reasoner` | 45–90 s |
| Scripting | `SWARMX_MODEL_CODE` | `qwen-worker` | 60–120 s |
| Storyboard | `SWARMX_MODEL_CODE` | `qwen-worker` | 120–300 s |
| Render dispatch | — (HTTP) | — | 2–5 s per shot |

Context windows are scaled down under pressure (`adaptive-timeout-config.ts`):

| Pressure | num_ctx scale | num_predict scale |
|----------|--------------|-------------------|
| `normal` | 100% | 100% |
| `high` | 75% | 65% |
| `critical` | 50% | 50% |

---

## Dashboard integration

The dashboard `/video` page is accessible at `http://localhost:3000/video` and is reachable
via the NavRail at keyboard shortcut `⌘7`.

**Live update flow:**

1. `useSwarmXEvents` (mounted by `DashboardShell`) opens the SSE connection to `/api/events`.
2. Each incoming event is passed to `handleEvent()` in `useEventsStore`.
3. `video:progress` events are routed via `applyVideoProgress()` which calls
   `useVideoStore.getState().applyProgressEvent()` — a static Zustand accessor, safe outside React.
4. The video page subscribes to `useVideoStore` and re-renders on every upsert.
5. React Query polls `GET /api/video/jobs` every 8 seconds as a fallback for clients that
   briefly disconnect from SSE.

**Store state shape (`useVideoStore`):**

```ts
{
  jobs: Map<string, VideoJobSummary>;   // keyed by jobId
  selectedJobId: string | null;         // drives detail panel
  loading: boolean;
  error: string | null;
}
```

---

## ComfyUI render setup

To enable live rendering, start ComfyUI with low-VRAM flags:

```bash
python main.py --lowvram --force-fp16 --listen 127.0.0.1 --port 8188
```

Required model: `ltx-video-2b-v0.9.1_fp8_e4m3fn.safetensors` in ComfyUI's models directory.

The orchestrator dispatches one `/prompt` request per storyboard shot. Each shot uses the
`LTXVSampler` workflow with the shot's `comfyPrompt` as input. Clips are saved as MP4 with
the prefix `swarmx_video_<jobId>_shot<n>`.

If ComfyUI is not running, jobs complete in `render_deferred` mode — full content is produced
and operator can run the saved `render-ready.json` against ComfyUI manually later.

---

## Troubleshooting

### `/api/video/jobs` returns `404`

**Cause:** `videoRouter` not registered in `server.ts`.

**Fix:** Confirm `server.ts` contains:
```ts
import { videoRouter } from "./routes/video.js";
// ...
await server.register(videoRouter, { prefix: "/api/video" });
```

This was a known bug fixed in `[VIDEO-SERVER-01]`. If you copied an older `server.ts`, apply
the fix above.

---

### Jobs always show `status: failed` with `No video processor registered`

**Cause:** `registerVideoProcessor(runVideoJob)` is not being called before the first job is
created. This call lives at the top of `routes/video.ts` (triggered on first import).

**Fix:** Ensure `routes/video.ts` is the version from this bundle. The old erroneous version
contained React component code (a copy-paste mistake) and never called `registerVideoProcessor`.

---

### Pressure warning never shows in the job form

**Cause:** `VideoJobForm.tsx` referenced `s.governorSnapshot` but the events store exports the
field as `governorState`.

**Fix:** Use `VideoJobForm.tsx` from this bundle, which corrects the selector to
`s.governorState?.pressureLevel`. This was `[VIDEO-FORM-01]`.

---

### Job created but SSE events don't arrive in the dashboard

**Checklist:**
1. Confirm `broadcastEvent` in `video-queue.ts` is not throwing. The catch block silently
   swallows errors to avoid crashing the queue — check API logs for repeated SSE exceptions.
2. Confirm `useSwarmXEvents` is mounted. It lives in `DashboardShell` in `layout.tsx`. If you
   have a custom layout that skips `DashboardShell`, SSE will not be subscribed.
3. Confirm `NEXT_PUBLIC_API_BASE` points to the correct API host:port.
4. Open browser DevTools → Network → filter by `EventSource` — the `/api/events` stream should
   show `connected` as the first event.

---

### Ollama connection refused

**Checklist:**
1. Is Ollama running? `ollama serve` or check `systemctl status ollama`.
2. Is it listening on the expected interface? By default Ollama binds `127.0.0.1:11434`.
3. Verify: `curl http://localhost:11434/api/tags`
4. The `SWARMX_OLLAMA_URL` env var (if set) must match the Ollama bind address.

---

### Script generation returns `Script generation returned incomplete data`

**Cause:** The model returned partial or malformed JSON. This happens when:
- `num_predict` is too low to complete the JSON object (common under `critical` pressure)
- The model is being swapped mid-generation (OOM kill)

**Fix:** Under high pressure, reduce job `length` to `short`. The orchestrator automatically
scales context and prediction ceilings via `adaptive-timeout-config.ts` — at `critical`
pressure these are halved. If the host has less than 4 GB available, script generation may
not reliably complete for `medium` or `long` jobs.

---

### ComfyUI `POST /prompt` returns `500`

**Checklist:**
1. Confirm the LTX-Video model is present: check ComfyUI's `models/checkpoints/` or
   `models/diffusion_models/` directory for `ltx-video-2b-v0.9.1_fp8_e4m3fn.safetensors`.
2. Start ComfyUI with `--lowvram --force-fp16` to stay within 8 GB.
3. The ComfyUI workflow in `dispatchRender()` uses `LTXVLoader` and `LTXVSampler`. If your
   ComfyUI version does not have these nodes, install the `ComfyUI-VideoHelperSuite` and
   `ComfyUI-LTXVideo` custom nodes.

---

## Known bugs fixed in this release

| ID | File | Description |
|----|------|-------------|
| `VIDEO-ROUTE-01` | `routes/video.ts` | File contained the `VideoPageLoading` React component instead of Fastify route definitions. All `/api/video/*` endpoints returned `404`. Replaced with correct Fastify plugin. |
| `VIDEO-SERVER-01` | `server.ts` | `videoRouter` was never imported or registered. All `/api/video/*` routes were unreachable. Import and `server.register(videoRouter, ...)` call added. |
| `VIDEO-FORM-01` | `VideoJobForm.tsx` | `s.governorSnapshot` referenced a non-existent key; the correct field is `s.governorState`. The pressure warning was never shown. Fixed selector. |
| `VIDEO-FIX-01` | `types/events.ts` | `VideoJobEventData` and `VideoHealthEventData` were defined but not included in the `SwarmXEvent` discriminated union, causing TypeScript build failures. Fixed in the current bundle (already present). |
| `VIDEO-FIX-03` | `stores/events.ts` | `video:progress` events were not routed to the video store from the events reducer. Fixed in the current bundle (already present). |
