# SwarmX — GitHub Copilot Instructions
# Version: V5.9 · 2026.06 · APEX-17 Gate-Aware
# Maintainer: Scar (Oscar Ndugbu) · scardubu.dev
#
# This file is the single authoritative Copilot context for the SwarmX codebase.
# It must be placed at `.github/copilot-instructions.md`.
# Update it whenever architecture, conventions, or invariants change.
# ─────────────────────────────────────────────────────────────────────────────

## 1. What SwarmX Is

SwarmX is a production-grade autonomous multi-agent swarm control plane. It
combines a deterministic async Python orchestration core, specialist LLM agent
roles, persistent layered memory, proposal-based bounded self-evolution, a
Fastify REST/SSE API bridge, and a Next.js real-time dashboard.

**Runtime target:** 8 GB RAM + 12 GB VRAM (HP EliteBook 850 G3 class).
**LLM backend:** Ollama (local), strict single-model-at-a-time mode by default.
**Version:** `2026.6.0` (see `src/swarmx/version.py`).

---

## 2. Repository Layout (authoritative)

```
SwarmX-1.5/
├── orchestration/            Core async orchestrator + tool registry + config
│   ├── orchestrator.py       V5.8 SwarmXOrchestrator (1935 lines, async)
│   ├── tools.py              24-tool registry (circuit breaker, rate limiter)
│   └── swarmx_config.yaml    SINGLE config authority — never hardcode constants
│
├── brain/                    Lightweight orchestration adapter + domain logic
│   ├── __init__.py           Clean public API for brain/ module
│   ├── orchestrator.py       bridge → orchestration/ + RAG enrichment
│   ├── graph.py              Async DAG executor (Kahn topological, asyncio.gather)
│   ├── router.py             Ollama /api/chat async dispatcher (httpx)
│   ├── dispatcher.py         Step classifier → model role router
│   ├── planner.py            Goal → step list decomposition
│   ├── loop.py               Autonomous multi-iteration loop + quality scorer
│   ├── reflector.py          Post-execution quality reflection
│   ├── rag.py                4-tier RAG enrichment (graceful degradation)
│   ├── memory.py             JSONL brain memory store (async-safe, TTL-aware)
│   ├── roles.py              Role → model tag mapping (aligned with config)
│   ├── scorer.py             Re-exports score_output from loop.py
│   └── utils.py              chunk_tasks, flatten_results, truncate
│
├── memory/                   Vector memory backends
│   ├── __init__.py           get_store() factory (best available)
│   ├── faiss_store.py        Tier-1: FAISS semantic NN (graceful fallback)
│   └── vector_store.py       Tier-2: TF-IDF cosine (JSONL, safe paths)
│
├── agents/                   Agent logic + 30 persona cards
│   ├── analyzer.py           Async result aggregator
│   ├── executor.py           Async parallel step executor (asyncio.gather)
│   ├── catalog.yaml          30 agent definitions (model, outputs, skill_tags)
│   └── *.md                  Individual agent persona cards
│
├── src/swarmx/               installable Python package
│   ├── config.py             SwarmConfig dataclass (env + YAML + defaults)
│   ├── state.py              Core types: RiskLevel, Plan, TaskItem, AgentRole,
│   │                         RunRecord, EvolutionProposal, Checkpoint
│   ├── risk.py               risk_from_text(), risk_for_path(), HIGH_RISK_KEYWORDS
│   ├── policy.py             assess_action(), godel_guard(), TIER_MAP,
│   │                         ExecutionPolicy, PolicyViolation
│   ├── planner.py            build_plan(), detect_stack(), build_roles()
│   ├── llm.py                Triadic model dispatch (generate, generate_batch,
│   │                         stream, proposer_solver_loop)
│   ├── memory/               Core memory types (_core.py, types.py)
│   ├── storage.py            SQLite3 + JSONL hybrid storage (WAL, thread-safe)
│   ├── event_bus.py          Typed publish/subscribe over journal (EventKind)
│   ├── journal.py            JSONL event log (append_event, load_events)
│   ├── evolver.py            Evolution cycle (observe → critique → mutate →
│   │                         validate → stage → [human gate] → apply)
│   ├── workflows.py          28 built-in YAML workflow blueprints
│   ├── skills.py             Skill library (match_skills, synthesize)
│   ├── evolution_layer/      observer, critique, mutation, validation, deployment
│   ├── evolution/            critique_pipeline, critic_agent, redteam_agent
│   ├── framework_adapters/   LangGraph, CrewAI, AutoGen, ADK, Strands, MCP,
│   │                         OpenAI Agents (availability-checked adapters)
│   ├── core/                 evolution_engine.py, db helpers, status schema
│   ├── console/              Rich TUI, CLI command implementations
│   ├── cli.py                Main Typer CLI entry point
│   ├── server.py             MCP server exposure
│   ├── sandbox.py            Docker/Podman sandboxed execution
│   └── telemetry.py          Latency + metric recording
│
├── apps/
│   ├── swarmx-api/           Fastify 5 + TypeScript API bridge
│   │   ├── src/server.ts     Entry point (Helmet, CORS, SSE, WebSocket)
│   │   ├── src/routes/       agents, system, workflows, logs, config,
│   │   │                     composer, metrics
│   │   ├── src/plugins/      sse.ts, websocket.ts
│   │   ├── src/services/     cgroup, journald, systeminfo, v5metrics
│   │   └── src/types/        events.ts — SwarmXEvent union type (shared)
│   └── swarmx-dashboard/     Next.js 16 + React 19 + Tailwind dashboard
│       ├── app/              App Router pages
│       ├── components/       Radix UI + shadcn/ui components
│       └── stores/           Zustand state (events, agents, metrics)
│
├── configs/                  YAML config overlays (loaded by SwarmConfig)
│   ├── swarmx.defaults.yaml  Master defaults
│   ├── routing.yaml          Model routing + triadic dispatch table
│   ├── guardrails.yaml       Safety limits
│   ├── evolution.yaml        Evolution budget + selection strategy
│   ├── v6-overlay.yaml       V5.9+ additions (loaded last)
│   └── mcp-defaults.yaml     MCP tool allowlist defaults
│
├── workflows/                28 pre-built YAML workflow blueprints
├── agents/                   30 agent persona cards (.md)
├── skills/                   50+ skill cards (.md, matched by planner)
├── models/                   Ollama Modelfiles (6 primary + 4 variants)
├── tests/                    pytest suite (brain/, memory/, agents/, cli/,
│                             evolution/, skills/)
├── templates/                Evolution proposal, workflow blueprint, rubric
├── docs/                     QUICKSTART, INSTALL, OPERATIONS
└── setup/                    install.sh, health_check.py, zram_setup.sh
```

