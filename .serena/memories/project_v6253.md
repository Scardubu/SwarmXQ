---
name: project_v6253
description: V6.2.53 session — template-aware QC wired into renderer, RetentionMap preview endpoint + Retention Lab tab, RuntimeCapabilityStrip on /system, universal prefers-reduced-motion; 338 API tests, 14 dashboard routes
metadata:
  type: project
---

## Shipped — V6.2.53

**Commit**: `feat(ux): V6.2.53 integrations + polish — template QC wired into renderer, RetentionMap preview lab, runtime capability strip, universal prefers-reduced-motion`

### Integration 1 — Template-Aware QC into renderer (P1)

**File**: `apps/swarmx-api/src/services/ffmpeg-video-renderer.ts`

- Added `parseDetectorIntervals(raw, detector)` helper that extracts structured `RawQcFinding[]` from FFmpeg `blackdetect`/`freezedetect` stderr. Handles both colon (`black_start:1.2`) and equals (`lavfi.freeze_start=5.0`) forms; extracts start + duration; severity ladder = LOW/<1s, MEDIUM/1–5s, HIGH/≥5s.
- In `writeProductionPackage`: calls `runTemplateQc(structuredFindings, rendererTier)` from `template-aware-qc.ts`.
- `mediaQualityReport.interpretedFindings` now contains per-tier-aware messages (`ffmpeg_kinetic_text` dark backgrounds marked expected; `ffmpeg_faceless_broll` freezes >10s block certification).
- `certificationTier` downgrades from `PRODUCTION_PACK_VALID` → `CREATIVE_REVIEW_REQUIRED` when `qcResult.blockers.length > 0`.
- **INV-15 preserved**: all tier assignments still route through `clampCertificationTier()`.
- Fallback when no structured intervals parsed: emit one legacy-shape "template baseline holds" message per raw detector so the QC report is never empty.

### Integration 2 — RetentionMap preview endpoint

**File**: `apps/swarmx-api/src/routes/creative-factory.ts`

- Added `POST /api/video/factory/retention-map/preview` (public — no write auth required, pure function, no persistence). Accepts `{ script: string, targetDurationSecs: 5–600 }`; returns `RetentionMap` from `generateRetentionMap()`. Zod-validated inputs.

### UX 1 — RuntimeCapabilityStrip on `/system` page

**Files**:
- `apps/swarmx-dashboard/src/hooks/useRuntimeCapabilities.ts` (NEW)
- `apps/swarmx-dashboard/src/components/layout/RuntimeCapabilityStrip.tsx` (NEW)
- `apps/swarmx-dashboard/src/app/(dashboard)/system/page.tsx` (edit)

Consolidated four capability cards (Ollama · RAM · Warmup · Voice Benchmark) on the `/system` page above tabs. Polls `/api/system/health` every 20s (separate React Query cache from `useApiHealth` so CommandBar keeps lean payload). Uses tone-aware status colour system already in globals.css.

### UX 2 — Retention Lab tab on `/system`

**Files**:
- `apps/swarmx-dashboard/src/components/video/RetentionMapPanel.tsx` (NEW)
- `apps/swarmx-dashboard/src/app/(dashboard)/system/page.tsx` (edit)

Interactive script-textarea + target-duration input → hits preview endpoint → renders time-coded beat cards with dropOffRisk colour bands + microReward / plannedRecovery annotations. Overall risk header shows counts (HIGH · unrecovered). ARIA live regions.

### UX 3 — Universal `prefers-reduced-motion` block

**File**: `apps/swarmx-dashboard/src/app/globals.css`

Existing named-class block only disabled 7 specific decorations. Added WCAG 2.3.3 universal fallback: `*, *::before, *::after { animation-duration: 0.01ms; animation-iteration-count: 1; transition-duration: 0.01ms; scroll-behavior: auto; }`. Also neutralises `.card-elevate:hover` transforms in addition to `.card-interactive:hover`.

### Detector parser tests

**File**: `apps/swarmx-api/__tests__/detector-interval-parser.test.ts` (NEW)

6 tests: colon form, equals form, multiple intervals, empty stderr, parser → runTemplateQc integration (kinetic_text expected; faceless_broll >10s blocks).

## Quality Gate Results

