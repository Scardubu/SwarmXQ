### `ARCHITECTURE.md` *(REWRITE — V5.9 accurate topology)*

```markdown
# SwarmX V5.9 Architecture

SwarmX is a production-grade autonomous multi-agent swarm control plane combining
a deterministic async orchestration core, specialist LLM agent roles, persistent
layered memory, proposal-based bounded evolution, and a self-improving overlay.

---

## Layer Map

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Interface Layer — CLI · Next.js Dashboard · Fastify API · MCP Server   │
├─────────────────────────────────────────────────────────────────────────┤
│  Brain Layer — brain/            (lightweight adapter over orchestration)│
│    orchestrator · planner · dispatcher · router · reflector · loop      │
│    rag (4-tier RAG) · graph (async DAG) · memory (JSONL)                │
├─────────────────────────────────────────────────────────────────────────┤
│  Orchestration Layer — orchestration/                                   │
│    SwarmXOrchestrator (V5.8 async) · OllamaClient · TaskTrace           │
│    tools.py (22 tools + circuit breaker + rate limiter)                 │
│    swarmx_config.yaml (single config authority)                         │
├─────────────────────────────────────────────────────────────────────────┤
│  Memory Layer — memory/ · src/swarmx/memory/                            │
│    FAISSStore (tier-1) · VectorStore TF-IDF (tier-2)                   │
│    brain.memory JSONL (tier-3) · SQLite via swarmx.storage (tier-4)    │
├─────────────────────────────────────────────────────────────────────────┤
│  Evolution Layer — src/swarmx/evolution_layer/ · src/swarmx/core/       │
│    observer · critique · mutation · validation · deployment              │
│    evolution_engine (delta_capture, generate_proposals, approve/reject) │
├─────────────────────────────────────────────────────────────────────────┤
│  Infrastructure Layer — Docker Compose · Ollama · zRAM · SQLite         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Model Topology (V5.9 — authoritative)

| Role Key     | Ollama Tag          | GGUF File                                          | VRAM    |
|--------------|---------------------|----------------------------------------------------|---------|
| `fast`       | `phi4-fast`         | `microsoft_Phi-4-mini-instruct-Q8_0.gguf`          | 4.15 GB |
| `worker`     | `phi4-worker`       | `microsoft_Phi-4-mini-instruct-Q8_0.gguf`          | 4.35 GB |
| `executor`   | `qwen-worker`       | `Qwen2.5-7B-Instruct-Q5_K_M.gguf`                 | 5.50 GB |
| `supervisor` | `qwen-supervisor`   | `Qwen2.5-7B-Instruct-Q5_K_M.gguf`                 | 6.10 GB |
| `reasoner`   | `deepseek-reasoner` | `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf`         | 6.00 GB |
| `critic`     | `deepseek-critic`   | `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf`         | 6.30 GB |

GGUF files live under `~/llm-local/gguf/`. Modelfiles in `models/Modelfiles/primary/`.

**Hardware target:** 8 GB RAM + 12 GB VRAM.
**Strict single-model mode** (`co_load.strict_single_model: true`) is the default.
Safe co-load pairs (phi4-fast + any other role) are defined in `swarmx_config.yaml`.

**Legacy tag normalisation** (`src/swarmx/config.py → _normalise_model_tag()`):

| Legacy tag       | Canonical tag       |
|------------------|---------------------|
| `phi4-mini`      | `phi4-fast`         |
| `deepseek-r1:7b` | `deepseek-reasoner` |
| `qwen2.5-coder`  | `qwen-worker`       |

---

## Orchestration Flow (V5.9)

```
Task prompt
    │
    ▼
