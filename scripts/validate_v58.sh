#!/usr/bin/env bash
# scripts/validate_v58.sh — SwarmX V5.8 post-deployment validation
#
# Runs a sequence of import, integration, and unit checks to verify the
# V5.8 refinement pass applied cleanly.  Safe to run on any machine that
# has Python 3.11+ and the core deps (httpx, pyyaml, structlog) installed.
# Does NOT require Ollama, faiss, or sentence-transformers.
#
# Exit code: 0 = all checks passed, 1 = one or more checks failed.

set -euo pipefail

PYTHON=${PYTHON:-python3}
PASS=0
FAIL=0
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RESET='\033[0m'

ok()   { echo -e "  ${GREEN}✓${RESET} $1"; ((PASS++)); }
fail() { echo -e "  ${RED}✗${RESET} $1"; ((FAIL++)); }
section() { echo -e "\n${YELLOW}── $1 ──${RESET}"; }

# ── 1. Module import checks ───────────────────────────────────────────────────
section "Import validation (no ML deps required)"

check_import() {
    local mod="$1" label="${2:-$1}"
    if $PYTHON -c "import $mod" 2>/dev/null; then
        ok "$label imports cleanly"
    else
        fail "$label import failed"
    fi
}

check_import "brain"              "brain (package)"
check_import "brain.rag"          "brain.rag"
check_import "brain.scorer"       "brain.scorer"
check_import "brain.roles"        "brain.roles"
check_import "brain.utils"        "brain.utils"
check_import "brain.graph"        "brain.graph"
check_import "brain.memory"       "brain.memory"
check_import "memory"             "memory (package)"
check_import "agents.executor"    "agents.executor"
check_import "agents.analyzer"    "agents.analyzer"
check_import "core"               "core (package)"

# ── 2. Symbol collision check ────────────────────────────────────────────────
section "scorer/loop symbol collision regression"

if $PYTHON -c "
from brain.scorer import score_output as s
from brain.loop   import score_output as l
assert s is l, 'COLLISION: scorer and loop define different score_output'
print('  same object:', s)
" 2>/dev/null; then
    ok "brain.scorer.score_output is brain.loop.score_output (no collision)"
else
    fail "brain.scorer.score_output collision detected"
fi

# ── 3. Memory path check ─────────────────────────────────────────────────────
section "Memory path alignment (~/.swarmx)"

if $PYTHON -c "
import os, tempfile, sys
with tempfile.TemporaryDirectory() as td:
    os.environ['SWARM_HOME'] = td
    # Clear cached modules
    for k in list(sys.modules.keys()):
        if k.startswith('memory.') or k == 'memory':
            del sys.modules[k]
    from memory.vector_store import _STORE_DIR
    assert str(_STORE_DIR).startswith(td), f'Bad path: {_STORE_DIR}'
print('  store_dir uses SWARM_HOME correctly')
" 2>/dev/null; then
    ok "VectorStore path uses SWARM_HOME (not ~/.swarm)"
else
    fail "VectorStore path regression — still using ~/.swarm"
fi

# ── 4. FAISSStore graceful fallback ──────────────────────────────────────────
section "FAISSStore graceful fallback (no faiss installed)"

if $PYTHON -c "
import sys
# Block faiss import
sys.modules['faiss'] = None
sys.modules['sentence_transformers'] = None
for k in list(sys.modules.keys()):
    if k.startswith('memory.'):
        del sys.modules[k]
from memory.faiss_store import FAISSStore
store = FAISSStore()
# Should not raise — should return a fallback store
print(f'  store type: {type(store).__name__}')
" 2>/dev/null; then
    ok "FAISSStore() returns fallback (no crash) when faiss is absent"
else
    fail "FAISSStore() still crashes when faiss is absent"
fi

# ── 5. RAG enrich no-crash ───────────────────────────────────────────────────
section "brain.rag.enrich() tier-4 passthrough (no stores)"

if $PYTHON -c "
import sys, os, tempfile
with tempfile.TemporaryDirectory() as td:
    os.environ['SWARM_HOME'] = td
    sys.modules['faiss'] = None
    sys.modules['sentence_transformers'] = None
    sys.modules['sklearn'] = None
    for k in list(sys.modules.keys()):
        if k.startswith('brain.rag') or k.startswith('memory.'):
            del sys.modules[k]
    import brain.rag as rag
    prompt = 'test prompt'
    result = rag.enrich(prompt)
    assert result == prompt, f'Expected passthrough, got: {result!r}'
print('  passthrough returned original prompt')
" 2>/dev/null; then
    ok "brain.rag.enrich() returns bare prompt when all stores unavailable"
else
    fail "brain.rag.enrich() crashed with no stores available"
fi

# ── 6. evolution_engine __all__ check ────────────────────────────────────────
section "evolution_engine __all__ includes delta_capture"

if $PYTHON -c "
from swarmx.core.evolution_engine import __all__
assert 'delta_capture' in __all__, f'delta_capture missing from __all__: {__all__}'
print(f'  __all__ = {sorted(__all__)}')
" 2>/dev/null; then
    ok "evolution_engine.__all__ correctly includes delta_capture"
else
    fail "evolution_engine.__all__ missing delta_capture (duplicate __all__ not fixed)"
fi

# ── 7. agents.executor async check ───────────────────────────────────────────
section "agents.executor — asyncio.gather (no threading.Thread)"

if $PYTHON -c "
import ast, inspect
from agents.executor import execute_parallel
src = inspect.getsource(execute_parallel)
tree = ast.parse(src)
for node in ast.walk(tree):
    if isinstance(node, ast.Attribute):
        if node.attr == 'Thread':
            raise AssertionError('threading.Thread found in execute_parallel — not fixed')
print('  no threading.Thread in execute_parallel')
" 2>/dev/null; then
    ok "agents.executor uses asyncio.gather (no threading.Thread deadlock)"
else
    fail "agents.executor still uses threading.Thread"
fi

# ── 8. New tools registered ──────────────────────────────────────────────────
section "New V5.8 tools registered in orchestration/tools.py"

if $PYTHON -c "
import sys
sys.path.insert(0, 'orchestration')
import tools
registry = tools.list_tools()
names = {t['name'] for t in registry}
assert 'semantic_search' in names, f'semantic_search not in registry: {names}'
assert 'diff_files'       in names, f'diff_files not in registry: {names}'
print(f'  registered tools: {sorted(names)}')
" 2>/dev/null; then
    ok "semantic_search and diff_files are registered in tools.py"
else
    fail "New V5.8 tools missing from tools.py registry"
fi

# ── Summary ───────────────────────────────────────────────────────────────────

echo ""
echo "────────────────────────────────────────"
echo -e "  ${GREEN}PASSED${RESET}: $PASS"
if [ "$FAIL" -gt 0 ]; then
    echo -e "  ${RED}FAILED${RESET}: $FAIL"
    echo "────────────────────────────────────────"
    echo -e "${RED}V5.8 validation FAILED — see failures above${RESET}"
    exit 1
else
    echo "  FAILED: 0"
    echo "────────────────────────────────────────"
    echo -e "${GREEN}V5.8 validation PASSED ✓${RESET}"
    exit 0
fi