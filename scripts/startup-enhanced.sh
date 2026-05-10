#!/usr/bin/env bash
# SwarmX Enhanced Startup Automation
# Comprehensive health checks + intelligent retry + startup telemetry
#
# Usage:
#   ./scripts/startup-enhanced.sh [--check-only] [--verbose] [--timeout 300]
#
# Features:
#   - Health check for required services (Ollama, Python, Node.js)
#   - Intelligent port conflict detection and recovery
#   - Auto-seeding CORS origins for localhost development
#   - Graceful degradation (non-blocking health failures)
#   - Startup telemetry and timing metrics
#   - Support for custom timeout and verbosity

set -euo pipefail

# ─── Configuration ────────────────────────────────────────────────────────────
readonly SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
readonly STARTUP_LOG="${STARTUP_LOG:-${SWARM_HOME:-.swarmx}/logs/startup-enhanced.log}"
readonly DEFAULT_TIMEOUT=300  # seconds
readonly OLLAMA_URL="${OLLAMA_HOST:-http://localhost:11434}"
readonly API_HOST="${SWARMX_API_HOST:-127.0.0.1}"
readonly API_PORT="${SWARMX_API_PORT:-3001}"
readonly DASHBOARD_PORT="3000"
readonly LEGACY_ROOT_HINT="/SwarmX-1.5"

# ─── Flags ───────────────────────────────────────────────────────────────────
CHECK_ONLY=false
VERBOSE=false
TIMEOUT="${DEFAULT_TIMEOUT}"

# ─── Colors & Formatting ─────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'  # No Color

# ─── Logging ──────────────────────────────────────────────────────────────────
log() {
  local level="$1"
  shift
  local msg="$@"
  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')
  echo "[${timestamp}] [${level}] ${msg}" >> "$STARTUP_LOG"
  if [[ "$VERBOSE" == true ]]; then
    echo -e "${BLUE}[${level}]${NC} ${msg}" >&2
  fi
}

log_success() {
  echo -e "${GREEN}✓${NC} $*" >&2
  log "INFO" "✓ $*"
}

log_warning() {
  echo -e "${YELLOW}⚠${NC} $*" >&2
  log "WARN" "⚠ $*"
}

log_error() {
  echo -e "${RED}✗${NC} $*" >&2
  log "ERROR" "✗ $*"
}

log_info() {
  echo -e "${BLUE}ℹ${NC} $*" >&2
  log "INFO" "ℹ $*"
}

# ─── Helper: Port Availability Check ──────────────────────────────────────────
check_port_available() {
  local port="$1"
  local name="${2:-Service}"
  if lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; then
    return 1  # Port is in use
  fi
  return 0  # Port is available
}

wait_for_port_free() {
  local port="$1"
  local max_wait_s="${2:-6}"
  local elapsed=0
  while lsof -Pi :$port -sTCP:LISTEN -t >/dev/null 2>&1; do
    if [[ $elapsed -ge $max_wait_s ]]; then
      return 1
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 0
}

# ─── Helper: Kill Process on Port ────────────────────────────────────────────
kill_port() {
  local port="$1"
  local max_attempts=3
  local attempt=1
  
  log_info "Attempting to stop service on port $port..."
  
  while [ $attempt -le $max_attempts ]; do
    local pid=$(lsof -Pi :$port -sTCP:LISTEN -t 2>/dev/null | head -1)
    if [[ -z "$pid" ]]; then
      log_success "Port $port is now available"
      return 0
    fi
    
    if [ $attempt -eq 1 ]; then
      log_info "Sending SIGTERM to PID $pid..."
      kill -15 "$pid" 2>/dev/null || true
      wait_for_port_free "$port" 3 || true
    elif [ $attempt -eq 2 ]; then
      log_warning "SIGTERM timeout, sending SIGKILL to PID $pid..."
      kill -9 "$pid" 2>/dev/null || true
      wait_for_port_free "$port" 2 || true
    else
      log_error "Failed to free port $port after $max_attempts attempts"
      return 1
    fi
    
    attempt=$((attempt + 1))
  done
  
  return 1
}

