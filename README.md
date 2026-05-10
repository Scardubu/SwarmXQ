# SwarmX Operator Platform V6

SwarmX V6 is the self-improving operator layer on top of the existing control plane. It keeps the bounded mission runtime, live dashboard, audit trail, and workflow engine, and adds an autonomous evolution overlay that can observe, critique, mutate, validate, and stage improvements without mutating the base system blindly.

## Quick Start

### Prerequisites
- Python 3.11+ with venv activated
- Node.js 22+
- Ollama running locally (or models available in registry)

### Launch Full Stack (API + Dashboard)

```bash
cd SwarmXQ
source .venv/bin/activate
python -m cli up --dashboard --host 127.0.0.1 --port 3001
```

Then open the dashboard at **http://localhost:3000**

### Environment Variables

- `SWARMX_API_URL` — API endpoint for dashboard rewrites (default: `http://127.0.0.1:3001`)
- `SWARMX_COMPOSER_TIMEOUT_MS` — Composer model timeout in ms (default: `60000` in API)
- `SWARMX_V5_POLL_TIMEOUT_MS` — Metrics poll subprocess timeout in ms (default: `25000`)
- `SWARMX_OLLAMA_URL` — Ollama endpoint (default: `http://127.0.0.1:11434`)
- `SWARMX_DASHBOARD_ORIGIN` — CORS allowlist for browser requests (default: auto-configured by `swarm up`)
  - For local dev: `http://localhost:3000,http://127.0.0.1:3000` (auto-set)
  - For production: Set explicitly, e.g. `https://swarmx.example.com`
  - See [CORS Configuration Guide](docs/CORS_CONFIGURATION.md) for details
- `SWARMX_REPO_ROOT` — Absolute path to SwarmX repository (auto-detected by `swarm up`, [V6.1-FIX-06])
- `SWARMX_PYTHON` — Python interpreter for metrics poller (auto-detected from active venv, [V6.1-FIX-06])

### CORS Configuration

SwarmX uses **environment-driven CORS** to protect the API from unauthorized cross-origin requests:

- **Local Development:** `swarm up` automatically configures CORS for `localhost:3000` — no manual env setup needed ✅
- **Production:** Set `SWARMX_DASHBOARD_ORIGIN` to your dashboard domain and `NODE_ENV=production` for strict validation
- **Troubleshooting:** See [CORS Configuration Guide](docs/CORS_CONFIGURATION.md) for browser errors and solutions

### Troubleshooting

**Dashboard shows "404: This page could not be found"**
- Ensure the API is running: `curl http://127.0.0.1:3001/health`
- Check dashboard logs: `tail ~/.swarmx/logs/swarmx-dashboard.log`
- Verify SWARMX_API_URL is set correctly (should be `http://127.0.0.1:3001`, not `localhost`)

**Composer endpoint hangs or times out**
- Cold model loads can take 15–40s on first request; API default timeout is 45s and then falls back to a fleet summary
- Common operator prompts (for example, simple welcome/greeting copy) are now answered locally without waiting for model warmup
- Presence checks like `are you there?` and `ping` are answered locally from live fleet state
- Idle-assignment prompts like `how many are idle and why are they not assigned tasks?` are answered locally with assignment guidance
- Simple code prompts like a small Python calculator are also answered locally without waiting for model warmup
- Start Ollama: `ollama serve`
- Ensure `SWARMX_COMPOSER_MODEL` (or `SWARMX_MODEL_FAST`) resolves to an installed Ollama tag (`:latest` is auto-appended when omitted)
- Tune timeout with `SWARMX_COMPOSER_TIMEOUT_MS` if your host is slower/faster

**V5 metrics poll logs repeated "poll skipped" with SIGTERM**
- On slower hosts, `python -m swarmx metrics` can exceed the poll timeout
- Increase the subprocess timeout: `export SWARMX_V5_POLL_TIMEOUT_MS=30000`
- The poller now avoids overlapping subprocesses and skips while an existing poll is still running

**Agent fleet shows 0 agents after startup**
- API now seeds agent registry from `agents/catalog.yaml` on boot so dashboard starts with idle agents
- If catalog file is unavailable, a static built-in catalog snapshot is used (fail-open)
- Send `SIGHUP` to API process to force a catalog re-seed without full restart

**Port 3000 or 3001 already in use**
```bash
# Kill existing processes
lsof -i :3000  # Find process on port 3000
lsof -i :3001  # Find process on port 3001
kill -9 <PID>
```

## Model Triad

The bundled routing is aligned to this local triad (canonical tags):

