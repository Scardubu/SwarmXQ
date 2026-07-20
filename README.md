# SwarmXQ — Autonomous Multi-Agent Orchestration Platform

**Version:** APEX-17 r8 runtime profile · Auto-detected 8 GB / 16 GB host tuning · CPU-only · WSL2

SwarmXQ is a self-improving, pressure-aware multi-agent system that runs a fleet of specialized local LLMs through Ollama. It observes, critiques, mutates, validates, and deploys improvements autonomously — bounded by memory constraints, safety guardrails, and a deterministic governance layer.

---

## Operator Taxonomy

SwarmXQ organizes its model fleet through a **dual-layer naming system** — memorable Operator names for humans, canonical runtime tags for machines.

| Operator | Purpose | Canonical Tag | RAM | 7B? |
|----------|---------|---------------|-----|-----|
| **Relay** | Ultra-light routing / intent classification | `route-phi4-lite-q4km-prod` | ~2.5 GB | No |
| **Pilot** | Fast generalist / intake / session routing | `instruct-phi4-pro-q8-prod` | ~4.3 GB | No |
| **Architect** | Planning / orchestration / strategy | `plan-{phi4,qwen25,deepseekr1}-pro-*-prod` | 4.3–5.4 GB | Mixed |
| **Forge** | Code generation / execution / tool use | `code-qwen25-pro-q5km-prod` | ~5.4 GB | Yes |
| **Oracle** | Deep reasoning / diagnosis / architecture | `reason-deepseekr1-pro-q5km-prod` | ~5.4 GB | Yes |
| **Auditor** | Adversarial review / critique / safety | `critique-deepseekr1-pro-q5km-prod` | ~5.4 GB | Yes |
| **Lab** | Experimental / evolution / non-production | `synth-*-exp-*-dev` | 4.4–5.4 GB | Mixed |

**Usage rules:** Code, configs, and Ollama commands use canonical tags. Docs, dashboards, logs, and UI use Operator names. Both layers are synchronized through `MODEL_OPERATOR_MAP` — the single source of truth (defined in `packages/swarmx-types/src/operator-map.ts` and mirrored in `src/swarmx/operator_map.py`).

**Startup behavior by host profile:** the startup script now auto-detects total system RAM and selects either the constrained `8gb` profile or the warmer `16gb` profile. On the `8gb` profile no model is loaded by default, Relay loads on the first eligible request unless `SWARMX_MODEL_STARTUP_PREWARM=1` is set deliberately, and predictive specialist warmup stays off. On the `16gb` profile the startup script allows two resident models, enables a short global reuse window, and opt-in warmups default on. Override auto-detection with `SWARMX_HOST_PROFILE=8gb` or `SWARMX_HOST_PROFILE=16gb` when you need to pin behavior explicitly.

---

## Quick Start

### Prerequisites

- Python 3.11+ with venv
- Node.js 22+ / pnpm
- Ollama running locally
- GGUF models in `~/llm-local/gguf/`
- `ffmpeg` and `ffprobe` for local video renders
- `espeak-ng` for voiced local renders

### Clean Clone Setup

```bash
python -m venv .venv
source .venv/bin/activate
python -m pip install --editable '.[dev]'
pnpm install --frozen-lockfile
```

### Launch

```bash
bash scripts/startup-enhanced.sh --dashboard
```

Dashboard: **http://localhost:3000** · API: **http://localhost:3001/health**

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SWARMX_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `SWARMX_API_URL` | `http://127.0.0.1:3001` | API endpoint for CLI and server-side integrations |
| `NEXT_PUBLIC_SWARMX_API_URL` | `http://127.0.0.1:3001` | Preferred dashboard API endpoint |
| `NEXT_PUBLIC_API_URL` | `http://127.0.0.1:3001` | Legacy dashboard API fallback |
| `SWARMX_VIDEO_API_TOKEN` | unset | Write-route token for protected `/api/video/*` mutations |
| `SWARM_MODEL_FAST` | `instruct-phi4-pro-q8-prod` | Pilot model override |
| `SWARM_MODEL_CODE` | `code-qwen25-pro-q5km-prod` | Forge model override |
| `SWARM_MODEL_REASON` | `reason-deepseekr1-pro-q5km-prod` | Oracle model override |
| `SWARM_MODEL_ULTRA_ROUTER` | `route-phi4-lite-q4km-prod` | Relay model override |
| `SWARMX_HOST_PROFILE` | `auto` | Auto-detects `constrained_cpu_8gb` or `standard_cpu_16gb`; legacy `8gb`/`16gb` names are accepted as aliases at startup/API boundaries. |
| `OLLAMA_MAX_LOADED_MODELS` | profile-managed | `1` on `constrained_cpu_8gb`; `2` only under `standard_cpu_16gb` after host measurement and pressure checks. |
| `OLLAMA_NUM_PARALLEL` | `1` | One inference slot at a time |
| `OLLAMA_KEEP_ALIVE` | profile-managed | `0` on `constrained_cpu_8gb`; short reuse windows are profile-derived and must not be a universal default. |
| `SWARMX_MODEL_STARTUP_PREWARM` | profile-managed | Defaults `0` on `constrained_cpu_8gb`; heavyweight startup preload stays off on constrained hosts. |
| `SWARMX_MODEL_PREDICTIVE_PREWARM` | profile-managed | Defaults `0` on `constrained_cpu_8gb`; standard hosts may opt in after measurement. |
| `SWARMX_VIDEO_ALLOW_SILENT_AUDIO` | unset | Set to `1` only to permit silent local renders when `espeak-ng` is unavailable |

