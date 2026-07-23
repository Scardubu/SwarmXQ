---
session: V6.2.42
date: 2026-07-19
baseline: V6.2.41 (commit 806cb40)
---

## Shipped

- **V6.2.41** — `fix(bullmq): guard against terminal-state registry entries on BullMQ retry` (commit 806cb40)
  - `video-worker.ts`: if existing registry entry is in terminal state on BullMQ retry, call `restoreJobFromBullMQ()` instead of re-using the stale entry; prevents `assertMutable()` throw → unhandled rejection → process exit
- **V6.2.42** — `fix(video): CPU-realistic stage timeout defaults and bounds` (commit ff9e291)
  - `video-runtime-config.ts`: raised STAGE_TIMEOUT_DEFAULTS (intent 120s, planning 5m, scripting/storyboard 10m, render 30m, finalizing 2m) and STAGE_TIMEOUT_BOUNDS max ceilings to match
  - `video-regression-check.ts`: assertions updated to match new values
  - `AGENTS.md` / `apps/swarmx-api/AGENTS.md` / `.github/copilot-instructions.md`: refreshed to V6.2.22/APEX-17 r8 baseline (16 GB, 38-skill system)

## First successful video (second attempt under BullMQ)

- **Job**: `98df291a-c168-4f37-bf5b-549a2b4b9b76`
- **Prompt**: "How AI is transforming software engineering in 2025"
- **Pipeline time**: 4m 9s total (intent 38s · planning 63s · scripting 70s · storyboard 72s · render 6s)
- **Output**: `video_98df291a.mp4` · 328 KB · 21.0s · H.264 · 720×1280 · 30fps
- **Model**: `swarmxq-video-model:latest` on all 4 text stages

## Quality Gates (all offline gates only — Ollama not exercised)

- ✅ `pnpm tsc --noEmit` (API) — zero errors
- ✅ `video-regression-check.ts` — pass
- ✅ `adaptive-timeout-regression.ts` — pass
- ✅ `eviction-metric-regression.ts` — pass
- ✅ `system-health-regression.ts` — pass
- ✅ `reasoning-sanitizer-regression.ts` — pass
- ⏭ `vitest run` (API) — skipped (not needed for these changes)
- ⏭ `dashboard tsc / vitest / next build` — not touched this session

## Host profile

- RAM at session start: ~8.2 GB available (from API boot log)
- CPU governor: `performance` (set in prior session — must persist across reboots, not automatic)
- Ollama: online, `swarmxq-video-model:latest` loaded
- Redis: online
- startup-enhanced.sh: NOT active (Priority 5 — still open)

## Critical discoveries (Ollama CPU performance)

1. **CPU governor defaults to `powersave` on this EliteBook** — runs at 500 MHz instead of 2.5 GHz. ~5× inference slowdown. Fix: `echo performance | sudo tee /sys/devices/system/cpu/cpu*/cpufreq/scaling_governor`. NOT persistent across reboots.

2. **`OLLAMA_FLASH_ATTENTION=1` + `OLLAMA_KV_CACHE_TYPE=q8_0` segfaults with Q8 Phi-4 models** (llama.cpp runner crash). Fixed in `/etc/systemd/system/ollama.service.d/override.conf` → `FLASH_ATTENTION=0`, `KV_CACHE_TYPE=f16`.

3. **All production Ollama models embed ~1239-token system prompts** in their Modelfiles. At 5–6 tok/s, that costs ~230 seconds of prefill per request. `SYSTEM ""` in `ollama create` does NOT clear the parent's system prompt. Must use a non-empty override.

4. **`PARAMETER num_batch 32`** is hardcoded in production model Modelfiles. Cannot be overridden per-request in Ollama 0.22.0. Must use `ollama create` with `PARAMETER num_batch 256` for ~4× batch-size improvement.

5. **`swarmxq-video-model:latest`** was created with `/tmp/swarmxq-video.Modelfile`:
   ```
   FROM instruct-phi4-lite-q4km-prod
   SYSTEM "You are a helpful assistant. Follow instructions precisely."
   PARAMETER num_batch 256
   PARAMETER num_ctx 3072
   PARAMETER num_thread 4
   PARAMETER temperature 0.1
   PARAMETER num_predict 1024
   ```
   This reduces prefill from 1239 → 21 tokens and raises n_batch to 256. Production speed: ~6.1 tok/s.
   **This model is local-only and NOT in git.** Must be re-created if Ollama data is wiped.

## Script quality note

The generated script for job 98df291a contained `(12-18 words maximum. 3-4 sentences.)` as literal text in the `[BODY]` section — prompt instructions leaked into the output. This is a known issue with the phi4-lite model at temperature 0.1 when the scripting prompt is too prescriptive. The video was still generated but the script quality is degraded. Address in a future scripting prompt refinement.

## Runtime pivots

- Prior session (V6.2.41): video-worker terminal-state crash on BullMQ retry was the blocker; fixed with `restoreJobFromBullMQ()` guard.
- This session: timeout bounds were the primary blocker for video completion; all stages were timing out before inference completed under old defaults.

## Remaining work

- **Priority 4 Extension**: Series engine unit tests (plan at `/home/scar/.claude/plans/swarmxq-series-engine-groovy-hare.md`) — ~75 tests for `series-registry.ts` + `video-episode-preproducer.ts`
- **Priority 5**: `startup-enhanced.sh` — wire CPU governor set, Ollama perf vars, dual-model warmup, cold-start ETA
- **Priority 6**: TONE_RULES completeness audit (`faceless_broll`, `kinetic_text`)
- **Ollama model persistence**: document `swarmxq-video-model` creation in startup-enhanced.sh so it survives service restarts
- **Script quality**: scripting prompt needs `[BODY]` instructions removed from literal output constraints; instruct model to write directly

## TONE_RULES state

All 8 tone variants confirmed present in V6.2.23 commit. No gaps found this session.
