---
name: project_v6225
description: V6.2.25 shipped 2026-07-18 — Series Director spec injected as pipeline prompts across all 8 LLM passes
metadata:
  type: project
---

## Shipped
- Commit: `c48f81a`
- Version: V6.2.25
- 3 files changed, 21 insertions(+), 9 deletions(-)

## What Was Built
Surgical prompt upgrades across all 8 LLM passes in the Series Engine. No new files, no new routes.

**Pass A (Episode Script):**
- Hook-position awareness: Ep1 → PREMISE HOOK, Ep2–N-1 → CONTINUATION HOOK, EpN → PAYOFF HOOK
- [VISUAL: subject · motion · setting · mood · quality] tag guidance for body sentences
- Show-not-tell callback rule (visual echoes only, never narrative recap)

**Pass B (Scene Prompts):**
- Full shot-type vocabulary (adds MWS, aerial, POV, OTS to ECU/CU/MCU/MS/WS/EWS)
- 11 camera movement options (static, push-in, pull-back, pan-L/R, tilt-U/D, dolly, crane, handheld, Steadicam, whip-pan, Dutch-angle)
- 6 lens options (16mm-wide through macro)
- Depth-of-field options (shallow/deep/rack-focus)
- Framing rules (rule-of-thirds, centred-symmetry, negative-space, leading-lines)
- Colour temperature values (2700K-warm/4000K-neutral/6500K-cool/split-gel)

**Pass C (Audio + Platform Assets):**
- Per-character dialogue direction + audio transition types (J-cut/L-cut/musical-bridge/silence-as-tension/hard-cut)
- `AudioPlan.dialogueNotes?: string[]` added to canonical type (optional, additive)
- Zod `AudioPlanSchema` updated with `.optional()` field

**Pass 1 (Character Bible):** Series Director persona replaces generic "series bible writer"

**Pass 3 (Virality Arc):** Algorithm Signal + Recency Loop added; token budget 400 → 600

**Pass 4 (Cinematic Lock):** Full shot/movement/lens vocabulary in JSON hint

## Quality Gate Results
- @swarmx/types tsc: PASS
- @swarmx/api tsc: PASS
- @swarmx/dashboard tsc: PASS
- vitest (dashboard): 52/52 PASS
- video-regression-check: PASS
- eviction-metric-regression: PASS
- system-health-regression: PASS
- reasoning-sanitizer-regression: PASS
- adaptive-timeout-regression: PASS
- next build: 14 routes, 0 errors
- console.* in new code: 0 hits
- process.env[...] in new code: 0 hits
- VIRALITY_WEIGHTS: unchanged
- HOOK_BLOCKLIST: unchanged

## Host Profile
- RAM: not checked (offline session)
- startup-enhanced.sh: not run
- Ollama: offline
- Redis: offline

## Runtime Pivots
None. All changes were prompt text upgrades + one optional type field.

## New Invariants
None. Existing invariants all preserved.

## TONE_RULES State
8 variants confirmed present from V6.2.23. Not modified in V6.2.25.

## Remaining Work (Next Session)
- Priority 2: GitHub Actions CI (`.github/workflows/ci.yml`, 8 gates, pnpm cache, Ollama stubs)
- Priority 3: Env schema expansion (migrate remaining `process.env[...]` hits to `env.ts`)
- Priority 4: First API unit tests (video-queue state machine, reasoning-sanitizer fixtures)
- Deferred series dashboard panels (SSE planning progress, virality arc panel, continuity drift report)
- Smoke test V6.2.25: create series → "Prepare Episode" → verify richer prompt output in pre-production data
