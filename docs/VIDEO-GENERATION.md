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
6. [SSE event lifecycle](#sse-event-lifecycle)
7. [Job lifecycle & state machine](#job-lifecycle--state-machine)
8. [Degradation behavior](#degradation-behavior)
9. [Model assignment](#model-assignment)
10. [Dashboard integration](#dashboard-integration)
11. [ComfyUI render setup](#comfyui-render-setup)
12. [Troubleshooting](#troubleshooting)
13. [Known bugs fixed in this release](#known-bugs-fixed-in-this-release)

---

## Architecture overview

```text
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
│   video-queue.ts      │ ──── orchestrator emits video lifecycle events ─────►
│   (in-memory queue)   │
└──────────┬────────────┘
           │ queue.startJob() → runOrchestration()
           ▼
┌───────────────────────┐
│ video-orchestrator.ts │  Sequential, pressure-aware pipeline:
│                       │  intent_classification → planning → scripting
│  Model calls          │    → storyboard_generation → render_assembly → finalizing
│  via Ollama REST API  │
└──────────┬────────────┘
           │
    ┌──────┴──────────────────────────────────┐
    │                                          │
    ▼                                          ▼
Ollama (local)                          ComfyUI (optional)
instruct-phi4-pro-q8-prod (fast)        LTX-Video / Wan 2.2
reason-deepseekr1-pro-q5km-prod         POST /prompt per shot
code-qwen25-pro-q5km-prod
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
| --- | --- |
| `apps/swarmx-api/src/types/video.ts` | All video domain types: job, intent, script, storyboard, render, and API contracts. |
| `apps/swarmx-api/src/types/events.ts` | SSE event union, including video lifecycle variants. |
| `apps/swarmx-api/src/services/video-queue.ts` | In-memory job registry, FIFO processor, and SSE emission. |
| `apps/swarmx-api/src/services/video-orchestrator.ts` | Pressure-aware pipeline execution, Ollama calls, and ComfyUI dispatch. |
| `apps/swarmx-api/src/services/video-assets.ts` | File-system helpers for artifact storage and cleanup. |
| `apps/swarmx-api/src/routes/video.ts` | Fastify route plugin for all `/api/video/*` endpoints. |
| `apps/swarmx-api/src/server.ts` | Registers `videoRoutes` under `/api/video`. |
| `apps/swarmx-dashboard/src/stores/video.ts` | Zustand store for job map, SSE upsert, and status helpers. |
| `apps/swarmx-dashboard/src/stores/events.ts` | Routes shared compact video progress events into the video store. |
| `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx` | Main video workspace page with form and queue list. |
| `apps/swarmx-dashboard/src/app/(dashboard)/video/loading.tsx` | Suspense skeleton. |
| `apps/swarmx-dashboard/src/app/(dashboard)/video/error.tsx` | Error boundary. |
| `apps/swarmx-dashboard/src/components/video/VideoJobForm.tsx` | Job creation form. |
| `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx` | Job card with progress, stage log, and output preview. |
| `apps/swarmx-dashboard/src/components/video/VideoJobTimeline.tsx` | Compact and full stage timeline components. |
| `apps/swarmx-dashboard/src/components/layout/NavRail.tsx` | Sidebar nav with the video entry. |
| `apps/swarmx-dashboard/src/app/(dashboard)/layout.tsx` | Breadcrumb mapping including `/video`. |
| `workflows/video-generation.yaml` | Workflow definition with stages, owners, and models. |
| `agents/catalog.yaml` | Agent catalog including `video-planner`. |
| `agents/video-planner.md` | Video planner agent persona and stage output specs. |

---

## Environment setup

Create or extend your `.env` / `apps/swarmx-api/.env.local`:

```bash
# ── API server ──────────────────────────────────────────────────────────────
SWARMX_API_PORT=3001
SWARMX_API_HOST=127.0.0.1

# ── Video model assignments ──────────────────────────────────────────────────
# These must match Ollama model names (run `ollama list` to verify)
SWARMX_MODEL_FAST=instruct-phi4-pro-q8-prod             # default fast model
SWARMX_MODEL_REASON=reason-deepseekr1-pro-q5km-prod     # narrative planning
SWARMX_MODEL_CODE=code-qwen25-pro-q5km-prod             # script + storyboard generation

# ── Render target (optional — jobs degrade gracefully without it) ────────────
SWARMX_COMFYUI_URL=http://127.0.0.1:8188
SWARMX_VIDEO_OUTPUT_DIR=./.swarmx/video-output
SWARMX_VIDEO_API_TOKEN=replace-me-for-write-routes

# ── CORS ─────────────────────────────────────────────────────────────────────
SWARMX_DASHBOARD_ORIGIN=http://localhost:3000
```

Create or extend your `apps/swarmx-dashboard/.env.local`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### Ollama model requirements

Pull the required models before starting the API:

```bash
ollama pull instruct-phi4-pro-q8-prod
ollama pull reason-deepseekr1-pro-q5km-prod
ollama pull code-qwen25-pro-q5km-prod
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

Verify API availability and video routes:

```bash
curl http://localhost:3001/health
curl http://localhost:3001/api/video/jobs
```

Validate package gates before exercising the video UI:

```bash
pnpm --filter @swarmx/types typecheck
pnpm --filter @swarmx/api typecheck
pnpm --filter @swarmx/dashboard typecheck
```

### Write-route auth

The following routes require write auth:

- `POST /api/video/jobs`
- `POST /api/video/jobs/:id/cancel`
- `DELETE /api/video/jobs/:id`
- `POST /api/video/jobs/:id/resume`
- `POST /api/video/jobs/reprioritize`
- `POST /api/video/jobs/:id/publish`
- `POST /api/video/caption-draft`
- `POST /api/video/caption/score`
- `POST /api/video/virality-score`

Provide the token as either:

```bash
-H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN"
```

or:

```bash
-H "x-video-api-key: $SWARMX_VIDEO_API_TOKEN"
```

---

## API reference

All endpoints are under the `/api/video` prefix registered in `server.ts`.

---

### POST /api/video/jobs

Create a new video generation job and enqueue it.

**Request body:**

```json
{
  "prompt": "string (required, 1-2000 chars)",
  "platform": "tiktok | youtube_shorts | reels | generic",
  "niche": "motivational | finance | facts | true_crime | tech | other",
  "targetDurationSeconds": 15,
  "modelTier": "fast | worker | supervisor | reasoner",
  "clientRequestId": "optional-idempotency-key"
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
  -d '{"prompt": "Explain compound interest in a way that motivates a first-time investor", "platform": "tiktok", "niche": "finance", "targetDurationSeconds": 45}'
```

**Response `201`:**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "status": "queued",
  "createdAt": "2026-05-21T09:55:00.000Z",
  "message": "Video job created. Track progress via SSE or GET /api/video/jobs/550e8400-e29b-41d4-a716-446655440000"
}
```

**Response `503` (RAM gate):**

When available RAM is below 1000 MB, admission is blocked:

```json
{
  "error": "insufficient_ram_for_video",
  "message": "Insufficient RAM for video generation",
  "availableMb": 742,
  "minimumRequired": 1000
}
```

---

### GET /api/video/jobs

List video jobs, most-recent first.

**Query params:**

| Param | Type | Default | Max |
| --- | --- | --- | --- |
| `status` | enum | unset | — |
| `limit` | integer | `20` | `100` |
| `offset` | integer | `0` | — |

```bash
curl "http://localhost:3001/api/video/jobs?limit=10"
```

**Response `200`:**

```json
{
  "jobs": [
    {
      "id": "550e8400-e29b-41d4-a716-446655440000",
      "status": "running",
      "request": {
        "prompt": "A 30-second motivational video about starting your first business",
        "platform": "tiktok"
      },
      "overallProgress": 35,
      "createdAt": "2026-05-21T09:55:00.000Z",
      "updatedAt": "2026-05-21T09:55:42.000Z"
    }
  ],
  "total": 1,
  "limit": 10,
  "offset": 0,
  "queueDepth": 0,
  "runningCount": 1
}
```

---

### GET /api/video/jobs/:id

Full job detail including intent, script, storyboard, render manifest, stage log, and warnings.

```bash
curl http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000
```

**Response `200` (shape):**

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "status": "running",
  "request": {
    "prompt": "A 30-second motivational video about starting your first business",
    "platform": "tiktok"
  },
  "stages": {
    "scripting": {
      "stage": "scripting",
      "stageProgress": 35,
      "overallProgress": 35,
      "startedAt": "2026-05-21T09:55:14.000Z"
    }
  },
  "currentStage": "scripting",
  "overallProgress": 35,
  "retryCount": 0,
  "createdAt": "2026-05-21T09:55:00.000Z",
  "updatedAt": "2026-05-21T09:55:42.000Z"
}
```

**Response `404`:**

```json
{ "error": "Job 550e8400-e29b-41d4-a716-446655440000 not found" }
```

---

### POST /api/video/jobs/:id/cancel

Cancel a job. Returns `409` when the job is already terminal.

```bash
curl -X POST http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000/cancel \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN"
```

### DELETE /api/video/jobs/:id

REST alias for cancellation, identical behavior to POST cancel.

```bash
curl -X DELETE http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000 \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN"
```

### POST /api/video/jobs/:id/resume

Resume a terminal job from a prior stage marker if partial artifacts exist.

```bash
curl -X POST http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000/resume \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN" \
  -d '{"fromStage":"failed"}'
```

### POST /api/video/jobs/reprioritize

Reorder queued jobs. Accepts queue order as an array of job IDs.

```bash
curl -X POST http://localhost:3001/api/video/jobs/reprioritize \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN" \
  -d '{"orderedIds":["job-a","job-b","job-c"]}'
```

---

### GET /api/video/jobs/:id/artifacts

Fetch resolved artifact pointers for a job, including published target URLs and persisted publish history.

```bash
curl http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000/artifacts
```

---

### GET /api/video/jobs/:id/analysis

Fetch virality analysis and caption draft state for a completed job.

```bash
curl http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000/analysis
```

---

### POST /api/video/jobs/:id/publish

Create a platform-specific publish handoff record. The API persists the publish attempt on the job, updates `outputArtifacts.exportPathByPlatform`, and emits a `video:snapshot` event so the dashboard refreshes immediately.

```bash
curl -X POST http://localhost:3001/api/video/jobs/550e8400-e29b-41d4-a716-446655440000/publish \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN" \
  -d '{"platform":"tiktok"}'
```

**Response shape:**

```json
{
  "jobId": "550e8400-e29b-41d4-a716-446655440000",
  "job": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "publishHistory": [
      {
        "publishId": "2d24...",
        "platform": "tiktok",
        "status": "pending_review",
        "approvalState": "pending_review",
        "deliveryMode": "studio_export",
        "accountLabel": "TikTok Studio",
        "requestedAt": "2026-06-01T09:00:00.000Z",
        "updatedAt": "2026-06-01T09:00:00.000Z",
        "requiresApproval": true,
        "platformUrl": "https://studio.tiktok.com/upload?..."
      }
    ]
  },
  "result": {
    "publishId": "2d24...",
    "platform": "tiktok",
    "status": "pending_review"
  }
}
```

Current adapter behavior:

- `generic`: direct export, no approval required, immediately marked `published`
- `tiktok`, `reels`, `shorts`: studio handoff URLs with persisted `pending_review` approval state

---

### POST /api/video/caption-draft

Generate a standalone caption draft without creating a full video job.

```bash
curl -X POST http://localhost:3001/api/video/caption-draft \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN" \
  -d '{"prompt":"How compound interest changes your life","platform":"tiktok"}'
```

---

### POST /api/video/virality-score

Generate a standalone virality score preview.

```bash
curl -X POST http://localhost:3001/api/video/virality-score \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN" \
  -d '{"prompt":"How compound interest changes your life","platform":"tiktok","durationSec":30}'
```

### POST /api/video/caption/score

Generate a caption draft and virality score in one call.

Rate limit: 10 requests/minute per connection by default
(`SWARMX_VIDEO_CAPTION_SCORE_LIMIT_PER_MIN`).

```bash
curl -X POST http://localhost:3001/api/video/caption/score \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $SWARMX_VIDEO_API_TOKEN" \
  -d '{"prompt":"How compound interest changes your life","platform":"tiktok"}'
```

Returns `429` when the per-connection rate limit is exceeded.

---

### Publish state in job detail

Publish records are persisted in two places on the job payload:

- `job.publishHistory`
- `job.outputArtifacts.publishHistory`

The dashboard list uses the latest record for compact status, while the detail panel renders the full history with approval state and target URL.

---

### Snapshot refresh behavior

After a publish request succeeds, the API broadcasts:

```json
{
  "type": "video:snapshot",
  "data": {
    "job": { "...": "updated job with publishHistory" }
  }
}
```

This avoids a second polling path for publish state and keeps the dashboard job list/detail view in sync with the route mutation.

---

## SSE event lifecycle

All video events are emitted on the existing `/api/events` SSE stream. No new SSE endpoint
is needed.

API video lifecycle events (from `apps/swarmx-api/src/types/events.ts`) use canonical
`{ type, timestamp, data }` shape:

- `video:created`
- `video:queued`
- `video:stage_started`
- `video:progress`
- `video:completed`
- `video:failed`
- `video:cancelled`
- `video:snapshot`

### Event: `video:progress` (API lifecycle shape)

```json
{
  "type": "video:progress",
  "timestamp": "2026-05-21T09:55:42.000Z",
  "data": {
    "jobId": "550e8400-e29b-41d4-a716-446655440000",
    "stage": "scripting",
    "stageProgress": {
      "stage": "scripting",
      "stageProgress": 0,
      "overallProgress": 30,
      "startedAt": "2026-05-21T09:55:42.000Z"
    },
    "overallProgress": 30,
    "message": "Starting scripting..."
  }
}
```

### Compact progress projection on shared dashboard stream

The dashboard `events` store currently handles a compact projection event shape from
`@swarmx/types` for `video:progress` and forwards it to `useVideoStore.applyProgressEvent()`.
That shape includes `jobId`, `status`, `degradeMode`, `progress`, `timestamp`, `correlationId`, and optional `error`.
The richer API lifecycle events are consumed by `useVideoStore.ingestEvent()`.

### Typical stage sequence for a successful job

```text
video:created
video:stage_started(stage=intent_classification)
video:progress(stage=intent_classification)
video:stage_started(stage=planning)
video:progress(stage=planning)
video:stage_started(stage=scripting)
video:progress(stage=scripting)
video:stage_started(stage=storyboard_generation)
video:progress(stage=storyboard_generation)
video:stage_started(stage=render_assembly)
video:progress(stage=render_assembly)
video:stage_started(stage=finalizing)
video:progress(stage=finalizing)
video:completed
```

---

## Job lifecycle & state machine

The orchestrator executes these canonical stages in order:

1. `intent_classification`
2. `planning`
3. `scripting`
4. `storyboard_generation`
5. `render_assembly`
6. `finalizing`

State transitions are queue-driven:

- Initial: `queued`
- Active processing: `running`
- Terminal: `completed` | `failed` | `cancelled`

At any stage boundary, a cancelled job is aborted and no further stages run.

---

## Degradation behavior

Current implementation degrades via retryable/terminal failures and pressure-aware timeouts.

- Under critical pressure, orchestration fails fast with `PRESSURE_CRITICAL`.
- Transient upstream failures (`TIMEOUT`, `OLLAMA_UNAVAILABLE`, `COMFY_UNAVAILABLE`) are marked retryable.
- Job retry behavior is controlled by queue policy (`VIDEO_MAX_RETRIES`).

---

## Model assignment

| Stage | Model env var | Default | Typical latency (8 GB) |
| --- | --- | --- | --- |
| Intent classification | `SWARMX_MODEL_FAST` | `instruct-phi4-pro-q8-prod` | 3–8 s |
| Planning | `SWARMX_MODEL_REASON` | `reason-deepseekr1-pro-q5km-prod` | 45–90 s |
| Scripting | `SWARMX_MODEL_CODE` | `code-qwen25-pro-q5km-prod` | 60–120 s |
| Storyboard | `SWARMX_MODEL_CODE` | `code-qwen25-pro-q5km-prod` | 120–300 s |
| Render assembly | — (HTTP) | — | 2–5 s per shot |

Context windows are scaled down under pressure (`adaptive-timeout-config.ts`):

| Pressure | num_ctx scale | num_predict scale |
| --- | --- | --- |
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
3. Shared compact `video:progress` events are routed via `applyVideoProgress()` which calls
  `useVideoStore.getState().applyProgressEvent()` — a static Zustand accessor, safe outside React.
4. API lifecycle video events are applied in `useVideoStore.ingestEvent()`.
5. The video page subscribes to `useVideoStore` and re-renders on every upsert.
6. React Query polls `GET /api/video/jobs` every 8 seconds as a fallback for clients that
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

If ComfyUI is not running, the render stage can fail with `COMFY_UNAVAILABLE` and follow the queue retry/fail policy.

---

## Troubleshooting

### `/api/system/health` reports `degraded`

**Cause:** On 8 GB hosts this usually means memory pressure, model probe timeouts, or both.
If `availableRamMb < 800`, SwarmX intentionally downgrades to `rule_engine` topology and the
health surface can remain degraded even while the API `/health` endpoint is OK.

**Fix:** Evict resident 7B models, warm Relay again, then rerun:

```bash
bash scripts/swarm-healthcheck-apex17.sh
```

This is an operational pressure signal, not automatically a regression in the video code path.

---

### `/api/video/jobs` returns `404`

**Cause:** `videoRoutes` not registered in `server.ts`.

**Fix:** Confirm `server.ts` contains:

```ts
import { videoRoutes } from "./routes/video.js";
// ...
await server.register(videoRoutes, { prefix: "/api/video" });
```

This was a known bug fixed in `[VIDEO-SERVER-01]`. If you copied an older `server.ts`, apply
the fix above.

---

### Jobs always show `status: failed` with `No video processor registered`

**Cause:** API is running an outdated `video` route/orchestrator bundle.

**Fix:** Ensure the current `apps/swarmx-api/src/routes/video.ts` and
`apps/swarmx-api/src/services/video-orchestrator.ts` are deployed together.

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
3. Confirm `NEXT_PUBLIC_API_URL` points to the correct API host:port.
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
| --- | --- | --- |
| `VIDEO-ROUTE-01` | `routes/video.ts` | File contained the `VideoPageLoading` React component instead of Fastify route definitions. All `/api/video/*` endpoints returned `404`. Replaced with correct Fastify plugin. |
| `VIDEO-SERVER-01` | `server.ts` | `videoRoutes` was never imported or registered. All `/api/video/*` routes were unreachable. Import and `server.register(videoRoutes, ...)` call added. |
| `VIDEO-FORM-01` | `VideoJobForm.tsx` | `s.governorSnapshot` referenced a non-existent key; the correct field is `s.governorState`. The pressure warning was never shown. Fixed selector. |
| `VIDEO-FIX-01` | `types/events.ts` | API video lifecycle events are now explicitly represented in the local `SwarmXEvent` union (`video:created` / `video:queued` / `video:stage_started` / `video:progress` / `video:completed` / `video:failed` / `video:cancelled` / `video:snapshot`). |
| `VIDEO-FIX-03` | `stores/events.ts` | `video:progress` events were not routed to the video store from the events reducer. Fixed in the current bundle (already present). |

---

## VIDEO-ALPHA r1 additions

### New API endpoints

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/video/jobs/:id/sse` | GET | Job-specific SSE stream — filtered video:* events for one job |
| `/api/video/jobs/:id` | DELETE | Cancel alias (same as POST cancel, for REST semantics) |
| `/api/video/jobs/:id/resume` | POST | Resume a terminal job from a stage marker when partial artifacts exist |
| `/api/video/jobs/reprioritize` | POST | Reorder queued jobs by explicit ordered job IDs |
| `/api/video/templates` | GET | List available ComfyUI workflow templates with RAM requirements |
| `/api/video/caption/score` | POST | Score a caption draft and return both captionDraft + viralitySignal |

### New dashboard components

| Component | Path | Purpose |
| --- | --- | --- |
| `ViralityMeter` | `components/video/ViralityMeter.tsx` | 5-bar virality signal display with Oracle reasoning tooltips |
| `CaptionEditor` | `components/video/CaptionEditor.tsx` | Editable caption draft with live char count, hashtag pills, re-score, copy |
| `PlatformPublishPanel` | `components/video/PlatformPublishPanel.tsx` | Publishing panel with scheduling, approval notices, publish history |

### Publisher modularization

The publisher layer is now split into:

```text
apps/swarmx-api/src/services/publishers/
├── index.ts          — getVideoPublisher() factory (existing import surface preserved)
├── base-publisher.ts — abstract base with retry, logging, schedule sidecar helpers
├── generic.ts        — local filesystem export (always available, no approval needed)
├── tiktok.ts         — TikTok Content API (requires SWARMX_TIKTOK_API_APPROVED=1)
└── instagram.ts      — Instagram Graph API (requires SWARMX_INSTAGRAM_ACCESS_TOKEN)
```

TikTok and Instagram publishers fall back to generic export when environment tokens are not set,
logging a clear message pointing to `docs/TIKTOK_SETUP.md`. See that file for OAuth setup.

### New environment variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `SWARMX_TIKTOK_ACCESS_TOKEN` | (empty) | TikTok OAuth access token |
| `SWARMX_TIKTOK_CLIENT_KEY` | (empty) | TikTok app client key |
| `SWARMX_TIKTOK_CLIENT_SECRET` | (empty) | TikTok app client secret |
| `SWARMX_TIKTOK_API_APPROVED=1` | `0` | Explicit opt-in for real TikTok uploads |
| `SWARMX_INSTAGRAM_ACCESS_TOKEN` | (empty) | Instagram page access token |
| `SWARMX_INSTAGRAM_USER_ID` | (empty) | Instagram user ID |
| `SWARMX_VIDEO_USE_BULLMQ` | `0` | Enable Redis-backed video queue (optional) |