---

## 3. Model Topology (V5.8 — authoritative)

| Role key     | Ollama tag            | Responsibility                                       | VRAM    |
|--------------|-----------------------|------------------------------------------------------|---------|
| `fast`       | `phi4-fast`           | Complexity scoring, routing, validation, RAG queries | 4.15 GB |
| `worker`     | `phi4-worker`         | Fast tool execution, short JSON tasks                | 4.35 GB |
| `executor`   | `qwen-worker`         | Complex tool chains, multi-lingual, code execution   | 5.50 GB |
| `supervisor` | `qwen-supervisor`     | Planning, delegation, final answer synthesis         | 6.10 GB |
| `reasoner`   | `deepseek-reasoner`   | Deep analysis, multi-step reasoning, code generation | 6.00 GB |
| `critic`     | `deepseek-critic`     | Post-run audit, APEX-17 evolution signals            | 6.30 GB |

**Co-load rule:** `strict_single_model: true` is the default. Safe pairs
(phi4-fast + anything) are listed in `swarmx_config.yaml`→`co_load.safe_pairs`.
Never load `qwen-supervisor` + `deepseek-reasoner` simultaneously.

**Routing:**
```
score_complexity() < 0.65  → supervisor plans  (qwen-supervisor)
score_complexity() ≥ 0.65  → reasoner plans    (deepseek-reasoner)
```

**Env-var overrides** (hot-swap without config edits):
```
SWARMX_MODEL_REASONER=llama3:70b
SWARMX_MODEL_FAST=phi4-mini
```

---

## 4. Execution Flow (orchestration/orchestrator.py)

```
SwarmXOrchestrator.run(user_task)
  ├── score_complexity()                  phi4-fast  (30 s timeout → 0.5 neutral)
  ├── Plan generation                     supervisor or reasoner
  ├── Plan normalisation                  (min-1-step guard — V5.8 ENH-04)
  ├── [Optional] TaskGraph parallel roots brain/graph.py (dep-free steps)
  ├── Sequential step loop                max_steps=20, max_tool_calls=6
  │   └── _execute_tool_call_loop()       message pruning every iteration
  ├── Memory compression                  at 70% context threshold
  ├── Final synthesis                     supervisor
  ├── Background critic audit             deepseek-critic (non-blocking)
  └── TaskTrace → disk                    atomic .tmp → rename
```

**Step execution** calls `_execute_tool_call_loop()`, which:
1. Sends messages to the model with JSON schema enforcement.
2. Parses tool calls from the response.
3. Dispatches via `tools.dispatch_tool()` (circuit breaker + rate limiter).
4. Appends results and continues until `step_complete` envelope or max iterations.
5. Prunes messages to `tool_loop_msg_keep` (default 12) on every turn to prevent OOM.

---

## 5. Config System

**Single authority:** `orchestration/swarmx_config.yaml` + `configs/*.yaml` hierarchy.
**Never hardcode** model names, limits, timeouts, or thresholds. Always read from config.

```python
# Correct: read from SwarmConfig
from src.swarmx.config import SwarmConfig
cfg = SwarmConfig()
model = cfg.model_fast          # "phi4-fast" (env or yaml)
max_it = cfg.max_iterations     # 3 (env or yaml)

# Correct: read runtime knob in orchestrator
from src.swarmx.config import _cfg
tool_timeout = _cfg("orchestration", "tool_hard_timeout_s", default=180)

# Wrong: hardcoded constant
model = "phi4-fast"             # ← NEVER do this
```

**Config resolution order** (highest priority first):
1. Environment variable (`SWARM_MODEL_FAST`, `SWARM_HOME`, etc.)
2. `configs/v6-overlay.yaml`
3. `configs/routing.yaml`, `configs/evolution.yaml`, `configs/guardrails.yaml`
4. `configs/swarmx.defaults.yaml`
5. `models/registry.yaml`

**Key env vars:**