---

## Architecture

The `ModelOrchestrator` singleton enforces memory safety across constrained and standard CPU-only hosts through five mechanisms working in concert. The **single-7B lock** prevents heavyweight co-loads that would overrun physical RAM. **Profile-aware residency policy** keeps the `8gb` profile at strict single-model mode while allowing a short two-model reuse window on the `16gb` profile. **Request-level keep-alive** controls unload behavior per inference. **Warmup controls** avoid silently pinning multi-gigabyte models on constrained hosts. A **serialization mutex** prevents concurrent heavyweight races that cause OOM. Under critical pressure (<800 MB available), **degraded mode** halves context windows and token budgets.

### Pressure Tiers

| Available RAM | Tier | Behavior |
|---------------|------|----------|
| ≥ 2500 MB | Normal | Full context, standard keep-alive |
| 1500–2499 MB | Low-RAM | 75% context, shortened keep-alive |
| 800–1499 MB | High | Backoff delay before model loads |
| < 800 MB | Degraded | 50% context, minimal tokens, immediate eviction |

### Core Components

- **Relay** (`route-phi4-lite-q4km-prod`) — lightweight router, loaded on demand unless explicitly prewarmed
- **ModelOrchestrator** (`apps/swarmx-api/src/services/model-orchestrator.ts`) — SINGLE-7B LOCK, RAM polling, adaptive timeouts
- **Reasoning Sanitizer** (`apps/swarmx-api/src/services/reasoning-sanitizer.ts`) — strips `<think>` blocks from DeepSeek output
- **Swarm Pressure Monitor** (`apps/swarmx-api/src/services/swarm-pressure-monitor.ts`) — procfs-based RAM/ZRAM sampling
- **Evolution Layer** (`src/swarmx/evolution_layer/`) — observe → critique → mutate → validate → deploy cycle, dispatched to Lab Operators

---

## Video Generation Pipeline

SwarmXQ includes a pressure-aware, faceless video generation subsystem for TikTok and YouTube Shorts.

The dashboard consumes video API payloads through a local adapter boundary in `apps/swarmx-dashboard/src/lib/video-dashboard.ts`, which normalizes route payloads into dashboard-safe job shapes without coupling the UI to API-internal bridge types.

### Pipeline Stages

1. **Intent Classification** (Pilot by default) — parse user request into structured intent
2. **Planning** (Architect by default) — generate stage plan and narrative direction
3. **Scripting** (Architect by default) — produce narration and visual cues
4. **Storyboard Generation** (Architect by default) — derive visual scene frames
5. **Render Assembly** (local FFmpeg by default, ComfyUI optional) — render a bounded MP4 artifact
6. **Finalizing** (API assets layer) — probe the artifact, write metadata, and publish only after validation

Integrations: FFmpeg/FFprobe, server-side VoiceProvider adapters (Kokoro microservice support installed in the app, Piper when installed, `espeak-ng` as an explicit fallback), ComfyUI (optional), pressure-aware stage gating, and graceful degradation paths. Dashboard: `/video` route with job list, creative brief controls, package/certification state, and detail timeline. For the exact route and payload contract, see [docs/VIDEO-GENERATION.md](docs/VIDEO-GENERATION.md).

Operational note: the compiled Fastify entrypoint currently resolves to `apps/swarmx-api/dist/apps/swarmx-api/src/server.js` because the API TypeScript build uses the monorepo root as `rootDir`.

---

## Migration & Compatibility

Canonical tags are preferred in all runtime config, scripts, and operator workflows.
Legacy `-scar` tags still resolve automatically through `MODEL_ALIASES` during the migration window:

```
phi4-fast-scar         → instruct-phi4-pro-q8-prod   (Pilot)
deepseek-reasoner-scar → reason-deepseekr1-pro-q5km-prod  (Oracle)
qwen-worker-scar       → code-qwen25-pro-q5km-prod   (Forge)
```

Pre-scar tags (V5 and earlier) also resolve: `phi4-mini`, `deepseek-r1`, `qwen2.5-coder`, etc.

