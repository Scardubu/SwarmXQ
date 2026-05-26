# SwarmXQ — Autonomous Multi-Agent Orchestration Platform

**Version:** APEX-17 r7-final · Optimized for 8 GB RAM · CPU-only · WSL2

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

---

## Quick Start

### Prerequisites

- Python 3.11+ with venv
- Node.js 22+ / pnpm
- Ollama running locally
- GGUF models in `~/llm-local/gguf/`

### Launch

```bash
bash scripts/startup-enhanced.sh --dashboard
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

---

## Architecture

The `ModelOrchestrator` singleton enforces memory safety on 8 GB systems through five mechanisms working in concert. The **SINGLE-7B LOCK** ensures only one 7B model resides in memory at any time. **Pressure-adaptive keep-alive** evicts models faster under memory pressure. **Predictive warmup** preloads the next specialist after Relay classifies intent. A **serialization mutex** prevents concurrent 7B races that cause OOM. Under critical pressure (<800 MB available), **degraded mode** halves context windows and token budgets.

### Pressure Tiers

| Available RAM | Tier | Behavior |
|---------------|------|----------|
| ≥ 2500 MB | Normal | Full context, standard keep-alive |
| 1500–2499 MB | Low-RAM | 75% context, shortened keep-alive |
| 800–1499 MB | High | Backoff delay before model loads |
| < 800 MB | Degraded | 50% context, minimal tokens, immediate eviction |

### Core Components

- **Relay** (`route-phi4-lite-q4km-prod`) — always-resident router, sub-second intent classification
- **ModelOrchestrator** (`apps/swarmx-api/src/services/model-orchestrator.ts`) — SINGLE-7B LOCK, RAM polling, adaptive timeouts
- **Reasoning Sanitizer** (`apps/swarmx-api/src/services/reasoning-sanitizer.ts`) — strips `<think>` blocks from DeepSeek output
- **Swarm Pressure Monitor** (`apps/swarmx-api/src/services/swarm-pressure-monitor.ts`) — procfs-based RAM/ZRAM sampling
- **Evolution Layer** (`src/swarmx/evolution_layer/`) — observe → critique → mutate → validate → deploy cycle, dispatched to Lab Operators

---

## Video Generation Pipeline

SwarmXQ includes a pressure-aware, faceless video generation subsystem for TikTok and YouTube Shorts.

### Pipeline Stages

1. **Intent Classification** (Pilot) — parse user request into structured video intent
2. **Planning** (Architect/Forge) — generate shot list, timing, and asset requirements
3. **Scripting** (Architect/Forge) — produce narration script and visual directions
4. **Storyboard Generation** (Architect/Forge) — frame-by-frame visual specification
5. **Render Assembly** (Pilot) — ComfyUI workflow dispatch + asset composition
6. **Finalizing** (Pilot) — metadata, thumbnail generation, export

Integrations: ComfyUI (LTX/Wan GGUF), Kokoro TTS, memory-pressure gating per stage, graceful degradation. Dashboard: `/video` route with job cards, timeline view, and SSE progress.

---

## Migration & Compatibility

Legacy `-scar` tags resolve automatically through `MODEL_ALIASES`:

```
phi4-fast-scar         → instruct-phi4-pro-q8-prod   (Pilot)
deepseek-reasoner-scar → reason-deepseekr1-pro-q5km-prod  (Oracle)
qwen-worker-scar       → code-qwen25-pro-q5km-prod   (Forge)
```

Pre-scar tags (V5 and earlier) also resolve: `phi4-mini`, `deepseek-r1`, `qwen2.5-coder`, etc.

### Migrate to r7

See **[docs/SETUP_AND_IMPLEMENTATION.md](docs/SETUP_AND_IMPLEMENTATION.md)** for the complete step-by-step guide. The one-shot migration:

```bash
bash scripts/migrate-to-r7.sh --apply
```

Validate after migration:

```bash
bash scripts/rebuild-all-modelfiles.sh --validate
python -m pytest tests/test_naming_validation.py -v
bash scripts/swarm-healthcheck-apex17.sh
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
| [docs/SWARMXQ-APEX17-UPGRADE.md](docs/SWARMXQ-APEX17-UPGRADE.md) | Full APEX-17 r7 changelog |
| `ARCHITECTURE.md` | System architecture deep dive |
| `SAFETY.md` | Safety guardrails and execution policy |
| `manifests/swarmx_model_manifest.yaml` | Bundle manifest with replacement matrix |

---

## Troubleshooting

**Dashboard shows 404** — Ensure API is running: `curl http://127.0.0.1:3001/health`

**Composer hangs on first call** — Cold model loads take 60–120s on constrained hosts. Relay answers common prompts locally while the specialist warms up. Run the "Warm Relay" VS Code task to preload.

**OOM on 7B load** — Run the "Evict 7B Models" VS Code task, then retry. Or use `bash scripts/rebuild-all-modelfiles.sh --evict-legacy` if legacy models are still resident.

**Naming validation fails** — Run `bash scripts/migrate-to-r7.sh --dry-run` to see what's out of sync, then `bash scripts/migrate-to-r7.sh --apply`.

**Port conflict** — `lsof -i :3000` / `lsof -i :3001` to find and kill stale processes.

---

## Philosophy

*The incision is precise.* SwarmXQ's design rejects ornamental complexity. Every layer — naming, orchestration, pressure governance, video pipeline — answers a specific failure mode observed on real 8 GB hardware. When something feels over-engineered, it's because the alternative crashed.
