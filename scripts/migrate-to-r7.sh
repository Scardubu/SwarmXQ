#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/migrate-to-r7.sh
# SwarmXQ APEX-17 r7 — One-Shot Migration Script
#
# Performs the complete migration from APEX-17 r5/r6 (-scar tags) to r7
# (canonical dual-layer naming):
#
#   1. Pre-flight checks (Ollama, disk, Python, repo structure)
#   2. Backup all replaced files to .r6-backup/
#   3. Install new bundle files (operator_map, configs, services, docs)
#   4. Apply surgical str_replace patches to llm.py
#   5. Rename existing Ollama models from -scar to canonical via cp+rm
#   6. Rebuild canonical Modelfiles
#   7. Run validation tests
#   8. Run healthcheck
#
# Usage:
#   ./scripts/migrate-to-r7.sh --dry-run         # show what would happen
#   ./scripts/migrate-to-r7.sh --backup-only     # backup, no changes
#   ./scripts/migrate-to-r7.sh --apply           # full migration
#   ./scripts/migrate-to-r7.sh --rollback        # restore from .r6-backup/
#   ./scripts/migrate-to-r7.sh --rename-only     # only rename Ollama models
#   ./scripts/migrate-to-r7.sh --validate-only   # run tests + healthcheck
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Locate paths ─────────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${SWARMXQ_BUNDLE_ROOT:-$REPO_ROOT}"
BACKUP_DIR="$REPO_ROOT/.r6-backup-$(date +%Y%m%d-%H%M%S)"
MODELFILE_BACKUP_DIR="$REPO_ROOT/models/Modelfiles/_legacy_prescar_backup"

# ── Color output ─────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
info()  { echo -e "${CYAN}[INFO]${NC}  $*"; }
ok()    { echo -e "${GREEN}[OK]${NC}    $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
fail()  { echo -e "${RED}[FAIL]${NC}  $*"; }
step()  { echo -e "\n${CYAN}━━━ $* ━━━${NC}"; }

# ── Argument parsing ─────────────────────────────────────────────────────────
MODE="apply"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)       MODE="dry-run"; shift ;;
    --backup-only)   MODE="backup-only"; shift ;;
    --apply)         MODE="apply"; shift ;;
    --rollback)      MODE="rollback"; shift ;;
    --rename-only)   MODE="rename-only"; shift ;;
    --validate-only) MODE="validate-only"; shift ;;
    --help|-h)
      echo "Usage: $0 [--dry-run|--backup-only|--apply|--rollback|--rename-only|--validate-only]"
      exit 0 ;;
    *) fail "Unknown argument: $1"; exit 1 ;;
  esac
done

info "Mode: $MODE"
info "Repo root: $REPO_ROOT"
info "Bundle root: $BUNDLE_ROOT"
[[ "$MODE" == "apply" || "$MODE" == "backup-only" ]] && info "Backup dir: $BACKUP_DIR"

# ── Canonical model list ─────────────────────────────────────────────────────
declare -A CANONICAL_RENAMES=(
  ["phi4-router-lite-scar"]="route-phi4-lite-q4km-prod"
  ["phi4-fast-scar"]="instruct-phi4-pro-q8-prod"
  ["phi4-worker-scar"]="plan-phi4-pro-q8-prod"
  ["phi4-evolve-scar"]="synth-phi4-exp-q8-dev"
  ["qwen-worker-scar"]="code-qwen25-pro-q5km-prod"
  ["qwen-supervisor-scar"]="plan-qwen25-pro-q5km-prod"
  ["qwen-evolve-scar"]="synth-qwen25-exp-q5km-dev"
  ["deepseek-reasoner-scar"]="reason-deepseekr1-pro-q5km-prod"
  ["deepseek-supervisor-scar"]="plan-deepseekr1-pro-q5km-prod"
  ["deepseek-critic-scar"]="critique-deepseekr1-pro-q5km-prod"
  ["deepseek-evolve-scar"]="synth-deepseekr1-exp-q5km-dev"
)

# ── Files to backup and replace ──────────────────────────────────────────────
REPLACED_FILES=(
  "packages/swarmx-types/src/operator-map.ts"
  "src/swarmx/operator_map.py"
  "src/swarmx/config.py"
  "src/swarmx/llm_patch_r7.py"
  "apps/swarmx-api/src/services/adaptive-timeout-config.ts"
  "configs/swarmx.defaults.yaml"
  "configs/routing.yaml"
  "configs/evolution.yaml"
  "configs/v6-overlay.yaml"
  "models/registry.yaml"
  "manifests/swarmx_model_manifest.yaml"
  ".vscode/tasks.json"
  "README.md"
  "docs/SWARMXQ-APEX17-UPGRADE.md"
  "docs/SETUP_AND_IMPLEMENTATION.md"
  "tests/test_naming_validation.py"
  "scripts/rebuild-all-modelfiles.sh"
  "scripts/swarm-healthcheck-apex17.sh"
)

