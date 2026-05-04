# SwarmX V5
> SCAR Cognitive OS · APEX-17 Gate-Aware · Local Multi-Agent LLM Orchestration

A production-hardened multi-agent inference system running entirely on local Ollama
models. Six specialised agents coordinate through a typed JSON contract layer,
a multi-turn tool dispatch loop, and a self-improvement audit cycle.

```
"The swarm that holds under pressure — no cloud dependency, no data exfiltration,
 and it still works at 2am during a live match."
```

---

## Architecture

```
User Task
    │
    ▼
phi4-fast          ← complexity scoring, routing, validation
    │
    ▼
qwen-supervisor    ← plans, delegates, synthesises final answer
    │
    ├──► phi4-worker        (fast single-tool, short JSON tasks)
    ├──► qwen-worker        (complex tool chains, multi-lingual)
    └──► deepseek-reasoner  (deep analysis, planning, code gen)
                │
                ▼
         tool dispatch loop
         (read_file, write_file, http_get, http_post,
          run_python, json_validate, summarise_text)
                │
                ▼
         qwen-supervisor   (synthesises final_answer)
                │
                ▼
    [optional] deepseek-critic  (post-run audit, APEX-17 evolution signals)
```

**One model loaded at a time.** VRAM budget: 8 GB RAM + 12 GB VRAM (RTX 3060/4060 Ti class).

---

## Hardware Requirements

| Component | Minimum       | Recommended         |
|-----------|---------------|---------------------|
| RAM       | 8 GB          | 16 GB               |
| VRAM      | 10 GB         | 12 GB               |
| Storage   | 25 GB free    | NVMe recommended    |
| OS        | Linux (WSL2 OK) | Ubuntu 22.04+     |
| Ollama    | 0.5.13+       | Latest              |
| Python    | 3.10+         | 3.11+               |

ZRAM is strongly recommended on 8 GB RAM systems.
Run `sudo bash setup/zram_setup.sh` during installation.

---

## Quick Start

```bash
# 1. Clone and place GGUF files
git clone <repo-url> swarmx && cd swarmx

# Download GGUF files to ~/models/llm-local/:
#   Qwen2.5-7B-Instruct-Q5_K_M.gguf       (~5.0 GB)
#   microsoft_Phi-4-mini-Instruct-Q8_0.gguf (~3.9 GB)
#   DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf (~5.0 GB)

# 2. Install
bash setup/install.sh

# 3. Configure environment
cp docs/env.swarmx.example .env.swarmx
source setup/ollama_env.sh   # or add to .bashrc

# 4. Start Ollama
ollama serve &

# 5. Run a task
python3 orchestration/orchestrator.py "Explain the CAP theorem in plain language"
```

---

## Model Roles

| Model              | Base              | Role                                      | VRAM  |
|--------------------|-------------------|-------------------------------------------|-------|
| `phi4-fast`        | Phi-4-mini Q8_0   | Router, classifier, complexity scorer     | 4.35 GB |
| `phi4-worker`      | Phi-4-mini Q8_0   | Fast single-tool executor                 | 4.35 GB |
| `qwen-supervisor`  | Qwen2.5-7B Q5_K_M | Planner, coordinator, synthesiser         | 5.58 GB |
| `qwen-worker`      | Qwen2.5-7B Q5_K_M | Complex tool chains, executor             | 5.49 GB |
| `deepseek-reasoner`| DeepSeek-R1-7B Q5 | Deep analysis, code gen, hard planning    | 5.67 GB |
| `deepseek-critic`  | DeepSeek-R1-7B Q5 | Post-run audit, APEX-17 evolution signals | 5.77 GB |

---

## Tool Library

| Tool               | Description                                              |
|--------------------|----------------------------------------------------------|
| `read_file`        | Read a local file (safe-path enforced)                   |
| `write_file`       | Write to `~/swarmx_outputs/` or `/tmp`                   |
| `run_python`       | Execute Python snippet (AST-level safety check)          |
| `http_get`         | HTTP GET with SSRF protection                            |
| `http_post`        | HTTP POST with JSON body + SSRF protection               |
| `json_validate`    | Validate JSON against message_schemas.json               |
| `summarise_text`   | Summarise text via phi4-fast                             |
| `list_tools`       | List all registered tools                                |
| `get_tool_call_log`| Return recent tool dispatch log (observability)          |

---

## Project Structure

