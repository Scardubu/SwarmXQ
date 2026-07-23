# SwarmXQ Project Memory — V6.2.22

## Session Date
2026-07-17

## Shipped

**Commit**: abc0017 `feat(api): V6.2.22 — BullMQ default-on, Worker co-location, Redis fallback`
**Files changed**: 5 (4 modified + 1 new)

| File | Change |
|---|---|
| `apps/swarmx-api/src/lib/env.ts` | `SWARMX_VIDEO_USE_BULLMQ` default `"0"` → `"1"` |
| `apps/swarmx-api/src/services/video-queue.ts` | Runtime `isBullMQEnabled()`, `setBullMQRuntimeEnabled()`, `restoreJobFromBullMQ()`, exported `VIDEO_QUEUE_NAME`, queue name `"swarmx:video"` → `"swarmx-video"` |
| `apps/swarmx-api/src/workers/video-worker.ts` | **New** — BullMQ Worker, co-located, separate connection config, calls `runOrchestration(id, broadcastEvent)` |
| `apps/swarmx-api/src/server.ts` | TCP Redis health probe, Worker start, `stopVideoWorker()` in shutdown |
| `apps/swarmx-api/src/routes/video.ts` | `setImmediate` dispatch guarded by `!isBullMQEnabled()` |

## Quality Gate Results

| Gate | Result |
|---|---|
| `api tsc --noEmit` | ✓ zero errors |
| `types tsc --noEmit` | ✓ zero errors |
| `dashboard tsc --noEmit` | ✓ zero errors |
| `vitest run` (dashboard) | ✓ 52 passing |
| `adaptive-timeout-regression.ts` | ✓ PASS |
| `video-regression-check.ts` | ✓ PASS |
| `eviction-metric-regression.ts` | ✓ PASS |
| `system-health-regression.ts` | ✓ PASS |
| `reasoning-sanitizer-regression.ts` | ✓ PASS |
| `next build` | ✓ 10 routes, zero errors |
| `git diff --check` | ✓ no whitespace violations |
| `grep console.*` | ✓ zero hits in services/routes |

## Host Profile
RAM at session start: not checked (offline Redis; Ollama not running).
`startup-enhanced.sh`: not active (Priority 5 pending).
Ollama: offline (no inference gates executed).

## Runtime Pivots

1. **IORedis version conflict**: Two IORedis versions exist in pnpm store (5.10.1 pinned by BullMQ, 5.11.1 in root). Direct `import IORedis from "ioredis"` in the Worker caused TS `exactOptionalPropertyTypes` mismatch between the two. Fix: pass `{ url: REDIS_URL, maxRetriesPerRequest: null }` as a plain connection options object — BullMQ creates its own IORedis instance internally. Worker connection is still separate from Queue connection (CLAUDE.md invariant satisfied).

2. **Redis probe approach**: Dynamic `import("ioredis")` in `server.ts` for the health probe hit the same version conflict. Fix: `node:net` TCP `createConnection` probe — zero dependency, no version conflicts, pure connectivity test.

3. **Queue name colons**: BullMQ v5 forbids `:` in queue names. Default `"swarmx:video"` was always invalid but was never caught because BullMQ was always disabled. Fixed to `"swarmx-video"`. Pre-existing bug exposed by this milestone.

4. **`BULLMQ_ENABLED` at module load time**: The old `const BULLMQ_ENABLED = process.env.SWARMX_VIDEO_USE_BULLMQ === "1"` at module load time means the Zod default does NOT propagate to it (Zod fills the validated object; `process.env.SWARMX_VIDEO_USE_BULLMQ` stays `undefined` when unset). Both the Zod default AND the module-level read had to change together.

## New Invariants Discovered

- **BullMQ queue name must not contain `:`** — Add to CLAUDE.md if queue name is ever changed again.
- **IORedis version isolation**: Never import `ioredis` directly in files that interact with BullMQ; use the connection options object pattern instead (`{ url, maxRetriesPerRequest }`).
- **Redis probe via `node:net`**: Canonical approach for Redis reachability check at startup without importing ioredis.

## Remaining Work — Next Session Starting Point

**Priority 2**: GitHub Actions CI — `.github/workflows/ci.yml` covering pnpm install → tsc (all 3) → vitest → 5 regressions → next build. Matrix on ubuntu-latest. Cache pnpm store.

**Priority 3**: Env Schema Expansion — migrate `VIDEO_MAX_RETRIES`, `VIDEO_JOB_TTL_MS`, `VIDEO_QUEUE_NAME`, `SWARMX_VIDEO_RENDER_BACKEND`, ComfyUI host, model tag overrides into `env.ts` Zod schema. Target: ≤10 `process.env[...]` hits in services/routes.

**Priority 4**: First API Unit Tests — vitest suite under `apps/swarmx-api/src/__tests__/` for `video-queue.ts` state machine, `reasoning-sanitizer.ts`, `video-runtime-config.ts`, `ffmpeg-video-renderer.ts` pure helpers.

**Priority 5**: 16 GB Profile — `startup-enhanced.sh` with dual-model residency, Pilot keep-alive, RAM-aware frame budget for ComfyUI.

**Medium Impact (discovered this session)**: Verify `restoreJobFromBullMQ` handles all necessary VideoJob fields if the job data schema evolves — currently reconstructs with `status: "queued"` and resets progress to 0 (full pipeline re-run on restart).
