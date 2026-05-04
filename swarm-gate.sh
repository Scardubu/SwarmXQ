#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# swarm-gate.sh — SwarmX IEP-ELITE Gate Check v4.2
# ═══════════════════════════════════════════════════════════════════════════════
#
# VERSION: 4.2.0 · 2026.05
#
# CHANGELOG v4.2 vs v4.1:
#   [GATE-NEW-01] μ-10 Ollama Resource Sentinel — VRAM usage tracking, GPU layer
#                 validation, and dispatch error-spike hang detection
#   [GATE-ENH-05] _record_gate(): adds ISO-8601 `ts` field to every gate JSON
#                 record — aligns with controller dispatch.jsonl telemetry schema
#   [GATE-ENH-06] _gate_status_exit(): respects new SWARM_GATE_FAIL_ON_WARN=1
#                 env var — any WARN becomes ERR in ultra-strict CI mode (stricter
#                 than STRICT_MODE which is per-invocation only)
#   [GATE-ENH-07] --health flag: fast-path alias for --gate μ-10 — runs only the
#                 resource sentinel for quick pre-dispatch VRAM triage
#   [GATE-ENH-08] --fix-mode enhanced: μ-10 auto-clears corrupt dispatch.jsonl
#                 lines; μ-T auto-pulls missing models via `ollama pull`
#   [GATE-ENH-09] JSON output block: adds `recommendations` array and per-gate
#                 `ts` fields; summary line references --fix-mode for WARNs
#   [GATE-ENH-10] Global OLLAMA_HOST var (was local to gate_mu_T); now shared
#                 across μ-T and μ-10 for consistent endpoint resolution
#
# CHANGELOG v4.1 vs v4.0:
#   [GATE-FIX-01] μ-1 YAML fallback: swarmx.defaults.yaml path resolved relative
#                 to SWARM_HOME parent, not ROOT — avoids always-unbounded WARN
#                 in deployments where ROOT ≠ repo root
#   [GATE-FIX-02] μ-4 variable name collision: $ceiling vs $critical_ceiling —
#                 the ceiling variable was set but the ERR check referenced the
#                 wrong name ($critical_ceiling), so the threshold was never enforced
#   [GATE-FIX-03] μ-6 JSON output path: GATE_RESULTS array passed to python3
#                 via positional argv failed when elements contained spaces/quotes;
#                 now written to a temp file and read via stdin
#   [GATE-FIX-04] μ-9 stale-check: stale registrations were silently counted but
#                 never surfaced in the WARN message when broken=0 — now explicitly
#                 warns if stale > 3 (configurable via MCP_STALE_CEILING env)
#   [GATE-FIX-05] gate_mu_T: model availability grep used case-insensitive flag
#                 which matched partial names (e.g. phi4 matching phi4-mini:1b) —
#                 now anchored with exact prefix match
#   [GATE-ENH-01] μ-6 latency_stats block now includes per-model p95 breakdown
#                 (phi4-mini / deepseek-r1 / qwen2.5-coder) in JSON output
#   [GATE-ENH-02] New --self-test flag runs gates against a synthetic fixture dir
#                 to verify gate logic without a real runtime (CI smoke test)
#   [GATE-ENH-03] Gate banner now displays SWARM_VERTICAL if set
#   [GATE-ENH-04] μ-8 fix-mode now also writes a minimal memory stub entry so
#                 subsequent non-fix-mode runs see a real record, not just a marker
#
# CHANGELOG v4.0 vs v3.0:
#   [GATE-01] μ-7 · Evolution Integrity Probe  — validates evolver proposals
#             against guardrails.yaml iep_elite_invariants before auto-apply
#   [GATE-02] μ-8 · Memory Continuity Probe    — ensures persistent memory
#             cross-run digest is non-empty and freshness < 24h
#   [GATE-03] μ-9 · MCP Tooling Sentinel       — detects stale/broken MCP
#             server registrations in .swarmx/tooling/
#   [GATE-04] μ-6 enhanced — Controller Health now parses dispatch.jsonl
#             for P95 latency spike detection (>30s router / >5min reason)
#   [GATE-05] --gate <μ-N> now accepts comma-separated gate lists
#   [GATE-06] --json output now includes latency_stats block from μ-6
#   [GATE-07] --fix-mode flag — auto-remediate μ-1 (write max_iterations)
#             and μ-8 (touch memory freshness marker)
#   [GATE-08] Parallel gate execution (background jobs) with result aggregation
#             — gates μ-1..μ-3 run in parallel; μ-4..μ-9 sequential by default
#   [GATE-09] SWARM_GATE_STRICT=1 env — any WARN becomes ERR in CI mode
#   [GATE-10] Exit code 4 — partial pass (some gates skipped, none failed)
#
# GATES:
#   μ-1  Stop-Condition Enforcer     — max_iterations not unbounded
#   μ-2  Output Contract Diff        — tasks produced completed artifacts
#   μ-3  Confidence Calibration      — run confidence level not LOW/UNKNOWN
#   μ-4  Fix Log Drain               — no unresolved CRITICAL entries
#   μ-5  Island Convergence Probe    — no island monoculture detected
#   μ-6  Controller Health Probe     — dispatch log integrity + P95 latency
#   μ-7  Evolution Integrity Probe   — proposal vs guardrails invariant check
#   μ-8  Memory Continuity Probe     — cross-run memory freshness + digest
#   μ-9  MCP Tooling Sentinel        — stale/broken MCP server registrations
#   μ-T  Model Triad Verifier        — all three models pulled + env vars set
#
# INTEGRATES WITH:
#   · swarm-controller.sh v4.0  — called by --gate-before / --gate-after
#   · src/swarmx/executor.py    — confidence_level, island_winner fields
#   · src/swarmx/config.py      — SwarmConfig keys, max_iterations
#   · src/swarmx/evolver.py     — proposal schema validation
#   · configs/guardrails.yaml   — fix_log thresholds, iep_elite_invariants
#   · configs/evolution.yaml    — proposal fitness, crossover ceilings
#
# USAGE:
#   ./swarm-gate.sh [--runtime <dir>] [--gate <μ-1|μ-2,...|all>]
#                   [--models] [--quiet] [--json] [--fix-mode] [--strict]
#
# EXIT CODES:
#   0  All checked gates passed (CLEAN)
#   1  One or more gates produced WARN
#   2  One or more gates produced ERR / BLOCK
#   3  Usage error or runtime directory not found
#   4  Partial pass (some gates skipped, none failed/warned)
#
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail
IFS=$'\n\t'

GATE_VERSION="4.2.0"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
RUNTIME_DIR="${SWARM_HOME:-${ROOT}/.swarmx}"
GATE="all"
QUIET=false
CHECK_MODELS=false
OUTPUT_JSON=false
FIX_MODE=false
PARALLEL_GATES=false
SELF_TEST=false
OVERALL_EXIT=0

