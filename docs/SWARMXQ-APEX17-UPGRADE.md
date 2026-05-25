# SwarmXQ APEX-17 r7 Upgrade — Dual-Layer Naming, Video Pipeline, Architectural Hardening

**Version:** v2026.5.25-apex17-r7
**Hardware target:** HP EliteBook 850 G3 · 8 GB RAM · CPU-only · WSL2

---

## 1. What Changed

APEX-17 r7 introduces three major capabilities:

1. **Dual-Layer Naming System** — canonical runtime tags for machines, memorable Operator names for humans, synchronized through a single `MODEL_OPERATOR_MAP` source of truth.

2. **Video Generation Pipeline** — a pressure-aware, faceless video production subsystem integrated with ComfyUI, Kokoro TTS, and the SwarmXQ agent orchestration layer.

3. **Architectural Hardening** — SINGLE-7B LOCK serialization, predictive warmup, adaptive timeouts, degraded-mode handling, and lifecycle methods on ModelOrchestrator.

---

## 2. Operator Taxonomy

| Operator | Role | Canonical Tag(s) | Function |
|----------|------|-------------------|----------|
| **Relay** | `route` | `route-phi4-lite-q4km-prod` | Ultra-light routing, intent classification |
| **Pilot** | `instruct` | `instruct-phi4-pro-q8-prod` | Fast generalist, session routing, Q&A |
| **Architect** | `plan` | `plan-phi4-pro-q8-prod`, `plan-qwen25-pro-q5km-prod`, `plan-deepseekr1-pro-q5km-prod` | Planning, orchestration, strategy |
| **Forge** | `code` | `code-qwen25-pro-q5km-prod` | Code generation, tool use, execution |
| **Oracle** | `reason` | `reason-deepseekr1-pro-q5km-prod` | Deep reasoning, diagnosis, architecture |
| **Auditor** | `critique` | `critique-deepseekr1-pro-q5km-prod` | Adversarial review, safety validation |
| **Lab** | `synth` | `synth-phi4-exp-q8-dev`, `synth-qwen25-exp-q5km-dev`, `synth-deepseekr1-exp-q5km-dev` | Experimental evolution |

---

## 3. Canonical Naming Standard

### Tag Grammar

```
<role>-<family>-<tier>-<quant>-<env>
```

- **role:** route, instruct, plan, code, reason, critique, synth
- **family:** phi4, qwen25, deepseekr1
- **tier:** lite, pro, exp
- **quant:** q4km, q8, q5km
- **env:** prod, dev

### Usage Rules

| Context | Use |
|---------|-----|
| Code, configs, Ollama commands, registry keys | Canonical runtime tag |
| Docs, dashboards, logs, UI, comments | Operator name |
| Mixed contexts (logs, debug) | `[Operator \| canonical-tag]` |

### Source of Truth

- **TypeScript:** `packages/swarmx-types/src/operator-map.ts`
- **Python:** `src/swarmx/operator_map.py`
- **YAML:** `models/registry.yaml` (with `operator_name` field)

---

## 4. Changelog

### Dual-Layer Naming Migration

| ID | File | Change |
|----|------|--------|
| NM-01 | `packages/swarmx-types/src/operator-map.ts` | **NEW** — authoritative TypeScript MODEL_OPERATOR_MAP with resolve helpers |
| NM-02 | `src/swarmx/operator_map.py` | **NEW** — authoritative Python MODEL_OPERATOR_MAP mirroring TypeScript |
| NM-03 | `src/swarmx/config.py` | Migrated `_model_alias_map()` to resolve through `operator_map.MODEL_ALIASES`. All default fields now use canonical tags instead of `-scar` suffixes |
| NM-04 | `src/swarmx/llm.py` | Prepended canonical tag entries to `_MODEL_TEMPERATURES` and `_MODEL_TOP_P` maps. Kept legacy entries for backward compatibility |
| NM-05 | `models/registry.yaml` | All `ollama_tag` values migrated to canonical grammar. Added `operator_name` and `legacy_aliases` fields to every entry |
| NM-06 | `.vscode/tasks.json` | All `-scar` tags replaced with canonical tags. Added "Validate Naming Standard" and "Evict Legacy" tasks |
| NM-07 | `apps/swarmx-api/src/services/model-orchestrator.ts` | MODEL_REGISTRY and MODEL_ALIASES already used canonical tags since r6 — no change needed. `resolveCanonicalTag()` now re-exported from operator-map.ts |
| NM-08 | `tests/test_naming_validation.py` | **NEW** — 25+ test cases validating naming grammar, alias resolution, operator lookup, and regression detection |

