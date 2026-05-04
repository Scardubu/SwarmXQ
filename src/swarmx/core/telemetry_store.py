"""Telemetry store adapter with aggregate and reset support.

Extends the minimal ``swarmx.telemetry.emit_event`` contract with
read-aggregate and reset operations required by the ``telemetry`` command.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from swarmx.telemetry import emit_event


def emit(runtime_home: Path, kind: str, payload: dict[str, Any]) -> None:
    """Emit a telemetry trace event."""
    emit_event(runtime_home, kind, payload)


def _trace_dir(runtime_home: Path) -> Path:
    return runtime_home / "traces"


def list_events(runtime_home: Path, *, limit: int = 100) -> list[dict[str, Any]]:
    """Return recent trace events (newest first)."""
    trace_dir = _trace_dir(runtime_home)
    if not trace_dir.exists():
        return []
    events: list[dict[str, Any]] = []
    for f in sorted(trace_dir.glob("trace-*.json"), reverse=True)[:limit]:
        try:
            events.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return events


def aggregate(runtime_home: Path) -> dict[str, Any]:
    """Return aggregate telemetry statistics across all stored events."""
    events = list_events(runtime_home, limit=10_000)
    if not events:
        return {"total_events": 0, "by_kind": {}, "first": None, "last": None}

    by_kind: dict[str, int] = {}
    for e in events:
        k = str(e.get("kind", "unknown"))
        by_kind[k] = by_kind.get(k, 0) + 1

    timestamps = [e.get("created_at") for e in events if e.get("created_at")]
    return {
        "total_events": len(events),
        "by_kind": by_kind,
        "first": min(timestamps) if timestamps else None,
        "last": max(timestamps) if timestamps else None,
    }


def reset(runtime_home: Path) -> int:
    """Delete all stored trace events. Returns the count of deleted files."""
    trace_dir = _trace_dir(runtime_home)
    if not trace_dir.exists():
        return 0
    deleted = 0
    for f in list(trace_dir.glob("trace-*.json")):
        try:
            f.unlink()
            deleted += 1
        except Exception:
            pass
    return deleted


__all__ = ["emit", "list_events", "aggregate", "reset"]
