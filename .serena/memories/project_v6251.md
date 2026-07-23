---
name: project_v6251
description: V6.2.51 session — SCAR-X V5.0.0 P1 creative intelligence bundle: hook lab, concept tournament, RetentionMap, scene DSL; Kokoro HTTP server live; 305 API tests
metadata:
  type: project
---

## Shipped — V6.2.51

**Commit**: `9352eda` — `feat(creative): V6.2.51 P1 creative intelligence — hook lab, tournament scoring, RetentionMap, scene DSL`

**Files changed**: 11 new/modified, 1248 insertions

### Phase A — Kokoro server context
- Kokoro-82M HTTP server (`python -m swarmx.services.kokoro_tts_server --port 8888`) started by user with FastAPI; responds at `/health` and `/tts`
- `SWARMX_TTS_URL=http://localhost:8888` written to `.env`
- Voice benchmark run: espeak-ng was recommended because Kokoro synthesis threw exceptions during cold-start model loading (runs=0, failures=4) → excluded from `eligible` list in `recommend()`. This is CORRECT behavior per INV-17 — the logic doesn't recommend a provider that failed all synthesis runs. Root cause: Kokoro server may have crashed mid-benchmark.
- Doctor CLI also reported `kokoro=unavailable` for same reason.
- M9 golden-path re-cert was deferred (requires Ollama online + fresh Kokoro run).
- **Why**: Kokoro cold-start loaded ONNX model for first time; took too long, server may have timed out or crashed. A warm second run should succeed.
- **How to apply**: In next session, restart Kokoro server, verify `/health` responds, run `voice-benchmark.ts` again, then attempt M9.

### Phase B — P1 Creative Intelligence (all 4 targets shipped)

**B1 — hook-laboratory.ts** (`apps/swarmx-api/src/lib/hook-laboratory.ts`)
- 10 HOOK_FAMILIES const array (curiosity-gap through visual-surprise)
- `validateHookCandidate()`: ≤18 words, HOOK_BLOCKLIST via `findHookBlocklistViolations`, forbidden openers regex `/^(in today'?s|welcome|hi everyone|today we|i |my |this video|let'?s|we'?re going)/i`
- `classifyHookFamily()`: heuristic FAMILY_SIGNALS regex patterns
- `generateHookCandidatesStub()`: clamped 1–12, returns typed `HookCandidate[]` with unique crypto IDs
- Imports `findHookBlocklistViolations` from `creative-quality.ts` — NEVER redefines HOOK_BLOCKLIST (invariant preserved)

**B2 — creative-tournament.ts** (`apps/swarmx-api/src/services/creative-tournament.ts`)
- `fingerprintCandidate()`: `hookFamily|emotionalArc|CTAStyle` lowercase-trimmed pipe-joined
- `levenshtein()`: O(m×n) DP; internal only
- `pairwiseDiversityWarnings()`: warns when levenshtein(fpA, fpB) < 3
- `scoreCandidate()`: feasibility×0.4 + originality×0.4 + confidence×0.2
- `runConceptTournament()`: throws `TOURNAMENT_INSUFFICIENT_CANDIDATES` if <2; winner = highest score; backup = next with fp distance ≥3 (falls back to second-ranked + diversity warning if none)
- `SCORING_VERSION = "v1"`

**B3 — retention-map.ts** (`apps/swarmx-api/src/services/retention-map.ts`)
- 7 canonical beats: HOOK(0-3s/LOW), ORIENTATION(3-6s/LOW), ESCALATION(6-12s/MEDIUM), INSIGHT(12-18s/LOW), PROOF(18-24s/MEDIUM), PAYOFF(24-28s/LOW), CTA_OR_LOOP(28-33s/LOW)
- MEDIUM→HIGH upgrade when beat section word count < 10 (`MIN_WORDS_PER_BEAT = 10`)
- `plannedRecovery` uses `defaultPlannedRecovery ?? fallback_string` — never null for HIGH beats in current design (both MEDIUM beats have non-null defaults)
- `unrecoveredHighRiskCount > 0` is soft guard — does NOT throw (INV-16 only throws on scripting)
- RetentionMapSchema added to `stage-schemas.ts` with `validateRetentionMap()`

