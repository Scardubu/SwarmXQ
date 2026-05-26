# SwarmXQ APEX-17 r7 — Setup & Implementation Guide

**Version:** v2026.5.25-apex17-r7-final
**Target Hardware:** HP EliteBook 850 G3 · 8 GB RAM · CPU-only · WSL2

This guide walks you through installing the APEX-17 r7 bundle onto an existing SwarmXQ repository, performing the dual-layer naming migration, renaming Ollama models, and validating the result.

---

## Table of Contents

1. [Prerequisites](#1-prerequisites)
2. [Bundle Contents Overview](#2-bundle-contents-overview)
3. [Fastest Path — Automated Migration](#3-fastest-path--automated-migration)
4. [Manual Step-by-Step Installation](#4-manual-step-by-step-installation)
5. [Ollama Model Rename](#5-ollama-model-rename)
6. [Validation](#6-validation)
7. [Rollback Procedure](#7-rollback-procedure)
8. [Common Issues](#8-common-issues)
9. [Post-Migration Checklist](#9-post-migration-checklist)

---

## 1. Prerequisites

### Required

- An existing SwarmXQ repository at any prior version (r5, r6, or pre-scar)
- Python 3.11+ with the SwarmX virtual environment activated
- Node.js 22+ with pnpm
- Ollama running locally with GGUF models in `~/llm-local/gguf/`
- At least 500 MB free disk for backup
- At least 2 GB free RAM during the migration

### Verify Prerequisites

```bash
# Python and venv
python3 --version                           # 3.11+
which python3                               # should point to .venv

# Node + pnpm
node --version                              # v22+
pnpm --version                              # 9+

# Ollama
ollama --version
curl -s http://localhost:11434/api/tags | python3 -m json.tool | head -20

# GGUF files
ls ~/llm-local/gguf/
# Expected:
#   DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf
#   Qwen2.5-7B-Instruct-Q5_K_M.gguf
#   microsoft_Phi-4-mini-instruct-Q4_K_M.gguf  (for Relay)
#   microsoft_Phi-4-mini-instruct-Q8_0.gguf    (for Pilot)

# Free RAM and disk
free -m | head -2
df -h .
```

---

## 2. Bundle Contents Overview

The bundle delivers **22 files** organized into 8 categories:

### Source of Truth (2 files — install FIRST)
- `packages/swarmx-types/src/operator-map.ts` — TypeScript authoritative MODEL_OPERATOR_MAP
- `src/swarmx/operator_map.py` — Python mirror

### Python Layer (3 files)
- `src/swarmx/config.py` — full replacement with canonical defaults
- `src/swarmx/llm_patch_r7.py` — patch instructions for llm.py (applied via migrate script)
- `tests/test_naming_validation.py` — 30+ validation test cases

### TypeScript Layer (1 file)
- `apps/swarmx-api/src/services/adaptive-timeout-config.ts` — canonical MODEL_BASE_PROFILES

### Configs (5 files — replace existing)
- `configs/swarmx.defaults.yaml`
- `configs/routing.yaml`
- `configs/evolution.yaml`
- `configs/v6-overlay.yaml`
- `models/registry.yaml`

### Modelfiles (5 files — canonical names)
- `models/Modelfiles/primary/route-phi4-lite-q4km-prod.modelfile` (Relay)
- `models/Modelfiles/primary/instruct-phi4-pro-q8-prod.modelfile` (Pilot)
- `models/Modelfiles/primary/code-qwen25-pro-q5km-prod.modelfile` (Forge)
- `models/Modelfiles/primary/reason-deepseekr1-pro-q5km-prod.modelfile` (Oracle)
- `models/Modelfiles/primary/critique-deepseekr1-pro-q5km-prod.modelfile` (Auditor)

### Scripts (3 files)
- `scripts/migrate-to-r7.sh` — one-shot migration
- `scripts/rebuild-all-modelfiles.sh` — canonical model rebuild + validation
- `scripts/swarm-healthcheck-apex17.sh` — production healthcheck

### Manifest + VS Code (2 files)
- `manifests/swarmx_model_manifest.yaml`
- `.vscode/tasks.json`

### Documentation (3 files)
- `README.md`
- `docs/SWARMXQ-APEX17-UPGRADE.md`
- `docs/SETUP_AND_IMPLEMENTATION.md` (this file)

---

## 3. Fastest Path — Automated Migration

If you trust the migration script (recommended for clean r5/r6 repos):

```bash
# 1. Extract the bundle into a sibling directory
unzip SwarmXQ-APEX17-r7-final.zip -d /tmp/

# 2. Set the bundle root and run the migrate script from your repo
cd /path/to/your/SwarmXQ
export SWARMXQ_BUNDLE_ROOT=/tmp/SwarmXQ-APEX17-r7-final

# 3. Preview what will happen
bash $SWARMXQ_BUNDLE_ROOT/scripts/migrate-to-r7.sh --dry-run

# 4. Run the actual migration (creates timestamped backup)
bash $SWARMXQ_BUNDLE_ROOT/scripts/migrate-to-r7.sh --apply

# 5. Verify
bash scripts/swarm-healthcheck-apex17.sh
```

The `--apply` mode performs all of these in sequence:

1. Pre-flight checks (Ollama, Python, disk, repo)
2. Backup all replaced files to `.r6-backup-YYYYMMDD-HHMMSS/`
3. Copy bundle files into your repo
4. Patch `src/swarmx/llm.py` (adds operator_map import + canonical temperature/topP entries)
5. Rename Ollama models via `ollama cp` + `ollama rm`
6. Rebuild Modelfiles from canonical definitions
7. Run validation tests + healthcheck

If anything fails, see [Rollback Procedure](#7-rollback-procedure).

---

## 4. Manual Step-by-Step Installation

If you prefer surgical control:

### Step 4.1 — Create a Backup

```bash
cd /path/to/your/SwarmXQ
BACKUP_DIR=".r6-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Back up everything we'll replace
for f in \
    packages/swarmx-types/src/operator-map.ts \
    src/swarmx/operator_map.py \
    src/swarmx/config.py \
    apps/swarmx-api/src/services/adaptive-timeout-config.ts \
    configs/swarmx.defaults.yaml \
    configs/routing.yaml \
    configs/evolution.yaml \
    configs/v6-overlay.yaml \
    models/registry.yaml \
    manifests/swarmx_model_manifest.yaml \
    .vscode/tasks.json \
    README.md \
    docs/SWARMXQ-APEX17-UPGRADE.md \
    tests/test_naming_validation.py \
    scripts/rebuild-all-modelfiles.sh \
    scripts/swarm-healthcheck-apex17.sh; do
  [[ -f "$f" ]] && { mkdir -p "$BACKUP_DIR/$(dirname "$f")"; cp "$f" "$BACKUP_DIR/$f"; }
done

# Back up the -scar Modelfiles
mkdir -p models/Modelfiles/_legacy_prescar_backup
cp models/Modelfiles/primary/*-scar.modelfile models/Modelfiles/_legacy_prescar_backup/ 2>/dev/null || true
```

### Step 4.2 — Install the Source of Truth FIRST

These must go in before anything that imports them:

```bash
# TypeScript SoT
mkdir -p packages/swarmx-types/src
cp /path/to/bundle/packages/swarmx-types/src/operator-map.ts packages/swarmx-types/src/

# Python SoT
cp /path/to/bundle/src/swarmx/operator_map.py src/swarmx/
```

Verify:
```bash
python3 -c "from swarmx.operator_map import MODEL_OPERATOR_MAP; print(len(MODEL_OPERATOR_MAP), 'canonical tags')"
# Expected: 11 canonical tags
```

### Step 4.3 — Replace config.py

```bash
cp /path/to/bundle/src/swarmx/config.py src/swarmx/config.py
```

Verify it loads:
```bash
python3 -c "from swarmx.config import SwarmConfig; c = SwarmConfig(); print(c.model_fast)"
# Expected: instruct-phi4-pro-q8-prod
```

### Step 4.4 — Patch llm.py (Two Surgical Edits)

You have two options:

**Option A — Use the migrate script for this single step:**
```bash
bash /path/to/bundle/scripts/migrate-to-r7.sh --apply  # patches llm.py among other things
```

**Option B — Apply manually:**

1. Open `src/swarmx/llm.py`
2. Find the existing relative imports (search for `from .utils`)
3. Add this import block immediately after:
   ```python
   from .operator_map import (
       resolve_canonical_tag,
       resolve_operator_name,
       format_operator_label,
   )
   ```
4. Find `_MODEL_TEMPERATURES: dict[str, float] = {` and immediately after the opening `{` insert the canonical block from `src/swarmx/llm_patch_r7.py` (TEMPERATURE_PREPEND constant)
5. Do the same for `_MODEL_TOP_P: dict[str, float] = {` using TOP_P_PREPEND

### Step 4.5 — Replace TypeScript and Configs

```bash
# TypeScript
cp /path/to/bundle/apps/swarmx-api/src/services/adaptive-timeout-config.ts apps/swarmx-api/src/services/

# Configs
cp /path/to/bundle/configs/swarmx.defaults.yaml configs/
cp /path/to/bundle/configs/routing.yaml configs/
cp /path/to/bundle/configs/evolution.yaml configs/
cp /path/to/bundle/configs/v6-overlay.yaml configs/
cp /path/to/bundle/models/registry.yaml models/

# Manifest
cp /path/to/bundle/manifests/swarmx_model_manifest.yaml manifests/

# Modelfiles
cp /path/to/bundle/models/Modelfiles/primary/*.modelfile models/Modelfiles/primary/
```

### Step 4.6 — Install Scripts and Tests

```bash
cp /path/to/bundle/scripts/*.sh scripts/
chmod +x scripts/*.sh

mkdir -p tests
cp /path/to/bundle/tests/test_naming_validation.py tests/
```

### Step 4.7 — Install VS Code and Docs

```bash
cp /path/to/bundle/.vscode/tasks.json .vscode/
cp /path/to/bundle/README.md ./
cp /path/to/bundle/docs/*.md docs/
```

---

## 5. Ollama Model Rename

The `-scar` Ollama models must be renamed to canonical tags so requests for canonical names resolve correctly.

### Option A — Rename in place (preserves weights, fast)

```bash
bash scripts/migrate-to-r7.sh --rename-only
```

This iterates through 11 legacy → canonical pairs and runs `ollama cp` followed by `ollama rm`. No re-quantization, no GGUF re-read.

### Option B — Rebuild from canonical Modelfiles (slower, cleaner)

```bash
bash scripts/rebuild-all-modelfiles.sh
bash scripts/rebuild-all-modelfiles.sh --evict-legacy  # remove the old -scar versions
```

### Option C — Manual rename

```bash
ollama cp phi4-router-lite-scar    route-phi4-lite-q4km-prod
ollama cp phi4-fast-scar           instruct-phi4-pro-q8-prod
ollama cp qwen-worker-scar         code-qwen25-pro-q5km-prod
ollama cp deepseek-reasoner-scar   reason-deepseekr1-pro-q5km-prod
ollama cp deepseek-critic-scar     critique-deepseekr1-pro-q5km-prod

# Then remove the old ones
ollama rm phi4-router-lite-scar phi4-fast-scar qwen-worker-scar deepseek-reasoner-scar deepseek-critic-scar
```

Verify:
```bash
ollama list | grep -E "(route-|instruct-|code-|reason-|critique-)"
```

---

## 6. Validation

Run all three layers of validation:

### 6.1 — Naming Tests

```bash
python -m pytest tests/test_naming_validation.py -v
```

Expected: 30+ tests pass. Validates grammar, alias resolution, TS/Python mirror consistency, operator lookup, repo-wide -scar audit.

### 6.2 — Standard Compliance

```bash
bash scripts/rebuild-all-modelfiles.sh --validate
```

Expected: confirms operator_map.py/ts exist, registry.yaml uses canonical tags, no -scar in primary model assignments.

### 6.3 — Production Healthcheck

```bash
bash scripts/swarm-healthcheck-apex17.sh
```

Expected: PASS for Ollama, canonical models registered, Relay warmth check, API health, memory tier, naming compliance.

### 6.4 — Live Smoke Test

```bash
# Test that Relay routes a request correctly
curl -s -X POST http://localhost:11434/api/generate \
  -H 'Content-Type: application/json' \
  -d '{"model":"route-phi4-lite-q4km-prod","prompt":"classify: implement a Fastify route","stream":false,"options":{"num_predict":80}}' \
  | python3 -m json.tool

# Test that the Python layer resolves legacy names
python3 -c "
from swarmx.operator_map import resolve_canonical_tag, resolve_operator_name
print('phi4-fast-scar →', resolve_canonical_tag('phi4-fast-scar'))
print('which is Operator:', resolve_operator_name('phi4-fast-scar'))
"
# Expected:
# phi4-fast-scar → instruct-phi4-pro-q8-prod
# which is Operator: Pilot
```

---

## 7. Rollback Procedure

If anything goes wrong:

### Automated rollback

```bash
bash scripts/migrate-to-r7.sh --rollback
```

This restores the latest `.r6-backup-*` directory contents.

### Manual rollback

```bash
LATEST_BACKUP=$(ls -td .r6-backup-* | head -1)
cd "$LATEST_BACKUP"
for f in $(find . -type f); do cp "$f" "../$f"; done
cd ..
```

### Restore Ollama models

If you used `ollama rm` on the -scar models:

```bash
# Rebuild from the backed-up Modelfiles
cd /path/to/your/SwarmXQ
for mf in models/Modelfiles/_legacy_prescar_backup/*.modelfile; do
  tag=$(basename "$mf" .modelfile)
  ollama create "$tag" -f "$mf"
done
```

---

## 8. Common Issues

### "ModuleNotFoundError: No module named 'swarmx.operator_map'"

You skipped step 4.2. Install `src/swarmx/operator_map.py` first.

### Tests fail with "Mirror desync"

The Python and TypeScript MODEL_OPERATOR_MAP got out of sync. Run:
```bash
diff <(grep -E '^\s*"[\w-]+":' src/swarmx/operator_map.py | sort) \
     <(grep -E '^\s*"[\w-]+":' packages/swarmx-types/src/operator-map.ts | sort)
```
Re-copy whichever file is behind.

### "Tag 'phi4-fast-scar' is using legacy tag" warning at startup

Expected during transition — `config.py` warns when it resolves a -scar tag. To silence permanently, update your `.env` / shell rc:
```bash
export SWARM_MODEL_FAST=instruct-phi4-pro-q8-prod
export SWARM_MODEL_CODE=code-qwen25-pro-q5km-prod
export SWARM_MODEL_REASON=reason-deepseekr1-pro-q5km-prod
```

### `ollama cp` says "model not found"

The legacy model wasn't registered. Either:
- It was already renamed (verify with `ollama list`), or
- It was never built — skip the rename for that one and let `rebuild-all-modelfiles.sh` create the canonical version from scratch

### Relay cold-start takes > 30s

Q4_K_M Phi-4-mini should cold-start in <2s. Check:
- GGUF file path: `ls -la ~/llm-local/gguf/microsoft_Phi-4-mini-instruct-Q4_K_M.gguf`
- num_thread is set: `ollama show route-phi4-lite-q4km-prod | grep num_thread`
- No swap thrashing: `free -m && swapon --show`

### Dashboard shows old -scar names in logs

Frontend may be cached. Restart the dashboard:
```bash
cd apps/swarmx-dashboard && pnpm dev
```
And/or hard-refresh the browser.

### `pytest: command not found`

The test suite uses pytest. Install in your venv:
```bash
pip install pytest pyyaml structlog
```

---

## 9. Post-Migration Checklist

After a successful migration, verify the following are true:

- [ ] `python3 -c "from swarmx.operator_map import MODEL_OPERATOR_MAP; assert len(MODEL_OPERATOR_MAP) == 11"`
- [ ] `python -m pytest tests/test_naming_validation.py -v` — all pass
- [ ] `bash scripts/rebuild-all-modelfiles.sh --validate` — exit 0
- [ ] `bash scripts/swarm-healthcheck-apex17.sh` — HEALTH: OK
- [ ] `ollama list | grep -c "scar"` — returns 0 (no -scar models remain in Ollama, optional)
- [ ] `grep -rn "scar" configs/*.yaml | grep -v "legacy\|alias"` — only legacy_alias fields contain "scar"
- [ ] Dashboard at http://localhost:3000 shows Operator names (Relay, Pilot, Forge, etc.) in agent cards
- [ ] First-token latency for routing: <1s after Relay warm
- [ ] First-token latency for code generation: <5s after Forge warm (~60-120s cold)
- [ ] No `-scar` strings in any structured log output

### Optional Cleanup

After one full production cycle without issues, you may:

```bash
# Permanently remove -scar Ollama models
bash scripts/rebuild-all-modelfiles.sh --evict-legacy

# Archive the backup
mv .r6-backup-* ~/swarmxq-r6-archive/

# Remove the legacy Modelfile backups
rm -rf models/Modelfiles/_legacy_prescar_backup/
```

The MODEL_ALIASES map in operator_map.{py,ts} stays — it's the safety net for any code path that hasn't been migrated yet.

---

## Quick Reference Card

```
Layer 1 (machine):  <role>-<family>-<tier>-<quant>-<env>
Layer 2 (human):    Relay · Pilot · Architect · Forge · Oracle · Auditor · Lab

Source of truth:    packages/swarmx-types/src/operator-map.ts
                    src/swarmx/operator_map.py

Migrate:            bash scripts/migrate-to-r7.sh --apply
Validate:           bash scripts/rebuild-all-modelfiles.sh --validate
Healthcheck:        bash scripts/swarm-healthcheck-apex17.sh
Tests:              python -m pytest tests/test_naming_validation.py -v
Rollback:           bash scripts/migrate-to-r7.sh --rollback
```

*The incision is precise.*