score_complexity()          ← phi4-fast  (30 s timeout; neutral 0.5 on timeout)
    │
    ├─ complexity < 0.65 ──► Supervisor plans  (qwen-supervisor)
    └─ complexity ≥ 0.65 ──► Reasoner plans   (deepseek-reasoner)
                                │
                                ▼
                        Plan normalisation
                        (min 1 step guard — V5.8 ENH-04)
                                │
                        ┌───────┴──────────┐
                        │  Step execution   │  × max_steps_per_task (20)
                        │   per-step tool   │
                        │   call loop       │  × max_tool_calls_per_step (6)
                        │   (max retries 3) │
                        └───────┬──────────┘
                                │
                        Memory compression
                        (triggered at 70% context threshold)
                                │
                        Final answer synthesis  (Supervisor)
                                │
                        Background critic audit (deepseek-critic)
                                │
                        TaskTrace → disk  (atomic .tmp→rename, V5.8 ENH-02)
```

---

## Tool Registry (V5.9 — 24 tools)

| Tool                 | Category      | Key safety feature                         |
|----------------------|---------------|--------------------------------------------|
| `read_file`          | filesystem    | `_SAFE_READ_ROOTS` gate + line_range       |
| `write_file`         | filesystem    | `_SAFE_WRITE_ROOTS` gate                   |
| `list_directory`     | filesystem    | read-only, depth-limited                   |
| `run_python`         | execution     | AST-level import/call blocklist            |
| `run_shell_safe`     | execution     | explicit command allowlist, no shell=True  |
| `http_get`           | network       | SSRF blocklist (9 host/prefix entries)     |
| `http_post`          | network       | SSRF blocklist                             |
| `git_status`         | vcs           | safe roots gate, fixed command set         |
| `summarise_text`     | llm           | `/api/chat` only (no deprecated generate)  |
| `hash_file`          | utility       | SHA-256 / MD5                              |
| `yaml_parse`         | utility       | safe read roots gate                       |
| `json_merge`         | utility       | recursive deep-merge, no shell             |
| `json_validate`      | utility       | JSONSchema validation                      |
| `diff_files`         | utility       | **NEW V5.8** — difflib, safe read roots    |
| `semantic_search`    | memory        | **NEW V5.8** — 3-tier vector store         |
| `list_tools`         | meta          | registry introspection                     |
| `get_tool_call_log`  | observability | call log, last 500 entries                 |
| `env_info`           | diagnostics   | env var values redacted to length          |
| `read_url`           | network       | SSRF-checked HTTP fetch                    |
| `write_memory`       | memory        | guarded memory store write                 |
| `search_memory`      | memory        | keyword + FAISS fallback                   |
| `list_files`         | filesystem    | alias for list_directory                   |
| `template_render`    | utility       | Jinja2 template rendering (safe mode)      |
| `workflow_validate`  | workflow      | YAML workflow schema validation            |

**Cross-cutting:** every tool has per-tool rate limiting, circuit breaker (5-failure
threshold, 60 s reset window), call logging (keys only — values never logged), and
`ToolResult.to_dict()` safe JSON serialisation.

---

## Memory Architecture (V5.9 — 4 Tiers)

```
Query/Store request
        │
        ▼
Tier 1: FAISSStore          ← requires faiss-cpu + sentence-transformers
        │  (384-dim L2, all-MiniLM-L6-v2, atomic index save)
        │  Fail → Tier 2
        ▼
Tier 2: VectorStore         ← requires scikit-learn + numpy
        │  (TF-IDF cosine, JSONL append-only, MAX_DOCS=1000 compaction)
        │  Fail → Tier 3
        ▼
Tier 3: brain.memory        ← stdlib only (json, pathlib)
        │  (JSONL keyword search, MAX_ENTRIES=500 compaction)
        │  Fail → Tier 4
        ▼
Tier 4: bare passthrough    ← always available (no memory enrichment)
```

All stores write to `$SWARM_HOME/memory/` (default `~/.swarmx/memory/`).

---

## Evolution Cycle (V5.9 — APEX-17 Gate-Aware)

```
observe()           collect runtime signals, recent runs, memory surface
    │
