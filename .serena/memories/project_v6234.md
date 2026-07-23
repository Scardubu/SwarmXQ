---
name: project_v6234
description: V6.2.31 commit (de23e8e) — Series Engine V2.1: SOLO FORMAT, LOOP_BRIDGE, DialogueNote, modular pass architecture
metadata:
  type: project
---

## Shipped

- Commit `de23e8e` — `feat(series): V6.2.31 — Series Engine V2.1: SOLO FORMAT, LOOP_BRIDGE, DialogueNote, modular passes`
- 14 files changed, +974 / -207
- Note: session memory filed as project_v6234 due to version drift (project_v6231 was already occupied by Priority 5 content)

## V2.1 Gap Fills (4 items)

### 1. SOLO FORMAT
- `SeriesBrief.soloFormat?: boolean` — narrator-only series flag
- When `true`: Pass 1 sets `characterBible: []`; all Pass B scene prompts use "narrator only — no on-camera characters"
- Dashboard: `SeriesWizardForm.tsx` — solo format checkbox added in Step 2 (after recurringSymbols); uses conditional spread to satisfy `exactOptionalPropertyTypes`

### 2. sceneLabel (computed, NOT LLM-generated)
- `ScenePromptSuite.sceneLabel: string` — required field; format `"SCENE [${episodeNumber}.${sceneIndex}]"`
- NOT in `ScenePromptSuiteSchema` — LLM does not generate it; computed post-Parse-B via `.map()`
- Dashboard: `ScenePromptViewer.tsx` header changed from `Scene {sceneIndex + 1}` → `{scene.sceneLabel}`

### 3. LOOP_BRIDGE transition type
- Added `"LOOP_BRIDGE"` to `transitionBridge.type` union in `EpisodeScript`
- Quality gate (Pass D scoring): enforces LOOP_BRIDGE for finale (episode N); rejects it for episodes 1..N-1
- Dashboard: `EpisodeScriptPanel.tsx` — `isLoop` flag; finale gets amber badge with `<RotateCcw>` + "Loop Bridge — Finale"

### 4. Structured DialogueNote
- `DialogueNote` interface: `{ characterName, emotion, subtext, deliveryInstruction, transitionType }`
- Replaces `string[]` in `AudioPlan.dialogueNotes?: DialogueNote[]`
- `buildContinuityReport()` updated: `note.characterName.toLowerCase() === nameLower` (was `note.toLowerCase().includes(nameLower)`)
- Dashboard: `AudioPlanPanel.tsx` — "Dialogue Notes (N)" section renders per-character structured cards with MessageSquare icon

## Modular Pass Architecture

### video-series-planner.ts (series planning)
4 named exports + thin orchestrator:
- `runPass1WorldBuilder(seriesId)` → `Promise<boolean>`
- `runPass2RoadmapBuilder(seriesId)` → `Promise<boolean>`
- `runPass3ViralityArc(seriesId)` → `Promise<void>`
- `runPass4CinematicLock(seriesId)` → `Promise<void>`
- `planSeries(seriesId)` — thin orchestrator calling the 4 in sequence

### video-episode-preproducer.ts (episode pre-production)
4 named exports + thin orchestrator:
- `runPassAScript(seriesId, episodeNumber)` → `Promise<boolean>`
- `runPassBPrompts(seriesId, episodeNumber)` → `Promise<boolean>` (computes sceneLabel via `.map()` post-parse)
- `runPassCAudioAssets(seriesId, episodeNumber)` → `Promise<boolean>`
- `runPassDScoring(seriesId, episodeNumber)` → `Promise<void>`
- `runEpisodePreProduction(seriesId, episodeNumber)` — thin orchestrator

Each pass function: reads prerequisites from registry at call time (safe for re-runs), own AbortController, calls `updateSeriesPassStatus` / `updateEpisodePassStatus` on enter/exit.

### series-registry.ts
Added `updateSeriesPassStatus(id, pass, status)` and `updateEpisodePassStatus(id, episodeNumber, pass, status)`.

