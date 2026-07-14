"""
brain/utils — SwarmX V5.8 Brain Utilities
==========================================
Shared helpers for the brain/ subsystem.

NOTE: `detect_role` is intentionally NOT defined here.  The canonical
implementation lives in brain.dispatcher.classify() and brain.router.detect_intent().
Duplicating it here caused inconsistent routing depending on import order.

CHANGES FROM LEGACY VERSION:
  [FIX-01] Removed duplicate `detect_role` stub — callers should use
           `brain.dispatcher.classify` or `brain.router.detect_intent`.
  [ENH-01] `chunk_tasks` is now an async generator (compatible with the
           V5.8 async loop) as well as a sync generator.
  [ENH-02] `flatten_results` added: collapses nested step result dicts
           to a single string summary for reflection/memory storage.
  [ENH-03] `truncate` helper added: safe length-bounded string trimming.
"""
from __future__ import annotations

from collections.abc import AsyncGenerator, Generator
from typing import Any


def chunk_tasks(tasks: list[Any], size: int = 3) -> Generator[list[Any], None, None]:
    """Yield successive `size`-length chunks from `tasks` (synchronous)."""
    for i in range(0, len(tasks), size):
        yield tasks[i : i + size]


async def chunk_tasks_async(
    tasks: list[Any], size: int = 3
) -> AsyncGenerator[list[Any], None]:
    """Async generator variant of chunk_tasks for use inside async for loops."""
    for i in range(0, len(tasks), size):
        yield tasks[i : i + size]


def flatten_results(results: list[Any]) -> str:
    """
    Collapse a list of step results into a single string summary.

    Handles: plain strings, dicts with a 'result' key, and arbitrary objects.
    Suitable for passing to brain.memory.store() or brain.reflector.reflect().
    """
    parts: list[str] = []
    for item in results:
        if isinstance(item, str):
            parts.append(item)
        elif isinstance(item, dict):
            parts.append(str(item.get("result", item)))
        else:
            parts.append(str(item))
    return "\n\n".join(parts)


def truncate(text: str, max_chars: int = 500) -> str:
    """Return `text` truncated to `max_chars` with an ellipsis suffix."""
    if len(text) <= max_chars:
        return text
    return text[: max_chars - 3] + "..."


__all__ = [
    "chunk_tasks",
    "chunk_tasks_async",
    "flatten_results",
    "truncate",
]
