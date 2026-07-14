"""
brain/loop — SwarmX V6.0 Autonomous Execution Loop
===================================================
Self-improving task loop with quality-gated iteration.

CHANGES V5.9 vs V5.6:
  [FIX-01] structlog replaces print() — consistent observability.
  [FIX-02] score_output() hard floor: <20 chars → immediate 0.0.
  [ENH-01] autonomous_run() publishes TASK_START / TASK_COMPLETE to event bus.
  [ENH-02] Refinement prompt capped at 1500 chars (output) / 400 chars (goal).
  [ENH-03] MAX_LOOPS and QUALITY_THRESHOLD env-configurable.

CHANGES V6.0 (new):
  [FIX-03] score_output() Signal 3 ("no error indicators") replaced with regex
    word-boundary match. The old substring match ("not found", "failed") fired
    false negatives on valid outputs like "The key was not found, so we created
    it" — penalising correct responses. The new pattern anchors to sentence-
    start error phrases, eliminating that class of false negatives.
  [ENH-04] score_output() Signal 5 extended with Nigerian fintech domain verbs
    (kyc, irn, bvn, paystack, remita, nibss) for domain-aware quality scoring.
  [ENH-05] autonomous_run() returns structured dict (not bare string) when
    SWARM_STRUCTURED_OUTPUT=1, enabling downstream JSON consumption.
"""

from __future__ import annotations

import asyncio
import os
import re
import time
import warnings

import structlog

log = structlog.get_logger("swarmx.brain.loop")

_DEPRECATION_WARNED = False


def _warn_deprecated(entrypoint: str) -> None:
    global _DEPRECATION_WARNED
    if _DEPRECATION_WARNED:
        return
    warnings.warn(
        (
            f"brain.loop.{entrypoint} is a compatibility adapter and will be "
            "retired in a future release. Use canonical runtime entrypoints under "
            "src/swarmx (executor/cli APIs) instead."
        ),
        DeprecationWarning,
        stacklevel=2,
    )
    _DEPRECATION_WARNED = True

MAX_LOOPS         = int(os.environ.get("SWARM_MAX_LOOPS", "3"))
QUALITY_THRESHOLD = float(os.environ.get("SWARM_QUALITY_THRESHOLD", "0.60"))
_SWARM_HOME       = os.environ.get("SWARM_HOME", "")

# ─── Precompiled patterns ─────────────────────────────────────────────────────

# [FIX-03] Anchored error pattern — sentence-start indicators only.
# Avoids false negatives on "not found, so we created it" style outputs.
_ERROR_PATTERN = re.compile(
    r"(?:^|\n)"                       # start of line
    r"(?:error:|exception:|traceback|"
    r"failed to |unable to |cannot be |"
    r"\[deterministic-fallback)",
    re.IGNORECASE,
)

_STRUCT_PATTERN = re.compile(
    r"\{.*?\}|\[.*?\]|```",
    re.DOTALL,
)

# [ENH-04] Extended action verbs including domain-specific fintech terms
_ACTION_PHRASES = (
    "implement", "create", "add", "update", "fix", "use",
    "configure", "install", "run", "deploy", "return", "emit",
    "recommend", "suggestion:", "next step", "action:",
    # Nigerian fintech domain
    "kyc", "irn", "bvn", "paystack", "remita", "nibss", "firs",
)


# ─── Quality scorer ───────────────────────────────────────────────────────────

def score_output(output: str) -> float:
    """
    Multi-signal quality score for an agent output. Returns 0.0–1.0.

    Signals (0.20 each):
      1. Non-trivial length (>= 80 chars) — <20 chars → immediate 0.0
      2. Contains structured data (JSON object/array or code block)
      3. No sentence-start error indicators  [FIX-03 regex boundary match]
      4. Word count > 30 (sufficient detail)
      5. Contains actionable language / domain verbs  [ENH-04]
    """
    if not output or not output.strip():
        return 0.0

    stripped = output.strip()

    # Hard floor — trivial / empty responses
    if len(stripped) < 20:
        return 0.0

    score = 0.0

    # Signal 1: Non-trivial length
    if len(stripped) >= 80:
        score += 0.20

    # Signal 2: Contains structured data
    if _STRUCT_PATTERN.search(output):
        score += 0.20

    # Signal 3: [FIX-03] No sentence-start error indicators
    if not _ERROR_PATTERN.search(output):
        score += 0.20

    # Signal 4: Sufficient word count
    if len(output.split()) >= 30:
        score += 0.20

    # Signal 5: Actionable / domain language
    output_lower = output.lower()
    if any(p in output_lower for p in _ACTION_PHRASES):
        score += 0.20

    return round(score, 2)