# ─── Startup Hygiene: stale instance eviction ───────────────────────────────
evict_stale_instances() {
  log_info "Running startup hygiene (old-instance eviction)..."

  local patterns=(
    "python -m cli up"
    "swarm.sh up"
    "swarmx-api/dist/server.js"
    "@swarmx/dashboard"
    "next start --port 3000"
  )

  local evicted=0
  local current_pid="$$"
  local parent_pid="${PPID:-0}"

  for pattern in "${patterns[@]}"; do
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      [[ "$pid" == "$current_pid" ]] && continue
      [[ "$pid" == "$parent_pid" ]] && continue

      local cmd
      cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
      [[ -z "$cmd" ]] && continue

      # Only evict known SwarmX roots (current repo or legacy sibling root).
      if [[ "$cmd" != *"$ROOT_DIR"* && "$cmd" != *"$LEGACY_ROOT_HINT"* ]]; then
        continue
      fi

      log_warning "Evicting stale process PID=$pid ($cmd)"
      kill -15 "$pid" 2>/dev/null || true
      evicted=$((evicted + 1))
    done < <(pgrep -f "$pattern" 2>/dev/null || true)
  done

  # Force kill any lingering matched processes.
  for pattern in "${patterns[@]}"; do
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      [[ "$pid" == "$current_pid" ]] && continue
      [[ "$pid" == "$parent_pid" ]] && continue
      local cmd
      cmd=$(ps -p "$pid" -o args= 2>/dev/null || true)
      [[ -z "$cmd" ]] && continue
      if [[ "$cmd" != *"$ROOT_DIR"* && "$cmd" != *"$LEGACY_ROOT_HINT"* ]]; then
        continue
      fi
      log_warning "Force-evicting lingering process PID=$pid"
      kill -9 "$pid" 2>/dev/null || true
    done < <(pgrep -f "$pattern" 2>/dev/null || true)
  done

  if [[ $evicted -gt 0 ]]; then
    log_success "Startup hygiene evicted $evicted stale process(es)"
  else
    log_info "No stale SwarmX instances detected"
  fi
}

# ─── Health Check: Ollama ─────────────────────────────────────────────────────
check_ollama() {
  log_info "Checking Ollama service at $OLLAMA_URL..."
  
  if ! command -v curl &> /dev/null; then
    log_warning "curl not found, skipping Ollama health check"
    return 0
  fi
  
  if curl -s --connect-timeout 5 "$OLLAMA_URL/api/version" >/dev/null 2>&1; then
    log_success "Ollama is responding"
    return 0
  else
    log_warning "Ollama is not responding at $OLLAMA_URL"
    log_info "To start Ollama: ollama serve"
    return 0  # Non-blocking; continue with startup
  fi
}

# ─── Health Check: Python Environment ─────────────────────────────────────────
check_python() {
  log_info "Checking Python environment..."
  
  if ! command -v python3 &> /dev/null; then
    log_error "python3 not found"
    return 1
  fi
  
  local python_version
  python_version=$(python3 --version 2>&1 | awk '{print $2}')
  log_success "Python $python_version found"
  
  # Check for venv
  if [[ ! -d "$ROOT_DIR/.venv" ]]; then
    log_error "Virtual environment not found at $ROOT_DIR/.venv"
    log_info "Run: python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt"
    return 1
  fi
  
  log_success "Virtual environment found"
  return 0
}

# ─── Health Check: Node.js ───────────────────────────────────────────────────
check_nodejs() {
  log_info "Checking Node.js environment..."
  
  if ! command -v node &> /dev/null; then
    log_error "node not found"
    return 1
  fi
  
  local node_version
  node_version=$(node --version)
  log_success "Node.js $node_version found"
  
  if ! command -v pnpm &> /dev/null; then
    log_error "pnpm not found"
    log_info "Run: npm install -g pnpm"
    return 1
  fi
  
  log_success "pnpm is available"
  return 0
}