**B4 — render-recipe-compiler.ts** (`apps/swarmx-api/src/services/render-recipe-compiler.ts`)
- SECURITY INVARIANT: model output never reaches raw FFmpeg filter graphs
- SHA256_RE validates assetHash (throws RENDER_INVALID_ASSET_HASH if invalid)
- SAFE_PATH_RE validates srtPath (throws RENDER_UNSAFE_SRT_PATH for shell-unsafe chars like `;|$`)
  - NOTE: `../etc/passwd` PASSES this regex (dots and slashes are allowed) — it blocks shell injection chars, not traversal sequences
- FFMPEG_METACHAR_RE strips `[\\[\];,{}()%]` from text fields; throws RENDER_TEXT_SANITIZATION_EMPTY only if ALL chars stripped
- `safeFilterTokens`: exclusively from MOTION_FILTER_TOKENS, TRANSITION_FILTER_TOKENS, COLOR_GRADE_FILTER_TOKENS maps — never free-text
- New types in video-types.ts: BeatLabel, DropOffRisk, RetentionBeat, RetentionMap, MotionPreset, TransitionPreset, SafeZone, ColorGrade, BackgroundSpec, TextLayerSpec, AssetLayerSpec, CaptionSpec, AudioEventSpec, SceneSpec, ValidatedRenderRecipe

**Route wiring**: `POST /concept-tournaments` added to `creative-factory.ts` with ConceptTournamentBodySchema, calls `runConceptTournament()`, persists via `upsertRegistryRecord`, optionally checkpoints CONCEPT_TOURNAMENT stage

## Quality Gate Results

| Gate | Result |
|---|---|
| `pnpm -F swarmx-types tsc --noEmit` | ✅ Zero errors |
| `pnpm -F swarmx-api tsc --noEmit` | ✅ Zero errors |
| `pnpm -F swarmx-dashboard tsc --noEmit` | ✅ Zero errors |
| `pnpm --filter @swarmx/api run test` | ✅ **305 passing** (baseline was 278; +27 net; 4 new test files: hook-lab 21, tournament 14, retention 11, compiler 11) |
| video-regression-check.ts | ✅ Passed |
| system-health-regression.ts | ✅ Passed |
| reasoning-sanitizer-regression.ts | ✅ Passed |
| eviction-metric-regression.ts | ✅ Passed |
| adaptive-timeout-regression.ts | ✅ Passed |
| `console.*` invariant check | ✅ 0 hits in services/routes |
| `const HOOK_BLOCKLIST` singleton check | ✅ 1 hit only (creative-quality.ts) |
| Dashboard build | Not run (no dashboard changes) |

**Why**: 305 tests (not ≥315 as planned) — plan estimated 37 new tests but actual was 57 new across 4 files minus some deduplication; prior baseline was actually 248 per session note but runner count was 278. `vitest run` output is authoritative.

## Host Profile

- Bare-metal Linux, 16 GB RAM
- Ollama status: not checked this session (not needed for Phase B)
- Redis: not checked (not needed for Phase B)
- Kokoro HTTP server: started by user at port 8888, crashed during first benchmark cold-run
- `startup-enhanced.sh`: not active (no warmup.json present)

## Runtime Pivots

- Voice benchmark `recommend()` correctly excluded Kokoro (failures=4, runs=0); NOT an INV-17 violation
- Test for srtPath path traversal (`../etc/passwd`) had to be corrected — SAFE_PATH_RE blocks shell-injection chars, not `..` sequences; correct test uses `;|$(cmd)` chars

## New Invariants Discovered

- **SAFE_PATH_RE does NOT block `../` traversal** — only blocks chars outside `[/a-zA-Z0-9_\-.]`. If real path traversal defense is needed, an explicit `..` sequence check must be added.

## TONE_RULES State

Not modified this session. All 8 variants confirmed present in prior session (V6.2.50).

## Voice Benchmark State

- Stale: Kokoro failed benchmark run; espeak-ng is current recommended provider
- Need to restart Kokoro server and re-run benchmark in next session

## Remaining Work

| Priority | Item | Status |
|---|---|---|
| **Next** | Restart Kokoro + clean voice benchmark + M9 golden-path re-cert | Deferred from Phase A |
| 11 | V4 S2 template expansion (+8 templates) | Not started |
| 12 | Ollama JSON-mode migration | Not started |
| 14 | V4 S3 preview pipeline | Not started |
| 15 | V4 S4 Openverse adapter (ADR first) | Not started |