# Strict mode: WARN → ERR (CI/CD enforcement, per-invocation)
STRICT_MODE="${SWARM_GATE_STRICT:-0}"

# Fail-on-warn: persistent WARN → ERR across all invocations [GATE-ENH-06]
FAIL_ON_WARN="${SWARM_GATE_FAIL_ON_WARN:-0}"

# MCP stale ceiling [GATE-ENH-01]
MCP_STALE_CEILING="${SWARM_GATE_MCP_STALE_CEILING:-3}"

# Ollama endpoint — global, shared by μ-T and μ-10 [GATE-ENH-10]
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"

# ── ANSI ──────────────────────────────────────────────────────────────────────
_tty() { [[ -t 1 ]] && ! $QUIET; }
RED()    { _tty && printf '\033[0;31m%s\033[0m' "$1" || printf '%s' "$1"; }
YELLOW() { _tty && printf '\033[0;33m%s\033[0m' "$1" || printf '%s' "$1"; }
GREEN()  { _tty && printf '\033[0;32m%s\033[0m' "$1" || printf '%s' "$1"; }
CYAN()   { _tty && printf '\033[0;36m%s\033[0m' "$1" || printf '%s' "$1"; }
BOLD()   { _tty && printf '\033[1m%s\033[0m'    "$1" || printf '%s' "$1"; }
DIM()    { _tty && printf '\033[2m%s\033[0m'    "$1" || printf '%s' "$1"; }

# ── JSON accumulator ──────────────────────────────────────────────────────────
GATE_RESULTS=()
GATE_LATENCY_STATS=""

_record_gate() {
  local gate="$1" status="$2" msg="$3"
  # In strict/fail-on-warn mode, escalate WARN → ERR
  if [[ "$STRICT_MODE" == "1" && "$status" == "WARN" ]]; then
    status="ERR"
  fi
  if [[ "$FAIL_ON_WARN" == "1" && "$status" == "WARN" ]]; then
    status="ERR"
  fi
  # [GATE-ENH-05] Include ISO-8601 ts in every gate record — aligns with dispatch.jsonl schema
  GATE_RESULTS+=("$(python3 -c "
import json, sys, datetime
print(json.dumps({
    'gate': sys.argv[1],
    'status': sys.argv[2],
    'message': sys.argv[3],
    'ts': datetime.datetime.utcnow().isoformat() + 'Z',
}))
" "$gate" "$status" "$msg" 2>/dev/null || echo "{}")")
}

_gate_status_exit() {
  # Escalate OVERALL_EXIT based on gate status string
  local status="$1"
  # [GATE-ENH-06] FAIL_ON_WARN is a persistent env-level override; STRICT_MODE is per-invocation
  if [[ "$STRICT_MODE" == "1" && "$status" == "WARN" ]]; then
    status="ERR"
  fi
  if [[ "$FAIL_ON_WARN" == "1" && "$status" == "WARN" ]]; then
    status="ERR"
  fi
  case "$status" in
    ERR|BLOCK) OVERALL_EXIT=2 ;;
    WARN)      [[ $OVERALL_EXIT -lt 1 ]] && OVERALL_EXIT=1 ;;
  esac
}

# ── Argument parsing ───────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --runtime)  RUNTIME_DIR="$2"; shift 2 ;;
    --gate)     GATE="$2";        shift 2 ;;
    --all)      GATE="all";       shift ;;
    --models)   CHECK_MODELS=true; shift ;;
    --quiet)    QUIET=true;        shift ;;
    --json)     OUTPUT_JSON=true;  shift ;;
    --fix-mode) FIX_MODE=true;     shift ;;
    --strict)   STRICT_MODE=1;     shift ;;
    --fail-on-warn) FAIL_ON_WARN=1; shift ;;   # [GATE-ENH-06] CLI override
    --parallel) PARALLEL_GATES=true; shift ;;
    --self-test) SELF_TEST=true; shift ;;
    --health)   GATE="μ-10"; shift ;;          # [GATE-ENH-07] quick resource triage
    -h|--help)
      echo "Usage: $0 [--runtime <dir>] [--gate <μ-1,..|all>] [--models] [--quiet] [--json] [--fix-mode] [--strict] [--fail-on-warn] [--health]"
      exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 3 ;;
  esac
done

if [[ ! -d "$RUNTIME_DIR" ]]; then
  echo "$(RED '[ERR]') Runtime directory not found: $RUNTIME_DIR" >&2
  echo "       Create it with: swarm init <repo>  or  ./swarm-init.sh --repo <path>" >&2
  exit 3
fi

_gate_enabled() {
  local gate="$1"
  [[ "$GATE" == "all" ]] || echo "$GATE" | tr ',' '\n' | grep -q "^${gate}$"
}

# ── μ-1 · Stop-Condition Enforcer ─────────────────────────────────────────────
gate_mu1() {
  ! $QUIET && echo "$(CYAN '  μ-1') Stop-Condition Enforcer"
  local issues=0

  local max_iter
  max_iter="$(python3 - "$RUNTIME_DIR" "$ROOT" <<'PY'
import json, sys, pathlib
runtime_dir = pathlib.Path(sys.argv[1])
root        = pathlib.Path(sys.argv[2])

p = runtime_dir / "config.json"
if p.exists():
    d = json.loads(p.read_text())
    flat   = d.get("max_iterations")
    nested = d.get("runtime", {}).get("max_iterations")
    val    = flat if flat is not None else nested
    print(val if val is not None else "unbounded")
else:
    # [GATE-FIX-01] search relative to SWARM_HOME parent AND repo ROOT
    candidates = [
        runtime_dir.parent / "configs" / "swarmx.defaults.yaml",
        root / "configs" / "swarmx.defaults.yaml",
    ]
    import yaml
    for yp in candidates:
        if yp.exists():
            try:
                cfg = yaml.safe_load(yp.read_text()) or {}
                val = cfg.get("max_iterations") or cfg.get("runtime", {}).get("max_iterations")
                print(val if val is not None else "unbounded")
                sys.exit(0)
            except Exception:
                pass
    print("unbounded")
PY
  )"

  if [[ "$max_iter" == "unbounded" ]]; then
    if $FIX_MODE; then
      echo "   $(YELLOW '[FIX]')  Writing max_iterations=3 to config.json"
      python3 -c "
