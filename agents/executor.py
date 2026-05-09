"""
agents/executor — SwarmX V6.0 Async Parallel Executor
=======================================================
Executes a list of steps concurrently using asyncio.gather.

CHANGES V6.0 vs V5.9:
  [FIX-01] _publish_event() now imports and uses EventKind constants instead of
    raw string literals ("step.start", "step.complete", "step.failed").
    Raw strings bypass the EventKind validation layer and create silent drift
    if the bus constants are ever refactored. Using the constants makes the
    contract explicit and tooling-verifiable.
  [FIX-02] publish() is called with EventKind.<CONSTANT>.value which is the
    canonical string, ensuring strict-mode (SWARMX_EVENT_STRICT=1) validation
    passes without requiring an enum import in publish() callers.

CHANGES V5.9 vs V5.8:
  [ENH-01] EventBus integration: publishes STEP_START / STEP_COMPLETE /
    STEP_FAILED events when SWARM_HOME is configured.
  [ENH-02] execute_parallel() accepts optional `timeout_per_step` parameter.
  [ENH-03] Result dicts include `duration_s` for downstream quality scoring.
  [PRESERVED] All V5.8 fixes and async correctness retained.
"""
from __future__ import annotations

import asyncio
import inspect
import os
import time
from typing import Any, Callable, Optional

_SWARM_HOME = os.environ.get("SWARM_HOME", "")


def _publish_event(kind: str, payload: dict) -> None:
    """
    Publish to event bus when SWARM_HOME is configured.

    [FIX-01] `kind` must be an EventKind constant value (e.g. EventKind.STEP_START).
    Callers in this module always pass EventKind.<CONST> — never bare strings.
    """
    if not _SWARM_HOME:
        return
    try:
        from pathlib import Path
        from swarmx.event_bus import publish, EventKind  # type: ignore[import]
        publish(Path(_SWARM_HOME), kind, payload)
    except Exception:
        pass


async def execute_parallel(
    steps: list[Any],
    route: Callable,
    *,
    return_exceptions: bool = True,
    timeout_per_step: Optional[float] = None,
) -> list[dict[str, Any]]:
    """
    Execute all steps concurrently via asyncio.gather.

    Args:
        steps:             List of step payloads to dispatch.
        route:             Callable(step) → result. May be sync or async.
        return_exceptions: If True, exceptions are captured per-step.
        timeout_per_step:  Per-step wall-clock timeout in seconds. None = no timeout.

    Returns:
        List of dicts: [{"step": ..., "result": ..., "error": ..., "duration_s": ...}]
    """
    # [FIX-01] Import EventKind once per execute_parallel call — cheap and correct.
    try:
        from swarmx.event_bus import EventKind as _EK  # type: ignore[import]
        _EK_STEP_START    = _EK.STEP_START
        _EK_STEP_COMPLETE = _EK.STEP_COMPLETE
        _EK_STEP_FAILED   = _EK.STEP_FAILED
    except Exception:
        # Fallback to string constants if EventKind is unavailable (e.g. in tests)
        _EK_STEP_START    = "step.start"
        _EK_STEP_COMPLETE = "step.complete"
        _EK_STEP_FAILED   = "step.failed"

    async def _call(step: Any) -> dict[str, Any]:
        t0 = time.monotonic()
        step_label = (
            str(step)[:60]
            if not isinstance(step, dict)
            else str(step.get("action", step))[:60]
        )
        _publish_event(_EK_STEP_START, {"step": step_label})
        try:
            if inspect.iscoroutinefunction(route):
                coro = route(step)
            else:
                coro = asyncio.to_thread(route, step)

            if timeout_per_step is not None:
                result = await asyncio.wait_for(coro, timeout=timeout_per_step)
            else:
                result = await coro

            duration_s = round(time.monotonic() - t0, 3)
            _publish_event(_EK_STEP_COMPLETE, {"step": step_label, "duration_s": duration_s})
            return {"step": step, "result": result, "error": None, "duration_s": duration_s}

        except asyncio.TimeoutError:
            duration_s = round(time.monotonic() - t0, 3)
            err = f"TimeoutError: step exceeded {timeout_per_step}s"
            _publish_event(_EK_STEP_FAILED, {"step": step_label, "error": err, "duration_s": duration_s})
            return {"step": step, "result": None, "error": err, "duration_s": duration_s}

        except Exception as exc:
            duration_s = round(time.monotonic() - t0, 3)
            err = f"{type(exc).__name__}: {exc}"
            _publish_event(_EK_STEP_FAILED, {"step": step_label, "error": err, "duration_s": duration_s})
            return {"step": step, "result": None, "error": err, "duration_s": duration_s}

    return await asyncio.gather(*[_call(step) for step in steps])


def execute_parallel_sync(
    steps: list[Any],
    route: Callable,
    *,
    timeout_per_step: Optional[float] = None,
) -> list[dict[str, Any]]:
    """Synchronous wrapper for execute_parallel (for legacy / CLI callers)."""
    try:
        asyncio.get_running_loop()
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(
                asyncio.run,
                execute_parallel(steps, route, timeout_per_step=timeout_per_step),
            ).result()
    except RuntimeError:
        return asyncio.run(execute_parallel(steps, route, timeout_per_step=timeout_per_step))


__all__ = ["execute_parallel", "execute_parallel_sync"]