| Variable                  | Purpose                                        |
|---------------------------|------------------------------------------------|
| `SWARM_HOME`              | Runtime state dir (default `~/.swarmx`)        |
| `SWARM_MODEL_FAST`        | Override fast model tag                        |
| `SWARM_MODEL_CODE`        | Override code/executor model tag               |
| `SWARM_MODEL_REASON`      | Override reasoner model tag                    |
| `SWARM_AUTONOMOUS`        | Enable fully autonomous mode (bool)            |
| `SWARM_REVIEW_REQUIRED`   | Force human review on every run (bool)         |
| `SWARM_AUTO_APPLY`        | Allow auto-apply of low-risk proposals (bool)  |
| `SWARM_RISK_FLOOR`        | Minimum risk level that triggers human gate    |
| `SWARMX_OLLAMA_URL`       | Ollama base URL (default `http://127.0.0.1:11434`) |
| `SWARMX_EVENT_STRICT`     | Raise on unknown EventKind in tests (`1`)      |
| `TOOL_HARD_TIMEOUT_S`     | Per-tool dispatch hard timeout (default `180`) |
| `SWARM_MEMORY_TTL_SECONDS`| Brain memory TTL for search results            |
| `SWARM_RAG_TOP_K`         | RAG retrieval count (default `3`)              |
| `NODE_ENV`                | `production` disables pino-pretty in API       |
| `SWARMX_API_PORT`         | Fastify port (default `3001`)                  |
| `SWARMX_DASHBOARD_ORIGIN` | Trusted CORS origin for production             |

---

## 6. Core Python Types (src/swarmx/state.py)

Always import from `src/swarmx/state.py` — do not redefine these:

```python
class RiskLevel(str, Enum):
    LOW = "low"; MEDIUM = "medium"; HIGH = "high"; CRITICAL = "critical"

@dataclass
class AgentRole:
    name: str; mission: str; tools: list[str]
    model_hint: str | None          # "fast" | "code" | "reason" | "supervisor"
    can_autorun: bool; human_gate: bool
    skill_tags: list[str]; framework_tags: list[str]

@dataclass
class TaskItem:
    title: str; detail: str; owner: str
    risk: RiskLevel; done: bool; evidence: list[str]
    model_hint: str | None          # "code" | "reason" | "fast"

@dataclass
class Plan:
    target: str; stack: list[str]; workflow: str; risk: RiskLevel
    goal: str; tasks: list[TaskItem]; roles: list[AgentRole]
    approval_required: bool

@dataclass
class RunRecord:
    id: str; created_at: str; target: str; workflow: str; risk: str
    status: str; plan: dict; summary: str
    island_winner: str | None       # V2.0+ — never lookup plan.stages (wrong field)
    confidence_level: str           # "HIGH" | "MEDIUM" | "LOW"

@dataclass
class EvolutionProposal:
    id: str; created_at: str; scope: str; reason: str
    patch: dict; risk: str; status: str; score: float

@dataclass
class Checkpoint:
    thread_id: str                  # "{mission_id}:{run_id}:{stage_index}"
    stage: str                      # "after_plan" | "after_task_{n}" | "before_evolve"
    state_snapshot: dict; risk_at_snapshot: str
    is_human_interrupt: bool; resume_cursor: int
    branch_parent: str | None       # for what-if forks
```

---

## 7. Risk & Policy System

**Single source of truth for risk signals:** `src/swarmx/risk.py`

```python
from src.swarmx.risk import (
    risk_from_text,        # str → RiskLevel (score-based: keywords + dangerous cmds)
    risk_for_path,         # path → RiskLevel (sensitive path detection)
    HIGH_RISK_KEYWORDS,    # set[str] — canonical vocabulary
    DANGEROUS_COMMANDS,    # list[str] — regex patterns (rm -rf, kubectl apply, etc.)
)
```

**Policy evaluation:** `src/swarmx/policy.py`

```python
from src.swarmx.policy import (
    assess_action,         # (action, target, repo, cfg) → PolicyDecision
    assess_mission,        # (target, repo, cfg) → dict with plan + policy
    godel_guard,           # (scope, agent_permissions) → raises PolicyViolation
    ExecutionPolicy,       # LOCAL | PREVIEW | SANDBOXED | BLOCKED
    TIER_MAP,              # RiskLevel → ExecutionPolicy
    PolicyViolation,       # raised by godel_guard — never catch silently
)
```

**NEVER redefine `RISK_KEYWORDS` locally.** The historical bug of a locally-scoped
`RISK_KEYWORDS` dict diverging from `risk.py` caused production NameErrors on every
policy evaluation. Always import from `risk.py`.

**ExecutionPolicy tiers:**

| RiskLevel  | ExecutionPolicy | Behaviour                                  |
|------------|----------------|--------------------------------------------|
| LOW        | LOCAL          | Execute unchanged                          |
| MEDIUM     | PREVIEW        | Dry-run diff, approval before apply        |
| HIGH       | SANDBOXED      | Docker/Podman isolated + diff + human gate |
| CRITICAL   | BLOCKED        | Never auto-apply; operator action only     |

**Gödel guard** — hard invariant, never bypass:
```python
# An agent cannot approve changes to its own permission scope.
godel_guard(proposal_scope, agent_own_permissions)
# Raises PolicyViolation if scope ∈ agent_own_permissions.
```

---

## 8. Tool Registry (orchestration/tools.py)

24 registered tools. All share:
- Per-tool **rate limiting** (configurable via `tool_rate_limits:` in config)
- **Circuit breaker** (5 consecutive failures → open; 60 s reset window)
- **Call logging** (keys logged, values never — last 500 entries in `_CALL_LOG`)
- **Hard dispatch timeout** (`TOOL_HARD_TIMEOUT_S`, default 180 s, wraps every call)
- **EventBus publish** on `tool.result` / `tool.error`

