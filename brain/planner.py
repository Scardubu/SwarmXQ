"""
brain/planner — SwarmX V5.6 Brain Planner
==========================================
Decomposes a goal into an ordered list of step strings.

CHANGES FROM LEGACY VERSION:
  [FIX-01] `plan_task()` is now async (calls async `run_model`).
  [FIX-02] JSON parse failure now returns `[prompt]` fallback (was silently
           swallowing all exceptions with bare `except:`).
  [FIX-03] Planner prompt updated to request a well-structured JSON array.
  [ENH-01] `plan_task_sync()` wrapper added for legacy callers.
  [ENH-02] Validates that the parsed result is a non-empty list of strings;
           falls back gracefully if the model returns unexpected structure.
"""

from __future__ import annotations

import asyncio
import json
import re
import warnings


_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.planner.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (planner/cli APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True


async def plan_task(prompt: str) -> list[str]:
    """
    Ask the reasoning model to decompose `prompt` into an ordered step list.

    Returns a list of step strings. Falls back to `[prompt]` on any failure
    so callers are never blocked by a planning failure.
    """
    _warn_deprecated("plan_task")
    from brain.router import run_model  # local import to avoid circular

    plan_prompt = (
        "Decompose the following task into 2–5 ordered executable steps.\n"
        "Each step should be a single, concrete action sentence.\n"
        "Return ONLY a JSON array of strings — no markdown, no explanation.\n\n"
        f"TASK:\n{prompt}\n\n"
        'Example output: ["Step 1: ...", "Step 2: ...", "Step 3: ..."]'
    )

    try:
        raw = await run_model("reason", plan_prompt)
    except Exception as e:
        return [prompt]  # planning failure — run as single step

    # Strip think blocks (DeepSeek-R1 produces these)
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # Extract JSON array
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
            if isinstance(parsed, list) and all(isinstance(s, str) for s in parsed) and parsed:
                return parsed
        except (json.JSONDecodeError, TypeError):
            pass

    # Try direct parse
    try:
        parsed = json.loads(raw)
        if isinstance(parsed, list) and parsed:
            return [str(s) for s in parsed]
    except (json.JSONDecodeError, TypeError):
        pass

    # Fallback: treat as single step
    return [prompt]


def plan_task_sync(prompt: str) -> list[str]:
    """Synchronous wrapper for plan_task (for legacy callers)."""
    return asyncio.run(plan_task(prompt))
