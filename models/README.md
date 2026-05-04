# SwarmX V6 · Local Model Registry

This bundle is wired for a local Ollama triad. All model configuration is centralized
in `models/registry.yaml`. To change a model, edit that file — no other files need
manual edits (the config system reads the registry at startup via `_bundle_defaults()`).

---

## Registered roles

| Role          | Ollama tag         | GGUF file                                      | Quant  |
|---------------|--------------------|------------------------------------------------|--------|
| orchestrator  | `phi4-mini`        | `microsoft_Phi-4-mini-instruct-Q8_0.gguf`      | Q8_0   |
| reasoning     | `deepseek-r1:7b`   | `DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf`     | Q5_K_M |
| execution     | `qwen2.5-coder`    | `Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf`       | Q5_K_M |

Role names match the `triad.<role>.role` field in `registry.yaml` and the
`Model triad` section of `ARCHITECTURE.md`.

---

## Registering the GGUF files with Ollama

GGUF files are not bundled here — place them in a directory on disk
(e.g. `~/llm-local/gguf/`), then register each one via a Modelfile.
Modelfile templates are provided in `models/Modelfiles/`.

```bash
# 1. Register Phi-4-mini (orchestrator / router)
ollama create phi4-mini \
  -f models/Modelfiles/Modelfile.phi4-mini

# 2. Register DeepSeek-R1 (reasoning engine)
ollama create deepseek-r1:7b \
  -f models/Modelfiles/Modelfile.deepseek-r1

# 3. Register Qwen2.5-Coder (execution engine)
ollama create qwen2.5-coder \
  -f models/Modelfiles/Modelfile.qwen2.5-coder

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
3. Copy the nearest Modelfile template from `models/Modelfiles/` and give it a new
   name matching the Ollama tag you'll use (e.g. `Modelfile.phi4` for tag `phi4`).
   Update `FROM` to the new GGUF path and adjust `PARAMETER` values to match
   `registry.yaml`. Note: Modelfile names use the Ollama base tag without version
   suffix (e.g. `Modelfile.deepseek-r1`, not `Modelfile.deepseek-r1:7b`).
4. Remove the old model: `ollama rm <old-tag>`.
5. Register the new model: `ollama create <new-tag> -f models/Modelfiles/<new-modelfile>`.
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