**Safe path roots** (enforced for filesystem tools):
```python
_SAFE_READ_ROOTS  = [Path.home(), Path("/tmp"), Path("/opt/swarmx")]
_SAFE_WRITE_ROOTS = [Path.home() / "swarmx_outputs", Path("/tmp")]
```

**Key tools and their safety constraints:**

| Tool             | Safety feature                                    |
|------------------|---------------------------------------------------|
| `run_python`     | AST-level import/call blocklist (not regex)       |
| `run_shell_safe` | Explicit command allowlist — model never supplies shell string |
| `http_get`       | SSRF blocklist (9 cloud metadata prefixes)        |
| `http_post`      | SSRF blocklist                                    |
| `write_file`     | `_SAFE_WRITE_ROOTS` gate                          |
| `read_file`      | `_SAFE_READ_ROOTS` gate + optional line_range     |
| `diff_files`     | difflib only, read roots gated                    |
| `semantic_search`| 3-tier vector store fallback                      |

**Registering a new tool:**
```python
@register_tool(
    name="my_tool",
    description="One-sentence description for the model.",
    schema={...},                  # JSON Schema for args validation
    rate_limit=10,                 # calls/minute (None = no limit)
)
async def my_tool(args: dict) -> ToolResult:
    ...
    return ToolResult(status="success", result={...})
```

**`ToolResult` contract:**
```python
@dataclass
class ToolResult:
    status: str          # "success" | "error" | "blocked"
    result: Any          # JSON-serialisable payload
    error_detail: str | None = None

    def truncated(self, max_chars=4096) -> "ToolResult": ...
    def to_dict(self) -> dict: ...
```

---

## 9. Brain Module Layer (brain/)

The `brain/` layer is a lightweight adapter over `orchestration/`. It exposes a
simpler async interface for programmatic use, testing, and the CLI.

**Public API surface (`brain/__init__.py`):**
```python
from brain import (
    route,               # async: step str → response str (auto model select)
    dispatch,            # async: step str → response str (classified dispatch)
    enrich,              # str → str (RAG-enriched prompt, 4-tier)
    enrich_batch,        # list[str] → list[str] (shared store singleton)
    plan_task,           # async: goal str → list[str] (decomposed steps)
    autonomous_run,      # async: goal str → str (quality-gated loop)
    score_output,        # str → float 0.0–1.0 (quality scorer)
)
```

**Role resolution** (brain/roles.py):
```python
from brain.roles import role_model, all_roles
model_tag = role_model("reasoner")    # "deepseek-reasoner" (or SWARMX_MODEL_REASONER)
```

**DAG execution** (brain/graph.py):
```python
from brain.graph import TaskGraph, TaskNode, build_graph_from_plan

graph = TaskGraph([
    TaskNode("a", "task payload"),
    TaskNode("b", "next task", depends_on=["a"]),
])
results = await graph.execute(my_async_dispatcher)
# results: dict[node_id, TaskNodeResult]
# TaskNodeResult.ok() → True if status == "complete"
# graph.summary(results) → {total, completed, failed, skipped, success, errors}
```

**Cycle detection:** `_topological_levels()` uses Kahn's algorithm and raises
`ValueError` before execution if a cycle is detected. Always build graphs from
`build_graph_from_plan(plan_dict)` for orchestrator-compatible plans.

**RAG enrichment** (brain/rag.py):
```python
from brain.rag import enrich, enrich_batch, reset_store_cache

enriched = enrich(prompt)          # adds CONTEXT block or returns prompt unchanged
prompts  = enrich_batch(prompts)   # cheaper: shared store init for fan-out
reset_store_cache()                # force re-init after FAISS index update
```

⚠️ **FAISSStore and VectorStore are module-level lazy singletons.** Never
instantiate them in a loop — each instantiation reloads the SentenceTransformer
model (1–3 GB, 2–10 s). Use `enrich()` and `enrich_batch()` which use the
cached singletons.

---

## 10. Memory Architecture (4-Tier Fallback)

```
Tier 1 → memory/faiss_store.py     FAISS + SentenceTransformer (all-MiniLM-L6-v2)
Tier 2 → memory/vector_store.py    TF-IDF cosine (scikit-learn + numpy)
Tier 3 → brain/memory.py           JSONL keyword search (stdlib only)
Tier 4 → bare passthrough          always available (no memory enrichment)
```

All stores write to `$SWARM_HOME/memory/` (default `~/.swarmx/memory/`).

**brain/memory.py API:**
```python
from brain.memory import store, store_async, search, load_all, stats, clear

store("task", "result", improved="refined result")   # sync
await store_async("task", "result")                  # async-safe (uses Lock)
results = search("query", top_k=3)                   # TTL-aware keyword search
all_mem = load_all(limit=100, since_ts=1700000000.0) # time-range filter
info    = stats()                # {entry_count, disk_bytes, oldest_ts, newest_ts}
```

**SQLite storage** (`src/swarmx/storage.py`):
```python
from src.swarmx.storage import connect, store_run_record, list_runs
with connect(runtime_home) as conn:
    ...   # WAL mode, synchronous=NORMAL, busy_timeout=5000 ms
```

The SQLite connection uses `PRAGMA journal_mode=WAL` and `PRAGMA foreign_keys=ON`.
Always use the `connect()` context manager — never open the SQLite file directly.

---

## 11. Event Bus (src/swarmx/event_bus.py)