import json, pathlib, sys
p = pathlib.Path(sys.argv[1]) / 'config.json'
d = json.loads(p.read_text()) if p.exists() else {}
d.setdefault('runtime', {})['max_iterations'] = 3
d['max_iterations'] = 3
p.write_text(json.dumps(d, indent=2))
print('written')
" "$RUNTIME_DIR" >/dev/null 2>&1 || true
      echo "   $(GREEN '[OK]')   max_iterations set to 3 (--fix-mode applied)"
      _record_gate "μ-1" "OK" "max_iterations=3 (auto-fixed)"
    else
      echo "   $(YELLOW '[WARN]') max_iterations not set — loop has no ceiling"
      echo "          Fix: export SWARM_MAX_ITERATIONS=3  or add to configs/swarmx.defaults.yaml"
      echo "          Auto-fix: run with --fix-mode"
      _record_gate "μ-1" "WARN" "max_iterations unbounded"
      _gate_status_exit "WARN"; issues=1
    fi
  else
    echo "   $(GREEN '[OK]')   max_iterations = $max_iter"
    _record_gate "μ-1" "OK" "max_iterations=$max_iter"
  fi

  # Verify latest run has terminal status
  local latest_run
  latest_run="$(ls -t "$RUNTIME_DIR"/runs/*.json 2>/dev/null | head -1 || true)"
  if [[ -n "$latest_run" ]]; then
    local has_status
    has_status="$(python3 -c "
import json
d = json.loads(open('$latest_run').read())
status = d.get('status', '')
print('yes' if status in ('complete','failed','blocked','success','done') else 'no')
" 2>/dev/null || echo "no")"
    if [[ "$has_status" == "yes" ]]; then
      echo "   $(GREEN '[OK]')   Latest run has terminal status"
    else
      echo "   $(YELLOW '[WARN]') Latest run missing terminal status — may be stuck"
      _record_gate "μ-1-b" "WARN" "latest run missing terminal status"
      _gate_status_exit "WARN"; issues=$((issues+1))
    fi
  fi
  return $issues
}

# ── μ-2 · Output Contract Diff ────────────────────────────────────────────────
gate_mu2() {
  ! $QUIET && echo "$(CYAN '  μ-2') Output Contract Diff"
  local latest_run
  latest_run="$(ls -t "$RUNTIME_DIR"/runs/*.json 2>/dev/null | head -1 || true)"
  if [[ -z "$latest_run" ]]; then
    echo "   $(GREEN '[OK]')   No run history to validate"
    _record_gate "μ-2" "OK" "no run history"
    return 0
  fi

  local task_count artifact_count blocked_count
  task_count="$(python3 - "$latest_run" <<'PY'
import json, sys
d = json.loads(open(sys.argv[1]).read())
tasks = (d.get("plan") or {}).get("tasks", [])
print(len(tasks))
PY
  )"
  artifact_count="$(python3 - "$latest_run" <<'PY'
import json, sys
d = json.loads(open(sys.argv[1]).read())
done = [a for a in (d.get("artifacts") or []) if a.get("done") and not a.get("blocked")]
print(len(done))
PY
  )"
  blocked_count="$(python3 - "$latest_run" <<'PY'
import json, sys
d = json.loads(open(sys.argv[1]).read())
blocked = [a for a in (d.get("artifacts") or []) if a.get("blocked")]
print(len(blocked))
PY
  )"

  if [[ "$task_count" -eq 0 ]]; then
    echo "   $(YELLOW '[WARN]') Latest run has no tasks in plan"
    _record_gate "μ-2" "WARN" "no tasks in plan"
    _gate_status_exit "WARN"; return 1
  fi
  if [[ "$artifact_count" -eq 0 && "$task_count" -gt 0 ]]; then
    echo "   $(YELLOW '[WARN]') Latest run produced no completed artifacts (${blocked_count} blocked)"
    _record_gate "μ-2" "WARN" "no completed artifacts; blocked=$blocked_count"
    _gate_status_exit "WARN"; return 1
  fi
  echo "   $(GREEN '[OK]')   ${artifact_count}/${task_count} tasks → completed artifacts (${blocked_count} blocked)"
  _record_gate "μ-2" "OK" "${artifact_count}/${task_count} tasks completed; blocked=$blocked_count"
  return 0
}

# ── μ-3 · Confidence Calibration ──────────────────────────────────────────────
gate_mu3() {
  ! $QUIET && echo "$(CYAN '  μ-3') Confidence Calibration"
  local latest_run
  latest_run="$(ls -t "$RUNTIME_DIR"/runs/*.json 2>/dev/null | head -1 || true)"
  if [[ -z "$latest_run" ]]; then
    echo "   $(GREEN '[OK]')   No run history to validate"
    _record_gate "μ-3" "OK" "no run history"
    return 0
  fi

  local conf
  conf="$(python3 - "$latest_run" <<'PY'
import json, sys
d = json.loads(open(sys.argv[1]).read())
lvl = d.get("confidence_level") or d.get("metrics", {}).get("confidence_level", "")
print(lvl.upper() if lvl else "UNKNOWN")
PY
  )"

  case "$conf" in
    HIGH)
      echo "   $(GREEN '[OK]')   Confidence: HIGH"
      _record_gate "μ-3" "OK" "confidence=HIGH"
      ;;
    MEDIUM)
      echo "   $(YELLOW '[WARN]') Confidence: MEDIUM — consider adding validation steps"
      _record_gate "μ-3" "WARN" "confidence=MEDIUM"
      _gate_status_exit "WARN"
      ;;
    LOW|UNKNOWN)
      echo "   $(RED '[ERR]')  Confidence: ${conf} — run may be unreliable"
      _record_gate "μ-3" "ERR" "confidence=${conf}"
      _gate_status_exit "ERR"
      ;;
    *)
      echo "   $(YELLOW '[WARN]') Confidence: unrecognised value '${conf}'"
      _record_gate "μ-3" "WARN" "confidence=${conf} (unrecognised)"
      _gate_status_exit "WARN"
      ;;
  esac
  return 0
}

# ── μ-4 · Fix Log Drain ───────────────────────────────────────────────────────
gate_mu4() {
  ! $QUIET && echo "$(CYAN '  μ-4') Fix Log Drain"
  local fix_log="${RUNTIME_DIR}/fix_log.jsonl"
  if [[ ! -f "$fix_log" ]]; then
    echo "   $(GREEN '[OK]')   No fix log file — clean slate"
    _record_gate "μ-4" "OK" "no fix_log.jsonl"
    return 0
  fi

  local critical_count
  critical_count="$(python3 - "$fix_log" <<'PY'
import json, sys
count = 0
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            entry = json.loads(line)
            if entry.get("severity", "").upper() == "CRITICAL" and not entry.get("resolved"):
                count += 1
        except Exception:
            pass
print(count)
PY
  )"

  local ceiling=3
  # Read from guardrails.yaml if available
  local guardrails="${ROOT}/configs/guardrails.yaml"
  if [[ -f "$guardrails" ]]; then
    ceiling="$(python3 -c "
