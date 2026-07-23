# V6.2.50 — SCAR-X V5.0.0 P1 hygiene bundle

**Date:** 2026-07-23
**Baseline:** V6.2.49 (c312488) — smoke ceiling + per-stage Zod + voice benchmark (S1)
**Directive:** SCAR-X V5.0.0 Constitution, first-slice P1 hygiene bundle

## Shipped (6 commits)

- `d0344d2 docs: land V5.0.0 framework + fix test count drift` — Committed the +457-line CLAUDE.md rewrite that had been sitting uncommitted: IEP-ELITE meta-protocol, BLOCK/ESCALATE/PROCEED taxonomy, INV-18 (lateral cert-tier write-protection), FREE TOOL INTEGRATION REGISTRY (Kokoro/Piper/whisper.cpp/Openverse), V4 S2–S5 milestones, doctor CLI + JSON-mode milestones.
- `5e6e15f refactor(creative): consolidate HOOK_BLOCKLIST into shared module` — New `apps/swarmx-api/src/lib/creative-quality.ts` unifies HOOK_BLOCKLIST (21 phrases, union of both historical lists, deduped case-insensitively, alphabetized). Two helpers: `findHookBlocklistViolations()` (orchestrator, returns all matches) + `matchesHookBlocklistPrefix()` (preproducer, returns first match). Both consumers refactored to import from the shared module; local definitions deleted.
- `70a471d feat(workflow): add QUICK_DRAFT execution mode` — Sixth Creative Factory execution mode. Widened `CreativeFactoryExecutionMode` in `@swarmx/types`; added `"QUICK_DRAFT"` to Zod route enums; extended `requiredModesFor()` to include it through `ASSET_PLAN` only (excluded from `ASSET_GENERATE_OR_IMPORT` onward). New `MODE_CERT_CEILING` map + `getModeCertificationCeiling()` — QUICK_DRAFT tops out at TECHNICALLY_VALID.
- `4c5f116 feat(cert): INV-18 transition functions for lateral cert tiers` — Four new exports in `renderer-certification.ts`: `transitionToPublishing`, `transitionToPublishFailed`, `transitionToBlocked` (reason required), `transitionToNeedsRevision` (failedDomain required + current >= CREATIVE_REVIEW_REQUIRED). Return `{ok: true} | {ok: false, reason}`; emit `CERT_TIER_TRANSITION` / `CERT_TIER_TRANSITION_REJECTED` structured log lines. Design decision: PUBLISH_FAILED / BLOCKED / NEEDS_REVISION intentionally stay OFF `SUCCESS_CHAIN_RANK` — they are off-ladder lateral moves; modeling them as ranks would corrupt `clampCertificationTier()` semantics. New `LATERAL_TERMINAL_TIERS` set gates blocking transitions.
- `0183075 feat(ops): scaffold doctor CLI for host preflight` — New `apps/swarmx-api/scripts/doctor.ts` runnable via `pnpm -F @swarmx/api exec tsx scripts/doctor.ts`. Six checks (env, redis, ollama, ram, voice-binaries, voice-benchmark), each returns `{name, ok, detail}`. Exits 0 clean / 1 on failure with structured log. Uses scoped `IORedis(lazyConnect)` for the redis check — the "no direct ioredis" rule is intentionally scoped to `src/services/`, not one-shot CLIs; commented in-file.
- `96e240d docs: correct baseline test count from grep estimate to vitest runner count` — My original 228→225 change was based on a `grep 'test('` count that undercounts `test.each`/`describe.each` runs. The vitest runner is authoritative: V6.2.49 baseline is 228, V6.2.50 (end of session) is 248.

## Quality gate results (all green)

- `pnpm -F @swarmx/types tsc --noEmit` → exit 0
- `pnpm -F @swarmx/api tsc --noEmit` → exit 0
- `pnpm -F @swarmx/dashboard tsc --noEmit` → exit 0
- `pnpm -F @swarmx/api vitest run` → **248 passed / 14 test files** (+20 from V6.2.49 baseline of 228)
  - +3 quick-draft-mode.test.ts
  - +14 renderer-certification.test.ts (INV-18 transitions describe block)
  - +3 doctor-script.test.ts
- `pnpm -F @swarmx/dashboard vitest run` → 52 passed / 4 test files (unchanged)
- All 5 CLAUDE.md release-gate regression scripts exit 0:
  - `adaptive-timeout-regression.ts` — PASS
  - `video-regression-check.ts` — PASS
  - `eviction-metric-regression.ts` — PASS
  - `system-health-regression.ts` — PASS
  - `reasoning-sanitizer-regression.ts` — PASS
- `creative-factory-invariant.ts` — PASS (verified QUICK_DRAFT accepted)
- `doctor.ts` smoke run on live host — env/redis/ollama/ram pass; voice-binaries/voice-benchmark fail as expected (Piper/Kokoro not installed on this host); exit 1 correctly signals unhealthy state.
- Invariant greps:
  - `console.*` in services/routes → 0 hits
  - Direct `certificationTier =` assignments outside `clampCertificationTier` / `canPromoteTo` / transitions / MODE_CERT_CEILING / CERTIFICATION_CEILING → 0 hits
  - V5 operator names (SENTINEL/CANVAS/LEDGER/PROPHET/EVOLVER) → 0 hits
  - TONE_RULES entries → all 8 present