Use typed `EventKind` constants — never bare strings. Unknown kinds in strict mode
(`SWARMX_EVENT_STRICT=1`) raise `ValueError`.

```python
from src.swarmx.event_bus import EventKind, publish, recent, subscribe, snapshot

publish(runtime_home, EventKind.TASK_START, {"goal": "...", "source": "brain.loop"})
publish(runtime_home, EventKind.TOOL_RESULT, {"tool": "run_python", "duration_s": 1.2})

events = recent(runtime_home, limit=50, kind_filter=EventKind.STEP_FAILED)

for event in subscribe(runtime_home, kind=EventKind.EVOLUTION_PROPOSAL, limit=200):
    ...

bus_stats = snapshot(runtime_home)
# {count, kinds: {kind: n}, latency_stats: {kind: {count, mean_s, max_s}}, recent: [...]}
```

**Full EventKind catalog:**
```python
# Task lifecycle
TASK_START, TASK_COMPLETE, TASK_FAILED, TASK_CANCELLED

# Step lifecycle
STEP_START, STEP_COMPLETE, STEP_RETRY, STEP_FAILED

# Tool dispatch
TOOL_CALL, TOOL_RESULT, TOOL_ERROR, TOOL_CB_OPEN

# Memory
MEMORY_STORE, MEMORY_COMPRESS

# Evolution
EVOLUTION_PROPOSAL, EVOLUTION_APPROVED, EVOLUTION_REJECTED, EVOLUTION_DELTA

# System
HEALTH_CHECK, CONFIG_RELOAD, ESCALATION

# Audit
AUDIT_FLAG, POLICY_BLOCK
```

---

## 12. Evolution System (APEX-17)

**Pipeline** (`src/swarmx/evolver.py` + `src/swarmx/evolution_layer/`):

```
observe()          → collect runtime signals, recent runs, memory surface
critique()         → heuristic score + optional LLM critic (SWARM_LAYER_USE_LLM=1)
generate_mutations() → 3 bounded reversible candidates
validate_candidate() → score ≥ 0.05 AND risk ∈ {low, medium} → approved
delta_capture()    → composite fitness snapshot
stage_candidate()  → persist proposal artifact
[human gate]       → required for risk=high; auto for risk=low with Δfitness > 0
apply_proposals()  → NEVER auto-deploys (allow_auto_deploy: false — immutable)
```

**`allow_auto_deploy` is permanently `false`.** No PR, no commit, no test should
change this. Every evolution proposal is staged as an artifact and requires explicit
operator action to deploy.

**Evolution proposal format** (templates/evolution-proposal.md):
```yaml
id:          "proposal-{timestamp}-{nonce}-{scope}"
scope:       bootstrap | reliability | safety | routing | skills | templates | other
reason:      "Evidence-grounded. No speculative reasons."
patch:       "Minimal delta — show diff, not full file."
risk:        low | medium | high | critical
reversibility: undoable_1min | undoable_1hr | irreversible
```

**Scoring minimum:** composite score ≥ 0.72 to qualify for application.

**Multi-island tournament** (APEX-15+): proposals compete across divergent islands;
`island_winner` is stored on `RunRecord` (top-level field, not in `plan.stages`).

---

## 13. Agent System

### 13.1 Agent Catalog (agents/catalog.yaml)

30 specialist agents. Each entry specifies: `name`, `file`, `model` (`fast`|`code`|`reason`),
`outputs`, `skill_tags`, `framework_tags`.

**Model assignments:**
- `fast` → phi4-fast: strategist, design-critic, tournament-judge, evaluator,
  memory-curator, skill-curator, reviewer, risk-sentinel, workflow-router
- `code` → qwen-worker: mcp-toolsmith, frontend-architect, qa-evaluator,
  performance-optimizer, data-engineer, backend-engineer, producer, release-manager,
  environment-governor, security-reviewer
- `reason` → deepseek-reasoner: context-researcher, research-analyst,
  chief-architect, subagent-coordinator, workflow-composer, prompt-architect,
  evolver, benchmark-analyst, incident-commander, security-auditor

### 13.2 Risk Sentinel (highest priority agent)

```yaml
name: risk-sentinel
decision_rights: [block-action, require-human-review]
priority: highest
```

The risk-sentinel can block any action and require human review. Its `decision_rights`
are enforced by the orchestrator — never downgrade them.

### 13.3 Adding an Agent

1. Add persona card to `agents/my-agent.md`.
2. Add entry to `agents/catalog.yaml` with `model`, `outputs`, and `skill_tags`.
3. Add a `_role()` call in `src/swarmx/planner.py:build_roles()` if the agent
   should be automatically included in stack-specific plans.
4. Add skill tags to match in `src/swarmx/skills.py` if needed.

---

## 14. Workflow System

28 pre-built YAML workflows in `workflows/`. Key ones:

| Workflow                   | Family    | Risk   | Use case                              |
|----------------------------|-----------|--------|---------------------------------------|
| `autonomous-pipeline`      | general   | medium | Default full-stack autonomous run     |
| `backend-elite`            | backend   | medium | API/service hardening                 |
| `frontend-elite`           | frontend  | medium | UI/UX upgrade loop                    |
| `test-fix-loop`            | quality   | medium | Test stabilisation                    |
| `release-guarded`          | devops    | high   | Safe release with approval gate       |
| `evolution-tournament`     | evolution | medium | Multi-island proposal tournament      |
| `self-improving-pipeline`  | evolution | medium | Autonomous evolution cycle            |
| `security-deep-dive`       | security  | high   | Threat modelling + audit              |
| `incident-response`        | devops    | high   | Incident command + postmortem         |
| `fan-out-fan-in`           | general   | medium | Parallel sub-task fan-out             |
| `hierarchical-delegation`  | general   | medium | Multi-level agent delegation          |