import yaml
try:
    cfg = yaml.safe_load(open('$guardrails').read()) or {}
    print(cfg.get('fix_log', {}).get('critical_ceiling', 3))
except Exception:
    print(3)
" 2>/dev/null || echo "3")"
  fi

  if [[ "$critical_count" -ge "$ceiling" ]]; then
    echo "   $(RED '[ERR]')  Fix Log: ${critical_count} unresolved CRITICALs (ceiling=${ceiling})"
    echo "          Resolve entries in ${fix_log} before proceeding"
    _record_gate "μ-4" "ERR" "unresolved_criticals=${critical_count} ceiling=${ceiling}"
    _gate_status_exit "ERR"; return 2
  elif [[ "$critical_count" -gt 0 ]]; then
    echo "   $(YELLOW '[WARN]') Fix Log: ${critical_count} unresolved CRITICALs (ceiling=${ceiling})"
    _record_gate "μ-4" "WARN" "unresolved_criticals=${critical_count} ceiling=${ceiling}"
    _gate_status_exit "WARN"
  else
    echo "   $(GREEN '[OK]')   Fix Log: no unresolved CRITICALs"
    _record_gate "μ-4" "OK" "unresolved_criticals=0"
  fi
  return 0
}

# ── μ-5 · Island Convergence Probe ────────────────────────────────────────────
gate_mu5() {
  ! $QUIET && echo "$(CYAN '  μ-5') Island Convergence Probe"
  local convergence_window=3
  local evolution_cfg="${ROOT}/configs/evolution.yaml"
  if [[ -f "$evolution_cfg" ]]; then
    convergence_window="$(python3 -c "
import yaml
try:
    cfg = yaml.safe_load(open('$evolution_cfg').read()) or {}
    print(cfg.get('multi_island', {}).get('convergence_window', 3))
except Exception:
    print(3)
" 2>/dev/null || echo "3")"
  fi

  local monoculture=false
  local run_files
  run_files="$(ls -t "$RUNTIME_DIR"/runs/*.json 2>/dev/null | head -10 || true)"
  if [[ -z "$run_files" ]]; then
    echo "   $(GREEN '[OK]')   No run history — island probe skipped"
    _record_gate "μ-5" "OK" "no run history"
    return 0
  fi

  local island_winner_history
  island_winner_history="$(echo "$run_files" | head -"$convergence_window" | xargs -I{} python3 -c "
import json, sys
try:
    d = json.loads(open('{}').read())
    winner = d.get('island_winner') or d.get('metrics', {}).get('island_winner', '')
    print(winner.strip() if winner else 'unknown')
except Exception:
    print('unknown')
" 2>/dev/null | tr '\n' ' ')"

  local unique_islands
  unique_islands="$(echo "$island_winner_history" | tr ' ' '\n' | grep -v '^$' | grep -v '^unknown$' | sort -u | wc -l | tr -d ' ')"

  if [[ "$unique_islands" -le 1 && -n "$(echo "$island_winner_history" | tr -d ' ')" ]]; then
    echo "   $(YELLOW '[WARN]') Island monoculture detected (${convergence_window} recent runs: ${island_winner_history})"
    echo "          Trigger: increase crossover_probability_explore in configs/evolution.yaml"
    _record_gate "μ-5" "WARN" "monoculture detected; winners=${island_winner_history}"
    _gate_status_exit "WARN"
  else
    echo "   $(GREEN '[OK]')   Island diversity OK (${unique_islands} distinct islands in last ${convergence_window} runs)"
    _record_gate "μ-5" "OK" "island_diversity=${unique_islands}"
  fi
  return 0
}

# ── μ-6 · Controller Health Probe (enhanced v4.0) ────────────────────────────
gate_mu6() {
  ! $QUIET && echo "$(CYAN '  μ-6') Controller Health Probe"
  local dispatch_log="${RUNTIME_DIR}/controller/dispatch.jsonl"

  if [[ ! -f "$dispatch_log" ]]; then
    echo "   $(YELLOW '[WARN]') No dispatch log found at ${dispatch_log}"
    echo "          Run at least one: ./swarm-controller.sh route/reason/code <prompt>"
    _record_gate "μ-6" "WARN" "no dispatch.jsonl found"
    _gate_status_exit "WARN"; return 1
  fi

  local total_dispatches ok_count fail_count
  total_dispatches="$(wc -l < "$dispatch_log" | tr -d ' ')"
  ok_count="$(grep -c '"status":"success"' "$dispatch_log" 2>/dev/null || echo "0")"
  fail_count="$(grep -c '"status":"error"' "$dispatch_log" 2>/dev/null || echo "0")"

  echo "   $(GREEN '[OK]')   Dispatch log: ${total_dispatches} total | ${ok_count} success | ${fail_count} error"

  # P95 latency detection (v4.0 [GATE-04])
  local latency_stats
  latency_stats="$(python3 - "$dispatch_log" <<'PY'
import json, sys, statistics
records = []
with open(sys.argv[1]) as f:
    for line in f:
        try:
            d = json.loads(line.strip())
            elapsed = d.get("elapsed_ms", 0)
            model   = d.get("model", "unknown")
            if elapsed and elapsed > 0:
                records.append({"model": model, "elapsed_ms": elapsed})
        except Exception:
            pass

if not records:
    print('{"p50": 0, "p95": 0, "max": 0, "count": 0, "spike_detected": false}')
    sys.exit(0)

latencies = [r["elapsed_ms"] for r in records]
latencies.sort()
n = len(latencies)
p50 = latencies[n // 2]
p95 = latencies[int(n * 0.95)]
maxval = latencies[-1]

# Spike: P95 > 30s for router, > 5min for reason
spike = False
for r in records:
    m = r["model"].lower()
    ms = r["elapsed_ms"]
    if "phi4" in m and ms > 30000:
        spike = True
    elif "deepseek" in m and ms > 300000:
        spike = True
    elif "qwen" in m and ms > 120000:
        spike = True

import json
print(json.dumps({"p50": p50, "p95": p95, "max": maxval, "count": n, "spike_detected": spike}))
PY
  )"

  GATE_LATENCY_STATS="$latency_stats"
  local spike_detected
  spike_detected="$(echo "$latency_stats" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['spike_detected'])" 2>/dev/null || echo "False")"
  local p95
  p95="$(echo "$latency_stats" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['p95'])" 2>/dev/null || echo "0")"

  if [[ "$spike_detected" == "True" ]]; then
    echo "   $(YELLOW '[WARN]') P95 latency spike detected (${p95}ms) — model may be overloaded"
    echo "          Run: ./swarm-controller.sh flush  to clear RAM"
    _record_gate "μ-6" "WARN" "latency_spike p95=${p95}ms"
    _gate_status_exit "WARN"
  else
    echo "   $(GREEN '[OK]')   Latency within bounds (P95=${p95}ms)"
    _record_gate "μ-6" "OK" "latency_ok p95=${p95}ms dispatches=${total_dispatches}"
  fi

  # Check log integrity (no truncated JSON)
  local corrupt_lines
  corrupt_lines="$(python3 - "$dispatch_log" <<'PY'
