#!/usr/bin/env bash
# =============================================================================
# install.sh — SwarmX V5.6 model builder and smoke tester
# =============================================================================
# Creates all Ollama models from Modelfiles (primary + optional variants),
# installs Python deps, and runs functional verification.
#
# Usage:
#   bash setup/install.sh              # primary + variants, then test
#   bash setup/install.sh --primary    # primary tags only
#   bash setup/install.sh --variants   # variant tags only (requires primaries)
#   bash setup/install.sh --test-only  # skip creation, run tests only
#   bash setup/install.sh --clean      # remove all swarmx tags from Ollama
#   bash setup/install.sh --no-zram    # skip ZRAM setup prompt
#
# Environment variables:
#   MODELS_DIR      Override GGUF directory (default: ~/models/llm-local)
#   OLLAMA_HOST     Override Ollama base URL (default: http://localhost:11434)
#
# Prerequisites:
#   - Ollama >= 0.5.13 installed (https://ollama.com)
#   - GGUF files present in ~/models/llm-local/ (or set MODELS_DIR)
#   - sudo access (for optional ZRAM setup)
#
# CHANGES V5.2:
#   ✦ --primary / --variants / --test-only / --clean flags from v2 create-and-test.sh
#   ✦ --no-zram flag to skip ZRAM prompt in CI
#   ✦ Smoke tests updated to V5.2 model names
#   ✦ Python venv detection — warns if running outside venv
#   ✦ All primary model existence checks before any creation
# =============================================================================

set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; NC='\033[0m'

pass()    { echo -e "${GREEN}[PASS]${NC}  $*"; }
fail()    { echo -e "${RED}[FAIL]${NC}  $*"; FAILURES=$((FAILURES + 1)); }
info()    { echo -e "${CYAN}[INFO]${NC}  $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC}  $*"; }
die()     { echo -e "${RED}[FAIL]${NC}  $*" >&2; exit 1; }
title()   { echo -e "\n${BOLD}═══ $1 ═══${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
MODELS_DIR="${MODELS_DIR:-$HOME/models/llm-local}"
OLLAMA_BASE="${OLLAMA_HOST:-http://localhost:11434}"

CREATE_PRIMARY=true
CREATE_VARIANTS=true
TEST_ONLY=false
CLEAN=false
NO_ZRAM=false
FAILURES=0

# ── Argument parsing ──────────────────────────────────────────────────────────
for arg in "$@"; do
    case "$arg" in
        --primary)    CREATE_PRIMARY=true;  CREATE_VARIANTS=false ;;
        --variants)   CREATE_PRIMARY=false; CREATE_VARIANTS=true  ;;
        --test-only)  CREATE_PRIMARY=false; CREATE_VARIANTS=false; TEST_ONLY=true ;;
        --clean)      CLEAN=true ;;
        --no-zram)    NO_ZRAM=true ;;
        -h|--help)
            grep '^#' "$0" | head -30 | sed 's/^# \?//'
            exit 0
            ;;
        *) die "Unknown argument: $arg (try --help)" ;;
    esac
done

# ── Ollama connectivity check ─────────────────────────────────────────────────
check_ollama() {
    if ! curl -sf "$OLLAMA_BASE/api/tags" > /dev/null 2>&1; then
        die "Ollama not reachable at $OLLAMA_BASE — start it with: source setup/env.swarmx && ollama serve"
    fi
    info "Ollama reachable at $OLLAMA_BASE"
}

# ── GGUF file check ───────────────────────────────────────────────────────────
check_gguf() {
    local f="$MODELS_DIR/$1"
    if [[ -f "$f" ]]; then
        local sz; sz=$(du -sh "$f" | cut -f1)
        info "GGUF found: $1 ($sz)"
    else
        die "GGUF not found: $f — place files in $MODELS_DIR or set MODELS_DIR env var"
    fi
}

