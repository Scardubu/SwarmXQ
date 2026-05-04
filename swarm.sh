#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# swarm.sh — SwarmX hardened unified entry point
#
# Production improvements over v6-patched:
#   · Works correctly from any working directory (uses BASH_SOURCE resolution)
#   · Exports SWARM_ROOT for bundle-relative config / vertical YAML discovery
#   · Automatically activates local .venv; falls back to src/ PYTHONPATH
#   · Enforces Python 3.11+ before attempting import
#   · Predictable WAT timestamps (Africa/Lagos default timezone)
#   · Clean signal forwarding + graceful cleanup on INT/TERM/HUP/QUIT
#   · Fast module probing via importlib — avoids slow --help subprocess calls
#   · Optional debug mode:   SWARM_DEBUG=1  (verbose path diagnostics)
#   · Optional dry-run mode: SWARM_DRY_RUN=1 (prints config without launching)
#   · Uses exec for clean PID ownership (container / systemd / tini compat)
# ═══════════════════════════════════════════════════════════════════════════════

set -Eeuo pipefail

# ── Paths / Environment ────────────────────────────────────────────────────────
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
export SWARM_ROOT="${ROOT}"
export TZ="${TZ:-Africa/Lagos}"
export PYTHONUNBUFFERED="${PYTHONUNBUFFERED:-1}"
export PYTHONDONTWRITEBYTECODE="${PYTHONDONTWRITEBYTECODE:-1}"

readonly SCRIPT_NAME="$(basename "$0")"
readonly REQUIRED_PYTHON_MAJOR=3
readonly REQUIRED_PYTHON_MINOR=11

# ── Logging helpers ────────────────────────────────────────────────────────────
ts()    { date +"%Y-%m-%d %H:%M:%S %Z"; }
log()   { printf '[%s] [SwarmX] %s\n' "$(ts)" "$*" >&2; }
info()  { log "INFO: $*"; }
warn()  { log "WARN: $*"; }
err()   { log "ERROR: $*"; }

debug() {
    if [[ "${SWARM_DEBUG:-0}" == "1" ]]; then
        log "DEBUG: $*"
    fi
}

# ── Signal handling + cleanup ──────────────────────────────────────────────────
cleanup() {
    local code=$?
    if [[ $code -ne 0 ]]; then
        warn "Interrupted or aborted (exit=${code})"
    else
        info "Shutdown complete"
    fi
}

on_signal() {
    warn "Signal received — exiting cleanly"
    exit 0
}

trap cleanup EXIT
trap on_signal INT TERM HUP QUIT

# ── Python resolution ──────────────────────────────────────────────────────────
# Priority: local .venv > python3 on PATH > python on PATH
resolve_python() {
    if [[ -x "${ROOT}/.venv/bin/python" ]]; then
        echo "${ROOT}/.venv/bin/python"
        return 0
    fi
    if command -v python3 >/dev/null 2>&1; then
        command -v python3
        return 0
    fi
    if command -v python >/dev/null 2>&1; then
        command -v python
        return 0
    fi
    return 1
}

if ! PY="$(resolve_python)"; then
    err "Python not found. Install Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+."
    exit 1
fi

debug "Using Python: ${PY}"

# ── Python version enforcement ─────────────────────────────────────────────────
if ! "${PY}" - <<'PYCHECK' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info >= (3, 11) else 1)
PYCHECK
then
    err "Python ${REQUIRED_PYTHON_MAJOR}.${REQUIRED_PYTHON_MINOR}+ required."
    "${PY}" --version >&2 || true
    exit 1
fi

# ── Dev source tree fallback ───────────────────────────────────────────────────
# When running directly from the repo (not from an installed .venv), prepend
# src/ to PYTHONPATH so `import swarmx` resolves to the local source tree.
if [[ ! -x "${ROOT}/.venv/bin/python" && -d "${ROOT}/src" ]]; then
    export PYTHONPATH="${ROOT}/src${PYTHONPATH:+:${PYTHONPATH}}"
    debug "Enabled src/ PYTHONPATH fallback (dev mode)"
fi

# ── Module detection ───────────────────────────────────────────────────────────
# Uses importlib.import_module so selection only succeeds when dependencies are
# actually importable (e.g. cli requires typer).
has_module() {
    "${PY}" - "$1" <<'PYMOD' >/dev/null 2>&1
import importlib, sys
name = sys.argv[1]
try:
    importlib.import_module(name)
except Exception:
    raise SystemExit(1)
raise SystemExit(0)
PYMOD
}

ENTRY_MODULE=""

if has_module cli; then
    ENTRY_MODULE="cli"
elif has_module swarmx; then
    # Compatibility fallback while older environments transition.
    warn "Falling back to legacy module 'swarmx'. Canonical entrypoint is 'cli'."
    ENTRY_MODULE="swarmx"
else
    # [V5.9-FIX-02] Dry-run must report readiness even in an uninstalled checkout.
    if [[ "${SWARM_DRY_RUN:-0}" == "1" ]]; then
        warn "Dry-run continuing without importable entry module; reporting readiness only."
        ENTRY_MODULE="unresolved"
    else
        err "Neither canonical 'cli' nor legacy 'swarmx' module found."
        err "Run: pip install -e .  (or: source .venv/bin/activate)"
        exit 1
    fi
