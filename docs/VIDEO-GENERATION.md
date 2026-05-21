# Video Generation Subsystem

## What is included

This bundle adds the remaining video subsystem files that connect the already-created video queue, orchestrator, dashboard page, and UI cards into the SwarmXQ codebase.

The code is split into three layers:

1. **API contract and SSE events** — video job types, event variants, and route handlers
2. **Execution** — in-memory queue, orchestration, and artifact storage
3. **Dashboard** — video store, page, error state, navigation, and live updates

## Files to place

Copy the files from this bundle into the matching paths in your repo:

- `apps/swarmx-api/src/types/events.ts`
- `apps/swarmx-api/src/services/video-assets.ts`
- `apps/swarmx-api/src/routes/video.ts`
- `apps/swarmx-api/src/server.ts`
- `apps/swarmx-dashboard/src/stores/events.ts`
- `apps/swarmx-dashboard/src/stores/video.ts`
- `apps/swarmx-dashboard/src/app/(dashboard)/video/error.tsx`
- `apps/swarmx-dashboard/src/components/layout/NavRail.tsx`
- `apps/swarmx-dashboard/src/app/(dashboard)/layout.tsx`
- `workflows/video-generation.yaml`
- `agents/catalog.yaml`

The core files already present in the earlier zip should remain in place:

- `apps/swarmx-api/src/types/video.ts`
- `apps/swarmx-api/src/services/video-queue.ts`
- `apps/swarmx-api/src/services/video-orchestrator.ts`
- `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx`
- `apps/swarmx-dashboard/src/components/video/VideoJobForm.tsx`
- `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx`
- `apps/swarmx-dashboard/src/app/(dashboard)/video/loading.tsx`

## Setup

### 1) Install dependencies
From the repo root, install workspace dependencies as usual:

```bash
pnpm install
```

### 2) Configure the API
Add or confirm these environment variables:

```bash
SWARMX_API_PORT=3001
SWARMX_API_HOST=127.0.0.1
SWARMX_MODEL_ROUTER=phi4-fast
SWARMX_MODEL_REASON=deepseek-reasoner
SWARMX_MODEL_CODE=qwen-worker
SWARMX_COMFYUI_URL=http://127.0.0.1:8188
SWARMX_VIDEO_OUTPUT_DIR=./.swarmx/video-output
```

Optional but recommended:

```bash
SWARMX_DASHBOARD_ORIGIN=http://localhost:3000
NEXT_PUBLIC_API_BASE=http://localhost:3001
```

### 3) Run the API
```bash
pnpm --filter @swarmx/api dev
```

### 4) Run the dashboard
```bash
pnpm --filter @swarmx/dashboard dev
```

### 5) Verify the route
Open the dashboard and check:

- `/video` renders the job workspace
- `POST /api/video/jobs` creates a job
- `GET /api/video/jobs` returns job summaries
- `GET /api/video/health` returns Ollama and ComfyUI reachability
- the existing SSE stream at `/api/events` shows video progress events

## Runtime behavior

### Job lifecycle
The queue and orchestrator run a pressure-aware pipeline:

- `queued`
- `preflight`
- `planning`
- `scripting`
- `storyboard`
- `rendering`
- `assembling`
- `exporting`
- `completed`

Degraded states are used when the host is under pressure or a renderer is unavailable.

### Live updates
The API emits video progress events over the existing SSE channel. The dashboard stores the latest event snapshot so the video page can respond immediately without polling only.

### Artifacts
Video outputs are written beneath `SWARMX_VIDEO_OUTPUT_DIR`. The helper service also exposes per-job artifact paths so future renderers or file browsers can be added without changing the API shape.

## Notes

- The in-memory queue is intentionally simple and local-first.
- If you later add persistence, keep the same request and event contracts so the dashboard does not need a redesign.
- The `video-planner` catalog entry is optional for runtime but useful for agent routing and documentation.
