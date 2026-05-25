# SwarmXQ — Autonomous Multi-Agent Orchestration Platform

**Version: APEX-17 r7** · Optimized for 8 GB RAM · CPU-only · WSL2

SwarmXQ is a self-improving, pressure-aware multi-agent system that runs a fleet of specialized local LLMs through Ollama. It observes, critiques, mutates, validates, and deploys improvements autonomously — bounded by memory constraints, safety guardrails, and a deterministic governance layer.

---

## Operator Taxonomy

SwarmXQ organizes its model fleet through a **dual-layer naming system** — memorable Operator names for humans, canonical runtime tags for machines.

| Operator | Purpose | Canonical Tag | RAM | 7B? |
|----------|---------|--------------|-----|-----|
| **Relay** | Ultra-light routing / intent classification | `route-phi4-lite-q4km-prod` | ~2.5 GB | No |
| **Pilot** | Fast generalist / intake / session routing | `instruct-phi4-pro-q8-prod` | ~4.3 GB | No |
| **Architect** | Planning / orchestration / strategy | `plan-{phi4,qwen25,deepseekr1}-pro-*-prod` | 4.3–5.4 GB | Varies |
| **Forge** | Code generation / execution / tool use | `code-qwen25-pro-q5km-prod` | ~5.4 GB | Yes |
| **Oracle** | Deep reasoning / diagnosis / architecture | `reason-deepseekr1-pro-q5km-prod` | ~5.4 GB | Yes |
| **Auditor** | Adversarial review / critique / safety | `critique-deepseekr1-pro-q5km-prod` | ~5.4 GB | Yes |
| **Lab** | Experimental / evolution / non-production | `synth-*-exp-*-dev` | 4.4–5.4 GB | Varies |

**Naming rules:** Code, configs, and Ollama commands use canonical tags only. Docs, dashboards, logs, and UI use Operator names. Both layers are synchronized through `MODEL_OPERATOR_MAP` — the single source of truth (defined in `packages/swarmx-types/src/operator-map.ts` and `src/swarmx/operator_map.py`).

---

## Quick Start

### Prerequisites

- Python 3.11+ with venv
- Node.js 22+ / pnpm
- Ollama running locally
- GGUF models in `~/llm-local/gguf/`

### Launch

```bash
# Enhanced startup (recommended — includes health checks + stale-process eviction)
bash scripts/startup-enhanced.sh --dashboard

# Or classic path
source .venv/bin/activate
python -m cli up --dashboard --host 127.0.0.1 --port 3001
```

Dashboard: **http://localhost:3000** · API: **http://localhost:3001/health**

### Environment Variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `SWARMX_OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama endpoint |
| `SWARMX_API_URL` | `http://127.0.0.1:3001` | API endpoint for dashboard |
| `SWARM_MODEL_FAST` | `instruct-phi4-pro-q8-prod` | Pilot model override |
| `SWARM_MODEL_CODE` | `code-qwen25-pro-q5km-prod` | Forge model override |
| `SWARM_MODEL_REASON` | `reason-deepseekr1-pro-q5km-prod` | Oracle model override |
| `SWARM_MODEL_ULTRA_ROUTER` | `route-phi4-lite-q4km-prod` | Relay model override |
| `SWARMX_DASHBOARD_ORIGIN` | auto-configured | CORS allowlist |

---

## Architecture

### Model Orchestration

The `ModelOrchestrator` singleton enforces memory safety on 8 GB systems:

- **SINGLE-7B LOCK** — only one 7B model may be resident at any time
- **Pressure-adaptive keep-alive** — models are evicted faster under memory pressure
- **Predictive warmup** — after Relay classifies intent, the next specialist is preloaded
- **Serialized transitions** — mutex prevents concurrent 7B races that cause OOM
- **Degraded mode** — under critical pressure (<800 MB available), context windows and token budgets are halved

### Pressure Tiers

| Available RAM | Tier | Behavior |
|---------------|------|----------|
| ≥ 2500 MB | Normal | Full context, standard keep-alive |
| 1500–2499 MB | Low-RAM | 75% context, shortened keep-alive, non-router eviction |
| 800–1499 MB | High | Backoff delay before model loads |
| < 800 MB | Degraded | 50% context, minimal tokens, immediate eviction |

### Core Components

