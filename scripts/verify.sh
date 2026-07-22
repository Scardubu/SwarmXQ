#!/usr/bin/env bash
# SwarmX · scripts/verify.sh · v2.0 · IEP-ELITE-MAX
#
# CHANGES vs apex13:
#   [CHECK-01] Canonical APEX model verification
#   [CHECK-02] MODEL_REASON env var presence check added
#
# Runs 6 checks. Exits 0 if all pass (or only soft warnings).

set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

GREEN() { printf '\033[0;32m%s\033[0m' "$1"; }
RED()   { printf '\033[0;31m%s\033[0m' "$1"; }
YELLOW(){ printf '\033[0;33m%s\033[0m' "$1"; }
CYAN()  { printf '\033[0;36m%s\033[0m' "$1"; }
BOLD()  { printf '\033[1m%s\033[0m'    "$1"; }

FAIL=0

echo ""
echo "$(BOLD 'SwarmX Verifier') · v2.0 · IEP-ELITE-MAX"
echo "──────────────────────────────────────────────────────────"

# ── [1/6] Python source compilation ─────────────────────────────────────────
echo ""
echo "$(CYAN '[1/6]') Compiling Python sources"
if python3 -m py_compile "$ROOT"/src/swarmx/*.py 2>/dev/null; then
  echo "  $(GREEN '[OK]') All Python sources compile cleanly"
else
  echo "  $(RED '[FAIL]') Python compilation errors found"
  FAIL=1
fi

# ── [2/6] Import smoke test ──────────────────────────────────────────────────
echo ""
echo "$(CYAN '[2/6]') Import smoke test"
PYTHONPATH="$ROOT/src" python3 -c "
import swarmx
print('  version:', getattr(swarmx, '__version__', 'unknown'))
" 2>/dev/null && echo "  $(GREEN '[OK]') swarmx imports cleanly" || {
  echo "  $(YELLOW '[WARN]') swarmx import failed — src/ may be empty (Path B deployment OK)"
}

# ── [3/6] Runtime health ─────────────────────────────────────────────────────
echo ""
echo "$(CYAN '[3/6]') Runtime health (swarm doctor)"
if command -v swarm >/dev/null 2>&1; then
  swarm doctor --json > /tmp/swarmx_health.json 2>/dev/null && \
    echo "  $(GREEN '[OK]') swarm doctor returned cleanly" || \
    echo "  $(YELLOW '[WARN]') swarm doctor failed — runtime not initialized (expected for fresh install)"
else
  echo "  $(YELLOW '[SKIP]') swarm CLI not in PATH — run install.sh first"
fi

# ── [4/6] IEP-ELITE keyword integrity ───────────────────────────────────────
echo ""
echo "$(CYAN '[4/6]') IEP-ELITE keyword integrity (SYSTEM-PROMPT.md)"
SP="$ROOT/SYSTEM-PROMPT.md"
if [[ -f "$SP" ]]; then
  MISSING=()
  for kw in "Signal Triage" "Latent Ensemble" "Adversarial Self-Check" \
            "Confidence Gate" "Swarm Coherence" "PromptBreeder" \
            "Handoff Contract" "Rollback Anchor" "Fix Log" \
            "Halt over hallucinate"; do
    grep -q "$kw" "$SP" || MISSING+=("$kw")
  done
  if [[ ${#MISSING[@]} -eq 0 ]]; then
    echo "  $(GREEN '[OK]') All 10 IEP-ELITE keywords present"
  else
    echo "  $(RED '[FAIL]') Missing keywords: ${MISSING[*]}"
    FAIL=1
  fi
else
  echo "  $(YELLOW '[WARN]') SYSTEM-PROMPT.md not found — place at project root"
fi

# ── [5/6] Workflow handoff_validation ───────────────────────────────────────
echo ""
echo "$(CYAN '[5/6]') Workflow handoff_validation fields"
WF_DIR="$ROOT/workflows"
MISSING_WF=()
if [[ -d "$WF_DIR" ]]; then
  for wf in "$WF_DIR"/*.yaml; do
    grep -q "handoff_validation" "$wf" 2>/dev/null || MISSING_WF+=("$(basename "$wf")")
  done
  if [[ ${#MISSING_WF[@]} -eq 0 ]]; then
    echo "  $(GREEN '[OK]') All workflows have handoff_validation"
  else
    echo "  $(YELLOW '[WARN]') Workflows missing handoff_validation (non-blocking): ${MISSING_WF[*]}"
  fi
else
  echo "  $(YELLOW '[WARN]') workflows/ directory not found"
fi

# ── [6/6] Canonical APEX model verification ─────────────────────────────────
echo ""
echo "$(CYAN '[6/6]') Canonical APEX models: Relay · Pilot · Architect · Forge · Oracle"
if command -v ollama >/dev/null 2>&1; then
  MODELS=$(ollama list 2>/dev/null | awk 'NR>1 {print $1}' || echo "")
  for spec in \
    "Relay:route-phi4-lite-q4km-prod" \
    "Pilot:instruct-phi4-pro-q8-prod" \
    "Architect:plan-qwen25-pro-q5km-prod" \
    "Forge:code-qwen25-pro-q5km-prod" \
    "Oracle:reason-deepseekr1-pro-q5km-prod"
  do
    model="${spec%%:*}"
    patterns="${spec#*:}"
    if echo "$MODELS" | python3 -c "
import sys
patterns = [p for p in '${patterns}'.split('|') if p]
models = [line.strip() for line in sys.stdin if line.strip()]
raise SystemExit(0 if any(any(p.lower() in model.lower() for p in patterns) for model in models) else 1)
"; then
      echo "  $(GREEN '[OK]') $model — present"
    else
      echo "  $(YELLOW '[WARN]') $model — canonical tag not found."
    fi
  done
else
  echo "  $(YELLOW '[SKIP]') Ollama not installed. Install from https://ollama.ai"
fi

# Check env vars
echo ""
echo "  Environment vars:"
for var in MODEL_FAST MODEL_REASON MODEL_CODE SWARM_MODEL_FAST SWARM_MODEL_REASON SWARM_MODEL_CODE; do
  val="${!var:-unset}"
  if [[ "$val" == "unset" ]]; then
    echo "  $(YELLOW '[WARN]') $var — not set (source ~/.zshrc or ~/.bashrc)"
  else
    echo "  $(GREEN '[OK]') $var=$val"
  fi
done

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────"
if [[ $FAIL -eq 0 ]]; then
  echo "$(GREEN 'Verification complete.') v2.0 / IEP-ELITE 2026.4"
  echo ""
  echo "Model routing:"
  echo "  $(CYAN 'route-phi4-lite-q4km-prod')        → Relay router"
  echo "  $(CYAN 'instruct-phi4-pro-q8-prod')        → Pilot classifier and captioner"
  echo "  $(CYAN 'plan-qwen25-pro-q5km-prod')        → Architect planning"
  echo "  $(CYAN 'code-qwen25-pro-q5km-prod')        → Forge code and tool agent"
  echo "  $(CYAN 'reason-deepseekr1-pro-q5km-prod')  → Oracle reasoning"
else
  echo "$(RED 'Verification FAILED.') Fix the errors above before running swarm commands."
  exit 1
fi
echo ""