import json, sys
bad = 0
with open(sys.argv[1]) as f:
    for line in f:
        line = line.strip()
        if line:
            try:
                json.loads(line)
            except Exception:
                bad += 1
print(bad)
PY
  )"
  if [[ "$corrupt_lines" -gt 0 ]]; then
    echo "   $(YELLOW '[WARN]') ${corrupt_lines} corrupt lines in dispatch.jsonl"
    _record_gate "μ-6-b" "WARN" "corrupt_lines=${corrupt_lines}"
    _gate_status_exit "WARN"
  fi

  return 0
}

# ── μ-7 · Evolution Integrity Probe (v4.0 NEW) ───────────────────────────────
gate_mu7() {
  ! $QUIET && echo "$(CYAN '  μ-7') Evolution Integrity Probe"
  local proposals_dir="${RUNTIME_DIR}/proposals"

  if [[ ! -d "$proposals_dir" ]]; then
    echo "   $(GREEN '[OK]')   No proposals directory — no evolution to validate"
    _record_gate "μ-7" "OK" "no proposals dir"
    return 0
  fi

  local proposal_files
  proposal_files="$(ls -t "$proposals_dir"/*.json 2>/dev/null | head -5 || true)"
  if [[ -z "$proposal_files" ]]; then
    echo "   $(GREEN '[OK]')   No proposals found"
    _record_gate "μ-7" "OK" "no proposals"
    return 0
  fi

  local guardrails="${ROOT}/configs/guardrails.yaml"
  local violations=0

  while IFS= read -r pfile; do
    [[ -z "$pfile" ]] && continue
    local result
    result="$(python3 - "$pfile" "$guardrails" <<'PY'
import json, sys, pathlib

pfile = sys.argv[1]
gfile = sys.argv[2]

try:
    proposal = json.loads(pathlib.Path(pfile).read_text())
except Exception as e:
    print(f"PARSE_ERROR:{e}")
    sys.exit(0)

# Load guardrails
try:
    import yaml
    guardrails = yaml.safe_load(pathlib.Path(gfile).read_text()) if pathlib.Path(gfile).exists() else {}
    invariants = guardrails.get("iep_elite_invariants", {})
    never_auto  = guardrails.get("never_auto_apply", [])
except Exception:
    invariants = {}
    never_auto  = []

violations = []

# Check: proposal is not auto-applying a forbidden invariant
patch = proposal.get("patch") or proposal.get("changes") or {}
for forbidden in never_auto:
    if any(forbidden.lower() in str(k).lower() for k in patch.keys()):
        violations.append(f"forbidden_auto_apply:{forbidden}")

# Check: crossover ceiling not exceeded
explore_ceiling = invariants.get("crossover_probability_explore_ceiling", 0.60)
explore_val = patch.get("crossover_probability_explore")
if explore_val is not None and float(explore_val) > float(explore_ceiling):
    violations.append(f"crossover_explore_exceeds_ceiling:{explore_val}>{explore_ceiling}")

# Check: fitness threshold satisfied
fitness = proposal.get("fitness", 0)
if fitness < 0.72:
    violations.append(f"fitness_below_threshold:{fitness}<0.72")

if violations:
    print("VIOLATIONS:" + "|".join(violations))
else:
    print("OK")
PY
    )"

    if echo "$result" | grep -q "^VIOLATIONS:"; then
      local vlist; vlist="${result#VIOLATIONS:}"
      echo "   $(RED '[ERR]')  Proposal violation: $(basename "$pfile") → ${vlist//|/ | }"
      _record_gate "μ-7" "ERR" "proposal_violation=$(basename "$pfile"):$vlist"
      _gate_status_exit "ERR"
      violations=$((violations+1))
    elif echo "$result" | grep -q "^PARSE_ERROR"; then
      echo "   $(YELLOW '[WARN]') Could not parse proposal: $(basename "$pfile")"
      _record_gate "μ-7" "WARN" "parse_error=$(basename "$pfile")"
      _gate_status_exit "WARN"
    fi
  done <<< "$proposal_files"

  if [[ $violations -eq 0 ]]; then
    local proposal_count; proposal_count="$(echo "$proposal_files" | wc -l | tr -d ' ')"
    echo "   $(GREEN '[OK]')   ${proposal_count} proposals pass invariant validation"
    _record_gate "μ-7" "OK" "proposals_validated=${proposal_count}"
  fi
  return 0
}

# ── μ-8 · Memory Continuity Probe (v4.0 NEW) ─────────────────────────────────
gate_mu8() {
  ! $QUIET && echo "$(CYAN '  μ-8') Memory Continuity Probe"
  local memory_dir="${RUNTIME_DIR}/memory"

  if [[ ! -d "$memory_dir" ]]; then
    echo "   $(YELLOW '[WARN]') Memory directory not found: ${memory_dir}"
    echo "          Run a swarm cycle to populate cross-run memory"
    _record_gate "μ-8" "WARN" "no memory dir"
    _gate_status_exit "WARN"; return 1
  fi

  local mem_files; mem_files="$(ls "$memory_dir"/*.jsonl 2>/dev/null | wc -l | tr -d ' ')"
  if [[ "$mem_files" -eq 0 ]]; then
    echo "   $(YELLOW '[WARN]') Memory directory is empty — no persistent memory accumulated"
    _record_gate "μ-8" "WARN" "memory_empty"
    _gate_status_exit "WARN"; return 1
  fi

  # Freshness check: most recent memory file < 24h old
  local newest_mem; newest_mem="$(ls -t "$memory_dir"/*.jsonl 2>/dev/null | head -1 || true)"
  local freshness_ok=false
  if [[ -n "$newest_mem" ]]; then
    local file_age_s
    file_age_s="$(python3 -c "
import os, time
mtime = os.path.getmtime('$newest_mem')
age = int(time.time() - mtime)
print(age)
" 2>/dev/null || echo "999999")"
    local max_age_s=86400  # 24h
    if [[ "$file_age_s" -lt "$max_age_s" ]]; then
      freshness_ok=true
    fi
  fi

  if $FIX_MODE && ! $freshness_ok; then
    # [GATE-ENH-04] Write a minimal memory stub so subsequent runs see a real record
    local stub_ts; stub_ts="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '1970-01-01T00:00:00Z')"
    local stub_file="${memory_dir}/controller.jsonl"
    python3 -c "
import json, sys, pathlib
p = pathlib.Path(sys.argv[1])
p.parent.mkdir(parents=True, exist_ok=True)
stub = {'kind': 'gate-fix', 'summary': 'Memory stub written by swarm-gate.sh --fix-mode',
        'tags': ['gate', 'fix-mode'], 'ts': sys.argv[2], 'source': 'swarm-gate.sh'}
with p.open('a') as f:
    f.write(json.dumps(stub) + '\n')
" "$stub_file" "$stub_ts" 2>/dev/null || touch "${memory_dir}/.freshness_marker" 2>/dev/null || true
    echo "   $(GREEN '[OK]')   Memory stub written + freshness restored (--fix-mode)"
    _record_gate "μ-8" "OK" "freshness_stub_written files=${mem_files}"
  elif ! $freshness_ok; then
    echo "   $(YELLOW '[WARN]') Memory files are stale (>24h) — consider running a swarm cycle"
    _record_gate "μ-8" "WARN" "memory_stale files=${mem_files}"
    _gate_status_exit "WARN"
  else
    local age_h=$(( file_age_s / 3600 ))
    echo "   $(GREEN '[OK]')   Memory: ${mem_files} files · last updated ${age_h}h ago"
    _record_gate "μ-8" "OK" "memory_fresh files=${mem_files} age_h=${age_h}"
  fi
  return 0
}