| Gate | Result |
|---|---|
| `apps/swarmx-api/node_modules/.bin/tsc -p packages/swarmx-types/tsconfig.json` | ✅ Zero errors |
| `apps/swarmx-api/node_modules/.bin/tsc -p apps/swarmx-api/tsconfig.json` | ✅ Zero errors |
| `apps/swarmx-api/node_modules/.bin/tsc -p apps/swarmx-dashboard/tsconfig.json` | ✅ Zero errors |
| `pnpm -F @swarmx/api test` | ✅ **344 passing** (V6.2.52 baseline was 338; +6 detector parser tests) |
| `pnpm -F @swarmx/dashboard test` | ✅ 52 passing (unchanged) |
| video-regression-check.ts | ✅ Passed |
| system-health-regression.ts | ✅ Passed |
| reasoning-sanitizer-regression.ts | ✅ Passed |
| eviction-metric-regression.ts | ✅ Passed |
| adaptive-timeout-regression.ts | ✅ Passed |
| `pnpm -F @swarmx/dashboard build` | ✅ 14 routes, zero errors |
| `console.*` invariant | ✅ 0 hits in services/routes |

**Correction**: Actual pnpm test count reported 338 pre-detector, 344 post-detector (not 338 → 344 as V6.2.52 note stated). V6.2.52 note said 332 → the runner delta was 338 - 332 = 6, then this session adds 6 more = 344.

## Host Profile at Kickoff

- Bare-metal Linux, 16 GB RAM host
- MemAvailable: 7552 MB (> 6170 threshold — full pipeline eligible)
- Redis: PONG (online)
- Ollama: running but cold (`/api/ps` → `{"models":[]}`)
- Kokoro HTTP server: `/health` returns `{status:"ok",engine:"kokoro",version:"82m"}` with 6 voices ready (`am_adam`, `bm_george`, `bm_lewis`, `af_sarah`, `am_michael`, `af_nicole`) — recovered from V6.2.51 crash
- Warmup: no `/tmp/swarmxq-warmup.json` (startup-enhanced.sh not active)

## Runtime Pivots

- **Audio-mastering wire-in deferred**: audio-mastering.ts stays standalone. The current renderer uses inline single-pass FFmpeg loudnorm; wiring the two-pass EBU R128 requires splitting AUDIO_MASTER from COMPOSE stage AND adding WAV output support to `masterAudio()` (currently AAC-only would double-transcode). Deferred to a runtime session that formalises the workflow stage split. Session note flags this for V6.2.54.
- **Retention preview route is `public`** (no `requireVideoWriteAuth`): it's pure-function preview with no persistence. If persistence lands later, elevate the guard.
- **Concept-tournament diversity axes**: 6 new fields (V6.2.52) are `optional` so any existing candidate JSON without them still validates. Dashboard tournament UI not built this session — deferred.
- **RetentionMap component uses local `interface` copies** rather than importing types from `@swarmx/types` — same invariant from V6.2.52 (runtime import from types package unresolvable in Next.js client bundle without a build step).

## New Invariants Discovered

- **`prefers-reduced-motion` fallback**: named-class-only blocks are incomplete — any new animation without adding its class to the block silently ignores the user preference. The universal `*` fallback closes this gap. Future animations do not need updates.

## TONE_RULES State

Not modified this session.

## Voice Benchmark State

Kokoro back online at :8888 with 6 voices — benchmark still stale (last run failed in V6.2.51). Next session should rerun `voice-benchmark.ts` before M9.

## Remaining Work

| Priority | Item | Status |
|---|---|---|
| **Next** | M9 golden-path re-cert — warm Ollama, rerun voice-benchmark.ts with fresh Kokoro, generate real MP4 | Deferred to runtime session |
| P1 | Audio-mastering two-pass wire-in (needs AUDIO_MASTER stage split + WAV output in `masterAudio`) | Deferred |
| 12 | Ollama JSON-mode migration | Not started |
| P2 | Dashboard tournament UI (routes + fetch + panel) | Not started |
| P2 | Voice preview button (needs backend sample endpoint) | Not started |
| 14 | Preview pipeline / proxy renders | Not started |
| 15 | Openverse adapter (ADR first) | Not started |