# ── Clean ─────────────────────────────────────────────────────────────────────
if $CLEAN; then
    title "Removing all SwarmX tags"
    check_ollama
    for tag in \
        "qwen-supervisor" "qwen-worker" "phi4-worker" "phi4-fast" \
        "deepseek-reasoner" "deepseek-critic" \
        "deepseek-r1:swarmx-evolve" "deepseek-r1:swarmx-supervisor" \
        "qwen2.5:swarmx-evolve" "phi4-fast:swarmx-evolve"; do
        if ollama rm "$tag" 2>/dev/null; then
            pass "Removed $tag"
        else
            warn "$tag not found (already removed?)"
        fi
    done
    exit 0
fi

# ── Ollama version check ──────────────────────────────────────────────────────
command -v ollama &>/dev/null || die "Ollama not found. Install from https://ollama.com"
OLLAMA_VERSION=$(ollama --version 2>/dev/null | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "0.0.0")
info "Ollama version: $OLLAMA_VERSION"

if [[ "$(printf '%s\n' "0.5.13" "$OLLAMA_VERSION" | sort -V | head -1)" != "0.5.13" ]]; then
    warn "Ollama < 0.5.13 detected. Upgrade recommended for phi4-fast REQUIRES directive."
fi

# ── Python venv advisory ──────────────────────────────────────────────────────
if [[ -z "${VIRTUAL_ENV:-}" ]]; then
    warn "No Python venv active. Consider: python3 -m venv .venv && source .venv/bin/activate"
fi

check_ollama

# ── Modelfile patching helpers ────────────────────────────────────────────────
TMP=$(mktemp -d)
trap "rm -rf $TMP" EXIT

patch_modelfile() {
    local src="$1" dst="$2"
    # Replace placeholder paths with actual MODELS_DIR
    sed \
        "s|FROM ~/models/llm-local/|FROM $MODELS_DIR/|g" \
        "$src" \
        | sed "s|FROM ./gguf/|FROM $MODELS_DIR/|g" \
        > "$dst"
}

patch_all_primary() {
    local mf_dir="$PROJECT_DIR/modelfiles/primary"
    patch_modelfile "$mf_dir/qwen-supervisor.modelfile"  "$TMP/qwen-supervisor.mf"
    patch_modelfile "$mf_dir/qwen-worker.modelfile"      "$TMP/qwen-worker.mf"
    patch_modelfile "$mf_dir/phi4-worker.modelfile"      "$TMP/phi4-worker.mf"
    patch_modelfile "$mf_dir/phi4-fast.modelfile"        "$TMP/phi4-fast.mf"
    patch_modelfile "$mf_dir/deepseek-reasoner.modelfile" "$TMP/deepseek-reasoner.mf"
    patch_modelfile "$mf_dir/deepseek-critic.modelfile"  "$TMP/deepseek-critic.mf"
}

patch_all_variants() {
    local mf_dir="$PROJECT_DIR/modelfiles/variants"
    patch_modelfile "$mf_dir/deepseek-r1-evolve.modelfile"    "$TMP/ds-evolve.mf"
    patch_modelfile "$mf_dir/deepseek-r1-supervisor.modelfile" "$TMP/ds-super.mf"
    patch_modelfile "$mf_dir/qwen2.5-evolve.modelfile"         "$TMP/qwen-evolve.mf"
    patch_modelfile "$mf_dir/phi4-fast-evolve.modelfile"       "$TMP/phi4-evolve.mf"
}

# ── Model creation ────────────────────────────────────────────────────────────
create_tag() {
    local tag="$1" mf="$2"
    echo ""
    echo -e "${BOLD}Creating:${NC} $tag"
    if ollama create "$tag" -f "$mf" 2>&1; then
        pass "$tag created"
    else
        fail "$tag creation failed — check Modelfile syntax"
    fi
}

