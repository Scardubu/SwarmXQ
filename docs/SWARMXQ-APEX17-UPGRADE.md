# SwarmXQ APEX-17 r7 Upgrade — Dual-Layer Naming · Video Pipeline · Architectural Hardening

**Version:** v2026.5.25-apex17-r7-final
**Hardware target:** HP EliteBook 850 G3 · 8 GB RAM · CPU-only · WSL2

---

## 1. Summary

APEX-17 r7 resolves the naming bifurcation that had accumulated across six prior revisions: the TypeScript layer had already migrated to canonical tags in r6, while the Python layer, YAML configs, and Modelfiles still used `-scar` suffixes. r7 completes the migration by establishing a single `MODEL_OPERATOR_MAP` as the authoritative source of truth for both layers, introduces a human-readable Operator identity layer (Relay, Pilot, Architect, Forge, Oracle, Auditor, Lab) and ships a one-shot migration script.

Three pillars:

1. **Dual-Layer Naming System** — canonical runtime tags for machines, Operator names for humans, synchronized through `MODEL_OPERATOR_MAP`.
2. **Video Generation Pipeline** — pressure-aware faceless video production: ComfyUI + LTX/Wan GGUF + Kokoro TTS, integrated with the agent council orchestration layer.
3. **Architectural Hardening** — SINGLE-7B LOCK serialization, predictive warmup, adaptive timeouts per Operator, degraded-mode handling, and full lifecycle management on `ModelOrchestrator`.

---

## 2. Operator Taxonomy

| Operator | Role | Canonical Tag(s) | Family | Quant | RAM | 7B |
|----------|------|-------------------|--------|-------|-----|----|
| **Relay** | `route` | `route-phi4-lite-q4km-prod` | phi4 | Q4_K_M | ~2.5 GB | No |
| **Pilot** | `instruct` | `instruct-phi4-pro-q8-prod` | phi4 | Q8_0 | ~4.3 GB | No |
| **Architect** | `plan` | `plan-phi4-pro-q8-prod`, `plan-qwen25-pro-q5km-prod`, `plan-deepseekr1-pro-q5km-prod` | Mixed | Mixed | 4.3–5.4 GB | Mixed |
| **Forge** | `code` | `code-qwen25-pro-q5km-prod` | qwen25 | Q5_K_M | ~5.4 GB | Yes |
| **Oracle** | `reason` | `reason-deepseekr1-pro-q5km-prod` | deepseekr1 | Q5_K_M | ~5.4 GB | Yes |
| **Auditor** | `critique` | `critique-deepseekr1-pro-q5km-prod` | deepseekr1 | Q5_K_M | ~5.4 GB | Yes |
| **Lab** | `synth` | `synth-phi4-exp-q8-dev`, `synth-qwen25-exp-q5km-dev`, `synth-deepseekr1-exp-q5km-dev` | Mixed | Mixed | 4.4–5.4 GB | Mixed |

---

## 3. Naming Standard

### Tag Grammar

```
<role>-<family>-<tier>-<quant>-<env>
```

| Field | Values |
|-------|--------|
| `role` | `route`, `instruct`, `plan`, `code`, `reason`, `critique`, `synth` |
| `family` | `phi4`, `qwen25`, `deepseekr1` |
| `tier` | `lite` (smallest), `pro` (production), `exp` (experimental) |
| `quant` | `q4km`, `q8`, `q5km` |
| `env` | `prod`, `dev` |

### Usage Rules

| Context | Use |
|---------|-----|
| Code, configs, Ollama commands, registry | Canonical runtime tag |
| Docs, dashboards, logs, UI, comments | Operator name |
| Mixed contexts (structured logs) | `Operator (canonical-tag)` via `format_operator_label()` |

### Source of Truth

| Layer | File |
|-------|------|
| TypeScript | `packages/swarmx-types/src/operator-map.ts` |
| Python | `src/swarmx/operator_map.py` |
| YAML registry | `models/registry.yaml` (with `operator_name` field) |

---

## 4. Changelog

### 4.1 Naming Migration

