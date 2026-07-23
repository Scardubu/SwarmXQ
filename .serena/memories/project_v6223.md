---
name: project_v6223
description: V6.2.23 — Series Engine V1 shipped; 3-pass LLM planning pipeline, episode roadmap, dashboard UI
metadata:
  type: project
---

# V6.2.23 Series Engine V1

**Date:** 2026-07-18  
**Commit:** ec438b8

## Shipped

- 22 files, 2 506 insertions
- `packages/swarmx-types/src/series-types.ts` — canonical type contracts (SeriesBrief, CharacterProfile, WorldRegistry, EpisodeRoadmapEntry, SeriesJob, SeriesEpisodeContext)
- `VideoTone` expanded from 6 → 8 variants: added `faceless_broll`, `kinetic_text`
- `apps/swarmx-api/src/services/series-registry.ts` — in-memory TTL store (unref'd cleanup interval, mirrors video-cleanup pattern)
- `apps/swarmx-api/src/services/video-series-planner.ts` — 3-pass async LLM pipeline (Pass 1: Pilot → character bible + world guide JSON; Pass 2: Architect → episode roadmap JSON; Pass 3: Pilot → virality arc plain text, non-fatal); Zod validation on all JSON passes
- `apps/swarmx-api/src/routes/series.ts` — 5 REST endpoints at `/api/video/series`; gated by `requireVideoWriteAuth()`
- `apps/swarmx-api/src/services/video-orchestrator.ts` — TONE_RULES completed to all 8 variants; `buildSeriesContextPreamble()` injected into scripting + storyboard prompts; `isKinetic` check extended to cover `req.tone === "kinetic_text"`
- Dashboard: Zustand series store + 5 components (SeriesWizardForm 2-step, SeriesCard, EpisodeCard, EpisodeGrid, SeriesContextPanel) + 3 pages (/series, /series/new, /series/[id]) + NavRail + breadcrumb entries

## Quality Gate Results

| Gate | Result |
|---|---|
| `@swarmx/types tsc --noEmit` | PASS |
| `@swarmx/api tsc --noEmit` | PASS |
| `@swarmx/dashboard tsc --noEmit` | PASS |
| vitest (dashboard) | 52/52 |
| video-regression-check | PASS |
| eviction-metric-regression | PASS |
| system-health-regression | PASS |
| reasoning-sanitizer-regression | PASS |
| adaptive-timeout-regression | PASS |
| next build | 13 routes, 0 errors |
| console.* in services/routes | 2 hits (both string literals in composer.ts — not real log calls) |
| TONE_RULES variants | 8 ✓ (faceless_broll + kinetic_text confirmed) |

## Host Profile

RAM: not re-checked (session was code-only, no inference). Ollama: offline. Redis: not checked.

## Bug Fixes During Implementation

- `extractJson()` returns `.data` not `.value` — fixed in `video-series-planner.ts` at lines 289 + 323
- `exactOptionalPropertyTypes: true` in dashboard tsconfig requires conditional spread for optional props — fixed in `EpisodeGrid.tsx` (jobId, jobStatus)

## New Invariants Discovered

- `ExtractJsonResult<T>` from reasoning-sanitizer uses `.data` (not `.value`, `.result`, etc.) — future LLM pipeline code must use this field

## TONE_RULES State

All 8 variants confirmed present: `contrarian`, `urgent`, `educational`, `cinematic`, `warm`, `minimal`, `faceless_broll`, `kinetic_text`

## What's Deferred to V2

- Cinematic language system (9-prompt scene generation per scene)
- Audio architecture per-episode
- Per-platform publishing assets (title, thumbnail concept, pinned comment)
- SSE stream for series-level planning progress
- Series-level virality arc dashboard panel
- Continuity drift report UI

## Remaining Milestone Queue (unchanged)

| Priority | Milestone |
|---|---|
| 2 | GitHub Actions CI |
| 3 | Env Schema Expansion (process.env[…] migration) |
| 4 | First API Unit Tests |
| 5 | 16 GB Profile Config |