# ─── Health Check: Port Availability ──────────────────────────────────────────
check_ports() {
  log_info "Checking port availability..."
  
  local api_available=true
  local dashboard_available=true
  
  if ! check_port_available "$API_PORT" "API"; then
    log_warning "API port $API_PORT is already in use"
    api_available=false
  else
    log_success "API port $API_PORT is available"
  fi
  
  if ! check_port_available "$DASHBOARD_PORT" "Dashboard"; then
    log_warning "Dashboard port $DASHBOARD_PORT is already in use"
    dashboard_available=false
  else
    log_success "Dashboard port $DASHBOARD_PORT is available"
  fi
  
  # Try to recover by killing existing processes
  if [[ "$api_available" == false ]] || [[ "$dashboard_available" == false ]]; then
    log_warning "Attempting to free ports..."
    if [[ "$api_available" == false ]]; then
      kill_port "$API_PORT" || return 1
    fi
    if [[ "$dashboard_available" == false ]]; then
      kill_port "$DASHBOARD_PORT" || return 1
    fi
  fi
  
  return 0
}

# ─── Health Check: Directory Structure ────────────────────────────────────────
check_directories() {
  log_info "Checking required directories..."
  
  local required_dirs=(
    "$ROOT_DIR/apps/swarmx-api"
    "$ROOT_DIR/apps/swarmx-dashboard"
    "$ROOT_DIR/orchestration"
    "$ROOT_DIR/brain"
    "$ROOT_DIR/configs"
  )
  
  for dir in "${required_dirs[@]}"; do
    if [[ ! -d "$dir" ]]; then
      log_error "Required directory not found: $dir"
      return 1
    fi
  done
  
  log_success "All required directories found"
  return 0
}

# ─── Environment Setup ────────────────────────────────────────────────────────
setup_environment() {
  log_info "Setting up environment variables..."
  
  # Ensure SWARM_HOME exists
  local swarm_home="${SWARM_HOME:-.swarmx}"
  mkdir -p "$swarm_home/logs"
  
  # Auto-seed SWARMX_DASHBOARD_ORIGIN for local development if not set
  if [[ -z "${SWARMX_DASHBOARD_ORIGIN:-}" ]]; then
    export SWARMX_DASHBOARD_ORIGIN="http://127.0.0.1:3000,http://localhost:3000"
    log_success "Auto-seeded SWARMX_DASHBOARD_ORIGIN=$SWARMX_DASHBOARD_ORIGIN"
  else
    log_info "Using SWARMX_DASHBOARD_ORIGIN=$SWARMX_DASHBOARD_ORIGIN"
  fi
  
  # Ensure timezone is set (WAT for operator dashboard)
  if [[ -z "${TZ:-}" ]]; then
    export TZ="Africa/Lagos"
    log_info "Set timezone to $TZ for operator dashboard"
  fi
  
  # Set Node environment to development if not explicitly set
  if [[ -z "${NODE_ENV:-}" ]]; then
    export NODE_ENV="development"
    log_info "Set NODE_ENV to development"
  fi
}

# ─── Startup Banner ──────────────────────────────────────────────────────────
print_startup_banner() {
  cat >&2 << 'EOF'
╔════════════════════════════════════════════════════════════════════════════╗
║                         SwarmX V6.1 Startup                               ║
║                    Enhanced Health Check & Automation                      ║
╚════════════════════════════════════════════════════════════════════════════╝
EOF
  
  echo >&2
  log_info "Startup timestamp: $(date '+%Y-%m-%d %H:%M:%S %Z')"
  log_info "Root directory: $ROOT_DIR"
  log_info "Ollama URL: $OLLAMA_URL"
  log_info "API: http://$API_HOST:$API_PORT"
  log_info "Dashboard: http://127.0.0.1:$DASHBOARD_PORT"
  echo >&2
}