### Video Pipeline

| ID | File | Change |
|----|------|--------|
| VP-01 | `apps/swarmx-api/src/services/video-orchestrator.ts` | STAGE_MODEL_TAG already uses canonical tags (r6). r7 adds high-pressure backoff delay [VOT-11] and poll ceiling alignment [VOT-12] |
| VP-02 | `apps/swarmx-api/src/services/video-queue.ts` | Queue manager with priority lanes and pressure-aware scheduling |
| VP-03 | `apps/swarmx-api/src/services/video-assets.ts` | Asset resolver for ComfyUI workflows and TTS audio |
| VP-04 | `apps/swarmx-api/src/types/video.ts` | Type definitions for video job lifecycle |
| VP-05 | `apps/swarmx-api/src/routes/video.ts` | REST + SSE endpoints for video job management |
| VP-06 | `apps/swarmx-dashboard/src/app/(dashboard)/video/page.tsx` | Dashboard UI with job cards, timeline, and progress tracking |
| VP-07 | `workflows/video-generation.yaml` | Workflow definition for agent-council video production |

### Architectural Fixes

| ID | File | Change |
|----|------|--------|
| AF-01 | `model-orchestrator.ts` [MOT-01] | Serialization mutex on `requestModel()` prevents concurrent 7B races |
| AF-02 | `model-orchestrator.ts` [MOT-03–05] | `resolveCanonicalTag()` applied at entry of all public methods |
| AF-03 | `model-orchestrator.ts` [MOT-06] | Exhaustive default branch in `_keepAliveFor()` — fixes TS2366 |
| AF-04 | `model-orchestrator.ts` [MOT-09] | `init()` syncs live Ollama state and preloads Relay on boot |
| AF-05 | `model-orchestrator.ts` [MOT-10] | `destroy()` cancels warmup and drains in-flight eviction |
| AF-06 | `video-orchestrator.ts` [VOT-11] | High-pressure backoff delay (3s configurable) before 7B load |
| AF-07 | `reasoning-sanitizer.ts` | Centralized `<think>` block stripping for DeepSeek/Qwen output |

### Performance & Resilience

| ID | Change |
|----|--------|
| PR-01 | Adaptive timeouts scale with pressure tier (normal → 0.75x → 0.5x → degraded) |
| PR-02 | RAM-aware ctx/predict overrides reduce context windows under pressure |
| PR-03 | Predictive warmup fires after Relay classification, before user confirmation |
| PR-04 | Composer tier selection expanded with SwarmX/TaxBridge/SabiScore domain vocabulary |
| PR-05 | Video pipeline stages check pressure before each model acquisition |

### Documentation Streamlining

| ID | Change |
|----|--------|
| DS-01 | README.md rewritten — operator taxonomy table, canonical naming rules, architecture overview, video pipeline summary, migration guide |
| DS-02 | This UPGRADE document consolidates all r7 changes in structured format |
| DS-03 | Removed redundant `README 2.md` — consolidated into single README |
| DS-04 | Documentation follows layered structure: quick start → taxonomy → architecture → reference |

---

## 5. Migration Guide

### Step 1 — Add operator_map module

Copy `src/swarmx/operator_map.py` and `packages/swarmx-types/src/operator-map.ts` into your repo.

### Step 2 — Update config.py

