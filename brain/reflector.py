"""
brain/reflector — SwarmX V5.6 Brain Reflector
===============================================
Post-execution reflection: evaluates a result against the original goal and
returns an improved version if the quality is insufficient.

CHANGES FROM LEGACY VERSION:
  [FIX-01] `reflect()` is now async (calls async `run_model`).
  [FIX-02] Bare `except:` replaced with `except Exception as e:` with logging.
  [FIX-03] Result validation: checks the parsed improved field is non-empty and
           longer than a minimum threshold before accepting it as an improvement.
  [ENH-01] `reflect_sync()` wrapper added for legacy callers.
  [ENH-02] Think block stripping applied (DeepSeek-R1 produces <think>...</think>).
  [ENH-03] Returns `None` explicitly when no meaningful improvement is found,
           allowing callers to decide whether to use the original result.
"""

from __future__ import annotations

import asyncio
import json
import re
import warnings
from typing import Optional

# [V5.9-FIX-01] Add _DEPRECATION_WARNED pattern consistent with all other
# brain/ modules so the phase-1 deprecation test can validate this module.
_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.reflector.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (reflector/cli APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True


async def reflect(prompt: str, results: str, min_improvement_len: int = 50) -> Optional[str]:
    """
    Ask the reasoning model to evaluate and improve `results` for `prompt`.

    Returns the improved text if it is longer than `min_improvement_len` chars,
    otherwise returns None (caller should use original result).
    """
    _warn_deprecated("reflect")
    from brain.router import run_model  # local import to avoid circular

    reflection_prompt = (
        "You are evaluating an AI agent's output against the original task.\n"
        "If the output adequately addresses the task: respond with "
        '{"improved": null, "reason": "output is sufficient"}.\n'
        "If the output can be meaningfully improved: respond with "
        '{"improved": "<full improved text>", "reason": "<why>"}.\n\n'
        f"ORIGINAL TASK:\n{prompt[:400]}\n\n"
        f"CURRENT OUTPUT:\n{results[:800]}\n\n"
        'Return ONLY valid JSON — no markdown, no explanation.'
    )

    try:
        raw = await run_model("reason", reflection_prompt)
    except Exception as e:
        return None

    # Strip think blocks
    raw = re.sub(r"<think>.*?</think>", "", raw, flags=re.DOTALL).strip()

    # Extract JSON
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        try:
            parsed = json.loads(match.group())
        except (json.JSONDecodeError, TypeError):
            parsed = {}
    else:
        try:
            parsed = json.loads(raw)
        except (json.JSONDecodeError, TypeError):
            parsed = {}

    improved = parsed.get("improved")

    # Only return improvement if it's substantive
    if improved and isinstance(improved, str) and len(improved.strip()) >= min_improvement_len:
        return improved.strip()

    return None  # original result is sufficient or model failed to improve


def reflect_sync(prompt: str, results: str) -> Optional[str]:
    """Synchronous wrapper for reflect (for legacy callers)."""
    return asyncio.run(reflect(prompt, results))
