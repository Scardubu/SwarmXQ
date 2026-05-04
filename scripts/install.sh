#!/usr/bin/env bash
# SwarmX · scripts/install.sh · v2.1 · IEP-ELITE-MAX
#
# CHANGELOG:
#   v2.1 [FIX-RC-01]   RC guard check corrected from "SwarmX vΩ.APEX" → "SwarmX v2.0"
#                       so the guard actually fires on re-runs (was always false → duplicate blocks)
#   v2.0 [MODEL-01]    Default model pull updated to Phi-4-mini, DeepSeek-R1:7B, Qwen2.5-Coder triad
#        [MODEL-02]    MODEL_REASON env var added alongside MODEL_FAST / MODEL_CODE
#        [MODEL-03]    RC-file patch writes all three model vars
#        [FIX-01]      install_models() checks each model individually and continues on soft failure
#
# Usage: bash ./scripts/install.sh
# Idempotent — safe to re-run.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV="$ROOT/.venv"
BIN_DIR="$HOME/.local/bin"
SWARM_HOME_DIR="$HOME/.swarmx"

# ── ANSI colours ────────────────────────────────────────────────────────────
RED()   { printf '\033[0;31m%s\033[0m' "$1"; }
GREEN() { printf '\033[0;32m%s\033[0m' "$1"; }
YELLOW(){ printf '\033[0;33m%s\033[0m' "$1"; }
CYAN()  { printf '\033[0;36m%s\033[0m' "$1"; }
BOLD()  { printf '\033[1m%s\033[0m' "$1"; }

echo ""
echo "$(BOLD 'SwarmX Installer') · v2.1 · IEP-ELITE-MAX"
echo "Model triad: $(CYAN 'Phi-4-mini') (router) · $(CYAN 'DeepSeek-R1:7B') (reason) · $(CYAN 'Qwen2.5-Coder') (code)"
echo "──────────────────────────────────────────────────────────"

# ── Pre-flight checks ────────────────────────────────────────────────────────
echo ""
echo "$(CYAN '[1/6]') Pre-flight checks"

PYTHON=$(command -v python3 || command -v python || true)
if [[ -z "$PYTHON" ]]; then
  echo "  $(RED '[INSTALL-BLOCK]'): Python not found. Install Python >= 3.11."
  exit 1
fi

