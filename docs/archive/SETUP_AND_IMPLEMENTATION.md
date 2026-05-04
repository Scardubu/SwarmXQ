# SwarmX v4.0-FINAL · Setup & Implementation Guide
**IEP-ELITE-MAX · SCAR Cognitive OS · Triadic Model Dispatch · V4 Mission Control Plane**

---

## What This Bundle Is

SwarmX v4.0-FINAL is a bounded, self-evolving multi-agent orchestration system with:
- **Full Python runtime** — stdlib server, async worker, SQLite control store
- **30 specialist agent role cards** — each with model assignment, mission, and output contract
- **60+ composable skill capsules** — latent ensemble, critic gate, handoff contract, and more
- **25+ workflow templates** — from `repo-bootstrap` to `security-deep-dive`
- **V4 Mission Control Plane** — missions, jobs, events, policy gate, memory graph
- **IEP-ELITE-MAX system prompt** — vΩ.APEX.15 with dual-axis adversarial self-check
- **Triadic model dispatch** — Phi-4-mini · DeepSeek-R1:7B · Qwen2.5-Coder-7B
- **Production dashboard** — 9-tab UI with Missions + Events tabs, live EventSource stream

---

## FINAL Corrections Applied (V4-FINAL)

| ID | File | Fix |
|---|---|---|
| FIX-01 | `src/swarmx/config.py` | `model_reason` default was `"deepseek-r1"` (no tag) → `"deepseek-r1:7b"` |
| FIX-02 | `configs/swarmx.defaults.yaml` | Missing `model_reason_alias` key; missing `evolution.budget` section |
| FIX-03 | `src/swarmx/state.py` | `TaskItem` missing `model_hint` field → `choose_model_for_task()` always got `None` |
| FIX-04 | `src/swarmx/planner.py` | 10 agent roles had wrong `model_hint`; corrected to `"reason"` for all R1 roles; `model_hint` now propagated into `TaskItem` |
| FIX-05 | `src/swarmx/executor.py` | Used `choose_model()` (heuristic) instead of `choose_model_for_task()` → triadic dispatch was silently ignored |
| FIX-06 | `agents/catalog.yaml` | 10 agents had `model: fast/code` where `model: reason` is correct |
| FIX-07 | `pyproject.toml` | Version out of sync with `version.py` |
| FIX-08 | `dashboard/index.html` | Missions + Events tabs repositioned after Runs (logical order) |
| FIX-09 | `dashboard/app.js` | Events tab badge counter never updated in `renderEvents()` |

**Net effect:** DeepSeek-R1:7B now fires correctly for all 10 reasoning-tier agents. Previously all fell through to Phi-4-mini via heuristic fallback.

---

## Pre-flight Requirements

| Requirement | Minimum | Check |
|---|---|---|
| Python | 3.11 | `python3 --version` |
| pip | latest | auto-upgraded by install.sh |
| Ollama | any | `ollama --version` |
| Bash | 5.0 | `bash --version` |
| Disk | 25 GB free | Models + runtime state |
| RAM | 8 GB min (16 GB recommended) | Triadic dispatch |

---

## Step 1 — Install Ollama

```bash
# macOS
brew install ollama

# Linux
curl -fsSL https://ollama.com/install.sh | sh

# Start daemon
ollama serve &

# Verify
ollama --version
```

---

## Step 2 — Pull the Model Triad

```bash
# ORCHESTRATOR — always-on routing brain (~2 GB)
ollama pull phi4-mini

# REASONING ENGINE — planning, architecture, logic chains (~4.7 GB)
ollama pull deepseek-r1:7b

# EXECUTION ENGINE — code generation, tool-use, agentic tasks (~5 GB)
ollama pull qwen2.5-coder-7b
```

Verify:
```bash
ollama list
# phi4-mini:latest      ...  ~2 GB
# deepseek-r1:7b        ...  ~4.7 GB
# qwen2.5-coder-7b:latest    ...  ~5 GB
```

**Low-RAM fallback** (< 8 GB):
```yaml
# In configs/swarmx.defaults.yaml:
routing:
  model_fast:   phi4-mini
  model_reason: deepseek-r1:1.5b
  model_code:   qwen2.5-coder:3b
```

