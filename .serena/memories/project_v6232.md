---
name: project_v6232
description: V6.2.32 — High Impact queue: cleanup logger, resumeJob validation, OTel spans
metadata:
  type: project
---

## Shipped

- Commit `85bc62f` — `feat(video): V6.2.29 — cleanup logger, resumeJob validation, OTel spans`

### Changes

**video-cleanup.ts** — migrated all `process.stderr.write()` to `log.info()` / `log.warn()`. The startup wiring already existed at `server.ts:283`; the actual gap was non-structured logging bypassing Pino.

**video-queue.ts** — `resumeJob()` refactored to sync (no I/O needed); fixed signature to `fromStage: VideoJobStage`; removed misleading `readdir(ARTIFACT_DIR)` check; new validation: stage must be in `VIDEO_JOB_STAGE_ORDER`, preceding stage must have `completedAt` set. Error sentinels: `"invalid_stage:<name>"` and `"prerequisite_stage_incomplete:<name>"`.

**types/video.ts** — `resumeFromStage?: VideoJobStage` (was `CanonicalVideoJobStatus`)

**video-dashboard.ts** (dashboard) — mirrored same fix in `VideoJob` shape line 128; `VideoJobStage` was already locally defined in that file.

**routes/video.ts** — `ResumeBodySchema` uses `z.enum(VIDEO_JOB_STAGE_ORDER)` for exhaustive stage validation; error handler updated for new sentinel prefixes.

**src/lib/tracer.ts** (NEW) — Zero-overhead OTel facade via `@opentelemetry/api` only. No-ops until SDK registered. Exports `tracer`, `SpanStatusCode`, `context`, `trace`.

**video-orchestrator.ts** — OTel instrumentation:
- `runOrchestration()` → root span `video.orchestration` with `swarmx.job.id`, pressure tier, tone, platform, output size, error code
- `runStage()` → child span `video.stage.<name>` per stage with timeout, progress bounds, model tag, duration, error recording
- Stage fns: `trace.getActiveSpan()?.setAttribute("swarmx.model.tag", model)` after acquireModel

## Quality Gate Results

| Gate | Result |
|---|---|
| api tsc | ✓ 0 errors |
| types tsc | ✓ 0 errors |
| dashboard tsc | ✓ 0 errors |
| dashboard vitest | ✓ 52 tests |
| api vitest | ✓ 58 tests |
| video-regression-check | ✓ all 8-tone assertions |
| series-regression | ✓ pass |
| adaptive-timeout-regression | ✓ pass |
| eviction-metric-regression | ✓ pass |
| system-health-regression | ✓ pass |
| reasoning-sanitizer-regression | ✓ pass |
| next build | ✓ 13 routes, 0 errors |
| console.* audit | ✓ 0 actual hits |

## Host Profile

- RAM: 16 GB / Ollama offline / Redis offline — all gates run as static analysis

## New Invariants

- `resumeJob()` should always be sync — job registry is in-memory; async was an artifact of old `readdir` approach.
- Dashboard's `VideoJob` shape in `video-dashboard.ts` is a LOCAL type, not imported from API types. Any API VideoJob shape change must be mirrored manually.
- `@opentelemetry/api` alone installs as zero-dependency no-op facade — add `@opentelemetry/sdk-node` + `exporter-trace-otlp-http` when ready to activate spans.

## Remaining Work

High Impact queue now clear. Next candidates (Medium Impact):
- Python brain: `print()` / `logging.basicConfig()` → `structlog` in `src/swarmx/`
- Activate OTel SDK: add sdk-node + exporter-otlp-http; wire `NodeSDK.start()` before server.ts
- WSL2 vs bare-metal thread count auto-detection in startup-enhanced.sh
- Agent idempotency audit