PY_VER=$($PYTHON -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(echo "$PY_VER" | cut -d. -f1)
PY_MINOR=$(echo "$PY_VER" | cut -d. -f2)
if [[ "$PY_MAJOR" -lt 3 ]] || { [[ "$PY_MAJOR" -eq 3 ]] && [[ "$PY_MINOR" -lt 11 ]]; }; then
  echo "  $(RED '[INSTALL-BLOCK]'): Python >= 3.11 required. Found: $PY_VER"
  exit 1
fi
echo "  $(GREEN '[OK]') Python $PY_VER"

DISK_MB=$(df -m "$ROOT" | awk 'NR==2{print $4}')
if [[ "${DISK_MB:-0}" -lt 200 ]]; then
  echo "  $(RED '[INSTALL-BLOCK]'): Insufficient disk space (${DISK_MB}MB free). Need >= 200MB."
  exit 1
fi
echo "  $(GREEN '[OK]') Disk space: ${DISK_MB}MB free"

# ── Create virtual environment ───────────────────────────────────────────────
echo ""
echo "$(CYAN '[2/6]') Creating virtual environment at $VENV"
if [[ ! -d "$VENV" ]]; then
  $PYTHON -m venv "$VENV" || {
    echo "  $(RED '[INSTALL-BLOCK]'): venv not created. Try: apt install python3-venv"
    exit 1
  }
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
pip install --quiet --upgrade pip
echo "  $(GREEN '[OK]') venv ready"

# ── Install package ──────────────────────────────────────────────────────────
echo ""
echo "$(CYAN '[3/6]') Installing SwarmX package"
pip install --quiet -e "$ROOT"
echo "  $(GREEN '[OK]') swarmx installed (editable)"

# ── Create CLI symlinks ──────────────────────────────────────────────────────
echo ""
echo "$(CYAN '[4/6]') Creating CLI symlinks in $BIN_DIR"
mkdir -p "$BIN_DIR"

for cmd in swarm swarmx; do
  LINK="$BIN_DIR/$cmd"
  cat > "$LINK" <<SHIM
#!/usr/bin/env bash
source "$VENV/bin/activate"
exec python3 -m swarmx "\$@"
SHIM
  chmod +x "$LINK"
done

for launcher in "$ROOT"/swarm-*.sh; do
  name="$(basename "$launcher" .sh)"
  LINK="$BIN_DIR/$name"
  cat > "$LINK" <<SHIM
#!/usr/bin/env bash
exec bash "$launcher" "\$@"
SHIM
  chmod +x "$LINK"
done
echo "  $(GREEN '[OK]') CLI symlinks written to $BIN_DIR"

# ── Patch shell RC files ─────────────────────────────────────────────────────
echo ""
echo "$(CYAN '[5/6]') Patching shell RC files"

RC_BLOCK=$(cat <<'RCBLOCK'

# ── SwarmX v2.0 ────────────────────────────────────────────
export SWARM_HOME="$HOME/.swarmx"
export PATH="$HOME/.local/bin:$PATH"
# Model triad: Phi-4-mini (orchestrator) · DeepSeek-R1 (reason) · Qwen2.5-Coder (code)
export MODEL_FAST="phi4-mini"
export MODEL_REASON="deepseek-r1:7b"
export MODEL_CODE="qwen2.5-coder"
export SWARM_MODEL_FAST="phi4-mini"
export SWARM_MODEL_REASON="deepseek-r1:7b"
export SWARM_MODEL_CODE="qwen2.5-coder"
# ─────────────────────────────────────────────────────────────────
RCBLOCK
)

for RC in "$HOME/.zshrc" "$HOME/.bashrc"; do
  if [[ -f "$RC" ]]; then
    # FIX v2.1 [FIX-RC-01]: Guard string now matches the actual block header
    # ("SwarmX v2.0") instead of "SwarmX vΩ.APEX" which never matched anything.
    # Previously this check was always false, so install.sh appended the block
    # and created a new backup on every invocation.
    if ! grep -q "SwarmX v2.0" "$RC" 2>/dev/null; then
      cp "$RC" "${RC}.swarmx-backup-$(date +%Y%m%d%H%M%S)"
      echo "$RC_BLOCK" >> "$RC"
      echo "  $(GREEN '[OK]') Patched $RC (backup saved)"
    else
      # Already patched — only update the model vars if they've changed
      sed -i 's/MODEL_FAST=.*/MODEL_FAST="phi4-mini"/' "$RC" 2>/dev/null || true
      sed -i 's/MODEL_CODE=.*/MODEL_CODE="qwen2.5-coder"/' "$RC" 2>/dev/null || true
      sed -i 's/SWARM_MODEL_FAST=.*/SWARM_MODEL_FAST="phi4-mini"/' "$RC" 2>/dev/null || true
      sed -i 's/SWARM_MODEL_CODE=.*/SWARM_MODEL_CODE="qwen2.5-coder"/' "$RC" 2>/dev/null || true
      if ! grep -q 'MODEL_REASON' "$RC"; then
        echo 'export MODEL_REASON="deepseek-r1:7b"' >> "$RC"
        echo 'export SWARM_MODEL_REASON="deepseek-r1:7b"' >> "$RC"
      fi
      echo "  $(YELLOW '[UPDATED]') $RC — model vars refreshed (no duplicate block added)"
    fi
  fi
done

# Copy configs to SWARM_HOME
mkdir -p "$SWARM_HOME_DIR/configs"
if [[ -d "$ROOT/configs" ]]; then
  cp "$ROOT"/configs/*.yaml "$SWARM_HOME_DIR/configs/" 2>/dev/null || true
  echo "  $(GREEN '[OK]') Configs copied to $SWARM_HOME_DIR/configs/"
fi

# ── Pull Ollama model triad ──────────────────────────────────────────────────
echo ""
echo "$(CYAN '[6/6]') Pulling Ollama model triad"

install_models() {
  if ! command -v ollama >/dev/null 2>&1; then
    echo "  $(YELLOW '[SKIP]') Ollama not found. Install from https://ollama.ai"
    echo "          Then pull models manually:"
    echo "            ollama pull phi4-mini"
    echo "            ollama pull deepseek-r1:7b"
    echo "            ollama pull qwen2.5-coder"
    return
  fi

  echo "  Pulling $(CYAN 'phi4-mini') (orchestrator / router brain)…"
  if ollama pull phi4-mini 2>&1 | tail -1; then
    echo "  $(GREEN '[OK]') phi4-mini ready"
  else
    echo "  $(YELLOW '[WARN]') phi4-mini pull failed — try: ollama pull phi4-mini"
  fi

  echo "  Pulling $(CYAN 'deepseek-r1:7b') (reasoning engine)…"
  if ollama pull deepseek-r1:7b 2>&1 | tail -1; then
    echo "  $(GREEN '[OK]') deepseek-r1:7b ready"
  else
    echo "  $(YELLOW '[WARN]') deepseek-r1:7b pull failed — try: ollama pull deepseek-r1:7b"
  fi

  echo "  Pulling $(CYAN 'qwen2.5-coder') (execution engine)…"
  if ollama pull qwen2.5-coder 2>&1 | tail -1; then
    echo "  $(GREEN '[OK]') qwen2.5-coder ready"
  else
    echo "  $(YELLOW '[WARN]') qwen2.5-coder pull failed — try: ollama pull qwen2.5-coder"
  fi
}

install_models

# ── Final summary ────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
echo "$(GREEN 'Installation complete.') Restart your shell or:"
echo "  source ~/.zshrc   # zsh"
echo "  source ~/.bashrc  # bash"
echo ""
echo "Model triad status:"
echo "  $(CYAN 'phi4-mini')       → MODEL_FAST / orchestrator"
echo "  $(CYAN 'deepseek-r1:7b') → MODEL_REASON / reasoning engine"
echo "  $(CYAN 'qwen2.5-coder')     → MODEL_CODE  / execution engine"
echo ""
echo "Verify with: swarm doctor"
echo "Gate check:  ./swarm-gate.sh --gate all --models"
echo ""
