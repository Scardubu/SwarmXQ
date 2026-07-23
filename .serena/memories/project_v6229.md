---
name: project_v6229
description: V6.2.29 session — Priority 3 Env Schema Expansion complete; 142 → 6 process.env reads in services/routes
metadata:
  type: project
---

## Shipped

- Commit `e1f211e` — `refactor(env): Priority 3 — Env Schema Expansion`
- 33 files changed, 325 insertions, 366 deletions
- Priority 3 milestone complete

## What was done

Migrated all `process.env[` reads in `apps/swarmx-api/src/services/` and `src/routes/`
to the centralized Zod schema in `src/lib/env.ts`.

**Before:** 142 hits  
**After:** 6 intentional escape hatches

### 6 remaining escape hatches (by design)

| File | Key | Reason |
|---|---|---|
| `services/video-auth.ts:3` | `SWARMX_VIDEO_API_TOKEN` | Write-auth secret |
| `services/publishers/tiktok.ts:51` | `SWARMX_TIKTOK_ACCESS_TOKEN` | OAuth secret |
| `services/publishers/instagram.ts:31` | `SWARMX_INSTAGRAM_ACCESS_TOKEN` | OAuth secret |
| `services/v5metrics.ts:55` | `PYTHONPATH` | OS system path var |
| `services/video-runtime-config.ts:106` | `process.env[envName]` | Dynamic parametric (stage timeout override) |
| `services/video-runtime-config.ts:131` | `process.env[TEXT_STAGE_MODEL_ENV[stage]]` | Dynamic parametric (stage model override) |

### env.ts expansion

- 18 → ~80 vars across 13 groups
- Alias chain resolution for SWARM_* legacy prefixes via `z.preprocess()`
- Computed path defaults: SWARMX_HOME, SWARMX_REPO_ROOT, SWARMX_WORKFLOWS_DIR, SWARMX_VIDEO_TEMP_DIR
- Bounds-clamping transforms (not min/max validation) for health probe timeouts — preserves original readBoundedTimeoutMs() behavior
- `resetEnvForTesting()` export (already existed) wired into regression scripts

### Key fixes during implementation

1. `ollama.ts:filter(Boolean)` — needs `(m): m is string => Boolean(m)` for strict TypeScript
2. `video-cleanup.ts` — `join` was removed from import accidentally; restored
3. `loadEnv()` singleton cache broke regression tests that mutate process.env:
   - `video-regression-check.ts` and `system-health-regression.ts` updated to call `resetEnvForTesting()` before each env mutation
4. `SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS` — changed from `.min(250)` (throws) to `.transform(clamp)` to match original clamping behavior

### CI invariant activated

`.github/workflows/ci.yml` — previously commented out TODO block for process.env check now active:
```
grep -rn 'process.env[' services routes → ≤10 enforced in CI
```

## Quality gate results

| Gate | Result |
|---|---|
| `@swarmx/types typecheck` | PASS |
| `@swarmx/api typecheck` | PASS |
| `@swarmx/dashboard typecheck` | PASS |
| `@swarmx/dashboard vitest` | PASS (52/52) |
| `test:video` (video-regression-check.ts) | PASS |
| `test:regression` (5 scripts) | PASS |
| `@swarmx/dashboard next build` | PASS |
| `git diff --check` | PASS |
| `console.*` invariant | PASS (0 hits) |
| `TONE_RULES completeness` | PASS (8 variants) |
| `process.env[` invariant | PASS (6 hits) |

## Host profile

- RAM: 16 GB (HP EliteBook 850 G3 · CPU-only · WSL2)
- Ollama: OFFLINE (not needed for Priority 3)
- Redis: OFFLINE (not needed for Priority 3)

## Remaining work (next session starting point)

Priority 4 — First API Unit Tests:
- `video-queue.ts` state machine tests
- `reasoning-sanitizer.ts` fixture tests
- Pure helper functions
- Target: ≥30 new tests, >60% coverage on 4 modules
- Need: create `apps/swarmx-api/vitest.config.ts` first
- Unlocks Gate 5 in ci.yml (currently commented as TODO Priority 4)