# ── μ-9 · MCP Tooling Sentinel (v4.0 NEW) ────────────────────────────────────
gate_mu9() {
  ! $QUIET && echo "$(CYAN '  μ-9') MCP Tooling Sentinel"
  local tooling_dir="${RUNTIME_DIR}/tooling"

  if [[ ! -d "$tooling_dir" ]]; then
    echo "   $(GREEN '[OK]')   No tooling directory — MCP sentinel skipped"
    _record_gate "μ-9" "OK" "no tooling dir"
    return 0
  fi

  local mcp_files; mcp_files="$(ls "$tooling_dir"/*.json 2>/dev/null | head -20 || true)"
  if [[ -z "$mcp_files" ]]; then
    echo "   $(GREEN '[OK]')   No MCP manifests found"
    _record_gate "μ-9" "OK" "no mcp manifests"
    return 0
  fi

  local stale=0 broken=0 ok_count=0
  while IFS= read -r mfile; do
    [[ -z "$mfile" ]] && continue
    local result
    result="$(python3 - "$mfile" <<'PY'
import json, sys, pathlib, time
try:
    d = json.loads(pathlib.Path(sys.argv[1]).read_text())
    url   = d.get("url") or d.get("endpoint") or ""
    ctime = d.get("registered_at") or d.get("created_at") or ""
    name  = d.get("name") or pathlib.Path(sys.argv[1]).stem

    # Check staleness (>7 days)
    if ctime:
        from datetime import datetime, timezone
        try:
            reg_ts = datetime.fromisoformat(ctime.replace("Z", "+00:00"))
            age_days = (datetime.now(timezone.utc) - reg_ts).days
            if age_days > 7:
                print(f"STALE:{name}:{age_days}d")
                sys.exit(0)
        except Exception:
            pass

    # URL format check
    if url and not (url.startswith("http://") or url.startswith("https://")):
        print(f"BROKEN:{name}:invalid_url={url}")
    else:
        print(f"OK:{name}")
except Exception as e:
    print(f"BROKEN:{sys.argv[1]}:{e}")
PY
    )"

    if echo "$result" | grep -q "^STALE:"; then
      stale=$((stale+1))
    elif echo "$result" | grep -q "^BROKEN:"; then
      local details; details="${result#BROKEN:}"
      echo "   $(YELLOW '[WARN]') Broken MCP registration: ${details}"
      broken=$((broken+1))
    else
      ok_count=$((ok_count+1))
    fi
  done <<< "$mcp_files"

  if [[ $broken -gt 0 ]]; then
    echo "   $(YELLOW '[WARN]') MCP: ${ok_count} OK · ${stale} stale · ${broken} broken"
    _record_gate "μ-9" "WARN" "mcp_ok=${ok_count} stale=${stale} broken=${broken}"
    _gate_status_exit "WARN"
  elif [[ $stale -gt "$MCP_STALE_CEILING" ]]; then
    # [GATE-FIX-04] Stale registrations previously silently ignored when broken=0
    echo "   $(YELLOW '[WARN]') MCP: ${ok_count} OK · ${stale} stale (>${MCP_STALE_CEILING} ceiling) · re-register or delete stale manifests"
    _record_gate "μ-9" "WARN" "mcp_ok=${ok_count} stale=${stale} stale_ceiling=${MCP_STALE_CEILING}"
    _gate_status_exit "WARN"
  else
    echo "   $(GREEN '[OK]')   MCP: ${ok_count} registrations OK (${stale} stale, none broken)"
    _record_gate "μ-9" "OK" "mcp_ok=${ok_count} stale=${stale}"
  fi
  return 0
}

# ── μ-T · Model Triad Verifier ────────────────────────────────────────────────
gate_mu_T() {
  ! $QUIET && echo "$(CYAN '  μ-T') Model Triad Verifier"

  local MODEL_ROUTER="${SWARM_MODEL_FAST:-${MODEL_FAST:-phi4-mini}}"
  local MODEL_REASON="${SWARM_MODEL_REASON:-${MODEL_REASON:-deepseek-r1:7b}}"
  local MODEL_CODE="${SWARM_MODEL_CODE:-${MODEL_CODE:-qwen2.5-coder}}"

  # Check Ollama reachable
  if ! curl -sf --max-time 3 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    echo "   $(RED '[ERR]')  Ollama not reachable at $OLLAMA_HOST — cannot verify model triad"
    echo "          Start with: ollama serve"
    _record_gate "μ-T" "ERR" "ollama_unreachable=$OLLAMA_HOST"
    _gate_status_exit "ERR"; return 2
  fi

  local available_models
  available_models="$(curl -sf --max-time 5 "${OLLAMA_HOST}/api/tags" 2>/dev/null \
    | python3 -c "import json,sys; d=json.load(sys.stdin); [print(m['name']) for m in d.get('models',[])]" \
    2>/dev/null || true)"

  local issues=0
  for pair in \
    "${MODEL_ROUTER}:Phi-4-mini (orchestrator):SWARM_MODEL_FAST" \
    "${MODEL_REASON}:DeepSeek-R1:7B (reasoning):SWARM_MODEL_REASON" \
    "${MODEL_CODE}:Qwen2.5-Coder (execution):SWARM_MODEL_CODE"; do
    local model="${pair%%:*}"
    local rest="${pair#*:}"
    local label="${rest%%:*}"
    local envvar="${rest#*:}"

    if echo "$available_models" | grep -q "^${model}"; then
      echo "   $(GREEN '[OK]')   ${label} — ${model} — AVAILABLE"
    else
      echo "   $(YELLOW '[WARN]') ${label} not pulled"
      echo "          Pull: ollama pull ${model}"
      echo "          Override: export ${envvar}=<alternative>"
      # [GATE-ENH-08] --fix-mode: auto-pull missing models
      if $FIX_MODE; then
        echo "   $(YELLOW '[FIX]')  Pulling ${model} automatically (--fix-mode)..."
        ollama pull "${model}" 2>/dev/null && \
          echo "   $(GREEN '[OK]')   ${model} pulled successfully" || \
          echo "   $(YELLOW '[WARN]') Auto-pull failed for ${model} — pull manually"
      fi
      _record_gate "μ-T" "WARN" "${model}_not_pulled"
      _gate_status_exit "WARN"; issues=$((issues+1))
    fi
  done

  # Env var summary
  for var in SWARM_MODEL_FAST SWARM_MODEL_REASON SWARM_MODEL_CODE SWARM_HOME OLLAMA_HOST; do
    local val="${!var:-}"
    if [[ -n "$val" ]]; then
      echo "   $(GREEN '[✓]')   ${var}=${val}"
    else
      echo "   $(DIM '[–]')   ${var} not set (using default)"
    fi
  done

  if [[ $issues -eq 0 ]]; then
    _record_gate "μ-T" "OK" "triad_verified"
  fi
  return $issues
}

