# SwarmX Modelfile Guide — V5
> SCAR Cognitive OS · APEX-17 Gate-Aware · Hardware target: 8 GB RAM + 12 GB VRAM

This document covers every Modelfile in the SwarmX V5 stack: memory math, parameter
rationale, KV cache strategy, co-load matrix, and customisation guidance.

---

## Stack Overview

```
Primary models (orchestration runtime):
  qwen-supervisor     → Qwen2.5-7B-Q5_K_M  — plans, delegates, synthesises
  qwen-worker         → Qwen2.5-7B-Q5_K_M  — complex tool chains, executor role
  phi4-worker         → Phi-4-mini-Q8_0    — fast single-tool execution
  phi4-fast           → Phi-4-mini-Q8_0    — routing, classification, complexity scoring
  deepseek-reasoner   → DeepSeek-R1-7B-Q5  — deep analysis, code gen, planning
  deepseek-critic     → DeepSeek-R1-7B-Q5  — post-run audit, APEX-17 evolution signals

Variant models (APEX-17 evolution cycle — build with BUILD_VARIANTS=1):
  deepseek-r1:swarmx-evolve      → critique + validate phases
  deepseek-r1:swarmx-supervisor  → long-horizon architectural planning
  qwen2.5:swarmx-evolve          → mutation generation (mutate phase)
```

---

## GGUF file → model role mapping

| GGUF file                               | Used by                                            |
|-----------------------------------------|----------------------------------------------------|
| `Qwen2.5-7B-Instruct-Q5_K_M.gguf`      | qwen-supervisor, qwen-worker, qwen2.5:swarmx-evolve |
| `microsoft_Phi-4-mini-Instruct-Q8_0.gguf` | phi4-worker, phi4-fast                          |
| `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf` | deepseek-reasoner, deepseek-critic, deepseek-r1:swarmx-evolve, deepseek-r1:swarmx-supervisor |

All three GGUFs are stored in `~/models/llm-local/`. The install script patches
`FROM ~/models/llm-local/…` to an absolute path automatically.

---

## Memory Math Reference

All estimates assume `OLLAMA_KV_CACHE_TYPE=q8_0` (primary models) or `q4_0` (phi4 models).
GPU overhead ~400 MB. Co-load overhead negligible (shared runtime).

```
KV cache formula (q8_0, 1 byte/element):
  KV_MB = (num_layers × num_kv_heads × head_dim × num_ctx × 2) ÷ 1,048,576

KV cache formula (q4_0, 0.5 bytes/element):
  KV_MB = (num_layers × num_kv_heads × head_dim × num_ctx × 2 × 0.5) ÷ 1,048,576
```

### Qwen2.5-7B-Instruct (28 layers, 4 KV heads GQA, head_dim 128)

| Context | KV type | KV MB  | + Weights | = Total  |
|---------|---------|--------|-----------|----------|
| 8k      | q8_0    | ~187   | ~4,900    | ~5,487   |
| 12k     | q8_0    | ~280   | ~4,900    | ~5,580   |
| 16k     | q8_0    | ~374   | ~4,900    | ~5,674   |
| 32k     | q8_0    | ~749   | ~4,900    | ~6,049   |

### Phi-4-mini-Instruct (32 layers, 8 KV heads GQA, head_dim 96)

| Context | KV type | KV MB  | + Weights | = Total  |
|---------|---------|--------|-----------|----------|
| 4k      | q4_0    | ~100   | ~3,900    | ~4,350   |
| 8k      | q4_0    | ~201   | ~3,900    | ~4,450   |

### DeepSeek-R1-Distill-Qwen-7B (28 layers, 4 KV heads GQA, head_dim 128)

| Context | KV type | KV MB  | + Weights | = Total  |
|---------|---------|--------|-----------|----------|
| 16k     | q8_0    | ~374   | ~4,900    | ~5,674   |
| 20k     | q8_0    | ~468   | ~4,900    | ~5,768   |
| 32k     | q8_0    | ~749   | ~4,900    | ~6,049   |

> **Rule of thumb:** Every model in this stack fits under 6.2 GB VRAM at its maximum
> configured context window, but the 8 GB CPU-only profile is strict single-model
> residency. Co-loading is historical guidance for larger GPU hosts only.

---

## Co-load Matrix (12 GB VRAM)

`OLLAMA_MAX_LOADED_MODELS=1` is required for the supported 8 GB profile. The
matrix below is retained only for operators on larger GPU hosts.

