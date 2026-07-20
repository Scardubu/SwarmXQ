# Creative Factory Audit Ledger

Date: 2026-07-20
Directive: `docs/SwarmXQ_Creative_Video_Factory_Production_Directive.md`

## Verified Conflicts And Decisions

| Priority | Source A | Source B | Chosen Source | Decision |
| --- | --- | --- | --- | --- |
| P0 | Directive prohibits browser-exposed server credentials | `apps/swarmx-dashboard/src/stores/video.ts` read a public video write token env var | Directive/security invariant | Dashboard writes now route through a Next.js server proxy that injects `SWARMX_VIDEO_API_TOKEN` server-side only. |
| P0 | Directive prohibits production writes when auth is unconfigured | `video-auth.ts` already fails closed in production | Existing executable behavior | Preserve fail-closed production behavior and update docs that still described local open writes as the general behavior. |
| P1 | Directive requires restart-safe durable lifecycle | `video-queue.ts` and `series-registry.ts` used in-memory `Map` registries with TTL cleanup | Directive/reliability invariant | Add atomic snapshots and append-only JSONL event journals under `SWARMX_HOME/state`; hydrate API registries during startup. |
| P1 | Directive says failed mandatory gates cannot become successful lifecycle states | `video-episode-preproducer.ts` marked Pass D `complete` even when `qualityGateResult.passed` was false | Directive/quality semantics | Failed mandatory quality gate now leaves pre-production in `failed` with explicit error and failed pass status. |
| P1 | Root guidance says 16 GB profile may use `OLLAMA_MAX_LOADED_MODELS=2` | `docker-compose.yml` previously pinned Ollama to `1` | Profile-specific startup safety | Compose now defaults to `2` with `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_KEEP_ALIVE=0`, `OLLAMA_FLASH_ATTENTION=0`, and `OLLAMA_KV_CACHE_TYPE=f16`; operators can override through env after measuring the host. |
| P1 | Startup skill example recommends `OLLAMA_FLASH_ATTENTION=1` and `q8_0` | `scripts/startup-enhanced.sh` documents CPU segfault risk on this host with Q8 Phi-4 | Verified executable safety note | Keep current `flash_attention=0` and `kv_cache=f16` defaults until measured safe on the target host. |
| P2 | AGENTS raw grep says zero `console.*` | CI uses source-aware grep excluding string literals | Executable CI behavior | Keep source-aware invariant; raw grep still reports harmless composer code-sample strings. |

## Baseline Commands

- `pnpm --filter @swarmx/types typecheck` passed.
- `pnpm --filter @swarmx/api typecheck` passed.
- `pnpm --filter @swarmx/dashboard typecheck` passed.
- `pnpm --filter @swarmx/api test` passed: 156 tests.
- `pnpm --filter @swarmx/dashboard test` passed: 52 tests.
- `pnpm --filter @swarmx/api run test:regression` passed when rerun outside sandbox because `tsx` IPC creation was sandbox-blocked.
- `pnpm --filter @swarmx/api run test:factory` passed when rerun outside sandbox.
- `pnpm --filter @swarmx/api run test:video:smoke` passed and generated a non-empty FFmpeg/FFprobe-validated MP4.
- `.venv/bin/python -m pytest` passed: 236 tests.
- `.venv/bin/python -m ruff check tests/test_startup.py` passed for the touched startup regression file.
- Full `.venv/bin/python -m ruff check .` remains blocked by pre-existing import-order findings across Python CLI/console modules.
- `docker compose config` could not run because `docker` is not installed in this environment; `sudo apt-get update` was attempted for Docker installation but sudo requires an interactive password.

## Open Certification Blockers

- Container build and Compose validation require Docker availability.
- Golden media runtime certification still requires API/dashboard restart recovery plus an approved brief through the full API workflow. The local FFmpeg/FFprobe smoke path passed.
- Publishing validation requires explicit user/platform authorization and valid platform credentials.