critique()          heuristic score + optional LLM reasoning critic
    │               (SWARM_LAYER_USE_LLM=1 to enable LLM path)
    │
generate_mutations()   3 bounded reversible candidates (routing / validation / config)
    │
validate_candidate()   score ≥ 0.05 AND risk ∈ {low, medium} → approved
    │
delta_capture()        composite fitness snapshot, keeper/rollback tagging
    │
stage_candidate()      persist as proposal artifact
    │
[Human approval gate]  required for risk=high; auto for risk=low with fitness delta > 0
    │
apply_proposals()      NEVER auto-deploys production changes (allow_auto_deploy: false)
```

**Gödel guard:** enforced in `src/swarmx/policy.py:godel_guard()` — an agent cannot
approve changes to its own permission scope. Hard `PolicyViolation` raised, never
silently bypassed.

---

## Directory Reference

```
SwarmX-1.5/
├── orchestration/          Core async orchestrator, tool registry, config
│   ├── orchestrator.py     V5.8 SwarmXOrchestrator (1935 lines)
│   ├── tools.py            Tool registry (24 tools, circuit breaker)
│   └── swarmx_config.yaml  Single config authority (V5.8)
├── brain/                  Lightweight adapter + domain logic
│   ├── __init__.py         Clean public API
│   ├── orchestrator.py     Bridge to orchestration/ + RAG enrichment
│   ├── graph.py            Async DAG executor (topological + parallel)
│   ├── router.py           Ollama /api/chat dispatcher
│   ├── dispatcher.py       Step classifier + model router
│   ├── planner.py          Goal → step list decomposition
│   ├── loop.py             Autonomous multi-iteration loop + quality scorer
│   ├── reflector.py        Post-execution quality reflection
│   ├── rag.py              4-tier RAG enrichment (graceful degradation)
│   ├── memory.py           JSONL brain memory store
│   ├── roles.py            Role→model mapping (aligned with swarmx_config.yaml)
│   ├── scorer.py           Re-exports score_output from loop.py
│   └── utils.py            chunk_tasks, flatten_results, truncate
├── memory/                 Vector memory backends
│   ├── __init__.py         get_store() factory (best available)
│   ├── faiss_store.py      Semantic NN store (graceful fallback)
│   └── vector_store.py     TF-IDF store (JSONL, safe path)
├── agents/                 Agent logic modules
│   ├── analyzer.py         Async result aggregator
│   ├── executor.py         Async parallel step executor
│   └── *.md                Agent persona cards (30 agents)
├── src/swarmx/             Python package (swarmx)
│   ├── core/               DB helpers, evolution engine, status schema
│   ├── evolution_layer/    Observer, critique, mutation, validation, deployment
│   ├── evolution/          Critique pipeline, critic/redteam agents
│   ├── memory/             Core memory types and JSONL implementation
│   ├── console/            TUI, Rich output, CLI commands
│   └── framework_adapters/ LangGraph, CrewAI, AutoGen, ADK, Strands, MCP
├── configs/                YAML config overlays (routing, evolution, guardrails)
├── workflows/              28 pre-built YAML workflow blueprints
├── skills/                 50+ skill cards (markdown persona fragments)
├── agents/                 Agent catalog + 30 agent cards
├── tests/                  pytest suite (brain, memory, agents, cli, evolution)
├── docs/                   Documentation (QUICKSTART, INSTALL, OPERATIONS)
├── models/                 Modelfiles (primary 6 + variant 4)
└── setup/                  install.sh, health_check.py, zram_setup.sh
```

---

## Safety Invariants (never bypassed)

1. `allow_auto_deploy` is **always False** in orchestrator config
2. Tool write paths restricted to `~/swarmx_outputs` and `/tmp`
3. SSRF blocklist covers all major cloud metadata endpoints
4. `run_python` uses AST-level dangerous import/call checking (not regex)
5. `run_shell_safe` uses an explicit command allowlist — model never supplies a shell string
6. Gödel guard prevents agents from approving changes to their own permission scope
7. ESCALATE / BLOCK / BLOCKED envelopes halt execution immediately
8. TaskTrace written atomically (`.tmp` → rename) — no partial trace files on crash
9. Memory failure never blocks orchestration (all store ops in try/except)
10. Complexity scoring timeout (30 s) → neutral routing (0.5) — never blocks
```

