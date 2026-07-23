# V6.2.47 — Script Quality Bleed Fix + Creative Factory UI Polish

**Date:** 2026-07-23
**Baseline:** V6.2.46 (commit d128f02)

## Shipped

Two coordinated commits produced by this session:

1. **`fix(creative): restructure scripting prompt to prevent phi4-lite instruction bleed`** (ee685f2)
   - `apps/swarmx-api/src/services/video-orchestrator.ts` — added `HOOK_BLOCKLIST` (13 entries), `validateScriptSections()` (soft-warning), refactored `buildScriptingPrompt()` into `WRITING RULES` preamble + clean 4-marker output template.

2. **`feat(ux): Creative Factory panel polish + surface script quality warnings end-to-end`** (this session)
   - `packages/swarmx-types/src/video-types.ts` — added `ScriptQualityWarningCode`, `ScriptQualityWarning`, `VideoJob.scriptQualityWarnings?`
   - `apps/swarmx-api/src/types/video.ts` — mirrored on API bridge; re-export
   - `apps/swarmx-api/src/services/video-orchestrator.ts` — `validateScriptSections()` now returns warnings; `stageScripting()` persists them on `ctx.job.scriptQualityWarnings`
   - `apps/swarmx-dashboard/src/lib/video-dashboard.ts` — bridge type + normalizer pass-through
   - `apps/swarmx-dashboard/src/components/series/CreativeFactoryPanel.tsx` — Zustand scalar selectors (P0 tearing fix), `ListSkeleton` for 3 tabs, responsive Runs split-pane (sm breakpoint + sticky headers + `max-h-[420px]` scroll), `focus-visible:ring-1` on RunRow, `aria-current="step"` on active checkpoint inside semantic `<ol>`
   - `apps/swarmx-dashboard/src/components/video/VideoJobCard.tsx` — script-quality warning badge (top 3 messages + overflow count)

## Quality gates — ALL GREEN

| Gate | Result |
|------|--------|
| Gate 1 — swarmx-types tsc | ✅ 0 errors |
| Gate 2 — swarmx-api tsc | ✅ 0 errors |
| Gate 3 — swarmx-dashboard tsc | ✅ 0 errors |
| Gate 4 — dashboard vitest | ✅ 52/52 |
| Gate 4.5 — api vitest | ✅ 177/177 |
| Gate 5 — 5 regression scripts | ✅ all pass |
| Gate 7 — creative-factory-invariant | ✅ passed |
| Gate 6 — dashboard next build | ✅ 15 routes |
| Gate 8 — whitespace | ✅ 0 violations |
| `console.*` invariant | ✅ 0 hits in services/routes |

## Host profile at session start

- RAM available: ~7.8 GB
- Redis: ONLINE (PONG)
- Ollama: v0.22.0 ONLINE at 127.0.0.1:11434
- Warmup marker: cold-start ETA 140s (not yet completed at kickoff)
- `startup-enhanced.sh`: prior session

## Runtime pivots

- Original scope from user was broad ("thoroughly analyze… UX/UI polishes and quick wins"). Scoped down to the 5 concrete quick wins the audit surfaced rather than speculative rewrites, per the SCAR-X "make the smallest change that closes the real gap" directive.
- Discovered the Zustand v5 tearing pattern (object selector) in the just-committed Creative Factory panel — promoted to P0 fix rather than deferring. This is the same class of bug documented in `feedback_zustand_selector_pattern.md`.
- The V6.2.46 audit reported "warnings field missing on VideoJob" — I closed it end-to-end (canonical type → API bridge → orchestrator emission → dashboard normalizer → VideoJobCard render) rather than stopping at just the type addition.

## New invariants discovered

- **Zustand v5 object selectors in newly-authored panels**: the just-shipped Creative Factory panel had the bug — this suggests reviewers didn't catch it. Consider adding a lint rule or grep gate on `useCreativeFactoryStore\(\(.*\) =>\s*\({`.
- **`scriptQualityWarnings` field must be normalized in raw-job pass-through**: dashboard bridge normalizer would drop unknown fields; I added the conditional spread `...(raw.scriptQualityWarnings ? { scriptQualityWarnings: raw.scriptQualityWarnings } : {})` to preserve them.

## TONE_RULES state

Confirmed still contains all 8 variants — untouched this session.

## Creative Factory state

- Last golden artifact tier: unchanged (still `TECHNICALLY_VALID` per V6.2.46 note — requires live services to reach `READY_TO_POST`)
- New surface: users can now see when their scripts hit soft-quality gates (hook blocklist, instruction bleed) without needing to trawl logs

## Remaining work (unchanged from V6.2.46)

1. **LOCAL_PRODUCTION_VALIDATED** — needs live API + dashboard restart + golden-path recovery verification
2. **OTel spans** — `acquireModel()` acquisition latency spans still missing
3. **ComfyUI integration** — when available on host
4. **Audio quality gate** — FFprobe silence/clipping check in `certifyProductionPack()`

## Files changed count

7 files (2 canonical/bridge types, 1 orchestrator service, 1 dashboard normalizer, 2 dashboard components, 1 CHANGELOG)