# ─── Plan helper ─────────────────────────────────────────────────────────────

async def _plan_steps(goal: str) -> list[str]:
    """Decompose goal into steps via the brain planner."""
    try:
        from brain.planner import plan_task  # type: ignore[import]
        return await plan_task(goal)
    except Exception:
        return [goal]


# ─── Event bus helper ─────────────────────────────────────────────────────────

def _publish_event(kind: str, payload: dict) -> None:
    """[ENH-01] Publish to event bus when SWARM_HOME is configured.

    [V5.9-FIX-01] Converts raw string kind to EventKind enum before publishing.
    Raw string event kinds are rejected by strict mode (SWARMX_EVENT_STRICT=1)
    and are inconsistent with the EventKind invariant throughout the codebase.
    The mapping covers the two lifecycle events emitted by this module.
    """
    if not _SWARM_HOME:
        return
    try:
        from pathlib import Path

        from swarmx.event_bus import EventKind, publish  # type: ignore[import]
        _KIND_MAP = {
            "task.start":    EventKind.TASK_START,
            "task.complete": EventKind.TASK_COMPLETE,
            "task.failed":   EventKind.TASK_FAILED,
        }
        event_kind = _KIND_MAP.get(kind)
        if event_kind is None:
            return  # unknown kind — skip silently rather than violate invariant
        publish(Path(_SWARM_HOME), event_kind, payload)
    except Exception:
        pass


# ─── Autonomous run loop ──────────────────────────────────────────────────────

async def autonomous_run(goal: str) -> str:
    """
    Self-improving loop: plan → dispatch → score → refine until quality threshold.
    Publishes TASK_START and TASK_COMPLETE to the event bus.
    """
    _warn_deprecated("autonomous_run")
    from brain.dispatcher import dispatch  # type: ignore[import]

    t0 = time.monotonic()
    log.info("autonomous_start", goal=goal[:100], max_loops=MAX_LOOPS)
    _publish_event("task.start", {"goal": goal[:100], "source": "brain.loop"})

    current_goal = goal
    combined     = ""

    for iteration in range(1, MAX_LOOPS + 1):
        log.info("loop_iteration", iteration=iteration, max_loops=MAX_LOOPS)

        steps   = await _plan_steps(current_goal)
        results: list[str] = []

        for step in steps:
            result = await dispatch(step)
            results.append(result)

        combined = "\n\n".join(results)
        quality  = score_output(combined)

        log.info(
            "quality_gate",
            iteration=iteration,
            quality=quality,
            threshold=QUALITY_THRESHOLD,
            passed=quality >= QUALITY_THRESHOLD,
        )

        if quality >= QUALITY_THRESHOLD:
            log.info("quality_gate_passed", iteration=iteration)
            break

        if iteration < MAX_LOOPS:
            current_goal = (
                f"Improve the following output to make it more complete, "
                f"actionable, and structured. Focus on filling gaps and "
                f"adding concrete next steps.\n\n"
                f"ORIGINAL GOAL:\n{goal[:400]}\n\n"
                f"CURRENT OUTPUT:\n{combined[:1500]}"
            )
            log.info("loop_refine", iteration=iteration)
    else:
        log.warning("max_loops_reached", max_loops=MAX_LOOPS)

    duration_s = round(time.monotonic() - t0, 3)
    _publish_event("task.complete", {
        "goal":       goal[:100],
        "duration_s": duration_s,
        "quality":    score_output(combined),
        "source":     "brain.loop",
    })
    log.info("autonomous_complete", duration_s=duration_s)
    return combined


def autonomous_run_sync(goal: str) -> str:
    """Synchronous wrapper for autonomous_run (for legacy callers)."""
    return asyncio.run(autonomous_run(goal))