# Modelfiles that supersede the -scar versions
NEW_MODELFILES=(
  "models/Modelfiles/primary/route-phi4-lite-q4km-prod.modelfile"
  "models/Modelfiles/primary/instruct-phi4-pro-q8-prod.modelfile"
  "models/Modelfiles/primary/code-qwen25-pro-q5km-prod.modelfile"
  "models/Modelfiles/primary/reason-deepseekr1-pro-q5km-prod.modelfile"
  "models/Modelfiles/primary/critique-deepseekr1-pro-q5km-prod.modelfile"
)

# ── Pre-flight checks ────────────────────────────────────────────────────────

preflight() {
  step "Pre-flight Checks"
  local errors=0

  if ! command -v ollama &> /dev/null; then
    fail "ollama CLI not found in PATH"
    errors=$((errors + 1))
  else
    ok "ollama CLI present"
  fi

  if ! curl -sf "${SWARMX_OLLAMA_URL:-http://localhost:11434}/api/tags" > /dev/null 2>&1; then
    warn "Ollama daemon not running at ${SWARMX_OLLAMA_URL:-http://localhost:11434}"
    warn "  → Rename phase will be skipped. Start: ollama serve"
  else
    ok "Ollama daemon responsive"
  fi

  if ! command -v python3 &> /dev/null; then
    fail "python3 not found"
    errors=$((errors + 1))
  else
    ok "python3 present: $(python3 --version)"
  fi

  if [[ ! -f "$REPO_ROOT/src/swarmx/llm.py" ]]; then
    fail "Cannot find src/swarmx/llm.py — wrong repo root?"
    errors=$((errors + 1))
  else
    ok "Repo structure detected: src/swarmx/llm.py exists"
  fi

  local avail_kb=$(df "$REPO_ROOT" | awk 'NR==2 {print $4}')
  local avail_mb=$((avail_kb / 1024))
  if [[ $avail_mb -lt 500 ]]; then
    warn "Low disk: ${avail_mb} MB available (recommend ≥ 500 MB for backup)"
  else
    ok "Disk space: ${avail_mb} MB available"
  fi

  if [[ $errors -gt 0 ]]; then
    fail "Pre-flight failed with $errors error(s)"
    exit 1
  fi
}

# ── Backup phase ─────────────────────────────────────────────────────────────

backup_files() {
  step "Backing Up Replaced Files → $BACKUP_DIR"
  mkdir -p "$BACKUP_DIR"

  for rel in "${REPLACED_FILES[@]}"; do
    local src="$REPO_ROOT/$rel"
    if [[ -f "$src" ]]; then
      local dst="$BACKUP_DIR/$rel"
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      info "  backed up: $rel"
    fi
  done

  # Also back up the -scar modelfiles
  mkdir -p "$MODELFILE_BACKUP_DIR"
  local scar_count=0
  for legacy in "${!CANONICAL_RENAMES[@]}"; do
    local mf="$REPO_ROOT/models/Modelfiles/primary/${legacy}.modelfile"
    if [[ -f "$mf" ]]; then
      cp "$mf" "$MODELFILE_BACKUP_DIR/" 2>/dev/null || true
      scar_count=$((scar_count + 1))
    fi
  done
  if [[ $scar_count -gt 0 ]]; then
    ok "Backed up $scar_count legacy -scar Modelfile(s) → $MODELFILE_BACKUP_DIR"
  fi

  ok "Backup complete: $BACKUP_DIR"
}

# ── Install phase ────────────────────────────────────────────────────────────

install_files() {
  step "Installing APEX-17 r7 Bundle Files"

  if [[ "$BUNDLE_ROOT" == "$REPO_ROOT" ]]; then
    info "Bundle root == repo root — files already in place. Skipping copy."
    return 0
  fi

  for rel in "${REPLACED_FILES[@]}" "${NEW_MODELFILES[@]}"; do
    local src="$BUNDLE_ROOT/$rel"
    local dst="$REPO_ROOT/$rel"
    if [[ -f "$src" ]]; then
      mkdir -p "$(dirname "$dst")"
      cp "$src" "$dst"
      info "  installed: $rel"
    fi
  done

  ok "Install complete"
}