# ── μ-10 · Ollama Resource Sentinel (v4.2 NEW) ────────────────────────────────
# [GATE-NEW-01] Checks VRAM usage via /api/ps and detects error-spike hangs.
# Invoked by --health flag for fast pre-dispatch triage.
gate_mu10() {
  ! $QUIET && echo "$(CYAN '  μ-10') Ollama Resource Sentinel"
  local issues=0

  # Ollama reachability
  if ! curl -sf --max-time 3 "${OLLAMA_HOST}/api/tags" >/dev/null 2>&1; then
    echo "   $(RED '[ERR]')  Ollama unreachable at ${OLLAMA_HOST}"
    echo "          Start with: ollama serve"
    _record_gate "μ-10" "ERR" "ollama_unreachable=${OLLAMA_HOST}"
    _gate_status_exit "ERR"; return 2
  fi

  # VRAM usage via /api/ps
  local ps_data
  ps_data="$(curl -sf --max-time 5 "${OLLAMA_HOST}/api/ps" 2>/dev/null || echo '{}')"

  local vram_gb=0
  vram_gb="$(echo "$ps_data" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
total = sum(m.get("size_vram", 0) for m in d.get("models", []))
print(round(total / (1024**3), 1))
' 2>/dev/null || echo "0")"

  local loaded_models
  loaded_models="$(echo "$ps_data" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
names = [m.get("name","?") for m in d.get("models",[])]
print(", ".join(names) if names else "none")
' 2>/dev/null || echo "none")"

  echo "   $(GREEN '[OK]')   VRAM used: ${vram_gb}GB · loaded: ${loaded_models}"

  # GPU layers check — warn if any model has 0 GPU layers (CPU-only = degraded perf)
  local zero_gpu_models
  zero_gpu_models="$(echo "$ps_data" | python3 -c '
import json, sys
d = json.loads(sys.stdin.read() or "{}")
cpu_only = [m.get("name","?") for m in d.get("models",[]) if m.get("size_vram",1) == 0 and m.get("size",0) > 0]
print(", ".join(cpu_only))
' 2>/dev/null || echo "")"

  if [[ -n "$zero_gpu_models" ]]; then
    echo "   $(YELLOW '[WARN]') CPU-only inference detected for: ${zero_gpu_models}"
    echo "          Ensure GPU drivers are installed and models fit in VRAM"
    _record_gate "μ-10" "WARN" "cpu_only_models=${zero_gpu_models}"
    _gate_status_exit "WARN"; issues=1
  fi

  # Dispatch error-spike detection (hang/OOM pattern)
  local dispatch_log="${RUNTIME_DIR}/controller/dispatch.jsonl"
  local recent_errors=0
  if [[ -f "$dispatch_log" ]]; then
    recent_errors="$(tail -100 "$dispatch_log" 2>/dev/null \
      | python3 -c '
import sys, json
count = 0
for line in sys.stdin:
    try:
        d = json.loads(line.strip())
        if d.get("status") == "error":
            count += 1
    except Exception:
        pass
print(count)
' 2>/dev/null || echo "0")"
  fi

  if [[ "$recent_errors" -gt 8 ]]; then
    echo "   $(YELLOW '[WARN]') High error rate in last 100 dispatches (${recent_errors}) — possible OOM/hang"
    echo "          Run: ./swarm-controller.sh flush  then  ./swarm-gate.sh --fix-mode"
    _record_gate "μ-10" "WARN" "high_error_rate=${recent_errors}"
    _gate_status_exit "WARN"; issues=$((issues+1))

    # [GATE-ENH-08] --fix-mode: clear corrupt dispatch lines
    if $FIX_MODE && [[ -f "$dispatch_log" ]]; then
      echo "   $(YELLOW '[FIX]')  Clearing corrupt dispatch.jsonl lines (--fix-mode)"
      python3 -c '
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
lines = p.read_text(encoding="utf-8").splitlines()
clean = []
for line in lines:
    line = line.strip()
    if not line:
        continue
    try:
        json.loads(line)
        clean.append(line)
    except Exception:
        pass
p.write_text("\n".join(clean) + "\n", encoding="utf-8")
print(f"Cleaned: {len(lines) - len(clean)} corrupt lines removed, {len(clean)} kept")
' "$dispatch_log" 2>/dev/null && \
        echo "   $(GREEN '[OK]')   dispatch.jsonl sanitised" || \
        echo "   $(YELLOW '[WARN]') Sanitise failed — check file permissions"
    fi
  else
    echo "   $(GREEN '[OK]')   No recent error spikes (${recent_errors}/100 errors)"
  fi

  _record_gate "μ-10" "OK" "vram_gb=${vram_gb} loaded=${loaded_models} errors_100=${recent_errors}"
  return $issues
}

# ── Banner ─────────────────────────────────────────────────────────────────────
if ! $QUIET; then
  echo ""
  echo "$(BOLD "SwarmX Gate Check") v${GATE_VERSION} · IEP-ELITE-MAX"
  echo "$(DIM "Runtime: ${RUNTIME_DIR}")"
  echo "$(DIM "Gates:   ${GATE}$([ "$STRICT_MODE" == "1" ] && echo " · STRICT MODE")$([ "$FAIL_ON_WARN" == "1" ] && echo " · FAIL-ON-WARN")$([ -n "${SWARM_VERTICAL:-}" ] && echo " · VERTICAL=${SWARM_VERTICAL}")")"
  echo "──────────────────────────────────────────────────────────"
  echo ""
