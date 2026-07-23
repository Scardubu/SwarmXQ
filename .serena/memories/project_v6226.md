---
name: project_v6226
description: V6.2.26 shipped 2026-07-18 — quick-win integrations pack (warmup ETA, virality badge, dialogue quality gate)
metadata:
  type: project
---

## Shipped
- Version: V6.2.26
- Files changed: 5 (api/routes/system.ts, api/services/video-episode-preproducer.ts, api/scripts/system-health-regression.ts, dashboard/hooks/useApiHealth.ts, dashboard/components/video/VideoJobCard.tsx) + CLAUDE.md baseline update

## What Was Built

**Chunk 1 — Warmup status endpoint pair**
- New `readWarmupStatus(nowMs?)` in `apps/swarmx-api/src/routes/system.ts` parses `SWARMX_WARMUP_STATUS_FILE` (defaults to `/tmp/swarmxq-warmup.json`) and derives `{ done, coldStartEtaSecs, startedAt?, completedAt?, source: "file" | "default" }`
- `/api/system/health` now returns `warmup: { … }` in the response body
- Dashboard `useApiHealth` hook extends `ApiHealthState` with `warmup: WarmupSnapshot | null`
- `VideoJobCard` cold-start hint consumes `warmup.coldStartEtaSecs` instead of the hardcoded 140s literal; falls back to historical 140 when the warmup file is absent
- 5 new assertions added to `system-health-regression.ts` (default fallback, done marker, in-progress decay, elapsed-past-140 floor, malformed JSON)

**Chunk 2 — soundSuggestion artist check in Series Pass C quality gate**
- `evaluateQualityGate()` in `video-episode-preproducer.ts` now runs the same artist/track/song regex as `caption-generator.validateCaptionDraft` (`\b(feat\.?|ft\.?|by\s+[A-Z][a-z]+|"[^"]+"|song|track|album)\b`)
- Existing URL regex expanded to catch `www.`, `spotify`, `soundcloud`, `apple music` (mirroring caption-generator)
- Copyright risk closes across both caption and platform-asset surfaces

**Chunk 3 — Virality visibility**
- Verified: `queue.listJobs()` already returns full `VideoJob` objects including `viralitySignal` — no API change needed
- New `ViralityBadge` component in `VideoJobCard.tsx` renders next to `StatusBadge`: `<0.4` red, `0.4–0.7` amber, `>0.7` green — matches CLAUDE.md dashboard virality panel color spec

## Quality Gate Results
- @swarmx/types tsc: PASS
- @swarmx/api tsc: PASS
- @swarmx/dashboard tsc: PASS
- vitest (dashboard): 52/52 PASS
- adaptive-timeout-regression: PASS
- video-regression-check: PASS
- eviction-metric-regression: PASS
- system-health-regression: PASS (with 5 new warmup-status cases)
- reasoning-sanitizer-regression: PASS
- next build: 14 routes, 0 errors
- git diff --check: clean
- console.* in new code: 0 hits
- process.env[...]: 1 net new hit (SWARMX_WARMUP_STATUS_FILE in system.ts — consistent with existing route-local pattern; Priority 3 will migrate wholesale)

## Host Profile
- RAM at session start: 9184 MB available
- startup-enhanced.sh: not run this session
- Ollama: ONLINE (empty model list — cold)
- Redis: ONLINE (PONG)
- Ollama CPU perf vars set: NUM_PARALLEL=1, FLASH_ATTENTION=1, KV_CACHE_TYPE=q8_0, NUM_THREADS=4, MAX_LOADED_MODELS=2

## Runtime Pivots
- Initial ViralityBadge attempt over-mixed the ETA math; simplified to prefer API `coldStartEtaSecs` when `source === "file"` and fall back to `140 - elapsed` otherwise.
- Job list API endpoint required no change — `queue.listJobs()` already returns the full VideoJob shape including virality signal, so only the UI badge was needed.
- The soundSuggestion validator was already implemented in `caption-generator.ts` at generation time; only Series Pass C needed the parallel check via the quality gate.

## New Invariants
- `readWarmupStatus()` is the single source of truth for cold-start ETA on the dashboard — never re-derive from elapsed time when `warmup.source === "file"`.
- `ViralityBadge` color thresholds (0.4 / 0.7) are contract-level and match the virality panel spec in CLAUDE.md; changing them requires coordinated updates in both places.

## TONE_RULES State
8 variants unchanged since V6.2.23.

## Video Generation Attempt (Post-Commit Smoke Test)

Submitted a real POST `/api/video/jobs` job (id `5d70b780`) against the running V6.2.26 API. Enqueued cleanly, transitioned to `running → intent_classification`, then failed cleanly at T+60s with structured error `{ code: "TIMEOUT", message: "Stage intent_classification timed out after 30000ms", retryable: true }` — the 30 s per-stage AbortController fired because the Ollama daemon's llama.cpp runner kept crashing ("model runner has unexpectedly stopped").

**Root cause (environment, not code):**
- System-wide `/usr/local/bin/ollama serve` (PID 1363, started 05:13 at boot) was launched with a different env than my session's (`OLLAMA_KV_CACHE_TYPE=q8_0` + `OLLAMA_FLASH_ATTENTION=1` likely mismatched or absent on the resident daemon)
- Systemd unit `ollama.service` was crash-looping every ~5 s during the entire session (port conflict with the user-launched daemon)
- Model IS installed and IS loading (`ollama ps` showed Pilot resident at 4.2 GB), but the inference thread crashes after model load completes
- Fixing this needs a `sudo systemctl` action on the ollama daemon with corrected env vars — not something I would do without explicit user authorization

**What the smoke test DID validate (V6.2.26 wins in production):**
- `/api/system/health` returns the new `warmup: { done, coldStartEtaSecs, source }` field — confirmed with the API live and with a synthetic `/tmp/swarmxq-warmup.json` marker (decayed 140 → 100 as expected)
- Job intake/queue path: POST → enqueue → running → structured error works end-to-end
- Error contract: `TIMEOUT` code, `retryable: true`, stage state preserved, no zombie state, no thrown exceptions
- SINGLE-7B LOCK held — no dual-model resident state observed

**Suggested next session action:** Priority 5 (`startup-enhanced.sh`) work will fix this at the source — the script must own Ollama env setup and daemon health, so we don't inherit a broken system-service state.

## Remaining Work (Next Session)
- Priority 2: GitHub Actions CI (`.github/workflows/ci.yml`)
- Priority 3: Env schema expansion — migrate remaining `process.env[...]` hits in services + routes to `env.ts`
- Priority 4: First API unit tests (video-queue state machine, reasoning-sanitizer fixtures)
- Priority 5: 16 GB Profile Config — `startup-enhanced.sh` writing to `SWARMX_WARMUP_STATUS_FILE` (unblocks Chunk 1 to have a real data source)
- Deferred series panels: SSE planning progress, virality arc panel, continuity drift report
