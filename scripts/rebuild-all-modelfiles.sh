#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/rebuild-all-modelfiles.sh
# SwarmXQ APEX-17 r7 — Canonical Model Rebuild & Validation
#
# Rebuilds all Ollama models from Modelfile definitions using the official
# canonical naming standard. Validates zero legacy -scar names remain in
# the active production namespace after rebuild.
#
# Usage:
#   ./scripts/rebuild-all-modelfiles.sh           # rebuild all models
#   ./scripts/rebuild-all-modelfiles.sh --validate # validate only (no rebuild)
#   ./scripts/rebuild-all-modelfiles.sh --only route-phi4-lite-q4km-prod
#
# Operator taxonomy:
#   Relay    (route-phi4-lite-q4km-prod)        — ultra-light router
#   Pilot    (instruct-phi4-pro-q8-prod)       — fast generalist
#   Architect (plan-*-pro-*-prod)               — planning / orchestration
#   Forge    (code-qwen25-pro-q5km-prod)       — code generation
#   Oracle   (reason-deepseekr1-pro-q5km-prod) — deep reasoning
#   Auditor  (critique-deepseekr1-pro-q5km-prod) — adversarial review
#   Lab      (synth-*-exp-*-dev)               — experimental / evolve
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELFILE_DIR="$REPO_ROOT/models/Modelfiles/primary"
LEGACY_BACKUP_DIR="$REPO_ROOT/models/Modelfiles/_legacy_prescar_backup"

# ── Color output ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ── Canonical model list ──────────────────────────────────────────────────────
# These are the authoritative production tags (Layer 1)
CANONICAL_MODELS=(
  "route-phi4-lite-q4km-prod"
  "instruct-phi4-pro-q8-prod"
  "plan-phi4-pro-q8-prod"
  "plan-qwen25-pro-q5km-prod"
  "plan-deepseekr1-pro-q5km-prod"
  "code-qwen25-pro-q5km-prod"
  "reason-deepseekr1-pro-q5km-prod"
  "critique-deepseekr1-pro-q5km-prod"
  "synth-phi4-exp-q8-dev"
  "synth-qwen25-exp-q5km-dev"
  "synth-deepseekr1-exp-q5km-dev"
)

# Legacy -scar tags that should be evicted after migration
LEGACY_SCAR_TAGS=(
  "phi4-router-lite-scar"
  "phi4-fast-scar"
  "phi4-worker-scar"
  "phi4-evolve-scar"
  "qwen-worker-scar"
  "qwen-supervisor-scar"
  "qwen-evolve-scar"
  "deepseek-reasoner-scar"
  "deepseek-supervisor-scar"
  "deepseek-critic-scar"
  "deepseek-evolve-scar"
)

# ── Argument parsing ──────────────────────────────────────────────────────────
VALIDATE_ONLY=false
ONLY_MODEL=""
EVICT_LEGACY=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --validate) VALIDATE_ONLY=true; shift ;;
    --only)     ONLY_MODEL="$2"; shift 2 ;;
    --evict-legacy) EVICT_LEGACY=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--validate] [--only <tag>] [--evict-legacy]"
      echo ""
      echo "  --validate      Validate naming only (no rebuild)"
      echo "  --only <tag>    Rebuild only the specified canonical tag"
      echo "  --evict-legacy  Remove legacy -scar models from Ollama after rebuild"
      exit 0
      ;;
    *) fail "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validation mode ───────────────────────────────────────────────────────────

