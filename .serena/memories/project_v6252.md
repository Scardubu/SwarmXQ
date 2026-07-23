---
name: project_v6252
description: V6.2.52 session — P1 completion: tournament 11-axis diversity, EBU R128 audio mastering, template-aware QC, path traversal fix; 332 API tests
metadata:
  type: project
---

## Shipped — V6.2.52

**Commit**: `feat(creative): V6.2.52 P1 completion — tournament 11-axis, audio mastering, template QC, path traversal fix`

**Files changed**: 9 modified/created

### Item 1 — SAFE_PATH_RE Path Traversal Fix

**File**: `apps/swarmx-api/src/services/render-recipe-compiler.ts`

Added explicit `..` segment check in `validateSrtPath()` after the existing `SAFE_PATH_RE` character check. The existing regex (`/^[/a-zA-Z0-9_\-.]+$/`) only blocked shell-injection chars; `../etc/passwd` passed it. Now `path.split('/').some(s => s === '..')` throws `RENDER_UNSAFE_SRT_PATH`.

**Test update**: `apps/swarmx-api/__tests__/render-recipe-compiler.test.ts` — added `rejects srtPath containing directory traversal sequence` test covering `../etc/passwd`, `/tmp/../../sensitive`, `subs/../../../etc`.

### Item 2 — Concept Tournament 11-Axis Diversity

**Types**: `packages/swarmx-types/src/video-types.ts` — added 6 optional fields to `ConceptCandidate`: `pointOfView`, `narrativeStructure`, `proofMechanism`, `soundStyle`, `pacing`, `productionComplexity`. All optional for backwards-compatibility.

**Service**: `apps/swarmx-api/src/services/creative-tournament.ts` — `fingerprintCandidate()` now joins all 11 axes: `hookFamily|emotionalArc|CTAStyle|visualLanguage|premise|narrativeStructure|proofMechanism|soundStyle|pacing|productionComplexity|pointOfView`. Optional axes default to `""` — absent fields still contribute a delimiter to prevent false-positive collisions between candidates that set different optional axis subsets.

**Tests**: updated existing fingerprint string test to match new 11-field format; added 2 new tests verifying optional-axis distinctness.

### Item 3 — Audio Mastering Pipeline (EBU R128)

**Service**: `apps/swarmx-api/src/services/audio-mastering.ts` (NEW)
- Two-pass EBU R128 via FFmpeg `loudnorm` filter
- `AUDIO_PLATFORM_PROFILES` const defined locally (not in types package) — codebase pattern is type-only imports from `@swarmx/types`; runtime values live in the service layer
- Pass 1: measures `input_i`, `input_tp`, `input_lra`, `input_thresh`, `target_offset` from loudnorm JSON in FFmpeg stderr
- Pass 2: applies `linear=true` normalization with measured values; outputs 48kHz stereo AAC 192kbps by default
- Uses `spawnSync` with args as array (no shell interpolation)
- Typed `AudioMasteringError` with codes `AUDIO_MASTERING_PASS1_FAILED`, `AUDIO_MASTERING_PASS2_FAILED`, `AUDIO_MASTERING_PASS1_NO_JSON`

**Types**: `packages/swarmx-types/src/video-types.ts` — added `AudioPlatform` union type (youtube|tiktok|reels|shorts|broadcast), `AudioMasteringRequest`, `AudioMasteringResult`.

**Tests**: `apps/swarmx-api/__tests__/audio-mastering.test.ts` (NEW) — 8 tests, all mocking `spawnSync` via `vi.mock("node:child_process")`.

**IMPORTANT**: `@swarmx/types` package has no `dist/` folder — Vitest cannot resolve runtime value imports from it. All runtime values (const/function) that Vitest test chains need must live in the API service layer, not in the types package. Only `import type` works from `@swarmx/types` in tests.

### Item 4 — Template-Aware QC

**Service**: `apps/swarmx-api/src/services/template-aware-qc.ts` (NEW)
- `interpretFinding(finding, tier)` → `QcFindingInterpretation` with `isExpected`, `interpretedSeverity`, `plannedEvent`, `notes`
- `runTemplateQc(findings, tier)` → `TemplateQcResult` with `pass`, `blockers` (non-expected HIGH), `warnings` (non-expected MEDIUM)
- Unconditional blockers: `MISSING_AUDIO` and `FIRST_FRAME_EMPTY` are always HIGH+unexpected regardless of tier
- Per-tier rules: `ffmpeg_text_smoke`, `ffmpeg_kinetic_text`, `ffmpeg_faceless_broll`, `ffmpeg_cinematic_explainer`, `optional_adapter`

**Types**: `packages/swarmx-types/src/video-types.ts` — added `RawQcFinding`, `QcFindingInterpretation`, `TemplateQcResult`.

**Tests**: `apps/swarmx-api/__tests__/template-aware-qc.test.ts` (NEW) — 16 tests (including parametric loop over unconditional blocker types × tiers).

## Quality Gate Results

| Gate | Result |
|---|---|
| `pnpm -F @swarmx/api tsc --noEmit` (via direct tsconfig path) | ✅ Zero errors |
| `pnpm -F @swarmx/types tsc --noEmit` (via direct tsconfig path) | ✅ Zero errors |
| `pnpm -F @swarmx/dashboard tsc --noEmit` (via direct tsconfig path) | ✅ Zero errors |
| `pnpm -F @swarmx/api test` | ✅ **332 passing** (was 305; +27 net across 4 test files and 2 new files) |
| video-regression-check.ts | ✅ Passed |
| system-health-regression.ts | ✅ Passed |
| reasoning-sanitizer-regression.ts | ✅ Passed |
| eviction-metric-regression.ts | ✅ Passed |
| adaptive-timeout-regression.ts | ✅ Passed |
| `console.*` invariant check on new services | ✅ 0 hits |
| `git diff --check` | ✅ Clean |
| Dashboard build | Not run (no dashboard changes) |

## Host Profile

- Bare-metal Linux, 16 GB RAM
- Ollama: not checked (not needed for this session — pure code)
- Redis: not needed
- Kokoro: not started (M9 golden-path re-cert deferred)

## Runtime Pivots

- `AUDIO_PLATFORM_PROFILES` moved from `video-types.ts` const to `audio-mastering.ts` local const — codebase pattern requires `@swarmx/types` to only export types (no runtime values); `dist/` folder does not exist, so Vitest cannot resolve runtime value imports from workspace packages.

## New Invariants Discovered

- **`@swarmx/types` runtime-value import invariant**: `@swarmx/types/video-types` has no built `dist/` folder. Vitest resolves `import type` imports at type-check time (erased), but runtime value imports (`import { SomeConst }`) fail. All runtime values must be defined in the service layer (`apps/swarmx-api/src/`) not in the types package. Types-only pattern must be maintained.

## TONE_RULES State

Not modified this session. All 8 variants confirmed present in V6.2.50.

## Voice Benchmark State

Stale — Kokoro crashed during V6.2.51 benchmark run. Next session: restart Kokoro + re-run benchmark before M9.

## Remaining Work

| Priority | Item | Status |
|---|---|---|
| **Next** | Restart Kokoro + clean voice benchmark + M9 golden-path re-cert | Deferred — needs runtime |
| 12 | Ollama JSON-mode migration | Not started — benchmark required first |
| 14 | V4 S3 preview pipeline | Not started |
| 15 | V4 S4 Openverse adapter (ADR first) | Not started |
| P2 | StylePack, Variant system, anti-sameness fingerprinting | Not started |
