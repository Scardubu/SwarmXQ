"""
brain/dispatcher — SwarmX V5.6 Brain Dispatcher
=================================================
Classifies steps and dispatches them to the appropriate model role.

CHANGES FROM LEGACY VERSION:
  [FIX-01] CRITICAL: Removed `from v7.api.client import send_task_to_cluster`.
           The v7 module does not exist in this codebase. This import caused an
           ImportError on every startup, silently breaking all brain/ entry points.
  [FIX-02] `dispatch()` is now async (calls async `route()`).
  [FIX-03] "cluster" mode is removed — all dispatch is local through the V5.6
           Ollama stack. Large/complex tasks are handled by the reasoner model,
           not a non-existent remote cluster API.
  [ENH-01] `classify()` extended to detect more patterns (fintech, security,
           architecture keywords) for better model routing.
  [ENH-02] `dispatch_sync()` wrapper added for legacy synchronous callers.
"""

from __future__ import annotations

import asyncio
import warnings

import structlog

log = structlog.get_logger("swarmx.brain.dispatcher")

_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.dispatcher.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (dispatch/executor APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True


# ─── Step classifier ──────────────────────────────────────────────────────────

def classify(step: str) -> str:
    """
    Classify a step string to determine which model role should handle it.

    Returns one of: "reason" | "code" | "fast" | "local"
    All modes are handled locally through the Ollama V5.6 stack.
    """
    s = step.lower()

    # Heavy reasoning tasks → deepseek-reasoner
    _reason_signals = (
        "build system", "architecture", "design", "strategy", "plan",
        "analyse", "analyze", "research", "evaluate", "security audit",
        "compliance", "zkp", "zero-knowledge", "multi-step",
    )
    if len(step) > 200 or any(sig in s for sig in _reason_signals):
        return "reason"

    # Code / implementation tasks → qwen-worker
    _code_signals = (
        "python", "typescript", "javascript", "script", "function", "class",
        "refactor", "implement", "endpoint", "schema", "migration", "test",
        "dockerfile", "workflow", "pipeline",
    )
    if any(sig in s for sig in _code_signals):
        return "code"

    return "local"   # fast / local: phi4-fast handles it


# ─── Core dispatch ────────────────────────────────────────────────────────────

async def dispatch(step: str) -> str:
    """
    Classify and dispatch a step to the appropriate local model.

    [FIX-01] No cluster mode — all work is local through Ollama V5.6.
    [FIX-02] Fully async.
    """
    _warn_deprecated("dispatch")
    mode = classify(step)
    role = "reason" if mode == "reason" else ("code" if mode == "code" else "fast")

    from brain.router import run_model  # local import to avoid circular

    # [V5.9-FIX-01] Replaced print() with structlog per code conventions.
    log.info("dispatch_step", role=role, step_preview=step[:80])
    return await run_model(role, step)


def dispatch_sync(step: str) -> str:
    """Synchronous wrapper for dispatch (for legacy callers)."""
    return asyncio.run(dispatch(step))