`scripts/startup-enhanced.sh` now auto-detects the host profile from total RAM and applies the matching Ollama defaults automatically. The constrained `constrained_cpu_8gb` profile clamps `OLLAMA_NUM_PARALLEL=1`, `OLLAMA_MAX_LOADED_MODELS=1`, and `OLLAMA_KEEP_ALIVE=0`; `standard_cpu_16gb` keeps `OLLAMA_NUM_PARALLEL=1` and may allow two resident models only after measurement and pressure checks. Set `SWARMX_HOST_PROFILE=constrained_cpu_8gb` or `SWARMX_HOST_PROFILE=standard_cpu_16gb` in `.env.local` to pin the profile explicitly.

### Legacy r7 migration

The current runtime uses canonical tags. Only repositories still on the legacy r7 naming scheme need the migration guide in **[docs/SETUP_AND_IMPLEMENTATION.md](docs/SETUP_AND_IMPLEMENTATION.md)**:

```bash
bash scripts/migrate-to-r7.sh --apply
```

Validate after migration:

```bash
source .venv/bin/activate
python -m pip install --editable '.[dev]'
pnpm --filter @swarmx/types typecheck
pnpm --filter @swarmx/api build
pnpm --filter @swarmx/api test
pnpm --filter @swarmx/api run test:regression
pnpm --filter @swarmx/api run test:video:smoke
pnpm --filter @swarmx/dashboard typecheck
python -m pytest
python -m ruff check .
python -m mypy src
bash scripts/rebuild-all-modelfiles.sh --validate
python -m pytest tests/test_naming_validation.py -v
bash scripts/swarm-healthcheck-apex17.sh
```

Operational note: on 8 GB hosts, `scripts/swarm-healthcheck-apex17.sh` may report `HEALTH: DEGRADED`
when free RAM falls below 800 MB or Ollama probe latency pushes Relay/model checks past their timeout.
That result indicates runtime pressure, not necessarily a build or type-safety regression.

### Validate Before Release

Use the repository Make targets after activating or creating `.venv`. The Makefile
automatically prefers `.venv/bin/python` when present, keeping Python tests and
quality tools aligned with the development dependency set.

```bash
make test
make typecheck-py
make typecheck-ts
make check-phase1
pnpm --filter @swarmx/api run test:video
pnpm --filter @swarmx/dashboard lint
pnpm --filter @swarmx/dashboard build
```

---

## CLI Entry Points

| Command | Purpose |
|---------|---------|
| `swarm run` | Mission execution |
| `swarm evolve` | Proposal generation and gated application |
| `swarm evolve-layer` | Autonomous self-improvement cycle (Lab Operators) |
| `swarm status` | Runtime state and telemetry |
| `swarm dashboard` | Browser dashboard |
| `swarm doctor` | Health diagnostics |

---

## Documentation

| Document | Purpose |
|----------|---------|
| [docs/SETUP_AND_IMPLEMENTATION.md](docs/SETUP_AND_IMPLEMENTATION.md) | **Step-by-step bundle installation** |
| [docs/SWARMXQ-APEX17-UPGRADE.md](docs/SWARMXQ-APEX17-UPGRADE.md) | Historical APEX-17 r7 upgrade changelog |
| `ARCHITECTURE.md` | System architecture deep dive |
| `SAFETY.md` | Safety guardrails and execution policy |
| `manifests/swarmx_model_manifest.yaml` | Bundle manifest with replacement matrix |

---

## Troubleshooting

**Dashboard shows 404** — Ensure API is running: `curl http://127.0.0.1:3001/health`

**Composer hangs on first call** — Cold model loads take 60–120s on constrained hosts. Startup and predictive warmup are off by default on 8 GB machines. Use the "SwarmX: Warm Relay Opt-In" VS Code task only when you intentionally want a short prewarm window.

**OOM on 7B load** — Run the "Evict 7B Models" VS Code task or `ollama ps` followed by `ollama stop <model>`, then retry. The API pre-evicts incompatible resident models before 7B loads, but a manually pinned Ollama model can still consume headroom.

**Video render fails before completion** — Verify local media binaries:

```bash
command -v ffmpeg
command -v ffprobe
command -v espeak-ng
pnpm --filter @swarmx/api run test:video:smoke
```

**Naming validation fails** — Run `bash scripts/migrate-to-r7.sh --dry-run` to see what's out of sync, then `bash scripts/migrate-to-r7.sh --apply`.

**Port conflict** — `lsof -i :3000` / `lsof -i :3001` to find and kill stale processes.

---

## Philosophy

*The incision is precise.* SwarmXQ's design rejects ornamental complexity. Every layer — naming, orchestration, pressure governance, video pipeline — answers a specific failure mode observed on real 8 GB hardware. When something feels over-engineered, it's because the alternative crashed.