**Loading a workflow:**
```python
from src.swarmx.workflows import load_workflow, workflow_for_target
wf = load_workflow("autonomous-pipeline")
wf = workflow_for_target("refactor authentication service", stack=["backend"])
```

**Workflow YAML schema** (templates/workflow-blueprint.yaml):
```yaml
family: custom
name: my-workflow
risk: medium
stages:
  - name: intake
    owner: strategist        # agent name from catalog
    risk: low
    purpose: "..."
    outputs: [...]
    quality_gate: output_quality_gate
```

**IEP-ELITE contract** (applied at every stage boundary in production workflows):
- `signal_triage_on_entry: true`
- `output_quality_gate_on_exit: true`
- `fix_log_forwarded: true`
- `handoff_contract_validated: true`

---

## 15. TypeScript API (apps/swarmx-api)

**Stack:** Fastify 5, TypeScript (ESM), Node ≥ 22.

**Key conventions:**
- All routes under `/api/<resource>` with Fastify router prefix.
- Input validation via **Zod** — no raw `request.body` access.
- **SSE** for real-time swarm events (`/api/sse`); **WebSocket** for terminal
  streams (`/api/ws`).
- `broadcastEvent()` from `plugins/sse.ts` is the only way to push to dashboard.
- `agentRegistry: Map<string, AgentState>` is the in-memory agent state.
  Python orchestrator PATCHes it via HTTP.

**`SwarmXEvent` union** (src/types/events.ts) — use this for all event payloads:
```typescript
type SwarmXEvent =
  | { type: "agent:update"; data: AgentState }
  | { type: "system:metrics"; data: SystemMetricsSnapshot }
  | { type: "workflow:started"; data: { id, workflowId, name } }
  | { type: "workflow:completed"; data: { id, workflowId, exitCode } }
  // ... see events.ts for full union
```

**Security:**
- `@fastify/helmet` must be registered before all routes.
- CORS origin list built **entirely from env** (`SWARMX_DASHBOARD_ORIGIN`).
  Never hardcode `localhost` origins in production paths.
- `NODE_ENV !== 'production'` adds dev convenience origins automatically.

**Adding a route:**
```typescript
// apps/swarmx-api/src/routes/my-resource.ts
export async function myResourceRouter(server: FastifyInstance): Promise<void> {
  server.get("/", async () => ({ items: [...] }));
  server.post("/", {
    schema: { body: mySchema.toJSON() },
  }, async (req, reply) => { ... });
}
// Register in server.ts:
server.register(myResourceRouter, { prefix: "/api/my-resource" });
```

---

## 16. Dashboard (apps/swarmx-dashboard)

**Stack:** Next.js 16 (App Router), React 19, Tailwind CSS, Radix UI, shadcn/ui,
TanStack Query, TanStack Table, Zustand, Vitest.

**Monorepo:** Turborepo (`turbo.json`). Shared types package: `@swarmx/types` —
add shared types there, not duplicated across apps.

**SSE consumption pattern:**
```typescript
// Always clean up EventSource on unmount
useEffect(() => {
  const source = new EventSource("/api/sse");
  source.addEventListener("agent:update", (e) => {
    const state: AgentState = JSON.parse(e.data);
    useAgentStore.getState().updateAgent(state);
  });
  return () => source.close();
}, []);
```

---

## 17. Framework Adapters (src/swarmx/framework_adapters/)

All adapters follow the same pattern — availability-checked, no hard dependency:
```python
from src.swarmx.framework_adapters.langgraph import adapter, available
if available():
    # LangGraph is installed — use it
```

Available adapters: `langgraph`, `crewai`, `autogen`, `adk`, `strands`, `mcp`,
`openai_agents`, `agent_framework`.

---

## 18. Testing

**Python tests:** `pytest` in `tests/` directory.
```
tests/
├── agents/      test_analyzer.py, test_executor.py
├── brain/       test_graph.py, test_rag.py, test_scorer.py
├── cli/         test_dispatch.py, test_doctor.py, test_output.py, test_compat.py
├── evolution/   test_critique_pipeline.py, test_divergent_proposer.py
├── memory/      test_vector_store.py
└── skills/      test_crystallizer.py
```

**Patterns to follow:**
```python
# Always test async functions with pytest-asyncio
@pytest.mark.asyncio
async def test_graph_parallel():
    async def dispatcher(node_id, task): return f"ok-{node_id}"
    graph = TaskGraph([TaskNode("a", "x"), TaskNode("b", "y")])
    results = await graph.execute(dispatcher)
    assert all(r.ok() for r in results.values())

# Use _BlockImport context manager (from test_rag.py) to test tier isolation:
with _BlockImport("faiss", "sklearn"):
    import brain.rag
    result = brain.rag.enrich("test prompt")
    assert "CONTEXT:" in result or result == "test prompt"

# Always reset module-level singletons between tests:
from brain.rag import reset_store_cache
reset_store_cache()
```

**TypeScript tests:** Vitest (`apps/swarmx-dashboard/__tests__/`).

---

## 19. Code Conventions

### Python

