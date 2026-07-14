#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# scripts/migrate.sh — SwarmX V5 Schema Migration Runner
#
# Runs the idempotent V5 schema migration against the SQLite runtime database.
# Safe to re-run — all DDL uses IF NOT EXISTS / ADD COLUMN IF NOT EXISTS guards.
#
# Usage:
#   bash scripts/migrate.sh [--home /path/to/.swarmx] [--dry-run]
#   make migrate
#
# Options:
#   --home PATH    Override SWARM_HOME (default: ~/.swarmx or $SWARM_HOME)
#   --dry-run      Print migration SQL without executing
#   --help         Show this message
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

SWARM_HOME_DEFAULT="${SWARM_HOME:-${HOME}/.swarmx}"
DRY_RUN=0

print_usage() {
    echo "Usage: bash scripts/migrate.sh [--home PATH] [--dry-run] [--help]"
    exit 0
}

# ── Argument parsing ──────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
    case "$1" in
        --home)    SWARM_HOME_DEFAULT="$2"; shift 2 ;;
        --dry-run) DRY_RUN=1; shift ;;
        --help|-h) print_usage ;;
        *)         echo "Unknown argument: $1" >&2; exit 1 ;;
    esac
done

RUNTIME_HOME="${SWARM_HOME_DEFAULT}"

echo ""
echo "SwarmX V5 Schema Migration"
echo "──────────────────────────────────────────────────────"
echo "  Runtime home : ${RUNTIME_HOME}"
echo "  Dry-run mode : $([ "${DRY_RUN}" -eq 1 ] && echo 'YES' || echo 'no')"
echo ""

# ── Python resolution ─────────────────────────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(dirname "${SCRIPT_DIR}")"

if [[ -x "${ROOT}/.venv/bin/python" ]]; then
    PY="${ROOT}/.venv/bin/python"
elif command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python3)"
else
    echo "ERROR: Python not found. Install Python 3.11+ or activate the venv." >&2
    exit 1
fi

# Ensure the src/ path is on PYTHONPATH if running without an installed package
if [[ -d "${ROOT}/src" ]]; then
    export PYTHONPATH="${ROOT}/src${PYTHONPATH:+:${PYTHONPATH}}"
fi

# ── Execute migration ─────────────────────────────────────────────────────────
if [[ "${DRY_RUN}" -eq 1 ]]; then
    echo "[DRY RUN] Would run V5 migration against: ${RUNTIME_HOME}/state/swarmx.sqlite3"
    echo "[DRY RUN] Use 'bash scripts/migrate.sh' (without --dry-run) to apply."
    exit 0
fi

"${PY}" - "${RUNTIME_HOME}" <<'PYEOF'
import sys
from pathlib import Path

home = Path(sys.argv[1])
home.mkdir(parents=True, exist_ok=True)

try:
    from swarmx.migrations.v5_memory import run_migration
    run_migration(home)
    print(f"  [OK] V5 migration complete → {home / 'state' / 'swarmx.sqlite3'}")
except ImportError as exc:
    print(f"  [ERROR] Could not import migration module: {exc}", file=sys.stderr)
    print("  [HINT]  Run: pip install -e .", file=sys.stderr)
    sys.exit(1)
except Exception as exc:
    print(f"  [ERROR] Migration failed: {exc}", file=sys.stderr)
    sys.exit(1)
PYEOF

echo ""
echo "Migration complete. Verify with: make db-check"
echo ""
