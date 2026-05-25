#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# scripts/swarm-healthcheck-apex17.sh
# SwarmXQ APEX-17 r7 — Production Healthcheck
#
# Validates:
#   1. Ollama is running and responsive
#   2. Core models are registered (canonical tags)
#   3. Relay (route-phi4-lite-q4km-prod) is warm and responsive
#   4. API health endpoint returns OK
#   5. Memory pressure is within operating bounds
#   6. Naming standard is enforced
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
WARN=0
FAIL=0

check() {
  local label="$1"; shift
  if "$@" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${RED}✗${NC} $label"
    FAIL=$((FAIL + 1))
  fi
}

warn_check() {
  local label="$1"; shift
  if "$@" 2>/dev/null; then
    echo -e "  ${GREEN}✓${NC} $label"
    PASS=$((PASS + 1))
  else
    echo -e "  ${YELLOW}⚠${NC} $label"
    WARN=$((WARN + 1))
  fi
}

OLLAMA_URL="${SWARMX_OLLAMA_URL:-http://127.0.0.1:11434}"
API_URL="${SWARMX_API_URL:-http://127.0.0.1:3001}"

echo -e "${CYAN}SwarmXQ APEX-17 r7 Healthcheck${NC}"
echo ""

# ── 1. Ollama ──────────────────────────────────────────────────────────────
echo -e "${CYAN}Ollama${NC}"
check "Ollama is running" curl -sf "$OLLAMA_URL/api/tags" -o /dev/null
check "Ollama /api/ps responds" curl -sf "$OLLAMA_URL/api/ps" -o /dev/null

# ── 2. Core models registered ─────────────────────────────────────────────
echo ""
echo -e "${CYAN}Model Registry (Canonical Tags)${NC}"

MODELS=$(curl -sf "$OLLAMA_URL/api/tags" 2>/dev/null | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
    for m in data.get('models', []):
        print(m['name'])
except: pass
" 2>/dev/null || echo "")

check_model() {
  local tag="$1"
  local operator="$2"
  echo "$MODELS" | grep -qx "$tag"
}

warn_check "Relay (route-phi4-lite-q4km-prod) registered" check_model "route-phi4-lite-q4km-prod" "Relay"
warn_check "Pilot (instruct-phi4-pro-q8-prod) registered" check_model "instruct-phi4-pro-q8-prod" "Pilot"
warn_check "Forge (code-qwen25-pro-q5km-prod) registered" check_model "code-qwen25-pro-q5km-prod" "Forge"
warn_check "Oracle (reason-deepseekr1-pro-q5km-prod) registered" check_model "reason-deepseekr1-pro-q5km-prod" "Oracle"

# ── 3. Relay responsiveness ───────────────────────────────────────────────
echo ""
echo -e "${CYAN}Relay Warmth${NC}"
check "Relay responds to classification prompt" bash -c '
  RESP=$(curl -sf -X POST "'$OLLAMA_URL'/api/generate" \
    -H "Content-Type: application/json" \
    -d "{\"model\":\"route-phi4-lite-q4km-prod\",\"prompt\":\"classify: hello\",\"stream\":false,\"options\":{\"num_predict\":8}}" \
    --max-time 10 2>/dev/null)
  echo "$RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get(\"response\") else 1)" 2>/dev/null
'

# ── 4. API Health ─────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}API${NC}"
warn_check "API /health responds" curl -sf "$API_URL/health" -o /dev/null
warn_check "API /api/system/health responds" curl -sf "$API_URL/api/system/health" -o /dev/null

# ── 5. Memory ─────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Memory${NC}"
if [[ -f /proc/meminfo ]]; then
  AVAIL_KB=$(grep MemAvailable /proc/meminfo | awk '{print $2}')
  AVAIL_MB=$((AVAIL_KB / 1024))
  if [[ $AVAIL_MB -ge 2500 ]]; then
    echo -e "  ${GREEN}✓${NC} Available RAM: ${AVAIL_MB} MB (normal)"
    PASS=$((PASS + 1))
  elif [[ $AVAIL_MB -ge 1500 ]]; then
    echo -e "  ${YELLOW}⚠${NC} Available RAM: ${AVAIL_MB} MB (low-ram tier)"
    WARN=$((WARN + 1))
  else
    echo -e "  ${RED}✗${NC} Available RAM: ${AVAIL_MB} MB (degraded/critical)"
    FAIL=$((FAIL + 1))
  fi
else
  echo -e "  ${YELLOW}⚠${NC} /proc/meminfo not available (non-Linux)"
  WARN=$((WARN + 1))
fi

# ── 6. Naming Validation ─────────────────────────────────────────────────
echo ""
echo -e "${CYAN}Naming Standard${NC}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

warn_check "operator_map.py exists" test -f "$REPO_ROOT/src/swarmx/operator_map.py"
warn_check "operator-map.ts exists" test -f "$REPO_ROOT/packages/swarmx-types/src/operator-map.ts"

# Check for legacy -scar in registry.yaml ollama_tag values
if [[ -f "$REPO_ROOT/models/registry.yaml" ]]; then
  if grep "ollama_tag:.*-scar" "$REPO_ROOT/models/registry.yaml" > /dev/null 2>&1; then
    echo -e "  ${YELLOW}⚠${NC} registry.yaml still has -scar ollama_tag values"
    WARN=$((WARN + 1))
  else
    echo -e "  ${GREEN}✓${NC} registry.yaml uses canonical tags"
    PASS=$((PASS + 1))
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${CYAN}────────────────────────────────────────${NC}"
echo -e "  ${GREEN}Passed:${NC} $PASS  ${YELLOW}Warnings:${NC} $WARN  ${RED}Failed:${NC} $FAIL"

if [[ $FAIL -gt 0 ]]; then
  echo -e "  ${RED}HEALTH: DEGRADED${NC}"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "  ${YELLOW}HEALTH: OK (with warnings)${NC}"
  exit 0
else
  echo -e "  ${GREEN}HEALTH: OK${NC}"
  exit 0
fi
