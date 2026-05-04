#!/usr/bin/env bash
# =============================================================================
# SwarmX Ollama Environment — ZRAM-Aware Configuration  V5.6-refined
# =============================================================================
# SOURCE THIS FILE before starting Ollama or any agent processes:
#   source /opt/swarmx/setup/ollama_env.sh
#
# CHANGES V5.6-refined:
#   ✦ SWARMX_OLLAMA_URL added (primary, matches orchestrator.py).
#   ✦ SWARMX_FAST_MODEL added for tool_summarise_text.
#   ✦ SWARMX_OLLAMA_BASE_URL retained as deprecated alias.
# =============================================================================

export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_KEEP_ALIVE=180
export OLLAMA_FLASH_ATTENTION=1
export OLLAMA_KV_CACHE_TYPE=q8_0
export OLLAMA_SCHED_SPREAD=0
export OLLAMA_MAX_QUEUE=512
export OLLAMA_HOST=127.0.0.1:11434
export OLLAMA_DEBUG=0
export OLLAMA_MODELS=/usr/share/ollama/.ollama/models

export CUDA_VISIBLE_DEVICES=0
export PYTORCH_NO_CUDA_MEMORY_CACHING=1
export NVIDIA_TF32_OVERRIDE=1
export PYTHONMALLOC=malloc

# ── SwarmX agent model routing ─────────────────────────────────────────────────
export SWARMX_WORKER_MODEL="phi4-worker"
export SWARMX_SUPERVISOR_MODEL="qwen-supervisor"
export SWARMX_REASONER_MODEL="deepseek-reasoner"
export SWARMX_FAST_MODEL="phi4-fast"

# V5.6-refined: PRIMARY — matches orchestrator.py OLLAMA_BASE_URL() reader.
export SWARMX_OLLAMA_URL="http://127.0.0.1:11434"

# Deprecated alias — retained for backwards compat. Remove after scripts updated.
export SWARMX_OLLAMA_BASE_URL="http://127.0.0.1:11434"

export SWARMX_REQUEST_TIMEOUT=120
export SWARMX_MAX_RETRIES=3

echo "[SwarmX V5.6-refined] Ollama environment loaded."
echo "  Worker     : $SWARMX_WORKER_MODEL"
echo "  Supervisor : $SWARMX_SUPERVISOR_MODEL"
echo "  Reasoner   : $SWARMX_REASONER_MODEL"
echo "  Fast       : $SWARMX_FAST_MODEL"
echo "  Endpoint   : $SWARMX_OLLAMA_URL"