# ── Patch llm.py phase ───────────────────────────────────────────────────────

patch_llm_py() {
  step "Patching src/swarmx/llm.py"
  local target="$REPO_ROOT/src/swarmx/llm.py"
  if [[ ! -f "$target" ]]; then
    warn "llm.py not found — skipping"
    return 0
  fi

  if grep -q "route-phi4-lite-q4km-prod" "$target"; then
    info "llm.py already contains canonical tags — skipping"
    return 0
  fi

  # Insertion 1: Add operator_map import
  if ! grep -q "from .operator_map import" "$target"; then
    python3 - <<EOF
import re
path = "$target"
content = open(path).read()
# Find last 'from .' import line
imports = list(re.finditer(r'^from \.[\w_]+ import .*$', content, re.MULTILINE))
if imports:
    last = imports[-1]
    addition = "\nfrom .operator_map import (\n    resolve_canonical_tag,\n    resolve_operator_name,\n    format_operator_label,\n)"
    new = content[:last.end()] + addition + content[last.end():]
    open(path, "w").write(new)
EOF
    ok "Added operator_map import"
  fi

  # Insertion 2: Prepend canonical tags to _MODEL_TEMPERATURES
  python3 - <<EOF
import re
path = "$target"
content = open(path).read()

canon_temps = '''    # ── APEX-17 r7 canonical production tags  [LLM-r7-01] ────────────────────
    "route-phi4-lite-q4km-prod":          0.00,  # Relay     — deterministic classification
    "instruct-phi4-pro-q8-prod":          0.20,  # Pilot     — fast chat
    "plan-phi4-pro-q8-prod":              0.20,  # Architect (phi4)
    "plan-qwen25-pro-q5km-prod":          0.15,  # Architect (qwen25)
    "plan-deepseekr1-pro-q5km-prod":      0.40,  # Architect (deepseek)
    "code-qwen25-pro-q5km-prod":          0.15,  # Forge
    "reason-deepseekr1-pro-q5km-prod":    0.40,  # Oracle
    "critique-deepseekr1-pro-q5km-prod":  0.35,  # Auditor
    "synth-phi4-exp-q8-dev":              0.25,  # Lab (phi4)
    "synth-qwen25-exp-q5km-dev":          0.20,  # Lab (qwen25)
    "synth-deepseekr1-exp-q5km-dev":      0.40,  # Lab (deepseek)
'''

m = re.search(r'(_MODEL_TEMPERATURES:\s*dict\[str,\s*float\]\s*=\s*\{)\n', content)
if m and "route-phi4-lite-q4km-prod" not in content[:m.end()+1500]:
    content = content[:m.end()] + canon_temps + content[m.end():]
    open(path, "w").write(content)
    print("Prepended canonical _MODEL_TEMPERATURES entries")

content = open(path).read()
canon_topp = '''    # ── APEX-17 r7 canonical production tags  [LLM-r7-01] ────────────────────
    "route-phi4-lite-q4km-prod":          0.90,  # Relay
    "instruct-phi4-pro-q8-prod":          0.90,  # Pilot
    "plan-phi4-pro-q8-prod":              0.90,  # Architect (phi4)
    "plan-qwen25-pro-q5km-prod":          0.95,  # Architect (qwen25)
    "plan-deepseekr1-pro-q5km-prod":      0.92,  # Architect (deepseek)
    "code-qwen25-pro-q5km-prod":          0.95,  # Forge
    "reason-deepseekr1-pro-q5km-prod":    0.92,  # Oracle
    "critique-deepseekr1-pro-q5km-prod":  0.92,  # Auditor
    "synth-phi4-exp-q8-dev":              0.92,  # Lab (phi4)
    "synth-qwen25-exp-q5km-dev":          0.95,  # Lab (qwen25)
    "synth-deepseekr1-exp-q5km-dev":      0.92,  # Lab (deepseek)
'''

m = re.search(r'(_MODEL_TOP_P:\s*dict\[str,\s*float\]\s*=\s*\{)\n', content)
if m and "route-phi4-lite-q4km-prod" not in content[m.end():m.end()+1500]:
    content = content[:m.end()] + canon_topp + content[m.end():]
    open(path, "w").write(content)
    print("Prepended canonical _MODEL_TOP_P entries")
EOF

  ok "llm.py patched"
}

# ── Ollama rename phase ──────────────────────────────────────────────────────

