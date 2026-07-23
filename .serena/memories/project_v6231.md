---
name: project_v6231
description: V6.2.31 — Priority 5 complete; 16 GB Profile Config — dual-resident Pilot, warmup marker, RAM gate
metadata:
  type: project
---

## Shipped

- Commit `473272a` — `feat(startup): Priority 5 — 16 GB Profile Config`
- 6 files changed, 72 insertions(+), 15 deletions(-)
- Priority 5 milestone complete

## Changes

### `scripts/startup-enhanced.sh`
- **OLLAMA_NUM_THREADS**: Auto-detected — WSL2 → 3, bare-metal → 4 (via `grep -qi microsoft /proc/version`)
- **OLLAMA_KEEP_ALIVE**: Fixed from `"2m"` → `"0"` for 16 GB profile (global evict-after-run policy)
- **OLLAMA_KEEP_ALIVE_PILOT_S=300**: New export for 16 GB profile — used by model-orchestrator per-request keep_alive for Pilot
- **Warmup marker write**: Writes `{"done":false,"startedAt":"..."}` to `$SWARMX_WARMUP_STATUS_FILE` after tuning; server.ts overwrites with `{"done":true,...}` on prewarm completion
- **RAM gate**: Before delegating to swarm-up.sh, checks available RAM ≥ 6170 MB on 16 GB profile (8 GB path bypasses gate); exits 1 with actionable message if below threshold

### `apps/swarmx-api/src/lib/env.ts`
- Added `OLLAMA_KEEP_ALIVE_PILOT_S: z.coerce.number().int().min(0).default(300)` in Ollama section

### `apps/swarmx-api/src/services/video-runtime-config.ts`
- Exported `PILOT_VIDEO_MODEL = "instruct-phi4-pro-q8-prod"` constant (mirrors LOW_RAM_VIDEO_MODEL pattern)

### `apps/swarmx-api/src/services/model-orchestrator.ts`
- `_keepAliveFor()`: Pilot models (`instruct-phi4-pro-q8-prod` + `instruct-phi4-lite-q4km-prod`) now return `${OLLAMA_KEEP_ALIVE_PILOT_S}s` in non-degraded modes, enabling dual-resident strategy without the previous 30 s eviction cycle

### `apps/swarmx-api/src/server.ts`
- Prewarm condition: `if (isLowRamVideoMode())` → `if (loadEnv().SWARMX_MODEL_STARTUP_PREWARM === "1")`
- Prewarm tag: 16 GB → `PILOT_VIDEO_MODEL`; 8 GB → `LOW_RAM_VIDEO_MODEL`
- Keep-alive: uses `OLLAMA_KEEP_ALIVE_PILOT_S` from env (not hardcoded "10m")
- Writes warmup done marker `{"done":true,"completedAt":"..."}` via dynamic `import("node:fs/promises")` on success

### `.github/workflows/ci.yml`
- Added `OLLAMA_KEEP_ALIVE_PILOT_S: '300'` to env block

## Architecture: Dual-Resident Strategy on 16 GB

```
OLLAMA_MAX_LOADED_MODELS=2  ← allows Pilot + one 7B simultaneously resident
OLLAMA_KEEP_ALIVE=0          ← global evict-after-run; Pilot is the exception
OLLAMA_KEEP_ALIVE_PILOT_S=300 ← 5 min per-request keep_alive for Pilot

Typical session:
  boot → startup-enhanced.sh writes {done:false} marker
  server.ts → fetch Pilot prewarm → writes {done:true} marker
  job → intent_classification (Pilot, keep_alive=300s) → stays warm
  job → planning (Architect, keep_alive=0) → evicted after stage
  job → scripting (Architect, keep_alive=0) → evicted after stage
  post-pipeline → stageViralityAndCaption() (Oracle) → evicted after use
  Pilot still warm from intent stage → next job's intent is instant
```

## Quality Gate Results

| Gate | Result |
|------|--------|
| Gate 1 · @swarmx/types typecheck | ✅ PASS |
| Gate 2 · @swarmx/api typecheck | ✅ PASS |
| Gate 3 · @swarmx/dashboard typecheck | ✅ PASS |
| Gate 4 · dashboard vitest | ✅ PASS (52/52) |
| Gate 5 · api vitest | ✅ PASS (58/58) |
| Gate 6a · video-regression-check | ✅ PASS |
| Gate 6b · 5 regression scripts | ✅ PASS |
| Gate 7 · next build | ✅ PASS (14 routes) |
| Gate 8 · git diff --check | ✅ PASS |
| Invariant · console.* zero tolerance | ✅ PASS (0 hits) |
| Invariant · process.env[ ≤10 | ✅ PASS (6 hits) |
| Invariant · TONE_RULES all 8 variants | ✅ PASS |

## Host Profile

- RAM: 16 GB (HP EliteBook 850 G3 · CPU-only · WSL2)
- Ollama: OFFLINE (not needed for this milestone)
- Redis: OFFLINE

## TONE_RULES State

All 8 variants confirmed: contrarian ✅ urgent ✅ educational ✅ cinematic ✅ warm ✅ minimal ✅ faceless_broll ✅ kinetic_text ✅

## Remaining Work (Next Session)

- **Priority 6:** TONE_RULES completeness formal audit (already confirmed ✓; audit is now just documentation)
- **High Impact:** video-cleanup.ts interval at boot ✅ (already wired), resumeJob() fromStage validation, stageViralityAndCaption() BullMQ persistence, ComfyUI totalFrames hard-floor 16 when RAM > 8000 MB
- **Medium Impact:** OTel trace spans around runOrchestration() lifecycle