| ID | File | Change |
|----|------|--------|
| NM-01 | `packages/swarmx-types/src/operator-map.ts` | **NEW** — authoritative TypeScript `MODEL_OPERATOR_MAP` with full `OperatorEntry` metadata (estimatedRamMb, defaultCtx, temperature, topP, description), `MODEL_ALIASES` covering 25+ legacy tags, resolution helpers |
| NM-02 | `src/swarmx/operator_map.py` | **NEW** — Python mirror with identical semantics; `OperatorEntry` TypedDict, same alias map, same helpers (snake_case) |
| NM-03 | `src/swarmx/config.py` | **FULL REPLACEMENT** — `_model_alias_map()` sources from `operator_map.MODEL_ALIASES`; `_DEFAULT_RELAY/PILOT/FORGE/ORACLE` constants use canonical tags; `runtime_profile()` emits dual-layer `{tag, operator}` per model entry; `_LEGACY_TAGS` validation set includes both pre-scar AND -scar tags |
| NM-04 | `src/swarmx/llm_patch_r7.py` | **NEW** — surgical `llm.py` patch instructions + Python script for automated `_MODEL_TEMPERATURES` / `_MODEL_TOP_P` prepend |
| NM-05 | `apps/swarmx-api/src/services/adaptive-timeout-config.ts` | **FULL REPLACEMENT** — `MODEL_BASE_PROFILES` rebuilt with canonical keys; circuit breaker key normalization via `resolveCanonicalTag()`; `AdaptiveCallConfig` adds `operator` field; all log messages use `formatOperatorLabel()` |
| NM-06 | `models/registry.yaml` | **FULL REPLACEMENT** — all `ollama_tag` values canonical; `operator_name`, `legacy_aliases`, `composer_tier` fields added to every entry; `operator_taxonomy` section documents all 7 Operators |
| NM-07 | `configs/swarmx.defaults.yaml` | Migrated — all `model_fast/reason/code` defaults → canonical; triadic_dispatch keys → canonical |
| NM-08 | `configs/routing.yaml` | **FULL REPLACEMENT** — all triadic_model_config keys → canonical; `adversarial_check.critic_model` fixed (was incorrectly set to Relay, now Pilot); `narrative.model` fixed (was Relay, now Pilot); `exclusive_pairs` expanded with all 7B combos; escalation chain updated |
| NM-09 | `configs/evolution.yaml` | Lab Operator tags (`synth-*`) for observe/critique/mutate |
| NM-10 | `configs/v6-overlay.yaml` | Lab Operator tags; annotated with Operator name comments |
| NM-11 | `manifests/swarmx_model_manifest.yaml` | **FULL REPLACEMENT** — canonical model identifiers; `operator`, `legacy_alias` fields per stack entry; `replaces[]` matrix |
| NM-12 | `tests/test_naming_validation.py` | **NEW** — 30+ tests covering grammar validation, alias resolution, operator lookup, TS/Python mirror consistency, repo-wide audit |

### 4.2 Fixes Included in This Bundle (Bugs in r5/r6)

| ID | File | Bug Fixed |
|----|------|-----------|
| BUG-01 | `configs/routing.yaml` | `adversarial_check.critic_model` was `phi4-router-lite-scar` (Relay). Relay is a deterministic JSON router with a 96-token output ceiling — it cannot produce adversarial critique. Fixed to Pilot (`instruct-phi4-pro-q8-prod`). |
| BUG-02 | `configs/routing.yaml` | `llm_retry.narrative.model` was `phi4-router-lite-scar` (Relay). Relay is JSON-only; narrative synthesis requires 3–5 natural sentences. Fixed to Pilot. |
| BUG-03 | `apps/swarmx-api/src/services/adaptive-timeout-config.ts` | `MODEL_BASE_PROFILES` used `-scar` keys — profiles never matched after TypeScript layer migrated to canonical tags in r6. Fixed by rebuilding with canonical keys. |
| BUG-04 | `apps/swarmx-api/src/services/adaptive-timeout-config.ts` | `getCircuit()` used raw model key without canonicalization — legacy and canonical tags tracked separate circuit breaker state for the same model. Fixed with `resolveCanonicalTag()` at entry. |

### 4.3 New Scripts

| Script | Purpose |
|--------|---------|
| `scripts/migrate-to-r7.sh` | One-shot migration with `--dry-run`, `--apply`, `--rollback`, `--rename-only`, `--validate-only` modes |
| `scripts/rebuild-all-modelfiles.sh` | Canonical model rebuild with `--validate`, `--evict-legacy`, `--only` modes |
| `scripts/swarm-healthcheck-apex17.sh` | Production healthcheck covering Ollama, canonical models, Relay probe, API, memory, naming |