Apply changes from `src/swarmx/config_patch_r7.py`:
- Add `from .operator_map import MODEL_ALIASES, resolve_canonical_tag` import
- Replace `_model_alias_map()` body to use the authoritative alias map
- Update default model field values from `-scar` to canonical tags
- Expand `_LEGACY_TAGS` validation set

### Step 3 — Update llm.py

Prepend canonical tag entries from `src/swarmx/llm_patch_r7.py` to `_MODEL_TEMPERATURES` and `_MODEL_TOP_P`.

### Step 4 — Replace registry.yaml

Copy `models/registry.yaml` (new version with `operator_name`, `legacy_aliases`, canonical `ollama_tag`).

### Step 5 — Rebuild models

```bash
bash scripts/rebuild-all-modelfiles.sh
bash scripts/rebuild-all-modelfiles.sh --evict-legacy  # optional: remove old -scar models
```

### Step 6 — Validate

```bash
bash scripts/rebuild-all-modelfiles.sh --validate
python -m pytest tests/test_naming_validation.py -v
```

### Step 7 — Update VS Code

Copy `.vscode/tasks.json` to get canonical-tag commands.

---

## 6. Compatibility

| Legacy Tag | Resolves To | Operator |
|------------|-------------|----------|
| `phi4-router-lite-scar` | `route-phi4-lite-q4km-prod` | Relay |
| `phi4-fast-scar` | `instruct-phi4-pro-q8-prod` | Pilot |
| `phi4-worker-scar` | `plan-phi4-pro-q8-prod` | Architect |
| `phi4-evolve-scar` | `synth-phi4-exp-q8-dev` | Lab |
| `qwen-worker-scar` | `code-qwen25-pro-q5km-prod` | Forge |
| `qwen-supervisor-scar` | `plan-qwen25-pro-q5km-prod` | Architect |
| `qwen-evolve-scar` | `synth-qwen25-exp-q5km-dev` | Lab |
| `deepseek-reasoner-scar` | `reason-deepseekr1-pro-q5km-prod` | Oracle |
| `deepseek-supervisor-scar` | `plan-deepseekr1-pro-q5km-prod` | Architect |
| `deepseek-critic-scar` | `critique-deepseekr1-pro-q5km-prod` | Auditor |
| `deepseek-evolve-scar` | `synth-deepseekr1-exp-q5km-dev` | Lab |
| `phi4-fast` | `instruct-phi4-pro-q8-prod` | Pilot |
| `phi4-mini` | `instruct-phi4-pro-q8-prod` | Pilot |
| `deepseek-r1` | `reason-deepseekr1-pro-q5km-prod` | Oracle |
| `deepseek-r1:7b` | `reason-deepseekr1-pro-q5km-prod` | Oracle |
| `qwen-worker` | `code-qwen25-pro-q5km-prod` | Forge |
| `qwen2.5-coder` | `code-qwen25-pro-q5km-prod` | Forge |

Aliases are resolved at the earliest possible entry point in each layer:
- **TypeScript:** `resolveCanonicalTag()` in `requestModel()`, `preloadNextSpecialist()`, `syncFromOllama()`
- **Python:** `normalize_model_tag()` in `config.py` → `resolve_canonical_tag()` in `operator_map.py`

Removal criteria: after one successful production cycle, run `rg -rn "scar" .` — if only alias definitions remain, the legacy map can be dropped.

---

## 7. New Capabilities Summary

- **Operator-driven identity** — Relay, Pilot, Architect, Forge, Oracle, Auditor, Lab as a cohesive, memorable taxonomy
- **Operator-driven video production** — multi-stage pipeline dispatching through the agent council
- **Memory-aware orchestration** — four-tier pressure system with adaptive timeouts and context scaling
- **Graceful degraded-mode behavior** — the system keeps working at reduced capacity instead of crashing
- **Naming validation tooling** — automated tests and scripts that prevent naming drift
- **Cleaner human readability** — every log, dashboard, and doc uses the Operator name first, canonical tag second
- **Stronger production reliability** — serialized 7B transitions, lifecycle init/destroy, predictive warmup