- Skipped: `pnpm -F @swarmx/dashboard next build` (dashboard code unchanged this session — dashboard tsc passed cleanly, next build outcome would be identical to V6.2.49's 14 routes).

## Host profile

- MemAvailable at session end: 10704 MB
- Runtime: bare-metal Linux (not WSL2) — `OLLAMA_NUM_THREADS=4` correct
- Ollama online (localhost:11434, 0 models loaded during session)
- Redis online (localhost:6379, responds PONG)
- Piper / Kokoro not installed (voice-binaries doctor check fails)
- Voice benchmark report not present (voice-benchmark doctor check fails)

## Runtime pivots

- The Explore-agent baseline test count of 225 was based on `grep -E 'test\('` which undercounts `test.each`/`describe.each` — the vitest runner reports 228. I ran with 225 through Commits A → E, then landed Commit F to correct CLAUDE.md to the true baseline (228 at V6.2.49) and update the release gate to the new baseline (248 at V6.2.50). Future sessions: trust `vitest run` counts, not grep estimates.
- HOOK_BLOCKLIST orchestrator uses full-text `.filter((p) => hookContent.toLowerCase().startsWith(p.toLowerCase().trimEnd()))` and preproducer uses `.find((p) => hookLower.startsWith(p))` — semantics are identical (both startsWith on lowercased+trimmed hook), only difference is all-matches vs first-match. The shared module models this as `findHookBlocklistViolations()` + `matchesHookBlocklistPrefix()` — the latter delegates to the former.

## New invariants active

- **INV-18 lateral transitions (now with enforcement primitives)**: `PUBLISHING`, `PUBLISH_FAILED`, `BLOCKED`, `NEEDS_REVISION` writes must go through `transitionTo*()` functions in `renderer-certification.ts`. Enforcement is convention-only (a lint rule is a future P2 item); the grep gate `grep -rn 'certificationTier\s*=' apps/swarmx-api/src/services | grep -v 'transitionTo\|clamp...'` catches drift. `LATERAL_TERMINAL_TIERS` set is authoritative for what "cannot be blocked from" (PUBLISHED_VERIFIED, PUBLISH_FAILED, BLOCKED, RENDER_FAILED).
- **QUICK_DRAFT ceiling**: `MODE_CERT_CEILING["QUICK_DRAFT"] = "TECHNICALLY_VALID"` — QUICK_DRAFT must never produce a `PRODUCTION_PACK_VALID` or higher artifact. Callers compose with renderer ceiling via min-rank.
- **Shared HOOK_BLOCKLIST**: `apps/swarmx-api/src/lib/creative-quality.ts` is now the single source of truth. Any new hook-quality helper (variant scoring, family classification, etc.) belongs there, not in the orchestrator or preproducer files.

## TONE_RULES state

All 8 tone variants confirmed present in `apps/swarmx-api/src/services/video-orchestrator.ts` TONE_RULES block: contrarian, urgent, educational, cinematic, warm, minimal, faceless_broll, kinetic_text. Untouched this session.

## Voice benchmark state

Not yet run against real neural providers (Piper and Kokoro not installed on this host). Doctor CLI reports `voice-benchmark: no benchmark report found`. This is the next opportunity when Piper/Kokoro get installed.

## Remaining V5.0.0 P1/P2 work (deferred to future sessions, in priority order)

1. **Hook laboratory** — 5–12 candidates per hook family, payoff-alignment check (P1, M4)
2. **RetentionMap + RetentionBeat types** — time-coded drop-off risk, planned recovery, wired into `stageValidationTrace` (P1, M4)
3. **Concept tournament diversity scoring** — cosine similarity + structural fingerprint, winner + backup with lineage (P1, M4)
4. **Two-pass EBU R128 loudnorm** — current is single-pass; upgrade for tighter LUFS convergence (P1)
5. **Scene composition DSL** — declarative `SceneSpec` compiled to validated FFmpeg args; model output never touches raw filter graphs (P1)
6. **Template-aware visual QC** — kinetic_text intentional black frames vs corruption; faceless_broll static b-roll vs freeze (P1)
7. **Doctor CLI expansion** — dashboard-visible health surface, `--json` output mode, remediation hints (P2)
8. **QUICK_DRAFT full workflow** — actually route through storyboard preview + voice preview + watermarked proxy stages (currently just the enum entry)
9. **whisper.cpp SCRIPT_DRIFT check** — post-render WER comparison against source script (P3)
10. **Openverse adapter (ADR required first)** — CC0/CC-BY search with AssetLicense metadata (P3, M15)

## Next session starting point

Next milestone from CLAUDE.md queue is Milestone 9 (S5 golden-path re-cert). That milestone depends on:
- A production renderer working end-to-end on this host (kinetic_text or faceless_broll)
- Voice benchmark real-provider run (needs Piper/Kokoro installed first)

Practical next step: **install Piper + Kokoro locally → run voice benchmark → then attempt end-to-end kinetic_text render**. The doctor CLI now surfaces exactly which of those preconditions are missing.