```python
# 1. Always begin files with:
from __future__ import annotations

# 2. Structured logging — NEVER print() in library code
import structlog
log = structlog.get_logger("swarmx.module.name")
log.info("event_name", key=value, other_key=other_value)

# 3. Async-first for I/O — sync wrappers for legacy callers only
async def my_function(x: str) -> str: ...
def my_function_sync(x: str) -> str:
    return asyncio.run(my_function(x))  # only for legacy callers

# 4. Dataclasses with from_dict / to_dict
@dataclass
class MyResult:
    status: str
    data: dict[str, Any]
    def to_dict(self) -> dict[str, Any]: return asdict(self)

# 5. Path operations — always Path(), never os.path.join()
output_path = Path(os.environ.get("SWARM_HOME", "~/.swarmx")) / "runs" / run_id

# 6. Error handling — never silently swallow unless explicitly noted
try:
    result = await risky_operation()
except Exception:
    pass  # WRONG — always at minimum log the exception

try:
    result = await risky_operation()
except Exception as e:
    log.warning("operation_failed", error=str(e))
    return default_value  # OK — graceful degradation with logging

# 7. Type annotations — full on all public functions
def process(items: list[str], limit: int = 100) -> dict[str, Any]: ...

# 8. Use RiskLevel enum — not raw strings
from src.swarmx.state import RiskLevel
if risk == RiskLevel.HIGH:     # correct
if risk == "high":              # wrong — fails comparison with enum instances

# 9. Atomic file writes — never partial writes
tmp = output_path.with_suffix(".tmp")
tmp.write_text(content, encoding="utf-8")
tmp.replace(output_path)   # atomic on POSIX

# 10. Config reads — always use _cfg() or SwarmConfig, not hardcoded values
from src.swarmx.config import SwarmConfig, _cfg
limit = int(_cfg("orchestration", "max_steps_per_task", default=20))
```

### TypeScript

```typescript
// 1. Use Zod for all input validation — never access raw body
const schema = z.object({ name: z.string().min(1).max(256) });
const { name } = schema.parse(request.body);

// 2. Typed events only — use SwarmXEvent union
broadcastEvent({ type: "agent:update", data: agentState });

// 3. ESM imports with .js extension (Node ESM requirement)
import { broadcastEvent } from "../plugins/sse.js";

// 4. Environment variable access — always with fallback or explicit check
const port = Number.parseInt(process.env["SWARMX_API_PORT"] ?? "3001", 10);

// 5. Async error handling in Fastify routes
server.get("/", async (request, reply) => {
  try { ... }
  catch (err) {
    server.log.error({ err }, "handler failed");
    reply.status(500).send({ error: "internal error" });
  }
});
```

### YAML Workflows and Config

```yaml
# Always include IEP-ELITE contract on production workflows
iep_elite:
  signal_triage_on_entry: true
  output_quality_gate_on_exit: true
  fix_log_forwarded: true

# Risk must be one of: low | medium | high | critical
risk: medium

# Owner must be a name from agents/catalog.yaml
owner: backend-engineer
```

---

## 20. Safety Invariants — NEVER BYPASS

These are hard constraints enforced throughout the codebase. Any suggestion that
would weaken, bypass, or comment them out is incorrect.

1. **`allow_auto_deploy` is always `false`** — no evolution proposal auto-deploys
   to production. This setting must never be changed.

2. **Tool write paths are restricted** to `~/swarmx_outputs` and `/tmp`. Never
   add writable roots outside these without a security review.

3. **SSRF blocklist covers all major cloud metadata endpoints** in `http_get` and
   `http_post`. Never remove blocklist entries.

4. **`run_python` uses AST-level import/call blocking** (not regex). Never replace
   the AST check with a regex or string-contains approach.

5. **`run_shell_safe` uses an explicit command allowlist** — the model never
   supplies a shell string. Never pass user-provided shell commands to `shell=True`.

6. **Gödel guard** (`godel_guard()`) prevents agents from approving changes to
   their own permission scope. `PolicyViolation` must never be caught and swallowed.

7. **ESCALATE / BLOCK / BLOCKED envelopes** halt execution immediately when
   returned by any agent. Handle these before processing any other content.

8. **TaskTrace written atomically** (`.tmp` → rename). Never write trace files
   directly — always via `TaskTrace.save()`.

9. **Memory failures never block orchestration** — all store operations are in
   `try/except`. Memory is best-effort; orchestration must continue without it.

10. **Complexity scoring timeout (30 s) → neutral routing (0.5)** — complexity
    scoring never blocks the task. On timeout, use neutral 0.5 and route to
    supervisor.

---

## 21. Common Patterns and Anti-Patterns

### ✅ Correct: Adding a new brain step
```python
# brain/my_step.py
from __future__ import annotations
from brain.router import run_model
import structlog

log = structlog.get_logger("swarmx.brain.my_step")

async def run_my_step(goal: str) -> str:
    log.info("my_step_start", goal=goal[:80])
    return await run_model("reason", goal)
```

### ❌ Wrong: Direct model name in code
```python
result = await ollama.chat("deepseek-r1:7b", prompt)  # hardcoded model
```

### ✅ Correct: Publishing an event
```python
from src.swarmx.event_bus import EventKind, publish
from pathlib import Path; import os
if _home := os.environ.get("SWARM_HOME"):
    publish(Path(_home), EventKind.TASK_COMPLETE, {"goal": goal[:100]})
```

### ❌ Wrong: Raw string event kind
```python
publish(home, "task_complete", {...})  # not in EventKind — will warn or error
```