---

## Step 3 — Install SwarmX

```bash
# Unzip and enter the bundle
unzip swarmx_v4_final.zip && cd swarmx_v4_final

# Make scripts executable
chmod +x swarm.sh scripts/*.sh swarm-*.sh

# Run the full installer
./scripts/install.sh
```

The installer: creates `.venv/`, installs deps, writes env vars to your shell RC, pulls models, runs verify.

---

## Step 4 — Verify Installation

```bash
./scripts/verify.sh
```

Expected:
```
[1/6] Python 3.11+              → OK
[2/6] Dependencies              → OK
[3/6] SwarmX package            → OK  (2026.4.24.4-v4-FINAL)
[4/6] Ollama daemon             → OK
[5/6] Model triad
      phi4-mini                  → OK
      deepseek-r1:7b             → OK
      qwen2.5-coder-7b                → OK
[6/6] Config load               → OK  MODEL_REASON=deepseek-r1:7b
```

---

## Step 5 — Set Environment Variables (manual)

```bash
export OLLAMA_HOST="http://localhost:11434"

# Model triad
export MODEL_FAST="phi4-mini"
export MODEL_REASON="deepseek-r1:7b"
export MODEL_CODE="qwen2.5-coder-7b"

# SwarmX-namespaced (take precedence over MODEL_*)
export SWARM_MODEL_FAST="phi4-mini"
export SWARM_MODEL_REASON="deepseek-r1:7b"
export SWARM_MODEL_CODE="qwen2.5-coder-7b"

# Runtime tuning
export SWARM_AUTONOMOUS=true
export SWARM_MAX_ITERATIONS=3
export SWARM_MISSION_BUDGET=4
export SWARM_CONTROL_MODE=hybrid    # hybrid | autonomous | supervised
```

---

## Step 6 — Initialize and Run a Mission

```bash
# Install CLI
pip install -e .

# Initialize runtime for a repo
swarm init ~/projects/my-app

# Create a mission (policy + plan + phase map, stored in SQLite)
swarm mission ~/projects/my-app "stabilize the repo and improve observability" --queue

# Start the background worker
swarm worker ~/projects/my-app

# Or run directly
swarm run ~/projects/my-app \
  --target "stabilize the repo and improve observability" \
  --autonomous --max-iterations 3
```

---

## Step 7 — Open the Dashboard

```bash
swarm dashboard --repo ~/projects/my-app --open-browser
# or
./swarm-dashboard.sh ~/projects/my-app
```

**Dashboard tabs (9 total):**

| Tab | What it shows |
|---|---|
| Overview | Runtime vitals, agent grid, live metrics |
| Council | Agent council, island tournament bracket, PromptBreeder pool |
| Runs | Active run stage pipeline, run history |
| **Missions** | V4 mission list: status, risk badge, policy mode, phase map detail |
| **Events** | Live event bus feed from `event_bus.py`, type filtering, auto-refresh |
| Workflows | 25+ workflow templates |
| Evolution | Proposal feed, convergence history, memory timeline |
| Fix Log | Append-only fix log, rollback anchor registry |
| Activity | Raw API log |

---

## Step 8 — Use as Prompt System (Path B — No Python Required)

1. Open `SYSTEM-PROMPT.md`
2. Copy the full contents
3. Paste into your tool's system prompt (Claude Code, Roo-Cline, Continue, Kilo-Code, Amp)

The prompt is stack-aware. In a TypeScript / Effect-TS / Turborepo project:
- Architecture and planning → DeepSeek-R1
- Prisma schemas, API routes, React components → Qwen2.5-Coder-7B
- Routing, evaluation, memory curation → Phi-4-mini

---

## Triadic Model Dispatch

