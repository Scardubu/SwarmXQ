# SwarmX v4.0-FINAL — Integration Instructions

## What changed in this bundle

All files are drop-in replacements. The bundle is self-contained — every file is
already in its correct location relative to the root. No `upgraded/` subdirectory exists.

## Verifying the install

```bash
chmod +x swarm.sh swarm-gate.sh scripts/*.sh
./scripts/install.sh         # creates .venv, pulls model triad, links launchers, writes shell exports
source ~/.bashrc             # or ~/.zshrc
swarm doctor                 # confirms runtime, model triad, and skill count
bash ./scripts/verify.sh     # compile + import smoke test + doctor JSON + IEP keyword check
```

## Post-install smoke run

```bash
swarm init ~/my-project
swarm plan ~/my-project "backend hardening"
swarm run  ~/my-project --target "backend hardening" --autonomous --max-iterations 2
swarm memory
swarm evolve ~/my-project
swarm up --dashboard
swarm status dashboard
```

## Key file roles

| Path | Role |
|------|------|
| `SYSTEM-PROMPT.md` | System prompt — drop into any agent runtime as the system message |
| `agents/*.md` | Role cards — each agent loads its own card as context |
| `skills/*.md` | Skill cards — routed by `match_skills()` based on stack + target |
| `skills/catalog.yaml` | Machine-readable skill index used by the skill selector |
| `agents/catalog.yaml` | Machine-readable agent roster used by the planner |
| `workflows/*.yaml` | Execution recipes — loaded by `load_workflow()` |
| `configs/swarmx.defaults.yaml` | Master runtime defaults (model triad defined here) |
| `configs/routing.yaml` | Triadic dispatch rules — per-model roles, timeouts, context windows |
| `configs/evolution.yaml` | Island tournament + PromptBreeder settings |
| `configs/guardrails.yaml` | Safety policy + IEP-ELITE invariants + crossover ceiling |
| `src/swarmx/` | Core Python runtime |
| `dashboard/` | legacy static dashboard assets preserved for compatibility |
| `swarm-gate.sh` | IEP-ELITE micro-utility gate runner (μ-1 through μ-5) |

## LLM provider configuration

### Ollama (default — local triadic dispatch)

```bash
export SWARM_LLM_PROVIDER=ollama
export SWARM_MODEL_FAST=phi4-mini       # Phi-4-mini   — orchestrator / router brain
export SWARM_MODEL_REASON=deepseek-r1:7b  # DeepSeek-R1 — reasoning / planning
export SWARM_MODEL_CODE=qwen2.5-coder-7b    # Qwen2.5-Coder-7B  — execution / coding / tools
```

Pull the triad:
```bash
ollama pull phi4-mini
ollama pull deepseek-r1:7b
ollama pull qwen2.5-coder-7b
```

### OpenAI-compatible

```bash
export SWARM_LLM_PROVIDER=openai
export OPENAI_API_KEY=sk-...
export SWARM_MODEL_FAST=gpt-4o-mini
export SWARM_MODEL_REASON=o3-mini
export SWARM_MODEL_CODE=gpt-4o
```

### Deterministic (no LLM — for CI/testing)

```bash
export SWARM_LLM_PROVIDER=deterministic
```

### Resource-constrained fallback (< 8 GB RAM)

```yaml
# In configs/swarmx.defaults.yaml — routing section:
routing:
  model_fast:   phi3
  model_reason: llama3:8b
  model_code:   llama3:8b
```

## Triadic dispatch architecture

```
┌──────────────────────────────┐
│  🧠 ORCHESTRATOR             │
│  Phi-4-mini  (always-on)     │
│  routing · decisions · triage│
└──────┬──────────────┬────────┘
       │              │
┌──────┘              └────────┐
▼                              ▼
┌──────────────────┐  ┌──────────────────┐
│  REASONING       │  │  EXECUTION       │
│  DeepSeek-R1:7B  │  │  Qwen2.5-Coder-7B     │
│  planning · arch │  │  code · tools    │
└──────────────────┘  └──────────────────┘
```

Dispatch signal (resolved by Phi-4-mini before every task):
- `code` → implement / refactor / test / tool_call → **Qwen2.5-Coder-7B**
- `reason` → plan / research / architecture / analyse → **DeepSeek-R1:7B**
- `router` → route / score / memory / status → **Phi-4-mini (direct)**

## Adding a new workflow

1. Create `workflows/<name>.yaml` following `templates/workflow-blueprint.yaml`.
2. Add the workflow name to `workflow_for_target()` keyword routing in `src/swarmx/workflows.py`.
3. Run `swarm workflows` to confirm it appears.

## Adding a new skill

1. Create `skills/<name>.md` following the format of any existing skill card.
2. Add an entry to `skills/catalog.yaml`.
3. Add a `SkillCard(...)` entry in `DEFAULT_SKILLS` in `src/swarmx/skills.py` if it should be available without a catalog file.
4. Run `swarm skills` to confirm it appears.