```
swarmx/
├── orchestration/
│   ├── orchestrator.py       ← main agent loop (V5)
│   ├── tools.py              ← tool registry and dispatch
│   ├── swarmx_config.yaml    ← all runtime configuration
│   └── requirements.txt
├── modelfiles/
│   ├── primary/              ← 6 production models
│   │   ├── qwen-supervisor.modelfile
│   │   ├── qwen-worker.modelfile
│   │   ├── phi4-worker.modelfile
│   │   ├── phi4-fast.modelfile
│   │   ├── deepseek-reasoner.modelfile
│   │   └── deepseek-critic.modelfile
│   └── variants/             ← APEX-17 evolution cycle (optional)
│       ├── deepseek-r1-evolve.modelfile
│       ├── deepseek-r1-supervisor.modelfile
│       └── qwen2.5-evolve.modelfile
├── schemas/
│   └── message_schemas.json  ← JSON schema registry for all message types
├── setup/
│   ├── install.sh            ← build Ollama models + install deps
│   ├── health_check.py       ← pre-flight checks + benchmark
│   ├── test_integration.py   ← end-to-end model tests (12 test cases)
│   ├── zram_setup.sh         ← configure ZRAM swap (8 GB RAM systems)
│   └── ollama_env.sh         ← export OLLAMA_* env vars
├── docs/
│   ├── MODELFILE-GUIDE.md    ← memory math, params, co-load matrix
│   ├── kv_cache_reference.md ← KV cache deep-dive
│   ├── CHANGELOG.md          ← version history
│   └── env.swarmx.example    ← environment configuration template
└── README.md
```

---

## Configuration

All runtime constants live in `orchestration/swarmx_config.yaml`. Key sections:

```yaml
models:                    # model tag → role mapping
context_limits:            # per-model context windows
vram_estimates_mb:         # per-model VRAM estimates
co_load:                   # safe/unsafe co-load pairs
orchestration:             # max_steps, max_retries, tool_call_budget
routing:                   # complexity threshold, semantic validation
kv_cache:                  # per-role KV strategy
traces:                    # output dir, auto_critic, retention
observability:             # log level, latency targets, dispatch log
evolution:                 # APEX-17 gate floors
```

---

## CLI Reference

```bash
# Run a task
python3 orchestration/orchestrator.py "Your task here"

# Override trace directory
python3 orchestration/orchestrator.py --trace-dir /tmp/traces "Your task"

# Run critic on a saved trace
python3 orchestration/orchestrator.py --critic traces/trace_<uuid>.json

# Pre-flight check
python3 setup/health_check.py

# Latency benchmark (all primary models)
python3 setup/health_check.py --bench

# Co-load safety check
python3 setup/health_check.py --coload phi4-fast qwen-worker

# Live VRAM/RAM monitor
python3 setup/health_check.py --monitor

# Full integration tests
python3 setup/test_integration.py

# Fast integration tests (skip deepseek)
python3 setup/test_integration.py --fast

# Single model test
python3 setup/test_integration.py --model phi4-fast --verbose

# Build evolution variant models
BUILD_VARIANTS=1 bash setup/install.sh

# Reload a model after Modelfile change
ollama create qwen-supervisor -f modelfiles/primary/qwen-supervisor.modelfile
```

---

## APEX-17 Evolution Cycle

```
observe  → phi4-mini:swarmx-evolve   ← synthesises fitness signals from traces
critique → deepseek-r1:swarmx-evolve ← identifies root cause with causal chain
mutate   → qwen2.5:swarmx-evolve     ← generates ONE bounded proposal
validate → deepseek-r1:swarmx-evolve ← scores safety + reversibility
gate     → swarm-gate.sh μ-7         ← rejects if safety < 4 or reversibility < 3
                                        HUMAN REVIEW REQUIRED before any application
```

Improvement proposals are staged to `swarmx_improvements.jsonl`. No automated
prompt modification ever occurs. Human review is enforced at the gate level.

---

## Troubleshooting

**Model not found:**
```bash
ollama list | grep qwen-supervisor   # check if built
bash setup/install.sh                # rebuild
```

**Out of VRAM:**
```bash
python3 setup/health_check.py        # check what's loaded
# Reduce context window in swarmx_config.yaml
# Set OLLAMA_MAX_LOADED_MODELS=1 to enforce single-model mode
```

**JSON parse failures:**
- Check `traces/trace_<uuid>.json` for raw model output
- Run `python3 setup/test_integration.py --model <model> --verbose`
- Lower `temperature` in the relevant Modelfile and rebuild

**Slow inference:**
- Confirm `OLLAMA_FLASH_ATTENTION=1` is set
- Confirm `OLLAMA_KV_CACHE_TYPE=q8_0` is set
- Run benchmark: `python3 setup/health_check.py --bench`
- Check ZRAM: `python3 setup/health_check.py` (look for ZRAM row)

---

## License

MIT. Local models are subject to their respective licenses:
- Qwen2.5: [Qwen License](https://huggingface.co/Qwen/Qwen2.5-7B-Instruct)
- Phi-4-mini: [MIT](https://huggingface.co/microsoft/Phi-4-mini-instruct)
- DeepSeek-R1-Distill: [MIT](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-7B)
