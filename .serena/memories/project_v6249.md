# V6.2.49 — V4 slice: smoke ceiling + per-stage Zod + voice benchmark (S1)

**Date:** 2026-07-23
**Baseline:** V6.2.48 (fb6cbe9) — V4 audit ledger + rights-safe fixtures + dockerignore cleanup

## Shipped

Two V4 slices per the V6.2.48 audit ledger backlog:

### V4 §11.3 + §7.5 — Smoke renderer ceiling + per-stage Zod validation

- `apps/swarmx-api/src/services/renderer-certification.ts` (NEW) — `getRendererCertificationCeiling()`, `clampCertificationTier()`, `canPromoteTo()`. Ceilings: `ffmpeg_text_smoke → TECHNICALLY_VALID`, three production renderers → `PUBLISHED_VERIFIED`, `optional_adapter → PRODUCTION_PACK_VALID`. Terminal side-branch tiers (RENDER_FAILED, PUBLISH_FAILED, BLOCKED, NEEDS_REVISION) pass through unchanged. Emits `CERT_TIER_CLAMPED_BY_RENDERER` warn log on clamp.
- `apps/swarmx-api/src/services/ffmpeg-video-renderer.ts:539` — assignment now routes through `clampCertificationTier()`.
- `apps/swarmx-api/src/services/creative-factory-certification.ts` — both `certifyProductionPack()` and `certifyReadyToPost()` now consult `output.mediaQualityReport?.rendererTier` and clamp their results. `certifyReadyToPost()` also emits an explicit "Renderer X caps certification at Y" blocker when the desired tier is clamped down.
- `apps/swarmx-api/src/services/stage-schemas.ts` (NEW) — Zod schemas + `validateStageResult()` for planning/scripting/storyboard.
- `apps/swarmx-api/src/services/video-orchestrator.ts` — planning/storyboard fall through to hard-coded defaults on schema failure (recorded in trace); scripting throws `SCRIPT_SCHEMA_INVALID` because no safe stub can reach a production tier. New `pushStageValidation()` + `runStageValidation()` helpers.
- `apps/swarmx-api/src/types/video.ts` — new `StageValidationEntry` type + optional `stageValidationTrace?: StageValidationEntry[]` on bridge `VideoJob`; new `SCRIPT_SCHEMA_INVALID` error code.

### V4 §13.2 — Voice provider benchmark (S1)

- `apps/swarmx-api/src/services/voice-benchmark-report.ts` (NEW) — `VoiceBenchmarkReportSchema` (Zod), `readVoiceBenchmarkReport()` with freshness check, `rankAvailableProviders()` that always prefers `neural_local` > `neural_hosted` > `synthetic_fallback`, then breaks ties by failure count, then by RTF.
- `apps/swarmx-api/scripts/voice-benchmark.ts` (NEW) — CLI that probes each provider, runs 1 cold + 3 warm synthesis iterations against a fixed fixture, computes median warm latency and RTF, records failures, writes ranked JSON report to `SWARMX_VOICE_BENCHMARK_FILE` (default `/tmp/swarmxq-voice-benchmark.json`).
- `apps/swarmx-api/src/services/voice-providers.ts` — `selectVoiceProvider()` when `SWARMX_TTS_PROVIDER=auto` consults the report and probes in ranked order. When no fresh report exists, the current default order (Kokoro → Piper → eSpeak) is preserved. Returns a new `benchmarkAppliedProviderId` field when the report changed the order.
- `apps/swarmx-api/src/routes/system.ts` — `/api/system/health` gained a `voice.benchmark` block with `generatedAt`, `ageHours`, `stale`, `recommendedProviderId`, `recommendationReason`, and per-provider `realTimeFactor`/latency/failures.
- `apps/swarmx-api/src/lib/env.ts` — new `SWARMX_VOICE_BENCHMARK_FILE` and `SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS` (default 168).

### Tests (+51 total across 3 new test files)

- `__tests__/renderer-certification.test.ts` — 19 tests: ceiling table, clamp semantics, promotion guard, terminal-tier pass-through.
- `__tests__/stage-schemas.test.ts` — 17 tests: schema bounds for all 3 stages + `validateStageResult()` outcome shape.
- `__tests__/voice-benchmark-report.test.ts` — 15 tests: schema validation, `readVoiceBenchmarkReport()` (missing/invalid/schema-mismatch/fresh/stale), `rankAvailableProviders()` (short-circuit, missing/stale report, neural preference, failure penalty, unmeasured providers).

### Docs

