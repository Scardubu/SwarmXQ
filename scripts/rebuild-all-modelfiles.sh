#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/rebuild-all-modelfiles.sh
# SwarmXQ APEX-17 r7 — Canonical Model Rebuild & Validation
#
# Rebuilds all Ollama models from Modelfile definitions using the canonical
# naming standard. Validates that no legacy -scar names remain in active
# production paths after rebuild.
#
# Usage:
#   ./scripts/rebuild-all-modelfiles.sh                # rebuild all
#   ./scripts/rebuild-all-modelfiles.sh --validate     # validate only
#   ./scripts/rebuild-all-modelfiles.sh --only <tag>   # rebuild specific tag
#   ./scripts/rebuild-all-modelfiles.sh --evict-legacy # remove -scar models
#   ./scripts/rebuild-all-modelfiles.sh --dry-run      # show plan
#
# Operator taxonomy:
#   Relay     (route-phi4-lite-q4km-prod)        — ultra-light router
#   Pilot     (instruct-phi4-pro-q8-prod)        — fast generalist
#   Architect (plan-*-pro-*-prod)                — planning
#   Forge     (code-qwen25-pro-q5km-prod)        — code generation
#   Oracle    (reason-deepseekr1-pro-q5km-prod)  — deep reasoning
#   Auditor   (critique-deepseekr1-pro-q5km-prod) — adversarial review
#   Lab       (synth-*-exp-*-dev)                — experimental / evolve
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MODELFILE_DIR="$REPO_ROOT/models/Modelfiles/primary"
OLLAMA_URL="${SWARMX_OLLAMA_URL:-http://localhost:11434}"

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }

# ── Canonical model list ─────────────────────────────────────────────────────
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

# ── Operator lookup ──────────────────────────────────────────────────────────
operator_for() {
  case "$1" in
    route-*)    echo "Relay" ;;
    instruct-*) echo "Pilot" ;;
    plan-*)     echo "Architect" ;;
    code-*)     echo "Forge" ;;
    reason-*)   echo "Oracle" ;;
    critique-*) echo "Auditor" ;;
    synth-*)    echo "Lab" ;;
    *)          echo "Unknown" ;;
  esac
}

# ── Argument parsing ─────────────────────────────────────────────────────────
VALIDATE_ONLY=false
ONLY_MODEL=""
EVICT_LEGACY=false
DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --validate)     VALIDATE_ONLY=true; shift ;;
    --only)         ONLY_MODEL="$2"; shift 2 ;;
    --evict-legacy) EVICT_LEGACY=true; shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    --help|-h)
      echo "Usage: $0 [--validate] [--only <tag>] [--evict-legacy] [--dry-run]"
      exit 0 ;;
    *) fail "Unknown argument: $1"; exit 1 ;;
  esac
done

# ── Validation function ──────────────────────────────────────────────────────

validate_naming() {
  local errors=0
  info "Validating canonical naming standard..."

  if [[ ! -f "$REPO_ROOT/src/swarmx/operator_map.py" ]]; then
    fail "operator_map.py not found — dual-layer naming system incomplete"
    errors=$((errors + 1))
  else
    ok "operator_map.py found"
  fi

  if [[ ! -f "$REPO_ROOT/packages/swarmx-types/src/operator-map.ts" ]]; then
    fail "operator-map.ts not found"
    errors=$((errors + 1))
  else
    ok "operator-map.ts found"
  fi

  # Check runtime defaults don't use -scar
  if [[ -f "$REPO_ROOT/src/swarmx/config.py" ]]; then
    if grep -E '_DEFAULT_(RELAY|PILOT|FORGE|ORACLE).*=.*-scar' "$REPO_ROOT/src/swarmx/config.py" 2>/dev/null; then
      fail "config.py defaults contain -scar"
      errors=$((errors + 1))
    else
      ok "config.py defaults are canonical"
    fi
  fi

  # Check registry.yaml ollama_tag fields
  if [[ -f "$REPO_ROOT/models/registry.yaml" ]]; then
    if grep -E '^[[:space:]]*ollama_tag:.*-scar' "$REPO_ROOT/models/registry.yaml" > /dev/null 2>&1; then
      fail "registry.yaml has -scar in ollama_tag fields"
      errors=$((errors + 1))
    else
      ok "registry.yaml ollama_tag values are canonical"
    fi
  fi

  # Check configs/*.yaml model_* assignments
  local config_violations=0
  for yaml_file in "$REPO_ROOT"/configs/*.yaml; do
    [[ -f "$yaml_file" ]] || continue
    if grep -E '^[[:space:]]*(model_fast|model_reason|model_code|observer_model|critic_model|mutator_model):.*-scar' "$yaml_file" 2>/dev/null | grep -v "alias\|legacy" > /dev/null; then
      fail "  $(basename "$yaml_file") has -scar in primary model assignment"
      config_violations=$((config_violations + 1))
    fi
  done
  if [[ $config_violations -eq 0 ]]; then
    ok "configs/*.yaml primary assignments are canonical"
  else
    errors=$((errors + config_violations))
  fi

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

# ── Pre-flight ───────────────────────────────────────────────────────────────

info "SwarmXQ APEX-17 r7 — Canonical Model Rebuild"

if ! curl -sf "$OLLAMA_URL/api/tags" > /dev/null 2>&1; then
  fail "Ollama is not running at $OLLAMA_URL"
  fail "  Start: ollama serve"
  exit 1
fi
ok "Ollama responsive at $OLLAMA_URL"

# ── Rebuild loop ─────────────────────────────────────────────────────────────

rebuild_count=0
skip_count=0
fail_count=0

for model in "${CANONICAL_MODELS[@]}"; do
  if [[ -n "$ONLY_MODEL" && "$model" != "$ONLY_MODEL" ]]; then continue; fi

  modelfile="$MODELFILE_DIR/${model}.modelfile"
  if [[ ! -f "$modelfile" ]]; then
    modelfile="$REPO_ROOT/latest-modelfiles/${model}.modelfile"
  fi

  if [[ ! -f "$modelfile" ]]; then
    warn "Skipping $model — no Modelfile found"
    skip_count=$((skip_count + 1))
    continue
  fi

  operator=$(operator_for "$model")
  info "Building $operator ($model)..."

  if $DRY_RUN; then
    echo "    [DRY RUN] ollama create $model -f $modelfile"
    continue
  fi

  if ollama create "$model" -f "$modelfile" 2>&1 | tail -5; then
    ok "$operator ($model) — built"
    rebuild_count=$((rebuild_count + 1))
  else
    fail "$operator ($model) — build failed"
    fail_count=$((fail_count + 1))
  fi
done

echo ""
info "Built: $rebuild_count  Skipped: $skip_count  Failed: $fail_count"

# ── Optional eviction of legacy -scar models ─────────────────────────────────

if $EVICT_LEGACY; then
  echo ""
  info "Evicting legacy -scar models..."
  evict_count=0
  for legacy in "${LEGACY_SCAR_TAGS[@]}"; do
    if ollama rm "$legacy" 2>/dev/null; then
      ok "  Evicted $legacy"
      evict_count=$((evict_count + 1))
    fi
  done
  info "Evicted $evict_count legacy model(s)"
fi

echo ""
validate_naming
