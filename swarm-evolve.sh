#!/usr/bin/env bash
# swarm-evolve.sh — SwarmX evolution runner with APEX-17 fitness delta capture
# ─────────────────────────────────────────────────────────────────────────────
# Usage:
#   ./swarm-evolve.sh [--repo <path>] [--auto-apply] [--dry-run] [--json] [...]
#
# APEX-17 additions:
#   - Captures a fitness delta snapshot after every successful evolution run
#   - Writes delta record to SWARMX_HOME via delta_capture() in evolution_engine
#   - Prints a one-line delta summary to stdout for CI/cron visibility
#   - All delta operations are non-critical (failures logged, never block evolve)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Signal handler ────────────────────────────────────────────────────────────
_active_mission_id="${ACTIVE_MISSION_ID:-}"

cleanup() {
    echo "[SwarmX] Caught signal — flushing state and exiting cleanly"
    exit 0
}
trap cleanup SIGINT SIGTERM

# ── Python environment ────────────────────────────────────────────────────────
if [[ -f "$ROOT/.venv/bin/activate" ]]; then
    # shellcheck disable=SC1091
    source "$ROOT/.venv/bin/activate"
elif [[ -d "$ROOT/src" ]]; then
    export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
fi

# Resolve python binary
if command -v python3 >/dev/null 2>&1; then
    PY="python3"
elif command -v python >/dev/null 2>&1; then
    PY="python"
else
    echo "[SwarmX] ERROR: python3 not found. Install Python 3.11+ and retry." >&2
    exit 1
fi

# ── Record pre-run baseline ───────────────────────────────────────────────────
# Capture the run start time for delta attribution. Non-critical.
_run_ts="$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo '')"

# ── Run the evolution loop ────────────────────────────────────────────────────
echo "[SwarmX] 🧬 Evolution run starting — $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
if bash "$ROOT/swarm.sh" evolve "$@"; then
    _exit_code=0
else
    _exit_code=$?
fi

# ── APEX-17: Delta capture ────────────────────────────────────────────────────
# Run after the evolution process exits cleanly. Never blocks the exit code.
if [[ $_exit_code -eq 0 ]]; then
    _delta_output="$("$PY" - <<'PYSCRIPT' 2>/dev/null
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "src"))
try:
    from pathlib import Path
    from swarmx.core.evolution_engine import delta_capture
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    record = delta_capture(
        cfg.home,
        current_fitness={},   # live metrics populated by evolver internals
        structural_delta={},
        attribution="swarm-evolve.sh post-run capture",
    )
    delta_id      = record.get("id", "DELTA-UNKNOWN")
    delta_fitness = record.get("delta_fitness", 0.0)
    composite     = record.get("composite_score", 0.0)
    keeper        = record.get("keeper", "")
    print(f"[SwarmX] 🧬 Delta captured: {delta_id} | fitness Δ = {delta_fitness:+.4f} | composite = {composite:.3f}{' | keeper: ' + keeper if keeper else ''}")
except Exception as exc:
    print(f"[SwarmX] ⚠  Delta capture skipped: {exc}")
PYSCRIPT
    )" && echo "$_delta_output" || echo "[SwarmX] ⚠  Delta capture unavailable (non-critical)"
fi

exit $_exit_code