| Pair                                        | Total MB | Headroom | Safe? |
|---------------------------------------------|----------|----------|-------|
| phi4-fast + qwen-worker                     | 9,650    | +2,350   | ✅    |
| phi4-fast + phi4-worker                     | 8,500    | +3,500   | ✅    |
| phi4-fast + qwen-supervisor                 | 10,250   | +1,750   | ✅    |
| phi4-fast + deepseek-reasoner               | 10,150   | +1,850   | ✅    |
| phi4-fast + deepseek-critic                 | 10,450   | +1,550   | ✅    |
| qwen-supervisor + deepseek-reasoner         | 12,100   | -100     | ⚠️ marginal |
| deepseek-reasoner + deepseek-critic (32k)   | 12,300   | -300     | ❌ OOM risk |

To check a specific pair: `python3 setup/health_check.py --coload phi4-fast qwen-worker`

---

## Primary Modelfile Parameters

### qwen-supervisor
```
num_ctx:        12288   — plan + 8–12 step history + tool call history
num_predict:    1024    — compact JSON plans
temperature:    0.10    — near-deterministic for structured JSON
top_k:          20
top_p:          0.90
min_p:          0.05    — prunes low-prob tokens that cause JSON syntax errors
repeat_penalty: 1.15    — prevents key repetition drift in multi-step plans
KV:             q8_0
```

### qwen-worker (executor role)
```
num_ctx:        8192    — executor sees only its assigned step
num_predict:    1024    — compact step_complete / tool_call JSON
temperature:    0.15    — slightly warmer for richer code/transform outputs
top_k:          40
repeat_penalty: 1.12
frequency_penalty: 0.05 — avoids stale vocabulary in multi-hop tool chains
KV:             q8_0
```

### phi4-worker (fast task executor)
```
num_ctx:        8192
num_predict:    512     — hard cap: workers emit compact JSON
temperature:    0.10
top_k:          10      — very tight sampling for reliable JSON syntax
min_p:          0.10    — stronger pruning for schema-constrained tasks
repeat_penalty: 1.10
KV:             q4_0    — speed priority; marginal quality loss acceptable
```

### phi4-fast (router / classifier)
```
num_ctx:        4096    — routing tasks never need more than ~1k tokens input
num_predict:    256     — responses are brief by design
temperature:    0.05    — maximum determinism for routing and classification
top_k:          10
min_p:          0.10
repeat_last_n:  32      — no repetition window needed for one-shot classification
KV:             q4_0
```

### deepseek-reasoner (deep analysis)
```
num_ctx:        16384   — reasoning chains need room; think block alone ~4–8k
num_predict:    4096    — generous for full think chain + structured JSON
temperature:    0.20    — lower than V4 for higher-quality reasoning
top_k:          40
repeat_penalty: 1.10
repeat_last_n:  256     — extended window prevents circular reasoning loops
KV:             q8_0    — quality matters for long reasoning chains
```

### deepseek-critic (post-run audit)
```
num_ctx:        20480   — reviews full task trace
num_predict:    3072    — audit reports are detailed
temperature:    0.40    — critique benefits from variation to cover edge cases
top_k:          35
repeat_penalty: 1.25    — prevents repeated complaints in audit reports
repeat_last_n:  512     — extended window for full trace context
KV:             q8_0
```

---

## KV Cache Strategy

```yaml
# From swarmx_config.yaml
kv_cache:
  strategy:
    supervisor: "q8_0"   # quality matters, moderate context
    worker:     "q4_0"   # speed matters, short context
    executor:   "q8_0"   # quality matters, multi-hop tool chains
    reasoner:   "q8_0"   # quality matters, long reasoning chains
    fast:       "q4_0"   # pure speed, minimal context
    critic:     "q8_0"   # quality matters, full trace review
```

**Why q8_0 vs q4_0?**
- `q8_0`: ~50% VRAM vs f16 KV. Imperceptible quality loss on structured-output tasks.
  Use when context > 8k or when reasoning quality matters.
- `q4_0`: ~75% VRAM reduction vs f16 KV. ~1% quality degradation on JSON syntax tasks.
  Use only for phi4 models doing fast routing/classification where speed dominates.

**Prefix caching:** On the 8 GB CPU-only profile, leave global
`OLLAMA_KEEP_ALIVE=0` and let SwarmX pass short request-level `keep_alive`
windows. Longer global keep-alive values can preserve prefix cache state, but
they also pin multi-GB models and should be used only for explicit short
operator sessions with measured headroom.

---

## Customisation Guide

### Changing model paths
Edit `FROM` lines in the modelfiles, or set `MODELS_DIR` before running `install.sh`:
```bash
MODELS_DIR=/path/to/my/models bash setup/install.sh
```

### Adjusting context windows
Increase `num_ctx` to allow longer conversations. Check the memory math table first.
After changing, rebuild: `ollama create <model-name> -f modelfiles/primary/<name>.modelfile`

