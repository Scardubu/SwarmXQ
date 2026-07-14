#!/usr/bin/env bash
# scripts/validate_cli.sh — SwarmX Premium CLI v0.3.0 smoke-test suite
# Usage: bash scripts/validate_cli.sh [--strict]
# Exit codes: 0 = all pass, 1 = one or more failures

set -euo pipefail

STRICT=0
for arg in "$@"; do
  [[ "$arg" == "--strict" ]] && STRICT=1
done

# ── Colour helpers (NO_COLOR aware) ──────────────────────────────────────────
if [[ -n "${NO_COLOR:-}" ]]; then
  RED="" GREEN="" YELLOW="" RESET=""
else
  RED="\033[0;31m" GREEN="\033[0;32m" YELLOW="\033[0;33m" RESET="\033[0m"
fi

PASS=0; FAIL=0; SKIP=0

pass()  { echo -e "  ${GREEN}PASS${RESET}  $1"; ((PASS++)); }
fail()  { echo -e "  ${RED}FAIL${RESET}  $1"; ((FAIL++)); }
skip()  { echo -e "  ${YELLOW}SKIP${RESET}  $1"; ((SKIP++)); }
banner(){ echo -e "\n── $1 ──"; }

# ── Helper: run a command, check exit code and optional output pattern ────────
check() {
  local label="$1"
  local pattern="${2:-}"   # optional grep pattern
  shift 2 || true
  local cmd=("$@")

  if output=$("${cmd[@]}" 2>&1); then
    if [[ -n "$pattern" ]] && ! echo "$output" | grep -qE "$pattern"; then
      fail "$label (output missing: $pattern)"
      return
    fi
    pass "$label"
  else
    fail "$label (exit $?)"
  fi
}

# ── Detect entry point ───────────────────────────────────────────────────────
banner "Entry-point detection"
if command -v swarm &>/dev/null; then
  CLI="swarm"
  pass "swarm entry point found"
elif command -v swarmx &>/dev/null; then
  CLI="swarmx"
  pass "swarmx entry point found (swarm not in PATH)"
elif python -m swarmx.console.entry --help &>/dev/null 2>&1; then
  CLI="python -m swarmx.console.entry"
  skip "swarm not in PATH — falling back to python -m swarmx.console.entry"
else
  echo -e "\n${RED}FATAL${RESET} No swarm/swarmx entry point found. Run: pip install -e ."
  exit 1
fi

# ── 1. Version flags ─────────────────────────────────────────────────────────
banner "Version flags"
check "--version flag"              "0\." $CLI --version
check "-V flag"                     "0\." $CLI -V
check "version subcommand"          "0\." $CLI version
check "version --json"              '"version"' $CLI version --json

# ── 2. Help ──────────────────────────────────────────────────────────────────
banner "Help"
check "root --help"                 "Usage" $CLI --help
check "run --help"                  "Usage" $CLI run --help
check "evolve --help"               "Usage" $CLI evolve --help
check "status --help"               "Usage" $CLI status --help
check "inspect --help"              "Usage" $CLI inspect --help
check "gate --help"                 "Usage" $CLI gate --help
check "skills --help"               "Usage" $CLI skills --help
check "audit --help"                "Usage" $CLI audit --help
check "telemetry --help"            "Usage" $CLI telemetry --help
check "doctor --help"               "Usage" $CLI doctor --help

# ── 3. Doctor ────────────────────────────────────────────────────────────────
banner "Doctor"
check "doctor check"                "python"  $CLI doctor check
check "doctor check --json"         '"check"' $CLI doctor check --json

# ── 4. Telemetry ─────────────────────────────────────────────────────────────
banner "Telemetry"
check "telemetry stats"             "" $CLI telemetry stats
check "telemetry stats --json"      '"total"' $CLI telemetry stats --json

# ── 5. Skills ────────────────────────────────────────────────────────────────
banner "Skills"
check "skills list"                 ""      $CLI skills list

# ── 6. Status ────────────────────────────────────────────────────────────────
banner "Status"
check "status show"                 ""      $CLI status show

# ── 7. Evolve (read-only) ────────────────────────────────────────────────────
banner "Evolve"
check "evolve show"                 ""      $CLI evolve show

# ── 8. NO_COLOR propagation ──────────────────────────────────────────────────
banner "NO_COLOR"
if NO_COLOR=1 $CLI --help 2>&1 | grep -q "Usage"; then
  pass "NO_COLOR=1 does not break --help"
else
  fail "NO_COLOR=1 breaks --help"
fi

# ── 9. JSON global flag ──────────────────────────────────────────────────────
banner "JSON mode"
if output=$($CLI --json version 2>&1) && echo "$output" | python -c "import sys,json;json.load(sys.stdin)" &>/dev/null; then
  pass "--json flag produces valid JSON"
else
  fail "--json flag did not produce valid JSON"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "────────────────────────────────────────"
echo "  PASS: $PASS   FAIL: $FAIL   SKIP: $SKIP"
echo "────────────────────────────────────────"

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}Validation FAILED — $FAIL check(s) did not pass.${RESET}"
  exit 1
else
  echo -e "${GREEN}Validation PASSED.${RESET}"
  exit 0
fi
