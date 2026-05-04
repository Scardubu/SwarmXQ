"""
src/swarmx/event_bus — SwarmX V5.8 Event Bus
=============================================
Thin publish/subscribe layer over the JSONL journal.  Provides typed event
kind constants, a structured publish() function, and snapshot utilities.

CHANGES FROM LEGACY VERSION:
  [ENH-01] EventKind constants class added — callers use `EventKind.TASK_START`
           instead of bare strings, preventing typo-driven event kind drift.
  [ENH-02] publish() validates the kind against known constants in debug mode
           (SWARMX_EVENT_STRICT=1) and warns rather than crashes in production.
  [ENH-03] subscribe() generator added — yields events matching a kind filter
           from the journal without loading the full history into RAM.
  [ENH-04] snapshot() extended with per-kind latency stats when events carry
           a 'duration_s' payload field.
  [FIX-01] recent() and snapshot() propagate limit correctly to load_events()
           — the legacy call had no limit parameter guard.
"""
from __future__ import annotations

import os
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Generator, Optional

from .journal import append_event, load_events


# ── Typed event kind constants ─────────────────────────────────────────────────

class EventKind:
    """Canonical event kind strings used across the SwarmX bus."""

    # Task lifecycle
    TASK_START      = "task.start"
    TASK_COMPLETE   = "task.complete"
    TASK_FAILED     = "task.failed"
    TASK_CANCELLED  = "task.cancelled"

    # Step lifecycle
    STEP_START      = "step.start"
    STEP_COMPLETE   = "step.complete"
    STEP_RETRY      = "step.retry"
    STEP_FAILED     = "step.failed"

    # Tool dispatch
    TOOL_CALL       = "tool.call"
    TOOL_RESULT     = "tool.result"
    TOOL_ERROR      = "tool.error"
    TOOL_CB_OPEN    = "tool.circuit_breaker.open"

    # Memory
    MEMORY_STORE    = "memory.store"
    MEMORY_COMPRESS = "memory.compress"

    # Evolution
    EVOLUTION_PROPOSAL  = "evolution.proposal"
    EVOLUTION_APPROVED  = "evolution.approved"
    EVOLUTION_REJECTED  = "evolution.rejected"
    EVOLUTION_DELTA     = "evolution.delta"

    # System
    HEALTH_CHECK    = "system.health_check"
    CONFIG_RELOAD   = "system.config_reload"
    ESCALATION      = "system.escalation"

    # Audit
    AUDIT_FLAG      = "audit.flag"
    POLICY_BLOCK    = "audit.policy_block"

    @classmethod
    def all_kinds(cls) -> frozenset[str]:
        return frozenset(
            v for k, v in vars(cls).items()
            if not k.startswith("_") and isinstance(v, str)
        )


_STRICT = os.environ.get("SWARMX_EVENT_STRICT", "0") == "1"


# ── Core API ──────────────────────────────────────────────────────────────────

def publish(
    runtime_home: Path,
    kind: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Publish an event to the journal.

    In strict mode (SWARMX_EVENT_STRICT=1), raises ValueError for unknown kinds.
    In production mode, unknown kinds are published with a warning prefix.
    """
    if kind not in EventKind.all_kinds():
        if _STRICT:
            raise ValueError(
                f"Unknown event kind '{kind}'. Use EventKind constants."
            )
        # Soft warning — never crash the calling agent
        payload = {"_unknown_kind_warning": True, **payload}

    append_event(runtime_home, kind, payload)
    return {"kind": kind, "payload": payload}


def recent(
    runtime_home: Path,
    limit: int = 100,
    *,
    kind_filter: Optional[str] = None,
) -> list[dict[str, Any]]:
    """
    Return the most recent `limit` events, optionally filtered by kind.
    """
    events = load_events(runtime_home, limit=limit if kind_filter is None else limit * 4)
    if kind_filter:
        events = [e for e in events if e.get("kind") == kind_filter]
    return events[-limit:]


def subscribe(
    runtime_home: Path,
    *,
    kind: Optional[str] = None,
    limit: int = 500,
) -> Generator[dict[str, Any], None, None]:
    """
    Generator that yields events matching `kind` (or all if kind is None).
    Loads from the journal — not a live stream; use for post-run analysis.
    """
    for event in load_events(runtime_home, limit=limit):
        if kind is None or event.get("kind") == kind:
            yield event


def snapshot(
    runtime_home: Path,
    limit: int = 200,
) -> dict[str, Any]:
    """
    Return a compact summary of recent bus activity, with per-kind stats.
    """
    events = load_events(runtime_home, limit=limit)
    kinds  = Counter(str(e.get("kind") or "unknown") for e in events)

    # Per-kind latency stats (when duration_s is present in payload)
    latency: dict[str, list[float]] = defaultdict(list)
    for e in events:
        payload = e.get("payload") or {}
        d = payload.get("duration_s")
        if isinstance(d, (int, float)):
            latency[str(e.get("kind", "unknown"))].append(float(d))

    latency_stats: dict[str, dict[str, float]] = {}
    for k, vals in latency.items():
        if vals:
            latency_stats[k] = {
                "count":  len(vals),
                "mean_s": round(sum(vals) / len(vals), 3),
                "max_s":  round(max(vals), 3),
            }

    return {
        "count":         len(events),
        "kinds":         dict(kinds),
        "latency_stats": latency_stats,
        "recent":        events[-20:],
    }


__all__ = [
    "EventKind",
    "publish",
    "recent",
    "subscribe",
    "snapshot",
]