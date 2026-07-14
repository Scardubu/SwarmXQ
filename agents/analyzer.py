"""
agents/analyzer — SwarmX V5.8 Async Result Aggregator
======================================================
Aggregates multiple agent step results into a structured summary.
Replaces the legacy `analyze_output(results)` stub with an async-first
implementation that provides per-item status tracking.

CHANGES FROM LEGACY VERSION:
  [FIX-01] `analyze_output()` was a bare `"\n".join(results)` one-liner —
           no error handling, no status tracking, no structured output.
  [ENH-01] `analyze_output()` now returns a structured dict with success
           counts, errors, and a joined summary string.
  [ENH-02] `analyze_output_async()` is the async variant for use inside
           the V5.8 event loop.
"""
from __future__ import annotations

from typing import Any


def analyze_output(results: list[Any]) -> dict[str, Any]:
    """
    Aggregate a list of step results into a structured summary dict.

    Args:
        results: List of strings or dicts (step outputs).

    Returns:
        {
            "summary":    str   — joined text of all results,
            "count":      int   — total items,
            "errors":     int   — items containing error indicators,
            "success":    bool  — True if no errors detected,
        }
    """
    parts: list[str] = []
    error_count = 0

    for item in results:
        text = str(item.get("result", item)) if isinstance(item, dict) else str(item)
        parts.append(text)
        if any(e in text.lower() for e in ("error:", "exception:", "failed", "traceback")):
            error_count += 1

    summary = "\n\n".join(parts)
    return {
        "summary": summary,
        "count":   len(results),
        "errors":  error_count,
        "success": error_count == 0,
    }


async def analyze_output_async(results: list[Any]) -> dict[str, Any]:
    """Async wrapper for analyze_output.

    Aggregation is CPU-trivial and does not perform I/O, so running it directly
    avoids creating a default executor thread during tests and short-lived CLI
    invocations.
    """
    return analyze_output(results)


__all__ = ["analyze_output", "analyze_output_async"]
