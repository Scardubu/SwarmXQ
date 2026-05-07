# SwarmX Operator Platform V6

SwarmX V6 is the self-improving operator layer on top of the existing control plane. It keeps the bounded mission runtime, live dashboard, audit trail, and workflow engine, and adds an autonomous evolution overlay that can observe, critique, mutate, validate, and stage improvements without mutating the base system blindly.

## Model triad

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
