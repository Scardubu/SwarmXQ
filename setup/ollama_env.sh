#!/usr/bin/env bash
# =============================================================================
# SwarmX Ollama Environment — APEX-17 r8 low-RAM profile
# =============================================================================
# SOURCE THIS FILE before starting Ollama or any agent processes:
#   source /opt/swarmx/setup/ollama_env.sh
#
# This profile preserves strict single-model mode on 8 GB hosts. Request-level
# keep_alive values remain authoritative; the global daemon keep-alive stays 0.
# =============================================================================

export OLLAMA_NUM_PARALLEL=1
export OLLAMA_MAX_LOADED_MODELS=1
export OLLAMA_KEEP_ALIVE=0
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
export SWARMX_WORKER_MODEL="plan-phi4-pro-q8-prod"
export SWARMX_SUPERVISOR_MODEL="plan-qwen25-pro-q5km-prod"
export SWARMX_REASONER_MODEL="reason-deepseekr1-pro-q5km-prod"
export SWARMX_FAST_MODEL="instruct-phi4-pro-q8-prod"
export SWARMX_MODEL_STARTUP_PREWARM="${SWARMX_MODEL_STARTUP_PREWARM:-0}"
export SWARMX_MODEL_PREDICTIVE_PREWARM="${SWARMX_MODEL_PREDICTIVE_PREWARM:-0}"

# PRIMARY — matches orchestrator.py OLLAMA_BASE_URL() reader.
export SWARMX_OLLAMA_URL="http://127.0.0.1:11434"

# Deprecated alias — retained for backwards compat. Remove after scripts updated.
export SWARMX_OLLAMA_BASE_URL="http://127.0.0.1:11434"

export SWARMX_REQUEST_TIMEOUT=120
export SWARMX_MAX_RETRIES=3

echo "[SwarmX APEX-17 r8] Ollama environment loaded."
echo "  Worker     : $SWARMX_WORKER_MODEL"
echo "  Supervisor : $SWARMX_SUPERVISOR_MODEL"
echo "  Reasoner   : $SWARMX_REASONER_MODEL"
echo "  Fast       : $SWARMX_FAST_MODEL"
echo "  Endpoint   : $SWARMX_OLLAMA_URL"