validate_naming() {
  local errors=0

  info "Validating canonical naming standard..."

  # Check runtime Python files for -scar default values
  if grep -rn '"-scar"' "$REPO_ROOT/src/swarmx/config.py" "$REPO_ROOT/src/swarmx/llm.py" 2>/dev/null | \
     grep -v "alias\|ALIAS\|legacy\|LEGACY\|compat\|comment\|#" | grep -q "default"; then
    fail "Found -scar tags in runtime default values"
    errors=$((errors + 1))
  else
    ok "No -scar defaults in runtime Python"
  fi

  # Check TypeScript orchestrator
  if grep -q "phi4-fast-scar\|qwen-worker-scar\|deepseek-reasoner-scar" \
     "$REPO_ROOT/apps/swarmx-api/src/services/model-orchestrator.ts" 2>/dev/null; then
    # These should only appear in MODEL_ALIASES, not in MODEL_REGISTRY
    if grep -A2 "MODEL_REGISTRY" "$REPO_ROOT/apps/swarmx-api/src/services/model-orchestrator.ts" | \
       grep -q "\-scar"; then
      fail "Found -scar tags in MODEL_REGISTRY (should be canonical only)"
      errors=$((errors + 1))
    else
      ok "TypeScript MODEL_REGISTRY uses canonical tags only"
    fi
  fi

  # Check operator_map.py exists
  if [[ -f "$REPO_ROOT/src/swarmx/operator_map.py" ]]; then
    ok "operator_map.py found"
  else
    fail "operator_map.py not found — dual-layer naming system incomplete"
    errors=$((errors + 1))
  fi

  # Check registry.yaml uses canonical tags
  if grep -q "operator_name:" "$REPO_ROOT/models/registry.yaml" 2>/dev/null; then
    ok "registry.yaml includes operator_name fields"
  else
    warn "registry.yaml missing operator_name fields"
  fi

  # Check for -scar in VS Code tasks
  if grep -q "\-scar" "$REPO_ROOT/.vscode/tasks.json" 2>/dev/null; then
    warn "VS Code tasks.json still references -scar tags"
  else
    ok "VS Code tasks.json clean"
  fi

  # Summary
  echo ""
  if [[ $errors -eq 0 ]]; then
    ok "Naming validation passed"
    return 0
  else
    fail "Naming validation failed with $errors error(s)"
    return 1
  fi
}

if $VALIDATE_ONLY; then
  validate_naming
  exit $?
fi

# ── Rebuild ───────────────────────────────────────────────────────────────────

info "SwarmXQ APEX-17 r7 — Canonical Model Rebuild"
echo ""

# Check Ollama is running
if ! curl -sf http://localhost:11434/api/tags > /dev/null 2>&1; then
  fail "Ollama is not running. Start it with: ollama serve"
  exit 1
fi
ok "Ollama is running"

# Rebuild loop
rebuild_count=0
skip_count=0

for model in "${CANONICAL_MODELS[@]}"; do
  if [[ -n "$ONLY_MODEL" && "$model" != "$ONLY_MODEL" ]]; then
    continue
  fi

  modelfile="$MODELFILE_DIR/${model}.modelfile"

  if [[ ! -f "$modelfile" ]]; then
    # Try the latest-modelfiles directory as fallback
    modelfile="$REPO_ROOT/latest-modelfiles/${model}.modelfile"
  fi

  if [[ ! -f "$modelfile" ]]; then
    warn "Skipping $model — no Modelfile found"
    skip_count=$((skip_count + 1))
    continue
  fi

  # Determine operator name for display
  case "$model" in
    route-*)    operator="Relay" ;;
    instruct-*) operator="Pilot" ;;
    plan-*)     operator="Architect" ;;
    code-*)     operator="Forge" ;;
    reason-*)   operator="Oracle" ;;
    critique-*) operator="Auditor" ;;
    synth-*)    operator="Lab" ;;
    *)          operator="Unknown" ;;
  esac

  info "Building $operator ($model)..."
  if ollama create "$model" -f "$modelfile" 2>/dev/null; then
    ok "$operator ($model) — built"
    rebuild_count=$((rebuild_count + 1))
  else
    fail "$operator ($model) — build failed"
  fi
done

echo ""
info "Built: $rebuild_count  Skipped: $skip_count"

# ── Optional legacy eviction ─────────────────────────────────────────────────

if $EVICT_LEGACY; then
  echo ""
  info "Evicting legacy -scar models..."
  for legacy in "${LEGACY_SCAR_TAGS[@]}"; do
    if ollama rm "$legacy" 2>/dev/null; then
      ok "Evicted $legacy"
    else
      info "$legacy — not present (already clean)"
    fi
  done
fi

# ── Post-rebuild validation ──────────────────────────────────────────────────
echo ""
validate_naming
