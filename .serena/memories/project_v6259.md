---
name: project_v6259
description: V6.2.59 - retry ceiling 3 with backoff scheduling, dead-letter error history, client/operator disclosure mode + always-visible mode badge, dashboard failed-job triage
metadata:
  type: project
---

# SwarmXQ Project Memory - V6.2.59

## Session Date

2026-08-03

## Shipped

### Backend reliability (video pipeline)

- Raised `SWARMX_VIDEO_MAX_RETRIES` default from `2` to `3`.
- Added exponential backoff + jitter retry scheduling: `computeRetryDelayMs()`
  in `video-orchestrator.ts` derives `SWARMX_VIDEO_RETRY_BASE_DELAY_MS * 2^retryCount`
  (default base 5000ms), jittered by `SWARMX_VIDEO_RETRY_JITTER_MS` (default
  1000ms), capped at `SWARMX_VIDEO_RETRY_MAX_DELAY_MS` (default 30000ms).
- Added `queue.setRetrySchedule(id, delayMs)` in `video-queue.ts`: persists
  `job.nextRetryAt` / `job.nextRetryDelayMs` on queued retries; cleared on
  `startJob()`, `completeJob()`, `cancelJob()`.
- Added `appendErrorHistory()` — every `failJob()` call (retryable or
  terminal) appends a capped (25-entry) record to `job.errorLog` for
  dead-letter triage.
- Added `job.preliminaryHookScore` set immediately after scripting completes
  (pre virality-scoring confidence signal), cleared once `viralitySignal` is
  available.
- `makeVideoFailedEvent()` extended with an optional `extra` payload merging
  `errorLog`, `maxRetries`, `nextRetryAt`, `nextRetryDelayMs` into the SSE
  `video:failed` event data.

### Dashboard UX

- `VideoJobCard.tsx` / `VideoJobTimeline.tsx`: dynamic `retry {n}/{maxRetries}`
  (was hardcoded `/2`), next-scheduled-retry time display, preliminary hook
  confidence chip.
- `/video` queue page: "Failed (`n`)" filter toggle, advisory banner when
  failed jobs exist and filter is inactive, empty-state copy.
- Client/operator disclosure mode: `useUIStore.operatorViewMode`
  (`"client" | "operator"`, default `"client"`) gates the Operator Trace
  table (`/video/[id]`) and per-operator token-ceiling chips
  (`TelemetryRail` Governor section). Toggle via CommandBar button, command
  palette ("Toggle Operator View"), or global shortcut `⌘⇧O`.
- Added `DisclosureModeBadge` (`components/ui/disclosure-mode-badge.tsx`) —
  small always-visible pill (uses existing `Badge` `throttled`/`idle`
  variants) placed next to the Telemetry rail header and the Operator Trace
  section header so a hidden section is never mistaken for missing data.
  Restructured the Operator Trace block so the header + badge always render;
  only the table body is gated, with a "Hidden in client view… ⌘⇧O" fallback
  message instead of the whole section disappearing.

### Documentation

- `docs/CONFIG_REFERENCE.md`: corrected `SWARMX_VIDEO_MAX_RETRIES` default
  (2→3) and documented the three new retry-backoff env vars.
- `docs/VIDEO-GENERATION.md`: replaced stale `VIDEO_MAX_RETRIES` reference
  with the canonical name + backoff/error-log behavior; added "Dead-letter
  triage" and "Client / operator disclosure mode" subsections under
  Dashboard integration.

## Quality Gates

- `pnpm --filter @swarmx/types typecheck` — passed, zero errors.
- `pnpm --filter @swarmx/api typecheck` — passed, zero errors.
- `pnpm --filter @swarmx/api test` — 345 passed (345), 22 test files.
- `pnpm --filter @swarmx/dashboard typecheck` — passed, zero errors.
- `pnpm --filter @swarmx/dashboard test` — 58 passed (58), 6 test files.
- `pnpm --filter @swarmx/dashboard build` — Turbopack build succeeded, 14
  routes generated, zero errors.
- `npx tsx apps/swarmx-api/scripts/video-regression-check.ts` — **skipped**;
  hung waiting on live Ollama/Redis, neither running in this session's
  environment. Not re-attempted after kill; no code path touched by this
  session's changes should affect that script's assertions (retry/backoff
  logic is already covered by `video-queue.test.ts`).

## Host profile

- Session ran without a live Ollama/Redis instance; only static
  typecheck/vitest/build gates were exercised. `startup-enhanced.sh` was not
  invoked this session (no live pipeline run needed for these changes).

## Runtime pivots

- None — scope stayed within the previously-approved gaps-only backend/UI
  plan (retry ceiling, dead-letter history, disclosure mode) plus the two
  explicit follow-ups requested by the user (dashboard test/build
  verification, always-visible disclosure badge) and a documentation
  reconciliation pass.

## New invariants discovered

- None new. Reaffirmed existing pattern: any optional field typed
  `T | undefined` under `exactOptionalPropertyTypes: true` must be added via
  conditional spread (`...(v !== undefined ? { k: v } : {})`), never direct
  assignment — required again here for the `video:failed` `extra` payload and
  dashboard `normalizeVideoJob()`.

## TONE_RULES state

- Unchanged this session; all 8 variants (`contrarian`, `urgent`,
  `educational`, `cinematic`, `warm`, `minimal`, `faceless_broll`,
  `kinetic_text`) still present in `video-orchestrator.ts` (not touched).

## Voice benchmark state

- Not re-run this session (no TTS provider changes). Last known state per
  `project_v6255.md`: refreshed, Kokoro recommended.

## Remaining work / next session starting point

- Commit and push this session's 19 changed files (18 modified + 1 new:
  `components/ui/disclosure-mode-badge.tsx`) — pending explicit user
  confirmation before `git push`.
- Milestone queue unchanged: next is **Priority 13 — S5: Golden-Path
  Re-Cert** per `CLAUDE.md`.
- Optional follow-up (not started, low priority): consider adding the same
  `DisclosureModeBadge` next to the Governor `SectionLabel` specifically
  (currently only at the rail's top-level Telemetry header) if user feedback
  indicates the top-level badge isn't discoverable enough when scrolled past.