# ── Pre-flight: check GGUFs ────────────────────────────────────────────────────
if ! $TEST_ONLY; then
    check_gguf "Qwen2.5-7B-Instruct-Q5_K_M.gguf"
    check_gguf "microsoft_Phi-4-mini-Instruct-Q8_0.gguf"
    check_gguf "DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf"
fi

# ── Create primary tags ───────────────────────────────────────────────────────
if $CREATE_PRIMARY; then
    title "Creating primary tags"
    patch_all_primary
    create_tag "qwen-supervisor"  "$TMP/qwen-supervisor.mf"
    create_tag "qwen-worker"      "$TMP/qwen-worker.mf"
    create_tag "phi4-worker"      "$TMP/phi4-worker.mf"
    create_tag "phi4-fast"        "$TMP/phi4-fast.mf"
    create_tag "deepseek-reasoner" "$TMP/deepseek-reasoner.mf"
    create_tag "deepseek-critic"  "$TMP/deepseek-critic.mf"
fi

# ── Create variant tags ───────────────────────────────────────────────────────
if $CREATE_VARIANTS; then
    title "Creating variant tags (APEX-17 evolution)"
    patch_all_variants
    create_tag "deepseek-r1:swarmx-evolve"    "$TMP/ds-evolve.mf"
    create_tag "deepseek-r1:swarmx-supervisor" "$TMP/ds-super.mf"
    create_tag "qwen2.5:swarmx-evolve"        "$TMP/qwen-evolve.mf"
    create_tag "phi4-fast:swarmx-evolve"      "$TMP/phi4-evolve.mf"
fi

# ── Smoke tests ───────────────────────────────────────────────────────────────
title "Smoke tests"

