#!/usr/bin/env bash
# SwarmX sample run — demonstrates a full init → plan → run → evolve cycle.
# Works without a real LLM by using the deterministic provider.
set -euo pipefail

REPO="${1:-$(pwd)}"

# ── provider config ────────────────────────────────────────────────────────────
# Swap to 'ollama' (+ set MODEL_FAST / MODEL_CODE) for a live local run.
# Swap to 'openai' (+ set OPENAI_API_KEY) for cloud inference.
export SWARM_LLM_PROVIDER="${SWARM_LLM_PROVIDER:-deterministic}"
export SWARM_MODEL_FAST="${SWARM_MODEL_FAST:-phi4-mini}"
export SWARM_MODEL_REASON="${SWARM_MODEL_REASON:-deepseek-r1:7b}"
export SWARM_MODEL_CODE="${SWARM_MODEL_CODE:-qwen2.5-coder}"

echo "=== SwarmX sample run ==="
echo "Repo:     $REPO"
echo "Provider: $SWARM_LLM_PROVIDER"
echo ""

swarm init   "$REPO"
swarm inspect "$REPO"
swarm plan    "$REPO" "frontend design and performance pass"
swarm run     "$REPO" --target "frontend design and performance pass" \
              --autonomous --max-iterations 2
swarm memory
swarm evolve  "$REPO"
swarm status  "$REPO"

echo ""
echo "Run complete. Open the dashboard:"
echo "  swarm dashboard --repo $REPO --open-browser"