- `phi4-fast` — router / orchestration complexity scoring
- `deepseek-reasoner` — reasoning / critique / architecture
- `qwen-worker` — execution / code / tool use

Legacy tags are normalized at config load time:

- `phi4-mini` -> `phi4-fast`
- `deepseek-r1:7b` -> `deepseek-reasoner`
- `qwen2.5-coder` -> `qwen-worker`

Local GGUF filenames used by the bundle:

- `Phi-4-mini-Instruct-Q8_0.gguf`
- `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf`
- `Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf`

## What is new in V6

- a self-improving autonomous swarm layer
- observation → critique → mutation → validation → deployment cycle
- candidate storage instead of blind auto-mutation
- model-aware evolution telemetry and artifact capture
- V6 workflow and model registry manifests
- a pressure-aware runtime governor for 8 GB RAM + ZRAM environments

## Runtime Governor

SwarmX now includes a deterministic runtime governor that keeps the local stack stable under memory pressure.

- Procfs-driven pressure sampling from `/proc/meminfo` and `/proc/swaps`
- Three pressure tiers: `normal`, `high`, `critical`
- Concurrency degradation for graph-root fanout under pressure
- Per-tier output token ceilings for fast, worker, supervisor, reasoner, and critic roles
- Typed SSE governor snapshots surfaced to the dashboard

The runtime governor is configured in [orchestration/swarmx_config.yaml](orchestration/swarmx_config.yaml) under `governance:`.

Key knobs:

- `governance.pressure.warn_available_mb`
- `governance.pressure.critical_available_mb`
- `governance.pressure.zram_warn_used_pct`
- `governance.pressure.zram_critical_used_pct`
- `governance.concurrency.*`
- `governance.token_ceilings.*`
- `governance.observe_only`

## Quick start

```bash
chmod +x scripts/install.sh
./scripts/install.sh

swarm doctor
swarm up --dashboard
swarm status
swarm evolve-layer --cycles 1
```

## Main entry points

- `swarm run` — mission execution
- `swarm evolve` — proposal generation and gated application
- `swarm evolve-layer` — the V6 autonomous self-improvement cycle
- `swarm status` — runtime state and telemetry
- `swarm dashboard` — browser dashboard

Runtime boundary notes:

- Shell wrappers (`swarm-*.sh`) resolve through `swarm.sh` and prefer `python -m cli`.
- Installed package scripts (`swarm`, `swarmx`) currently resolve through `swarmx.cli:main` for compatibility.

## Execution Policy Coverage

Execution policy is now enforced consistently across all execution surfaces:

- `src/swarmx/cli.py` gates direct CLI execution before `execute_plan()`.
- `src/swarmx/server.py` gates `/api/run` and returns `policy_blocked` with HTTP 403 on deny.
- `src/swarmx/worker.py` gates `run/mission` and `resume` job paths.
- `src/swarmx/execution_gate.py` is the shared fail-closed helper used by server and worker.

## Dashboard UX

The dashboard now renders governor state end-to-end:

- `system:governor` SSE events are emitted by the API from Python runtime metrics
- the command bar shows a compact pressure badge (`MEM OK`, `MEM HIGH`, `MEM CRITICAL`)
- the telemetry rail shows pressure tier, available RAM, ZRAM usage, active concurrency limit, and token ceilings
- Python lifecycle events (`mission`, `run`, `task`, `evolution`, `worker`) are bridged from `journal.jsonl` into the same Fastify SSE stream consumed by the Next.js dashboard
- the dashboard bootstraps recent lifecycle history from `/api/logs/events` and then tails new activity over `/api/events`, so the Recent Events and Log Explorer panels hydrate immediately after refresh
- the Agents page now normalizes `active` and `running` states (and error variants) consistently across status dots, filters, and counters

## Startup Autopilot

`swarm up` now runs a deterministic startup autopilot before the API comes online.

- health probe against Ollama plus a fresh procfs pressure snapshot
- lightweight warmup ping for the fast model
- dry-run evolver sync with proposal count capture
- persisted startup summary at `~/.swarmx/state/startup_summary.json`
- typed `system:startup` SSE replay so dashboards that connect after boot still receive the latest launch state

The dashboard surfaces that summary in two places:

- a compact `BOOT READY` / `BOOT DEGRADED` / `BOOT CRITICAL` chip in the command bar
- a startup card in the telemetry rail with narrative, pressure tier, warmup, evolver, and effective fanout

## Documentation

- `ARCHITECTURE.md`
- `SAFETY.md`
- `INTEGRATION.md`
- `SYSTEM-PROMPT.md`
- `configs/`
- `models/`
- `workflows/`