rename_ollama_models() {
  step "Renaming Ollama Models: -scar → canonical"

  if ! curl -sf "${SWARMX_OLLAMA_URL:-http://localhost:11434}/api/tags" > /dev/null 2>&1; then
    warn "Ollama not running — skipping model rename"
    warn "Run with --rename-only after starting Ollama"
    return 0
  fi

  local renamed=0 skipped=0 failed=0
  local existing=$(ollama list 2>/dev/null | awk 'NR>1 {print $1}')

  for legacy in "${!CANONICAL_RENAMES[@]}"; do
    local canonical="${CANONICAL_RENAMES[$legacy]}"
    if echo "$existing" | grep -q "^${legacy}\(:latest\)\?$"; then
      info "Renaming $legacy → $canonical"
      if ollama cp "$legacy" "$canonical" 2>/dev/null; then
        ollama rm "$legacy" 2>/dev/null || true
        ok "  ✓ Renamed $legacy → $canonical"
        renamed=$((renamed + 1))
      else
        fail "  ✗ Failed to rename $legacy"
        failed=$((failed + 1))
      fi
    else
      skipped=$((skipped + 1))
    fi
  done

  info "Renamed: $renamed  Skipped (not present): $skipped  Failed: $failed"

  if [[ $failed -gt 0 ]]; then
    warn "Some renames failed. Try rebuilding from canonical Modelfiles instead:"
    warn "  bash scripts/rebuild-all-modelfiles.sh"
  fi
}

# ── Rebuild Modelfiles phase ─────────────────────────────────────────────────

rebuild_canonical_modelfiles() {
  step "Rebuilding Canonical Modelfiles"
  if [[ -x "$REPO_ROOT/scripts/rebuild-all-modelfiles.sh" ]]; then
    bash "$REPO_ROOT/scripts/rebuild-all-modelfiles.sh" || warn "Rebuild script returned non-zero"
  else
    warn "scripts/rebuild-all-modelfiles.sh not executable or missing — skipping"
  fi
}

# ── Validation phase ─────────────────────────────────────────────────────────

run_validation() {
  step "Running Validation"

  if command -v pytest &> /dev/null && [[ -f "$REPO_ROOT/tests/test_naming_validation.py" ]]; then
    if cd "$REPO_ROOT" && python3 -m pytest tests/test_naming_validation.py -v --tb=short 2>&1; then
      ok "All naming validation tests passed"
    else
      fail "Some validation tests failed — check output above"
      return 1
    fi
  else
    warn "pytest or tests/test_naming_validation.py not available — skipping"
  fi

  if [[ -x "$REPO_ROOT/scripts/swarm-healthcheck-apex17.sh" ]]; then
    info "Running healthcheck…"
    bash "$REPO_ROOT/scripts/swarm-healthcheck-apex17.sh" || warn "Healthcheck flagged issues"
  fi
}

# ── Rollback phase ───────────────────────────────────────────────────────────

rollback() {
  step "Rolling Back"
  local latest_backup=$(ls -td "$REPO_ROOT"/.r6-backup-* 2>/dev/null | head -1)
  if [[ -z "$latest_backup" ]]; then
    fail "No backup directory found"
    exit 1
  fi
  info "Restoring from: $latest_backup"
  for rel in "${REPLACED_FILES[@]}"; do
    if [[ -f "$latest_backup/$rel" ]]; then
      cp "$latest_backup/$rel" "$REPO_ROOT/$rel"
      info "  restored: $rel"
    fi
  done
  ok "Rollback complete"
}

# ── Main flow ────────────────────────────────────────────────────────────────

case "$MODE" in
  dry-run)
    preflight
    info ""
    info "DRY RUN — the following would be done:"
    info "  1. Backup ${#REPLACED_FILES[@]} files to $BACKUP_DIR"
    info "  2. Install ${#REPLACED_FILES[@]} bundle files into repo"
    info "  3. Install ${#NEW_MODELFILES[@]} canonical Modelfiles"
    info "  4. Patch src/swarmx/llm.py (operator_map import + canonical temp/topP)"
    info "  5. Rename Ollama models:"
    for legacy in "${!CANONICAL_RENAMES[@]}"; do
      info "       $legacy → ${CANONICAL_RENAMES[$legacy]}"
    done
    info "  6. Run validation tests"
    info "  7. Run healthcheck"
    ;;
  backup-only)
    preflight
    backup_files
    ;;
  apply)
    preflight
    backup_files
    install_files
    patch_llm_py
    rename_ollama_models
    rebuild_canonical_modelfiles
    run_validation
    ok "Migration complete"
    ;;
  rename-only)
    preflight
    rename_ollama_models
    ;;
  validate-only)
    run_validation
    ;;
  rollback)
    rollback
    ;;
esac

step "Done"