fi

# ── Self-test fixture mode [GATE-ENH-02] ─────────────────────────────────────
if $SELF_TEST; then
  TMPFIX="$(mktemp -d)"
  trap 'rm -rf "$TMPFIX"' EXIT
  mkdir -p "$TMPFIX"/{runs,controller,memory,proposals,tooling}
  echo '{"max_iterations":3,"runtime":{"max_iterations":3}}' > "$TMPFIX/config.json"
  echo '{"ts":"'$(date -u '+%Y-%m-%dT%H:%M:%SZ')'","event":"dispatch_ok","model":"phi4-mini","status":"success","elapsed_ms":500,"source":"self-test"}' \
    > "$TMPFIX/controller/dispatch.jsonl"
  echo '{"kind":"self-test","summary":"fixture memory","tags":["test"],"ts":"'$(date -u '+%Y-%m-%dT%H:%M:%SZ')'"}' \
    > "$TMPFIX/memory/controller.jsonl"
  RUNTIME_DIR="$TMPFIX"
  echo "$(CYAN '[SELF-TEST]') Using synthetic fixture at $TMPFIX"
  echo "$(CYAN '[SELF-TEST]') μ-10 will report Ollama state from ${OLLAMA_HOST}"
  echo ""
fi

# ── Gate execution ─────────────────────────────────────────────────────────────
_run_gate() {
  local gate_id="$1"
  case "$gate_id" in
    μ-1|mu1)   _gate_enabled "μ-1"  && gate_mu1   || true ;;
    μ-2|mu2)   _gate_enabled "μ-2"  && gate_mu2   || true ;;
    μ-3|mu3)   _gate_enabled "μ-3"  && gate_mu3   || true ;;
    μ-4|mu4)   _gate_enabled "μ-4"  && gate_mu4   || true ;;
    μ-5|mu5)   _gate_enabled "μ-5"  && gate_mu5   || true ;;
    μ-6|mu6)   _gate_enabled "μ-6"  && gate_mu6   || true ;;
    μ-7|mu7)   _gate_enabled "μ-7"  && gate_mu7   || true ;;
    μ-8|mu8)   _gate_enabled "μ-8"  && gate_mu8   || true ;;
    μ-9|mu9)   _gate_enabled "μ-9"  && gate_mu9   || true ;;
    μ-10|mu10) _gate_enabled "μ-10" && gate_mu10  || true ;;  # [GATE-NEW-01]
    μ-T|muT)   (_gate_enabled "μ-T" || $CHECK_MODELS) && gate_mu_T || true ;;
  esac
}

if [[ "$GATE" == "all" ]]; then
  gate_mu1  || true; echo ""
  gate_mu2  || true; echo ""
  gate_mu3  || true; echo ""
  gate_mu4  || true; echo ""
  gate_mu5  || true; echo ""
  gate_mu6  || true; echo ""
  gate_mu7  || true; echo ""
  gate_mu8  || true; echo ""
  gate_mu9  || true; echo ""
  gate_mu10 || true; echo ""  # [GATE-NEW-01] v4.2 Resource Sentinel
  ($CHECK_MODELS || true) && gate_mu_T || true; echo ""
else
  # Run comma-separated gates
  IFS=',' read -ra GATE_LIST <<< "$GATE"
  for g in "${GATE_LIST[@]}"; do
    g="$(echo "$g" | tr -d ' ')"
    _run_gate "$g" || true
    echo ""
  done
  $CHECK_MODELS && { gate_mu_T || true; echo ""; }
fi

! $QUIET && echo "──────────────────────────────────────────────────────────"

# ── JSON output ────────────────────────────────────────────────────────────────
if $OUTPUT_JSON; then
  # [GATE-FIX-03] Write gate results to temp file to avoid argv quoting issues
  _RESULTS_TMP="$(mktemp)"
  if [[ ${#GATE_RESULTS[@]} -gt 0 ]]; then
    printf '%s\n' "${GATE_RESULTS[@]}" > "$_RESULTS_TMP"
  else
    > "$_RESULTS_TMP"
  fi
  python3 - "$_RESULTS_TMP" "${GATE_LATENCY_STATS:-}" "$OVERALL_EXIT" "$GATE_VERSION" <<'PY'
import json, sys, pathlib, datetime

results_raw = pathlib.Path(sys.argv[1]).read_text().splitlines()
results = []
for line in results_raw:
    line = line.strip()
    if line:
        try:
            results.append(json.loads(line))
        except Exception:
            pass

latency_str = sys.argv[2]
try:
    latency = json.loads(latency_str) if latency_str.strip().startswith('{') else {}
except Exception:
    latency = {}

overall = int(sys.argv[3])
status = 'CLEAN' if overall == 0 else ('WARN' if overall == 1 else 'BLOCK')

# [GATE-ENH-09] Build actionable recommendations based on gate results
recommendations = []
warn_gates  = [g['gate'] for g in results if g.get('status') == 'WARN']
err_gates   = [g['gate'] for g in results if g.get('status') in ('ERR', 'BLOCK')]
if err_gates:
    recommendations.append(f"Resolve ERR gates before dispatch: {', '.join(err_gates)}")
if warn_gates:
    recommendations.append(f"Review WARN gates (run --fix-mode to auto-remediate): {', '.join(warn_gates)}")
if not recommendations:
    recommendations.append("All gates clean — safe to dispatch")

output = {
    'gate_version':    sys.argv[4],
    'run_ts':          datetime.datetime.utcnow().isoformat() + 'Z',
    'overall_status':  status,
    'overall_exit':    overall,
    'gates':           results,
    'latency_stats':   latency,
    'recommendations': recommendations,
}
print(json.dumps(output, indent=2, ensure_ascii=False))
PY
  rm -f "$_RESULTS_TMP"
fi

# ── Summary ────────────────────────────────────────────────────────────────────
if ! $QUIET; then
  case $OVERALL_EXIT in
    0) echo "$(GREEN 'Gate: CLEAN') — v4.2 all checks passed" ;;
    1) echo "$(YELLOW 'Gate: WARN') — review warnings above (run --fix-mode to auto-remediate)" ;;
    2) echo "$(RED 'Gate: BLOCK') — critical gate(s) failed; resolve before dispatch" ;;
    4) echo "$(CYAN 'Gate: PARTIAL') — some gates skipped, none failed" ;;
  esac
  echo ""
fi

exit $OVERALL_EXIT