- **Relay** (`route-phi4-lite-q4km-prod`) — always-resident router, sub-second intent classification
- **ModelOrchestrator** (`apps/swarmx-api/src/services/model-orchestrator.ts`) — SINGLE-7B LOCK, RAM polling, adaptive timeouts
- **Reasoning Sanitizer** (`apps/swarmx-api/src/services/reasoning-sanitizer.ts`) — strips `<think>` blocks from DeepSeek/Qwen output
- **Swarm Pressure Monitor** (`apps/swarmx-api/src/services/swarm-pressure-monitor.ts`) — procfs-based RAM/ZRAM sampling
- **Evolution Layer** (`src/swarmx/evolution_layer/`) — observe → critique → mutate → validate → deploy cycle

---

## Video Generation Pipeline

SwarmXQ includes a pressure-aware, faceless video generation subsystem optimized for TikTok and YouTube Shorts.

### Pipeline Stages

1. **Intent Classification** (Pilot) — parse user request into structured video intent
2. **Planning** (Architect/Forge) — generate shot list, timing, and asset requirements
3. **Scripting** (Architect/Forge) — produce narration script and visual directions
4. **Storyboard Generation** (Architect/Forge) — frame-by-frame visual specification
5. **Render Assembly** (Pilot) — ComfyUI workflow dispatch + asset composition
6. **Finalizing** (Pilot) — metadata, thumbnail generation, export

### Integration Points

- **ComfyUI** — image/video generation backend (LTX / Wan GGUF models)
- **Kokoro TTS** — text-to-speech narration synthesis
- **Memory-pressure gating** — each stage checks RAM before loading a 7B model
- **Graceful degradation** — high-pressure backoff, critical-pressure abort

Dashboard: `/video` route with job cards, timeline view, and real-time SSE progress.

---

## Migration & Compatibility

### From -scar tags (APEX-17 r1–r6)

All legacy `-scar` tags resolve automatically through `MODEL_ALIASES`:

```
phi4-fast-scar         → instruct-phi4-pro-q8-prod  (Pilot)
deepseek-reasoner-scar → reason-deepseekr1-pro-q5km-prod  (Oracle)
qwen-worker-scar       → code-qwen25-pro-q5km-prod  (Forge)
```

### From pre-scar tags (V5 and earlier)

```
phi4-mini    → instruct-phi4-pro-q8-prod  (Pilot)
deepseek-r1  → reason-deepseekr1-pro-q5km-prod  (Oracle)
qwen2.5-coder → code-qwen25-pro-q5km-prod  (Forge)
```

### Rebuild Models

```bash
# Rebuild all models with canonical tags
bash scripts/rebuild-all-modelfiles.sh

# Evict legacy -scar models from Ollama
bash scripts/rebuild-all-modelfiles.sh --evict-legacy

# Validate naming standard compliance
bash scripts/rebuild-all-modelfiles.sh --validate
```

---

## CLI Entry Points

| Command | Purpose |
|---------|---------|
| `swarm run` | Mission execution |
| `swarm evolve` | Proposal generation and gated application |
| `swarm evolve-layer` | Autonomous self-improvement cycle |
| `swarm status` | Runtime state and telemetry |
| `swarm dashboard` | Browser dashboard |
| `swarm doctor` | Health diagnostics |

---

## Testing & Validation

```bash
# Run naming validation tests
python -m pytest tests/test_naming_validation.py -v

# Run full test suite
python -m pytest tests/ -v

# Validate naming standard (no code changes)
bash scripts/rebuild-all-modelfiles.sh --validate
```

---

## Documentation

| Document | Purpose |
|----------|---------|
| [SWARMXQ-APEX17-UPGRADE.md](docs/SWARMXQ-APEX17-UPGRADE.md) | Full APEX-17 r7 upgrade changelog |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture deep dive |
| [VIDEO-GENERATION.md](docs/VIDEO-GENERATION.md) | Video pipeline technical reference |
| [SAFETY.md](SAFETY.md) | Safety guardrails and execution policy |
| [CORS_CONFIGURATION.md](docs/CORS_CONFIGURATION.md) | Cross-origin request setup |
| [OPERATIONS.md](docs/OPERATIONS.md) | Production operations runbook |

---

## Troubleshooting

**Dashboard shows 404** — Ensure API is running: `curl http://127.0.0.1:3001/health`

**Composer hangs on first call** — Cold model loads take 60–120s on constrained hosts. Relay answers common prompts locally while the specialist warms up.

**Agent fleet shows 0 agents** — API seeds from `agents/catalog.yaml` on boot. Send `SIGHUP` to force re-seed.

**Port conflict** — `lsof -i :3000` / `lsof -i :3001` to find and kill stale processes.

**OOM on 7B load** — Evict with: `bash scripts/rebuild-all-modelfiles.sh --evict-legacy` or use the VS Code task "Evict 7B Models".