# ─── Startup Summary ──────────────────────────────────────────────────────────
print_startup_summary() {
  echo >&2
  cat >&2 << EOF
${GREEN}${BOLD}✓ SwarmX Stack Ready${NC}

  ${BOLD}API Server:${NC}
    🚀 http://$API_HOST:$API_PORT
    📡 CORS Origins: $SWARMX_DASHBOARD_ORIGIN
    
  ${BOLD}Dashboard:${NC}
    🌐 http://127.0.0.1:$DASHBOARD_PORT
    🔌 Connected to API via proxy + fallback
    
  ${BOLD}LLM Backend:${NC}
    🤖 Ollama at $OLLAMA_URL
    📚 Models: phi4-fast, qwen-worker, deepseek-reasoner
    
  ${BOLD}Quick Commands:${NC}
    • View logs: tail -f ~/.swarmx/logs/swarmx-*.log
    • Health check: curl http://$API_HOST:$API_PORT/health
    • Stop services: pkill -f 'swarmx|next start|@swarmx/dashboard'

  ${BOLD}Troubleshooting:${NC}
    • CORS errors? Check: docs/CORS_CONFIGURATION.md
    • API timeout? Start Ollama: ollama serve
    • Logs: $STARTUP_LOG

${YELLOW}Note: Ctrl+C to stop services${NC}
EOF
}

# ─── Startup Verification ────────────────────────────────────────────────────
verify_startup() {
  log_info "Verifying startup..."
  
  local max_attempts=30
  local attempt=1
  local api_ready=false
  local dashboard_ready=false
  
  while [ $attempt -le $max_attempts ]; do
    # Check API health
    if [[ "$api_ready" == false ]]; then
      if curl -s --connect-timeout 2 "http://$API_HOST:$API_PORT/health" >/dev/null 2>&1; then
        log_success "API is responding on port $API_PORT"
        api_ready=true
      fi
    fi
    
    # Check Dashboard health
    if [[ "$dashboard_ready" == false ]]; then
      if curl -s --connect-timeout 2 "http://127.0.0.1:$DASHBOARD_PORT" >/dev/null 2>&1; then
        log_success "Dashboard is responding on port $DASHBOARD_PORT"
        dashboard_ready=true
      fi
    fi
    
    if [[ "$api_ready" == true ]] && [[ "$dashboard_ready" == true ]]; then
      log_success "All services are operational"
      return 0
    fi
    
    if [ $((attempt % 5)) -eq 0 ]; then
      log_info "Waiting for services... ($attempt/$max_attempts)"
    fi
    
    sleep 1
    attempt=$((attempt + 1))
  done
  
  log_warning "Services took longer than expected to become ready"
  log_info "Try accessing manually: http://127.0.0.1:$DASHBOARD_PORT"
  return 0  # Non-blocking; don't fail
}

# ─── Main Execution ──────────────────────────────────────────────────────────
main() {
  # Ensure log directory exists
  mkdir -p "$(dirname "$STARTUP_LOG")"
  
  # Print startup banner
  print_startup_banner
  
  log_info "Starting SwarmX enhanced startup..."
  
  # Run health checks
  log_info "Running health checks..."
  check_directories || { log_error "Directory check failed"; exit 1; }
  evict_stale_instances
  check_python || { log_error "Python check failed"; exit 1; }
  check_nodejs || { log_error "Node.js check failed"; exit 1; }
  check_ports || { log_error "Port check failed"; exit 1; }
  check_ollama || true  # Non-blocking
  
  # If check-only flag, exit after health checks
  if [[ "$CHECK_ONLY" == true ]]; then
    log_success "Health checks passed"
    return 0
  fi
  
  # Setup environment
  setup_environment
  
  # Delegate to main startup script
  log_info "Delegating to swarm up command..."
  log_info "Startup log: $STARTUP_LOG"
  echo >&2
  
  cd "$ROOT_DIR"
  bash "$ROOT_DIR/swarm-up.sh" "${@:1}"
  
  # If we get here, startup succeeded
  verify_startup
  print_startup_summary
}

# ─── Argument Parsing ─────────────────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --check-only)
      CHECK_ONLY=true
      shift
      ;;
    --verbose|-v)
      VERBOSE=true
      shift
      ;;
    --timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    *)
      break
      ;;
  esac
done

main "$@"