### ✅ Correct: Building a workflow-compatible plan
```python
from src.swarmx.planner import build_plan
from src.swarmx.config import SwarmConfig
plan = build_plan(target="refactor auth service", repo=Path.cwd(), cfg=SwarmConfig())
```

### ❌ Wrong: Instantiating FAISSStore in a loop
```python
for prompt in prompts:
    store = FAISSStore()          # reloads SentenceTransformer every time
    context = store.search(prompt)
# Use enrich_batch(prompts) instead
```

### ✅ Correct: Async-safe brain memory write
```python
from brain.memory import store_async
await store_async("task description", "result summary")
```

### ❌ Wrong: Calling `_risk_score` with undefined `RISK_KEYWORDS`
```python
for risk, phrases in RISK_KEYWORDS.items():  # NameError — not defined here
    ...
# Import from risk.py or use _RISK_TIER_PHRASES from policy.py
```

### ✅ Correct: Graph with dependency declaration
```python
graph = TaskGraph([
    TaskNode("plan",     task_plan,     depends_on=[]),
    TaskNode("impl",     task_impl,     depends_on=["plan"]),
    TaskNode("test",     task_test,     depends_on=["impl"]),
    TaskNode("review",   task_review,   depends_on=["impl"]),
    TaskNode("merge",    task_merge,    depends_on=["test", "review"]),
])
```

### ✅ Correct: Tool with rate limiting and circuit breaker
```python
@register_tool(name="my_api_call", description="...", rate_limit=30)
async def my_api_call(args: dict) -> ToolResult:
    validated = MySchema(**args)     # Pydantic or dataclass validation
    result = await _call_api(validated.endpoint)
    return ToolResult(status="success", result=result)
```

---

## 22. Changelog Integration (CHANGE COMMENT CONVENTION)

Every significant change to an existing file must include a change tag comment.
This is a mandatory convention — not optional:

```python
# [V5.9-FIX-01] Brief description of what was broken and the fix.
# [V5.9-ENH-01] Brief description of what was added and why.
# [V5.9-PERF-01] Brief description of the performance improvement.
# [PRESERVED] Original feature retained unchanged — note if it was at risk.
```

For new files, include a module docstring with a CHANGES section:
```python
"""
brain/my_module — SwarmX V5.9 Module Description
=================================================
One-line purpose statement.

CHANGES V5.9 vs V5.8:
  [FIX-01] ...
  [ENH-01] ...
  [PRESERVED] All V5.8 enhancements retained.
"""
```

---

## 23. Shell Scripts

16 shell scripts at project root (`swarm-*.sh`). Key ones:

| Script                 | Purpose                                               |
|------------------------|-------------------------------------------------------|
| `swarm-run.sh`         | Run a task (calls Python orchestrator)                |
| `swarm-status.sh`      | Current swarm state and model status                  |
| `swarm-evolve.sh`      | Trigger an evolution cycle                            |
| `swarm-gate.sh`        | Human review gate for pending proposals               |
| `swarm-doctor.sh`      | Dependency health check                               |
| `swarm-models.sh`      | Model management (pull, verify, remove)               |
| `swarm-workflows.sh`   | Workflow management and introspection                 |
| `swarm-inspect.sh`     | Deep trace and memory inspection                      |
| `swarm-audit.sh`       | Security and safety audit                             |
| `swarm-init.sh`        | First-time setup                                      |

Scripts use `SWARM_HOME`, `SWARM_MODEL_*`, and `SWARMX_OLLAMA_URL` env vars.
Never hardcode paths inside scripts — always use `$SWARM_HOME` or derive from it.

---

## 24. Quick Reference: Where to Find Things

| I need to...                              | Look in...                                         |
|-------------------------------------------|----------------------------------------------------|
| Add a new tool                            | `orchestration/tools.py` — `@register_tool`        |
| Change model routing thresholds           | `configs/routing.yaml` + `orchestration/swarmx_config.yaml` |
| Add an agent persona                      | `agents/<name>.md` + `agents/catalog.yaml`         |
| Add a workflow                            | `workflows/<name>.yaml`                            |
| Add a skill                               | `skills/<name>.md`                                 |
| Change evolution budget                   | `configs/evolution.yaml`                           |
| Change safety limits                      | `configs/guardrails.yaml`                          |
| Add a brain module                        | `brain/<name>.py` + `brain/__init__.py`            |
| Add a new core state type                 | `src/swarmx/state.py`                              |
| Add a risk signal                         | `src/swarmx/risk.py` + `HIGH_RISK_KEYWORDS`        |
| Add a policy tier                         | `src/swarmx/policy.py` + `TIER_MAP`                |
| Add an event kind                         | `src/swarmx/event_bus.py` + `EventKind`            |
| Add a framework adapter                   | `src/swarmx/framework_adapters/<name>.py`          |
| Add a Fastify route                       | `apps/swarmx-api/src/routes/<name>.ts`             |
| Add a dashboard store                     | `apps/swarmx-dashboard/stores/<name>.ts`           |
| Change DB schema                          | `src/swarmx/migrations/` + `src/swarmx/storage.py` |
| Understand the orchestrator flow          | `orchestration/orchestrator.py` lines 1249–1663    |
| Understand the full architecture          | `ARCHITECTURE.md`                                  |
| Understand safety policy                  | `SAFETY.md`                                        |
| Understand the system prompt              | `SYSTEM-PROMPT.md`                                 |
| Understand the evolution proposal format  | `templates/evolution-proposal.md`                  |