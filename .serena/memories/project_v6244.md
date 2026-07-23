---
session: V6.2.43–V6.2.44
date: 2026-07-19
baseline: V6.2.42 (commit ff9e291)
---

## Shipped

- **V6.2.43** — `test(video): update stale timeout assertions to new CPU defaults`
  - `video-runtime-config.test.ts`: 2 assertions updated (intent default 120s, max clamp 600s)
  - All 150 tests green (5 files)

- **V6.2.44** — `feat(startup): CPU governor check, video model ensure, flash-attn safety fix`
  - `startup-enhanced.sh`:
    - `OLLAMA_FLASH_ATTENTION` default: 1 → 0 (Q8 + flash_attn=1 = llama.cpp segfault)
    - `OLLAMA_KV_CACHE_TYPE` default: q8_0 → f16
    - `check_cpu_governor()`: bare-metal Linux only; warns + attempts passwordless sudo fix
    - `ensure_video_model()`: `ollama create swarmxq-video-model` if not present
  - `~/.zshrc §7c`: same flash_attn and kv_cache defaults updated
  - `CLAUDE.md`: all 6 milestones closed; baseline updated to V6.2.44/bare-metal Linux

- **docs commit**: all 6 milestones closed in CLAUDE.md milestone queue and Confirmed Incomplete table

## All 6 Milestones — CLOSED

| # | Milestone | Version |
|---|---|---|
| 1 | BullMQ Default-On | V6.2.22 + V6.2.40 |
| 2 | GitHub Actions CI | V6.2.40 |
| 3 | Env Schema Expansion | V6.2.38 |
| 4 | First API Unit Tests | V6.2.39 + V6.2.43 |
| 5 | 16 GB Profile Config | V6.2.44 |
| 6 | TONE_RULES Completeness | V6.2.23 (confirmed V6.2.44) |

## Quality Gates (all passing)

- ✅ API tsc --noEmit — zero errors
- ✅ 150 tests (5 files, API)
- ✅ 52 tests (4 files, dashboard)
- ✅ 5 regression scripts pass
- ✅ console.* zero hits in services/routes
- ✅ process.env[ 4 hits (≤10, all documented)
- ✅ TONE_RULES all 8 variants present

## Host profile confirmed as bare-metal Linux

The HP EliteBook 850 G3 is running bare-metal Ubuntu/Debian Linux (not WSL2).
- `grep -qi microsoft /proc/version` returns false
- CPU governor defaults to `powersave` on bare-metal; must be set to `performance`
- `OLLAMA_NUM_THREADS=4` (not 3) is correct for bare-metal

## Key Ollama configuration summary (as of V6.2.44)

| Setting | Value | Location |
|---|---|---|
| `OLLAMA_FLASH_ATTENTION` | 0 | systemd override.conf + .zshrc + startup-enhanced.sh |
| `OLLAMA_KV_CACHE_TYPE` | f16 | systemd override.conf + .zshrc + startup-enhanced.sh |
| `OLLAMA_NUM_PARALLEL` | 1 | systemd override.conf |
| `OLLAMA_MAX_LOADED_MODELS` | 2 | systemd override.conf |
| `OLLAMA_KEEP_ALIVE` | 0 | systemd override.conf |
| `OMP_NUM_THREADS` | 4 | systemd override.conf |
| CPU governor | performance | set by `check_cpu_governor()` or manually |
| `swarmxq-video-model` | auto-created by ensure_video_model() | Ollama local |

## Next session starting point

All 6 milestones closed. The pipeline is fully functional with the first video generated (job 98df291a, 4m 9s). No immediate blockers.

Potential future work:
1. Production `swarmxq-video-model` Modelfile persistence (document in README or add to install.sh)
2. Script quality improvement — the phi4-lite model leaks prompt instructions into `[BODY]` section; scripting prompt needs tightening
3. Vitest coverage reporting to CI
4. ComfyUI integration when ComfyUI is available on the host