- `CLAUDE.md` — added invariants #15 (smoke ceiling), #16 (per-stage schema validation), #17 (benchmark-informed voice selection). Added milestone-queue rows 7 and 8 marking both slices done. Added voice-benchmark line to release-gate block.

## Quality gate results

All passed on this session's host (16 GB EliteBook 850 G3, CPU-only, WSL2, 2026-07-23):

| Gate | Result |
|---|---|
| `@swarmx/types typecheck` | ✅ pass |
| `@swarmx/api typecheck` | ✅ pass |
| `@swarmx/dashboard typecheck` | ✅ pass |
| `@swarmx/api vitest` | ✅ **228 tests** (was 213 → +15 new; 213 → 228 with voice-benchmark tests) |
| `@swarmx/dashboard next build` | ✅ 13 routes |
| `adaptive-timeout-regression` | ✅ pass |
| `video-regression-check` | ✅ pass |
| `eviction-metric-regression` | ✅ pass |
| `system-health-regression` | ✅ pass |
| `reasoning-sanitizer-regression` | ✅ pass |
| `git diff --check` | ✅ no whitespace violations |
| `console.*` in services/routes | ✅ 0 |
| `process.env[…]` in services/routes | ✅ 7 (≤10 cap) |
| TONE_RULES 8 variants | ✅ all present |

**Skipped:** live voice-benchmark run — this session was development/audit only; no Piper voice model installed, no Kokoro service running, so a real benchmark would have measured only eSpeak. The CLI is verified via unit tests + type gates; running it against real providers is deferred to a session where Piper is installed.

## Host profile

- RAM at session start: MemAvailable ~9.9 GB (16 GB total)
- `startup-enhanced.sh`: not active this session (audit + code work; no Ollama traffic)
- Ollama online: not probed this session
- Ollama CPU perf vars: unchanged (still `NUM_PARALLEL=1`, `KV_CACHE=q8_0`, `NUM_THREADS=3`)

## Runtime pivots

- Planned voice-benchmark ceilings for production renderers were `READY_TO_POST` in the initial plan file. Corrected during implementation to `PUBLISHED_VERIFIED` because publishing subsystems otherwise couldn't advance a job past `READY_TO_POST` even after successful upload — the ceiling should mark the highest tier the artifact can EVER reach, not the highest tier before publishing.
- Instead of building selection tie-breaking as an in-memory heuristic, the benchmark report is a JSON artifact so the operator has a permanent, auditable record of the host's measured behavior. This also lets `/api/system/health` surface the recommendation to the dashboard.

## New invariants discovered

- `certifyReadyToPost()` and `certifyProductionPack()` are the two documented downstream sites that promote past the FFmpeg renderer's initial tier assignment. Both now respect the ceiling; if a third promotion site is added later, it must route through `canPromoteTo()`.
- `stageValidationTrace` on bridge `VideoJob` is optional so dashboard code that predates it continues to work. Any future QC gate that needs to refuse promotion should check for `passed:false` entries in this trace.
- The benchmark report keeps `neural_local` above `synthetic_fallback` even when eSpeak has a materially lower RTF — RTF alone cannot elect a production voice.

## TONE_RULES state

Unchanged from V6.2.44 baseline. Still 8 variants: `contrarian`, `urgent`, `educational`, `cinematic`, `warm`, `minimal`, `faceless_broll`, `kinetic_text`. CI grep gate confirms.

## Remaining work (next session starting points)

From the V6.2.48 audit ledger, remaining V4 backlog:

| Slice | Status | Notes |
|---|---|---|
| S2 — Template family expansion (+8 templates) | not started | myth-vs-fact, list/countdown, mystery/reveal, product-demo, quote-to-insight, chart/data, motivational, series recap |
| S3 — Preview pipeline (proxy renders, partial scenes) | not started | Enables PLAN_ONLY/QUICK_DRAFT modes to skip full-resolution encoding |
| S4 — Openverse adapter | not started | Optional external asset search — requires ADR per V4 §22 |
| S5 — Golden-path re-cert under V6.2.49 | not started | Full clean-clone → real MP4 → tier certification pass |
| `doctor` CLI command | not started | Startup-enhanced.sh has semantics; wrap as `pnpm -F @swarmx/api exec tsx scripts/doctor.ts` |
| Ollama JSON-mode migration for planning/storyboard | seed | Requires CPU JSON-mode reliability benchmark first |
| Cert-tier state-machine transition wiring for new tiers | seed | PUBLISHING/PUBLISH_FAILED/BLOCKED/NEEDS_REVISION exist in the type but no explicit transition function uses them yet |

**Next-session opener:** run the actual voice benchmark on a host with Piper installed to produce the first real report and confirm `/api/system/health` surfaces it correctly.