### Tuning temperature per role
- Supervisor/fast: keep at 0.05–0.15. Higher values cause JSON syntax errors.
- Reasoner: 0.15–0.30 is safe. Higher = more creative but less reliable.
- Critic: 0.30–0.50. Critique benefits from diversity; pure JSON validity less critical.

### Adding a new agent role
1. Create `modelfiles/primary/my-agent.modelfile`
2. Add the model tag to `models:` in `swarmx_config.yaml`
3. Add VRAM estimate to `vram_estimates_mb:` in config
4. Rebuild: `ollama create my-agent -f modelfiles/primary/my-agent.modelfile`
5. Add a routing rule in the supervisor system prompt

### Swapping base models
Any Qwen2.5 or DeepSeek-R1-Distill model at a different quant level will work.
Update the `FROM` line and recalculate KV memory using the formula at the top.

Common swaps:
```
# Larger, slower, better reasoning:
FROM ~/models/llm-local/Qwen2.5-14B-Instruct-Q5_K_M.gguf  # ~9.5 GB — tight on 12 GB

# Smaller, faster, adequate for simple routing:
FROM ~/models/llm-local/Qwen2.5-3B-Instruct-Q8_0.gguf     # ~3.3 GB — fast co-load

# Alternative reasoning model:
FROM ~/models/llm-local/Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf  # code-specialist
```

---

## Variant Modelfiles

Build with: `BUILD_VARIANTS=1 bash setup/install.sh`

| File                              | Ollama tag                    | Role                                    |
|-----------------------------------|-------------------------------|-----------------------------------------|
| `deepseek-r1-evolve.modelfile`    | `deepseek-r1:swarmx-evolve`   | APEX-17 critique + validate phases      |
| `deepseek-r1-supervisor.modelfile`| `deepseek-r1:swarmx-supervisor`| Long-horizon architecture planner      |
| `qwen2.5-evolve.modelfile`        | `qwen2.5:swarmx-evolve`       | APEX-17 mutation generation (mutate)   |

These variants share weights with primary models but have different system prompts and
parameter sets tuned for their specific roles in the APEX-17 evolution cycle.

---

## APEX-17 Evolution Cycle

```
swarm-evolve.sh
  │
  ├─ observe  → phi4-mini:swarmx-evolve  (fast signal synthesis from runtime logs)
  ├─ critique → deepseek-r1:swarmx-evolve (root cause analysis, causal chain)
  ├─ mutate   → qwen2.5:swarmx-evolve    (bounded proposal generation)
  └─ validate → deepseek-r1:swarmx-evolve (safety + reversibility scoring)
                          │
                   swarm-gate.sh μ-7
                          │
                   STAGED (human review required)
                          │
                   Human applies → ollama create → deploy
```

**Gate floors (non-negotiable):**
- `safety < 4` → always REJECT
- `reversibility < 3` → always REJECT
- `allow_auto_deploy` is always `false` — never overridden

---

## Environment Variables

Source `setup/ollama_env.sh` before running `ollama serve`. Key variables:

```bash
OLLAMA_FLASH_ATTENTION=1          # ALWAYS set — reduces KV bandwidth pressure
OLLAMA_KV_CACHE_TYPE=q8_0         # Half KV VRAM vs f16, near-zero quality loss
OLLAMA_MAX_LOADED_MODELS=1        # Strict single-model residency
OLLAMA_KEEP_ALIVE=0               # Request-level keep_alive is authoritative
OLLAMA_NUM_PARALLEL=1             # Must be 1 on constrained VRAM
OLLAMA_GPU_MEMORY_FRACTION=0.90   # Leave 10% headroom for CUDA runtime
```

---

## Quick Reference Commands

```bash
# Build all primary models
bash setup/install.sh

# Build primary + evolution variants
BUILD_VARIANTS=1 bash setup/install.sh

# Pre-flight check
python3 setup/health_check.py

# Latency benchmark
python3 setup/health_check.py --bench

# Co-load safety check
python3 setup/health_check.py --coload phi4-fast deepseek-reasoner

# Integration tests (all)
python3 setup/test_integration.py

# Integration tests (fast, skip deepseek)
python3 setup/test_integration.py --fast

# Integration tests (one model)
python3 setup/test_integration.py --model phi4-worker

# Run a task
python3 orchestration/orchestrator.py "Summarise the key ideas in distributed systems consensus"

# Run critic on a saved trace
python3 orchestration/orchestrator.py --critic traces/trace_<uuid>.json

# Reload a model after Modelfile change
ollama create qwen-supervisor -f modelfiles/primary/qwen-supervisor.modelfile
```
