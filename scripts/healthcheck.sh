#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════════════════
# scripts/healthcheck.sh — SwarmX Comprehensive Deployment Health Check
#
# Checks every service endpoint, Docker container health, and core Ollama
# model availability. Exits 0 only when all critical services are healthy.
#
# Usage:
#   make health              (via Makefile)
#   bash scripts/healthcheck.sh
#
# Exit codes:
#   0 — all critical services healthy
#   1 — one or more critical services degraded or unreachable
# ═══════════════════════════════════════════════════════════════════════════════

set -euo pipefail

# ── Configuration (overridable via env) ───────────────────────────────────────
PYTHON_URL="${PYTHON_URL:-http://localhost:8787}"
API_URL="${API_URL:-http://localhost:3001}"
DASHBOARD_URL="${DASHBOARD_URL:-http://localhost:3000}"
OLLAMA_HOST="${OLLAMA_HOST:-http://localhost:11434}"
REDIS_HOST="${REDIS_HOST:-localhost}"
REDIS_PORT="${REDIS_PORT:-6379}"

# ── ANSI colour helpers ────────────────────────────────────────────────────────
OK()   { printf '\033[0;32m%-10s\033[0m' "$1"; }
FAIL() { printf '\033[0;31m%-10s\033[0m' "$1"; }
WARN() { printf '\033[0;33m%-10s\033[0m' "$1"; }
BOLD() { printf '\033[1m%s\033[0m' "$1"; }

PASS=0
FAIL_COUNT=0

check() {
    local name="$1"
    local result="$2"   # "ok" | "warn" | "fail"
    local detail="${3:-}"

    printf "  %-28s" "${name}:"
    case "$result" in
        ok)   echo "$(OK '[  OK  ]') ${detail}" ;;
        warn) echo "$(WARN '[ WARN ]') ${detail}" ;;
        fail) echo "$(FAIL '[ FAIL ]') ${detail}"; FAIL_COUNT=$((FAIL_COUNT + 1)) ;;
    esac
}

echo ""
echo "$(BOLD 'SwarmX Deployment Health Check')"
echo "──────────────────────────────────────────────────────────────────────"

# ── HTTP liveness probes ───────────────────────────────────────────────────────
echo ""
echo "$(BOLD 'HTTP Endpoints')"

http_check() {
    local name="$1" url="$2" critical="${3:-true}"
    local http_code
    http_code=$(curl -sf -o /dev/null -w "%{http_code}" --max-time 5 "${url}" 2>/dev/null || echo "000")
    if [[ "${http_code}" =~ ^[23] ]]; then
        check "${name}" ok "${url}  →  HTTP ${http_code}"
    elif [[ "${critical}" == "true" ]]; then
        check "${name}" fail "${url}  →  HTTP ${http_code} (unreachable)"
    else
        check "${name}" warn "${url}  →  HTTP ${http_code} (optional)"
    fi
}

http_check "Python brain"   "${PYTHON_URL}/health"
http_check "Fastify API"    "${API_URL}/health"
http_check "Next.js dash"   "${DASHBOARD_URL}"
http_check "Ollama runtime" "${OLLAMA_HOST}/api/tags"

# ── Redis connectivity ─────────────────────────────────────────────────────────
echo ""
echo "$(BOLD 'Infrastructure')"

if command -v redis-cli >/dev/null 2>&1; then
    if redis-cli -h "${REDIS_HOST}" -p "${REDIS_PORT}" ping 2>/dev/null | grep -q PONG; then
        check "Redis" ok "${REDIS_HOST}:${REDIS_PORT}"
    else
        check "Redis" fail "${REDIS_HOST}:${REDIS_PORT}  (ping failed)"
    fi
else
    check "Redis (redis-cli)" warn "redis-cli not installed — skipping direct check"
fi

# ── Docker container health (if Docker is available) ──────────────────────────
echo ""
echo "$(BOLD 'Docker Container Health')"

if command -v docker >/dev/null 2>&1 && docker info >/dev/null 2>&1; then
    for svc in redis ollama swarmx-python swarmx-api swarmx-dashboard; do
        CONTAINER_NAME="swarmx-${svc}-1"
        STATUS=$(docker inspect --format '{{.State.Health.Status}}' "${CONTAINER_NAME}" 2>/dev/null || echo "not_found")
        case "${STATUS}" in
            healthy)   check "${svc}" ok "container healthy" ;;
            starting)  check "${svc}" warn "container still starting" ;;
            not_found) check "${svc}" warn "container not found (running outside Docker?)" ;;
            *)         check "${svc}" fail "container status: ${STATUS}" ;;
        esac
    done
else
    check "Docker" warn "Docker not available — skipping container checks"
fi

# ── Ollama model triad ─────────────────────────────────────────────────────────
echo ""
echo "$(BOLD 'LLM Model Triad')"

MODELS_JSON=$(curl -sf --max-time 5 "${OLLAMA_HOST}/api/tags" 2>/dev/null || echo "{}")

check_model() {
    local display_name="$1"
    local tag_pattern="$2"
    if echo "${MODELS_JSON}" | python3 -c "
import sys, json
data = json.load(sys.stdin)
names = [m.get('name','') for m in data.get('models',[])]
patterns = [p.strip() for p in '${tag_pattern}'.split(',') if p.strip()]
found = any(any(pattern in name for pattern in patterns) for name in names)
raise SystemExit(0 if found else 1)
" 2>/dev/null; then
        check "${display_name}" ok "model available"
    else
        check "${display_name}" fail "model not found — expected one of: ${tag_pattern}"
    fi
}

check_model "Relay router"       "route-phi4-lite-q4km-prod"
check_model "Pilot classifier"   "instruct-phi4-pro-q8-prod"
check_model "Architect planner"  "plan-qwen25-pro-q5km-prod"
check_model "Forge code agent"   "code-qwen25-pro-q5km-prod"
check_model "Oracle reasoner"    "reason-deepseekr1-pro-q5km-prod"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "──────────────────────────────────────────────────────────────────────"

if [[ ${FAIL_COUNT} -eq 0 ]]; then
    echo "$(OK '[  OK  ]') All checks passed — SwarmX stack is healthy."
    echo ""
    exit 0
else
    echo "$(FAIL '[ FAIL ]') ${FAIL_COUNT} check(s) failed — review the output above."
    echo "          Run 'docker compose logs' for detailed service logs."
    echo ""
    exit 1
fi