run_test() {
    local tag="$1" prompt="$2" expected_key="$3"
    local out
    out=$(curl -sf "$OLLAMA_BASE/api/chat" \
        -H "Content-Type: application/json" \
        -d "{\"model\":\"$tag\",\"messages\":[{\"role\":\"user\",\"content\":\"$prompt\"}],\"stream\":false}" \
        --max-time 90 2>&1) || { fail "$tag: request failed"; return; }

    local content
    content=$(echo "$out" | python3 -c \
        "import sys,json; d=json.load(sys.stdin); print(d.get('message',{}).get('content',''))" 2>/dev/null) || {
        fail "$tag: response parse error"
        return
    }

    # Strip DeepSeek think blocks before JSON check
    local stripped
    stripped=$(echo "$content" | python3 -c \
        "import sys,re; t=sys.stdin.read(); print(re.sub(r'<think>.*?</think>','',t,flags=re.DOTALL).strip())" 2>/dev/null)

    if [[ -n "$expected_key" ]]; then
        if echo "$stripped" | python3 -c \
            "import sys,json; d=json.loads(sys.stdin.read()); assert '$expected_key' in d" 2>/dev/null; then
            pass "$tag: valid JSON with '$expected_key' field"
        else
            warn "$tag: responded but missing '$expected_key' — got: $(echo "$stripped" | head -c 120)"
        fi
    elif [[ ${#stripped} -gt 10 ]]; then
        pass "$tag: responded (${#stripped} chars)"
    else
        fail "$tag: empty or very short response"
    fi
}

# Primary model smoke tests
run_test "phi4-fast" \
    'Route this task: implement a Redis-backed rate limiter in Python. Emit a routing decision JSON with routed_to field.' \
    "routed_to"

run_test "phi4-worker" \
    'classify: write unit tests for the parse_config function. Emit JSON with route field.' \
    "route"

run_test "qwen-supervisor" \
    'New mission: build a CI/CD pipeline for a Python monorepo. Decompose into sub-tasks and emit a plan JSON.' \
    "type"

run_test "qwen-worker" \
    '{"type":"delegation","task_id":"t1","step_id":1,"agent":"executor","instruction":"Return the capital of France as a step_complete JSON.","input":null,"expected_output_schema":"step_complete","timeout_seconds":30}' \
    "type"

run_test "deepseek-reasoner" \
    'Analyse: Q4_0 vs Q8_0 KV cache for a 7B model on 12 GB VRAM at 16k context. Emit JSON with confidence field.' \
    "confidence"

run_test "deepseek-critic" \
    '{"instruction":"Audit this mock trace. Emit an audit schema JSON.","trace":{"task_id":"t1","goal":"test","status":"complete","steps":[]}}' \
    "type"

# ── Install Python deps ────────────────────────────────────────────────────────
title "Python dependencies"
if command -v pip3 &>/dev/null; then
    info "Installing Python orchestration dependencies..."
    if [[ -n "${VIRTUAL_ENV:-}" ]]; then
        pip3 install -r "$PROJECT_DIR/orchestration/requirements.txt"
    else
        pip3 install -r "$PROJECT_DIR/orchestration/requirements.txt" \
            --break-system-packages 2>/dev/null || \
        pip3 install -r "$PROJECT_DIR/orchestration/requirements.txt"
    fi
    pass "Python deps installed"
else
    warn "pip3 not found — install manually from orchestration/requirements.txt"
fi

# ── ZRAM setup (optional) ─────────────────────────────────────────────────────
if ! $NO_ZRAM; then
    echo ""
    read -rp "$(echo -e "${YELLOW}Configure ZRAM swap now? (requires sudo) [y/N]: ${NC}")" SETUP_ZRAM
    if [[ "$SETUP_ZRAM" =~ ^[Yy]$ ]]; then
        sudo bash "$SCRIPT_DIR/zram_setup.sh"
    else
        info "Skipping ZRAM. Run manually: sudo bash setup/zram_setup.sh"
    fi
fi

# ── Shell env integration ─────────────────────────────────────────────────────
echo ""
if ! grep -q "env.swarmx" ~/.bashrc 2>/dev/null; then
    echo "" >> ~/.bashrc
    echo "# SwarmX — uncomment to source before 'ollama serve'" >> ~/.bashrc
    echo "# source $PROJECT_DIR/setup/env.swarmx" >> ~/.bashrc
    info "Added commented source line to ~/.bashrc"
fi

# ── Pre-flight health check ────────────────────────────────────────────────────
echo ""
title "Pre-flight health check"
if command -v python3 &>/dev/null; then
    python3 "$SCRIPT_DIR/health_check.py" || warn "Pre-flight reported issues — see above."
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}═════════════════════════════════════════════════════${NC}"
if [[ $FAILURES -eq 0 ]]; then
    echo -e "${RED}  SwarmX V5.2 — $FAILURES failure(s) detected ✗${NC}" → "${RED}  SwarmX V5.6-refined — $FAILURES failure(s) detected ✗${NC}"
else
    echo -e "${RED}  SwarmX V5.6 — $FAILURES failure(s) detected ✗${NC}"
fi
echo -e "${BOLD}═════════════════════════════════════════════════════${NC}"
echo ""
echo "  Source env:         source setup/env.swarmx"
echo "  Start Ollama:       ollama serve"
echo "  Run task:           python3 orchestration/orchestrator.py \"<task>\""
echo "  Run critic only:    python3 orchestration/orchestrator.py --critic traces/trace_<uuid>.json"
echo "  Run evolution:      python3 orchestration/orchestrator.py --evolve traces/"
echo "  Integration test:   python3 setup/test_integration.py"
echo "  Health check:       python3 setup/health_check.py"
echo "  Benchmark:          python3 setup/health_check.py --bench"
echo ""
echo "  Model shortcuts:"
echo "    ollama run qwen-supervisor"
echo "    ollama run phi4-fast"
echo "    ollama run deepseek-reasoner"
echo ""
echo "  Rebuild variants only:"
echo "    bash setup/install.sh --variants"
echo ""

[[ $FAILURES -eq 0 ]] || exit 1