---

## Phase 1: Canonical Runtime Boundary *(added 2026-05-04)*

### Summary

Phase 1 establishes a hard runtime boundary between the **canonical execution
path** (`src/swarmx` + `cli/`) and the **compatibility adapter layer** (`brain/`).
All new code should target the canonical path. The brain/ layer is retained only
for backward-compatible import surfaces.

### Canonical vs. Legacy Entrypoints

| Use case                     | Legacy (deprecated)                          | Canonical (use this)                  |
|------------------------------|----------------------------------------------|---------------------------------------|
| Run a task from CLI          | `python -m swarmx run …`                     | `python -m cli run …`                 |
| Run a task from Python       | `brain.orchestrator.run_task(…)`             | `swarmx.cli.run(…)`                   |
| Plan a mission               | `brain.planner.plan_task(…)`                 | `swarmx.cli.plan_cmd(…)`              |
| Dispatch a step              | `brain.dispatcher.dispatch(…)`               | `swarmx.cli.run(…)`                   |
| Route to a model             | `brain.router.route(…)`                      | `swarmx.cli.run(…)` (routing internal)|
| Autonomous loop              | `brain.loop.autonomous_run(…)`               | `swarmx.cli.run(…)` with `autonomous=True` |
| Shell convenience wrappers   | direct `-m swarmx` or `-m cli` in each `.sh` | all `swarm-*.sh` → `swarm.sh` → `cli` |

### brain/ Compatibility Layer Status

The `brain/` directory is a **deprecated compatibility layer**. Each module emits
a one-time `DeprecationWarning` on first use:

```
DeprecationWarning: brain.orchestrator is a compatibility adapter.
Use swarmx.cli.run() directly.
```

**Do not add new functionality to `brain/`.** New features belong in `src/swarmx/`.

Planned removal: **Phase 4** (legacy dashboard retirement milestone).

### Shell Wrapper Delegation Chain

All 14 named convenience scripts now use a single two-line delegation pattern:

```bash
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec bash "$ROOT/swarm.sh" <COMMAND> "$@"
```

`swarm.sh` resolves the best available Python module at launch time:

```
swarm-*.sh → swarm.sh → importlib probe cli → importlib probe swarmx → error
                               ↓                        ↓
                       python -m cli              python -m swarmx
                       (canonical)                (compat fallback + warning)
```

### Dry-Run Diagnostics

Run with `SWARM_DRY_RUN=1` to inspect the fully resolved dispatch target and
dependency readiness without launching:

```bash
SWARM_DRY_RUN=1 bash swarm.sh
# or via Make:
make dry-run
```

Output includes: Python path/version, module availability (cli, swarmx, brain,
typer, yaml, aiohttp, faiss), dispatch resolution, registered CLI shims,
wrapper delegation status, and config file presence.

### Phase 1 CI Invariant Check

```bash
bash scripts/ci_phase1_check.sh
# or via Make:
make check-phase1
```

Verifies (without requiring a running service or Docker):
1. All `swarm-*.sh` pass `bash -n` syntax check  
2. All wrappers delegate via `bash "$ROOT/swarm.sh"`  
3. `swarm.sh` probes `cli` before `swarmx`  
4. All 15 CLI command shims exist in `cli/commands/`  
5. All shims registered in `cli/main.py`  
6. All `brain/*.py` compile cleanly  
7. All `brain/` adapter modules carry `DeprecationWarning`  
8. Phase 1 pytest regression suite (if pytest available)  

Exit code is `0` on full pass, `1` on any failure. Safe to run in CI without
Docker, Ollama, or network access.