### 4.4 New Modelfiles (5 canonical names)

| Modelfile | Operator | Was |
|-----------|----------|-----|
| `route-phi4-lite-q4km-prod.modelfile` | Relay | `phi4-router-lite-scar.modelfile` |
| `instruct-phi4-pro-q8-prod.modelfile` | Pilot | `phi4-fast-scar.modelfile` |
| `code-qwen25-pro-q5km-prod.modelfile` | Forge | `qwen-worker-scar.modelfile` |
| `reason-deepseekr1-pro-q5km-prod.modelfile` | Oracle | `deepseek-reasoner-scar.modelfile` |
| `critique-deepseekr1-pro-q5km-prod.modelfile` | Auditor | `deepseek-critic-scar.modelfile` |

Each Modelfile has a substantially improved SYSTEM prompt:
- Operator-branded identity (name + canonical tag + version)
- Clear purpose statement and delegation rules
- Correct model-specific stop tokens
- Operator-level memory math in header comments

### 4.5 Video Pipeline

| ID | File | Change |
|----|------|--------|
| VP-01 | `apps/swarmx-api/src/services/video-orchestrator.ts` | VOT-11: high-pressure backoff (3s) before 7B load; VOT-12: poll ceiling alignment |
| VP-02–06 | Various | Video queue, assets, types, routes, dashboard page — functional in r5; r7 updates operator references in logs |

### 4.6 Documentation

| Document | Change |
|----------|--------|
| `README.md` | Rewritten — Operator taxonomy table, canonical naming rules, architecture, video pipeline, migration guide |
| `docs/SWARMXQ-APEX17-UPGRADE.md` | This document |
| `docs/SETUP_AND_IMPLEMENTATION.md` | **NEW** — step-by-step installation with prerequisites, manual steps, automated path, rollback, validation, common issues, post-migration checklist |

---

## 5. Legacy Alias Map (complete)

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

Resolution happens at the first entry point in each layer: `resolveCanonicalTag()` in TypeScript, `resolve_canonical_tag()` in Python. Both are O(1) hash lookups.

**Removal criteria:** after one full production cycle with zero -scar log entries, run `rg -rn "\-scar" . | grep -v "alias\|legacy\|ALIAS\|LEGACY"`. When that returns zero hits, the alias maps can be dropped from both source files.

---

## 6. Migration Path Reference

| From | To | Automated | Notes |
|------|----|-----------|-------|
| APEX-17 r6 | APEX-17 r7 | `--apply` | TS layer was already canonical; Python + YAML + Modelfiles need migration |
| APEX-17 r5 | APEX-17 r7 | `--apply` | Same as r6 path |
| V5 / pre-scar | APEX-17 r7 | `--apply` | Pre-scar aliases also covered |

---

## 7. Files Replaced by This Bundle

```
packages/swarmx-types/src/operator-map.ts
src/swarmx/operator_map.py
src/swarmx/config.py
apps/swarmx-api/src/services/adaptive-timeout-config.ts
configs/swarmx.defaults.yaml
configs/routing.yaml
configs/evolution.yaml
configs/v6-overlay.yaml
models/registry.yaml
manifests/swarmx_model_manifest.yaml
.vscode/tasks.json
README.md
docs/SWARMXQ-APEX17-UPGRADE.md
docs/SETUP_AND_IMPLEMENTATION.md        (new)
tests/test_naming_validation.py          (new)
scripts/migrate-to-r7.sh                 (new)
scripts/rebuild-all-modelfiles.sh
scripts/swarm-healthcheck-apex17.sh
models/Modelfiles/primary/route-phi4-lite-q4km-prod.modelfile
models/Modelfiles/primary/instruct-phi4-pro-q8-prod.modelfile
models/Modelfiles/primary/code-qwen25-pro-q5km-prod.modelfile
models/Modelfiles/primary/reason-deepseekr1-pro-q5km-prod.modelfile
models/Modelfiles/primary/critique-deepseekr1-pro-q5km-prod.modelfile
```

---

*The incision is precise.*
