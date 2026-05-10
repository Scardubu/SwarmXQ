# SwarmX V6 · Local Model Registry

This bundle is wired for a local Ollama triad. All model configuration is centralized
in `models/registry.yaml`. To change a model, edit that file — no other files need
manual edits (the config system reads the registry at startup via `_bundle_defaults()`).

---

## Registered roles

| Role          | Ollama tag         | GGUF file                                      | Quant  |
|---------------|--------------------|------------------------------------------------|--------|
| orchestrator  | `phi4-fast`        | `microsoft_Phi-4-mini-instruct-Q8_0.gguf`      | Q8_0   |
| reasoning     | `deepseek-reasoner`| `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf`     | Q5_K_M |
| execution     | `qwen-worker`      | `Qwen2.5-7B-Instruct-Q5_K_M.gguf`             | Q5_K_M |

Role names match the `triad.<role>.role` field in `registry.yaml` and the
`Model triad` section of `ARCHITECTURE.md`.

---

## Registering the GGUF files with Ollama

GGUF files are not bundled here — place them in a directory on disk
(e.g. `~/llm-local/gguf/`), then register each one via a Modelfile.
Modelfile templates are provided in `models/Modelfiles/`.

```bash
# 1. Register Phi-4-fast (orchestrator / router)
ollama create phi4-fast \
  -f models/Modelfiles/primary/phi4-fast.modelfile

# 2. Register DeepSeek Reasoner (reasoning engine)
ollama create deepseek-reasoner \
  -f models/Modelfiles/primary/deepseek-reasoner.modelfile

# 3. Register Qwen Worker (execution engine)
ollama create qwen-worker \
  -f models/Modelfiles/primary/qwen-worker.modelfile

# 4. Verify all three are visible
ollama list

# 5. Validate the full triad is healthy
swarm doctor
```

---

## Swapping a model (future-proof workflow)

1. Place the new GGUF in `~/llm-local/gguf/` (or your preferred path).
2. Edit `models/registry.yaml` → update `gguf_file`, `name`, `ollama_tag`, `quant`,
   and `context_window` if the new model differs.
3. Copy the nearest Modelfile template from `models/Modelfiles/primary/` and give it a new
  name matching the Ollama tag you'll use (e.g. `phi4-custom.modelfile` for tag `phi4-custom`).
   Update `FROM` to the new GGUF path and adjust `PARAMETER` values to match
  `registry.yaml`.
4. Remove the old model: `ollama rm <old-tag>`.
5. Register the new model: `ollama create <new-tag> -f models/Modelfiles/primary/<new-modelfile>.modelfile`.
6. Run `swarm doctor` to confirm the swap is healthy.

No Python source files need editing — the config system resolves everything from
`models/registry.yaml` → `configs/swarmx.defaults.yaml` at startup.

---

## Environment variable overrides

For per-session model overrides without touching the registry:

```bash
export SWARM_MODEL_FAST="my-custom-router"    # overrides the orchestrator slot
export SWARM_MODEL_REASON="my-reason-model"   # overrides the reasoning slot
export SWARM_MODEL_CODE="my-code-model"       # overrides the execution slot
```

These take precedence over `registry.yaml` values and `swarmx.defaults.yaml`.

---

## Low-Latency Tuning (Recommended)

For faster first-response behavior on constrained hosts, keep Composer and
startup warmup aligned with local Ollama performance:

```bash
# Composer model path (API): reduce response ceiling for faster completion
export SWARMX_COMPOSER_NUM_PREDICT=256

# Composer timeout: keep high enough for cold starts, not infinite
export SWARMX_COMPOSER_TIMEOUT_MS=60000

# Short prompt cap: avoid premature fallbacks for short interactive queries
export SWARMX_COMPOSER_SHORT_PROMPT_TIMEOUT_MS=45000

# Keep router warm between bursts to avoid repeated reload latency
export SWARMX_COMPOSER_KEEP_ALIVE=10m

# Startup script probe timeout (prevents hanging on half-open sockets)
export SWARMX_STARTUP_CURL_MAX_TIME=8
```

Practical guidance:
- Lower `SWARMX_COMPOSER_NUM_PREDICT` first when chasing latency spikes.
- Increase `SWARMX_COMPOSER_TIMEOUT_MS` only if cold-load timeouts persist.
- Avoid very long keep-alive windows on low-RAM hosts if memory pressure rises.