### series.ts routes (2 new endpoints, both behind requireVideoWriteAuth)
- `POST /:id/rerun-pass/:pass` — rerun a series planning pass (1..4); 409 if any pass is already running
- `POST /:id/episodes/:n/rerun-pass/:pass` — rerun an episode pass (a..d); 409 if any pass running; 202 on accept (fire-and-forget)

### Dashboard additions
- `PassStatusRow.tsx` (NEW) — 4-dot status row (A/B/C/D) with color-coded dots, status text, Regenerate buttons (RotateCcw) for complete/failed passes when no rerun is in progress
- `SeriesContextPanel.tsx` — planning pass status strip (4 dots for pass1..pass4) added at top
- `stores/series.ts` — `rerunSeriesPass` and `rerunEpisodePass` Zustand actions
- `episodes/[episodeNumber]/page.tsx` — `rerunningPass` state, `handleRerunPass` callback, `PassStatusRow` rendered when `preProduction.passStatus` is present

### series-regression.ts (Section 5 — 16 new assertions)
- Modular export presence checks (8 pass functions across 2 files)
- Type field presence (soloFormat, sceneLabel, LOOP_BRIDGE, DialogueNote)
- LOOP_BRIDGE gate (3 cases: finale+LB passes, finale+VISUAL_MATCH fails, non-finale+LB fails)
- sceneLabel format assertion

## Quality Gate Results

| Gate | Result |
|------|--------|
| @swarmx/types tsc | ✅ PASS (0 errors) |
| @swarmx/api tsc | ✅ PASS (0 errors) |
| @swarmx/dashboard tsc | ✅ PASS (0 errors) |
| dashboard vitest | ✅ PASS (52/52) |
| api vitest | ✅ PASS (58/58) |
| series-regression.ts (36 assertions) | ✅ PASS |
| video-regression-check.ts | ✅ PASS |
| adaptive-timeout-regression.ts | ✅ PASS |
| eviction-metric-regression.ts | ✅ PASS |
| system-health-regression.ts | ✅ PASS |
| reasoning-sanitizer-regression.ts | ✅ PASS |
| next build | ✅ PASS (14 routes, 0 errors) |
| console.* audit | ✅ PASS (0 hits) |
| TONE_RULES all 8 variants | ✅ PASS |

## Host Profile

- RAM: 16 GB (HP EliteBook 850 G3 · CPU-only · WSL2)
- Ollama: OFFLINE (no LLM calls needed — pure type/service/UI work)
- Redis: OFFLINE
- startup-enhanced.sh: NOT RUN

## TONE_RULES State

All 8 variants confirmed: contrarian ✅ urgent ✅ educational ✅ cinematic ✅ warm ✅ minimal ✅ faceless_broll ✅ kinetic_text ✅

## New Invariants

- `sceneLabel` is ALWAYS computed post-Parse-B via `.map()` — never generated by the LLM. `ScenePromptSuiteSchema` intentionally excludes it.
- LOOP_BRIDGE must appear ONLY on the finale episode (episode N). Quality gate enforces both sides: presence on N and absence on 1..N-1.
- Each modular pass function reads prerequisites from the registry at call time — never from parameters passed by the orchestrator. This enables safe independent reruns.
- `dialogueNotes` continuity check uses `note.characterName` (DialogueNote field), not string `.includes()`.

## Remaining Work (Next Session)

- Activate OTel SDK: add `@opentelemetry/sdk-node` + `exporter-trace-otlp-http`; wire `NodeSDK.start()` before server.ts
- Python brain: `print()` / `logging.basicConfig()` → `structlog` in `src/swarmx/`
- WSL2 vs bare-metal thread count auto-detection in `startup-enhanced.sh`
- Agent idempotency audit
- API unit tests for series routes (series planning pipeline, pre-production endpoints)
- `rerunSeriesPass` UI on series detail page (currently only episode page has Regenerate buttons; series passes 3/4 are non-destructive)
