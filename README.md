# SwarmX Operator Platform V6

SwarmX V6 is the self-improving operator layer on top of the existing control plane. It keeps the bounded mission runtime, live dashboard, audit trail, and workflow engine, and adds an autonomous evolution overlay that can observe, critique, mutate, validate, and stage improvements without mutating the base system blindly.

## Model triad

The bundled routing is aligned to this local triad:

- `phi4-mini` — router / orchestrator
- `deepseek-r1:7b` — reasoning / critique / architecture
- `qwen2.5-coder` — execution / code / tool use

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

## Documentation

- `ARCHITECTURE.md`
- `SAFETY.md`
- `INTEGRATION.md`
- `SYSTEM-PROMPT.md`
- `configs/`
- `models/`
- `workflows/`