fi

debug "Selected entry module: ${ENTRY_MODULE}"

# ── Dry-run support ────────────────────────────────────────────────────────────
if [[ "${SWARM_DRY_RUN:-0}" == "1" ]]; then
    info "Dry-run mode — dependency readiness report, not launching"
    echo ""
    echo "═══════════════════════════════ SwarmX Dry-Run Diagnostics ════════════════════════════════"
    echo ""

    # -- Paths --
    echo "── Paths ───────────────────────────────────────────────────────────────────────────────────"
    echo "  SWARM_ROOT     : ${ROOT}"
    echo "  SWARM_HOME     : ${SWARM_HOME:-~/.swarmx (default)}"
    echo "  PYTHONPATH     : ${PYTHONPATH:-<not set>}"
    echo ""

    # -- Python runtime --
    echo "── Python Runtime ──────────────────────────────────────────────────────────────────────────"
    echo "  Interpreter    : ${PY}"
    PY_VER="$("${PY}" -c 'import sys; print(".".join(str(v) for v in sys.version_info[:3]))')"
    echo "  Version        : ${PY_VER}"
    if [[ -x "${ROOT}/.venv/bin/python" ]]; then
        echo "  Source         : local .venv (${ROOT}/.venv)"
    else
        echo "  Source         : system / PATH"
    fi
    echo ""

    # -- Module availability --
    echo "── Module Availability ─────────────────────────────────────────────────────────────────────"
    probe_module() {
        local mod="$1"
        if "${PY}" - "$mod" <<'PYPROBE' >/dev/null 2>&1
import importlib, sys
try:
    importlib.import_module(sys.argv[1])
except Exception:
    raise SystemExit(1)
raise SystemExit(0)
PYPROBE
        then
            echo "  [OK] ${mod}"
        else
            echo "  [--] ${mod}  (not importable)"
        fi
    }
    probe_module "cli"
    probe_module "swarmx"
    probe_module "brain"
    probe_module "typer"
    probe_module "yaml"
    probe_module "aiohttp"
    probe_module "fastapi"
    probe_module "faiss"
    echo ""

    # -- Dispatch resolution --
    echo "── Dispatch Resolution ─────────────────────────────────────────────────────────────────────"
    echo "  Entry module   : ${ENTRY_MODULE}"
    if [[ "${ENTRY_MODULE}" == "cli" ]]; then
        echo "  Status         : CANONICAL (cli/ Typer entrypoint)"
    elif [[ "${ENTRY_MODULE}" == "swarmx" ]]; then
        echo "  Status         : COMPAT FALLBACK (swarmx legacy module)"
    else
        echo "  Status         : UNRESOLVED (install or activate environment before launch)"
    fi
    if [[ "${ENTRY_MODULE}" == "unresolved" ]]; then
        echo "  Launch command : unavailable until module dependencies are importable"
    else
        echo "  Launch command : ${PY} -m ${ENTRY_MODULE} $*"
    fi
    echo ""

    # -- CLI command shims --
    echo "── Registered CLI Command Shims ────────────────────────────────────────────────────────────"
    if [[ -d "${ROOT}/cli/commands" ]]; then
        for f in "${ROOT}/cli/commands"/*.py; do
            fname="$(basename "$f" .py)"
            [[ "$fname" == "__init__" ]] && continue
            echo "  ${fname}"
        done
    else
        echo "  (cli/commands/ not found)"
    fi
    echo ""

    # -- Shell wrapper integrity --
    echo "── Shell Wrapper Delegation ────────────────────────────────────────────────────────────────"
    for wrapper in "${ROOT}"/swarm-*.sh; do
        wname="$(basename "$wrapper")"
        if grep -q 'bash "\$ROOT/swarm.sh"' "$wrapper" 2>/dev/null; then
            echo "  [OK] ${wname}  → delegates to swarm.sh"
        else
            echo "  [!!] ${wname}  → does NOT delegate to swarm.sh"
        fi
    done
    echo ""

    # -- Config files --
    echo "── Config Files ────────────────────────────────────────────────────────────────────────────"
    for cfg in \
        "${ROOT}/orchestration/swarmx_config.yaml" \
        "${ROOT}/configs/swarmx.defaults.yaml" \
        "${ROOT}/configs/routing.yaml" \
        "${ROOT}/configs/guardrails.yaml"; do
        if [[ -f "$cfg" ]]; then
            echo "  [OK] ${cfg}"
        else
            echo "  [--] ${cfg}  (missing)"
        fi
    done
    echo ""

    echo "═══════════════════════════════════════════════════════════════════════════════════════════"
    echo ""
    exit 0
fi

# ── Launch ─────────────────────────────────────────────────────────────────────
# exec replaces this shell process with Python so PID 1 (tini / systemd / the
# container runtime) communicates directly with the Python process.
debug "Launching SwarmX via ${ENTRY_MODULE}..."
exec "${PY}" -m "${ENTRY_MODULE}" "$@"
