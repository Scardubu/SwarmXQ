"""
brain/router — SwarmX V6.0 Brain Router
========================================
Routes brain/ module calls to the appropriate model via Ollama /api/chat.

CHANGES V6.0 vs V5.6:
  [FIX-01] Robust config loader with SWARM_ROOT env override, `models` key
    validation, and safe fallback to V5.6 defaults.
  [FIX-02] httpx async /api/chat — no deprecated subprocess.run per call.
  [FIX-03] `detect_intent` normalises legacy brain.yaml model names to V5.6 tags.
  [ENH-01] `run_model` async-first; `run_model_sync` wrapper for legacy callers.
  [ENH-02] `route` async with sync wrapper.

CHANGES V6.0 (new):
  [FIX-04] `_load_config()` now guarded by `threading.Lock` so concurrent
    callers (e.g. multiple asyncio tasks calling run_model simultaneously on
    first import) cannot both observe `_CONFIG = {}` and both attempt file I/O,
    causing a torn double-load or a race on the global dict assignment.
  [ENH-03] `detect_intent` extended with fintech / security / architecture
    signals for more precise model routing on domain-specific tasks.
"""

from __future__ import annotations

import asyncio
import json
import os
import threading
import warnings
from pathlib import Path
from typing import Any

import httpx

# ─── Legacy model name remap ──────────────────────────────────────────────────

_V5_MODEL_REMAP: dict[str, str] = {
    "phi3":       "phi4-fast",
    "phi3:mini":  "phi4-fast",
    "phi4:mini":  "phi4-fast",
    "llama3:8b":  "deepseek-reasoner",
    "llama3":     "deepseek-reasoner",
    "qwen:7b":    "qwen-worker",
    "qwen2.5":    "qwen-supervisor",
}

_DEFAULT_MODELS: dict[str, str] = {
    "fast":       "phi4-fast",
    "reason":     "deepseek-reasoner",
    "code":       "qwen-worker",
    "supervisor": "qwen-supervisor",
    "worker":     "phi4-worker",
    "critic":     "deepseek-critic",
}

# ─── Thread-safe config loader ────────────────────────────────────────────────

_CONFIG: dict[str, Any] = {}
_CONFIG_LOCK = threading.Lock()   # [FIX-04] prevents torn double-load
_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.router.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (routing/llm APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True


def _load_config() -> dict[str, Any]:
    global _CONFIG
    # Fast path — no lock needed once populated
    if _CONFIG:
        return _CONFIG

    with _CONFIG_LOCK:
        # Double-checked locking — another thread may have loaded first
        if _CONFIG:
            return _CONFIG

        swarm_root = os.environ.get("SWARM_ROOT", ".")
        candidates = [
            Path(swarm_root) / "configs" / "brain.yaml",
            Path(__file__).parent.parent / "configs" / "brain.yaml",
            Path("configs") / "brain.yaml",
        ]

        for candidate in candidates:
            if candidate.exists():
                try:
                    import yaml  # lazy — avoids hard dependency
                    raw = yaml.safe_load(candidate.read_text(encoding="utf-8")) or {}
                    if isinstance(raw, dict) and "models" in raw:
                        remapped = {
                            role: _V5_MODEL_REMAP.get(tag, tag)
                            for role, tag in raw.get("models", {}).items()
                        }
                        _CONFIG = {**raw, "models": {**_DEFAULT_MODELS, **remapped}}
                        return _CONFIG
                except Exception:
                    pass

        # No valid config — use built-in defaults
        _CONFIG = {"models": _DEFAULT_MODELS}
        return _CONFIG


def _ollama_url() -> str:
    return os.environ.get("SWARMX_OLLAMA_URL", "http://127.0.0.1:11434")


# ─── Intent detection ─────────────────────────────────────────────────────────

def detect_intent(prompt: str) -> str:
    """
    Map a prompt to a model role key. Returns a key from _DEFAULT_MODELS.

    [ENH-03] Extended with fintech / security / architecture signals.
    """
    p = prompt.lower()

    # Deep reasoning signals → deepseek-reasoner
    _reason_signals = (
        "design", "architecture", "analyze", "analyse", "research",
        "plan", "strategy", "reason", "evaluate", "compliance",
        "zero-knowledge", "zkp", "multi-step", "taxbridge", "sabiscore",
        "hashablanca", "explain", "investigate", "diagnose",
    )
    if any(k in p for k in _reason_signals):
        return "reason"

    # Code / implementation signals → qwen-worker
    _code_signals = (
        "code", "script", "implement", "function", "class", "refactor",
        "endpoint", "schema", "migration", "test", "dockerfile", "pipeline",
        "typescript", "python", "javascript", "prisma", "effect-ts", "bullmq",
    )
    if any(k in p for k in _code_signals):
        return "code"

    # Review / audit signals → deepseek-critic
    _critic_signals = ("review", "critique", "audit", "score", "grade", "assess")
    if any(k in p for k in _critic_signals):
        return "critic"

    return "fast"


def _resolve_model(role: str) -> str:
    """Resolve a role key to an Ollama model tag.

    Resolution order:
      1. brain.yaml `models:` section (file-based config override)
      2. brain.roles.role_model() — covers SWARMX_MODEL_<ROLE>, SWARM_MODEL_*
         env vars, SwarmConfig canonical values, and ROLE_MODELS static map.
      3. _DEFAULT_MODELS static fallback (handles roles not in ROLE_MODELS).

    [V5.9-FIX-01] Removed the duplicated per-role importlib blocks that
    diverged from brain/roles.py's resolution logic and used the wrong import
    priority order.  Delegating to role_model() gives a single canonical path.
    """
    cfg = _load_config()
    # 1. brain.yaml override
    tag = cfg.get("models", {}).get(role)
    if tag:
        return _V5_MODEL_REMAP.get(tag, tag)

    # 2. Canonical resolution via brain.roles (env + SwarmConfig + static map)
    try:
        from brain.roles import role_model  # local import to avoid circular
        return role_model(role)
    except Exception:
        pass

    # 3. Hard static fallback
    fallback = _DEFAULT_MODELS.get(role.lower(), "phi4-fast")
    return _V5_MODEL_REMAP.get(fallback, fallback)


# ─── Core model call ─────────────────────────────────────────────────────────

async def run_model(role: str, prompt: str, timeout: int = 120) -> str:
    """
    Call the Ollama /api/chat endpoint for the given role.
    Uses httpx async — no subprocess, no shell=True.
    Returns the assistant message content as a plain string.
    """
    _warn_deprecated("run_model")
    model = _resolve_model(role)
    base_url = _ollama_url().rstrip("/")

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            resp = await client.post(
                f"{base_url}/api/chat",
                json={
                    "model":    model,
                    "stream":   False,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )
            resp.raise_for_status()
            return resp.json().get("message", {}).get("content", "")
        except httpx.HTTPStatusError as e:
            return json.dumps({"error": f"Ollama HTTP {e.response.status_code}", "model": model})
        except Exception as e:
            return json.dumps({"error": str(e), "model": model})


def run_model_sync(role: str, prompt: str, timeout: int = 120) -> str:
    """Synchronous wrapper for run_model (for legacy callers)."""
    return asyncio.run(run_model(role, prompt, timeout=timeout))


# ─── Route helper ─────────────────────────────────────────────────────────────

async def route(step: str) -> str:
    """Detect intent and dispatch to the appropriate model. Returns response text."""
    role = detect_intent(step)
    return await run_model(role, step)


def route_sync(step: str) -> str:
    """Synchronous wrapper for route (for legacy callers)."""
    return asyncio.run(route(step))