```
Every task
    │
    ▼
┌──────────────────────────────────┐
│  🧠 ORCHESTRATOR (always-on)    │
│  Phi-4-mini                     │
│  · task classification          │
│  · model routing                │
│  · escalation control           │
│  · stop condition enforcement   │
└──────────┬───────────┬──────────┘
           │           │
    ┌──────┘           └──────┐
    ▼                         ▼
┌─────────────────┐  ┌─────────────────────┐
│ 🧠 REASONING   │  │ 💻 EXECUTION        │
│ DeepSeek-R1:7B  │  │ Qwen2.5-Coder-7B         │
│ · planning      │  │ · code generation   │
│ · architecture  │  │ · tool-use          │
│ · logic chains  │  │ · implementation    │
│ · research      │  │ · test generation   │
└─────────────────┘  └─────────────────────┘
```

### Role assignments

| Model | Agent roles |
|---|---|
| **Phi-4-mini** | strategist, workflow-router, evaluator, memory-curator, skill-curator, risk-sentinel, tournament-judge, reviewer, design-critic, expert-pool, subagent-coordinator (simple) |
| **DeepSeek-R1:7B** | chief-architect, workflow-composer, research-analyst, context-researcher, subagent-coordinator, benchmark-analyst, evolver, security-auditor, incident-commander, prompt-architect |
| **Qwen2.5-Coder-7B** | backend-engineer, frontend-architect, data-engineer, performance-optimizer, mcp-toolsmith, security-reviewer, qa-evaluator, producer, release-manager, environment-governor |

### Escalation chain (automatic on failure)

```
phi4-mini      → deepseek-r1:7b → qwen2.5-coder-7b   → deterministic stub
deepseek-r1:7b → qwen2.5-coder-7b    → phi4-mini      → deterministic stub
qwen2.5-coder-7b    → deepseek-r1:7b → phi4-mini      → deterministic stub
```

---

## V4 Mission Lifecycle

```
swarm mission <repo> <target>
  1. build_mission()   — policy assessment + plan + 5-phase map
  2. save_mission()    — durable SQLite record
  3. worker picks up   — mission job from queue
  4. execute_plan()    — tasks dispatched via choose_model_for_task()
  5. activate_mission(status=completed)
  6. memory-curator    — learn phase → store lessons
```

**Budget enforcement:** `mission_budget: 4` (default). Override: `export SWARM_MISSION_BUDGET=6`.

---

## V4 REST API

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/overview` | Full runtime snapshot |
| GET | `/api/missions` | All mission records |
| POST | `/api/mission` | Create + queue a mission |
| GET | `/api/events?limit=200` | Event bus journal |
| GET | `/api/policy?target=...` | Risk + policy assessment |
| GET | `/api/stream` | SSE stream (live dashboard) |
| POST | `/api/run` | Execute a plan directly |
| POST | `/api/evolve` | Trigger evolution cycle |
| POST | `/api/queue/submit` | Submit job to worker queue |

---

## CLI Reference

```bash
swarm init <repo>
swarm run <repo> --target "..." [--autonomous] [--max-iterations N]
swarm mission <repo> <target> [--queue] [--review-required]
swarm worker [<repo>] [--once]
swarm evolve <repo>
swarm plan <repo> --target "..."
swarm status
swarm graph
swarm search <query>
swarm memory
swarm dashboard [--repo <path>] [--open-browser]
swarm doctor
swarm models
swarm config
swarm audit
swarm skills
swarm workflows
```

---

## Troubleshooting

**DeepSeek-R1 timeouts:**
```bash
# Increase timeout — R1 chain-of-thought is slow at first
# routing.yaml: deepseek-r1.timeout_seconds: 600
# Or: SWARM_WORKER_INTERVAL=5.0
```

**Wrong model firing (not R1 for planning tasks):**
```bash
echo $SWARM_MODEL_REASON   # must print: deepseek-r1:7b
swarm config | grep reason
```

**Missions tab empty:**
```bash
curl http://localhost:7860/api/missions | python3 -m json.tool
swarm status | grep mission
```

**Worker not processing jobs:**
```bash
swarm doctor
swarm status
# Restart: swarm worker ~/projects/my-app
```

**Out of memory:**
```bash
export SWARM_LLM_PROVIDER=deterministic  # stub mode, no Ollama needed
# Or use 1.5b / 3b model variants in configs/swarmx.defaults.yaml
```
