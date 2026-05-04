# brain/ — SwarmX V5.8 Brain Subsystem

The `brain/` directory is a **lightweight domain-logic adapter** that sits
between simple call sites (CLI scripts, tests, legacy integrations) and the
production V5.8 `orchestration/` engine.

## When to use `brain/` vs `orchestration/` directly

| Use case                                    | Use                          |
|---------------------------------------------|------------------------------|
| One-liner task execution in a script        | `brain.run_task(prompt)`     |
| CLI / synchronous callers                   | `brain.run_task_sync(prompt)`|
| Autonomous multi-loop execution             | `brain.autonomous_run(goal)` |
| Full production orchestration + traces      | `orchestration/orchestrator.py` |
| Agent-to-agent tool dispatch                | `orchestration/tools.py`     |

## Public API (import from `brain` directly)

```python
from brain import (
    run_task,           # async: full V5.8 orchestrator run with RAG enrichment
    run_task_sync,      # sync wrapper for the above
    autonomous_run,     # async: multi-iteration quality-gated loop
    plan_task,          # async: decompose goal into step list
    dispatch,           # async: classify + dispatch a step to a model
    route,              # async: intent-detect + run model
    reflect,            # async: evaluate and optionally improve a result
    enrich,             # sync:  RAG-enrich a prompt (4-tier fallback)
    score_output,       # sync:  0.0–1.0 quality score for any text
    store,              # sync:  persist a memory entry (JSONL)
    search,             # sync:  keyword search over JSONL memory
    TaskGraph,          # class: async DAG executor
    build_graph_from_plan, # factory: plan dict → TaskGraph
)
```

## Module Map

| Module            | Responsibility                                                  |
|-------------------|-----------------------------------------------------------------|
| `__init__.py`     | Re-exports the full public API — import from here              |
| `orchestrator.py` | Bridges brain/ call sites into the V5.8 orchestration engine   |
| `graph.py`        | Async DAG executor with topological sort + parallel execution   |
| `router.py`       | Ollama `/api/chat` dispatcher; `run_model(role, prompt)`       |
| `dispatcher.py`   | Step classifier (`classify`) + model role resolver              |
| `planner.py`      | Goal → ordered step list via reasoning model                    |
| `loop.py`         | Autonomous quality-gated iteration loop + `score_output()`     |
| `reflector.py`    | Post-execution reflection and optional improvement              |
| `rag.py`          | 4-tier RAG: FAISS → TF-IDF → JSONL → passthrough              |
| `memory.py`       | JSONL brain memory: `store`, `load_all`, `search`, `clear`     |
| `roles.py`        | `ROLE_MODELS` dict + `role_model(role)` with env-var override  |
| `scorer.py`       | Re-exports `score_output` from `loop.py` (no duplication)      |
| `utils.py`        | `chunk_tasks`, `flatten_results`, `truncate`                   |

## Graceful Degradation

All brain/ modules are designed to work **without optional ML dependencies**.
The import chain never raises at module-import time:

from brain import run_task      # works with: httpx, pyyaml, tenacity only
from brain import enrich        # works with zero ML deps (stdlib fallback)
from memory import get_store    # returns None gracefully if no ML deps

## Environment Variables

| Variable                    | Default              | Effect                              |
|-----------------------------|----------------------|-------------------------------------|
| `SWARMX_OLLAMA_URL`         | `http://127.0.0.1:11434` | Ollama endpoint for all calls   |
| `SWARM_HOME`                | `~/.swarmx`          | Memory and trace base directory     |
| `SWARM_MEMORY_MAX_ENTRIES`  | `500`                | JSONL memory compaction threshold   |
| `SWARM_VECTOR_MAX_DOCS`     | `1000`               | TF-IDF store compaction threshold   |
| `SWARM_RAG_TOP_K`           | `3`                  | Items injected per RAG enrichment   |
| `SWARM_MAX_LOOPS`           | `3`                  | Autonomous loop iteration cap       |
| `SWARM_QUALITY_THRESHOLD`   | `0.60`               | Score gate for loop termination     |
| `SWARM_TRACE_DIR`           | `traces`             | Where TaskTrace files are written   |
| `SWARM_LAYER_USE_LLM`       | `0`                  | Enable LLM path in evolution layer  |
| `SWARMX_MODEL_<ROLE>`       | *(none)*             | Per-role model tag override         |
| `SWARMX_EVENT_STRICT`       | `0`                  | Strict event kind validation        |