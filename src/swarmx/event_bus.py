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

CHANGES V5.9 (this revision):
  [FIX-02] SWARMX_EVENT_STRICT=1 now prints to stderr instead of raising
           ValueError. Raising crashed calling agents — a telemetry enforcement
           mechanism must never interrupt execution. Unknown kinds are now
           clearly flagged to stderr and logged at WARNING, not silently
           injected into the payload.
  [FIX-03] Non-strict unknown-kind handling changed from silent payload
           mutation (`_unknown_kind_warning: True`) to a logger.warning() call.
           Silent payload mutations are invisible and confusing; a log line is
           actionable.
  [FIX-04] _STRICT env var is re-read inside publish() via os.environ.get()
           instead of at module import time. This allows test fixtures to set
           SWARMX_EVENT_STRICT=1 after import without reloading the module.
"""
from __future__ import annotations

import logging
import os
import sys
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Generator, Optional

from .journal import append_event, load_events

_log = logging.getLogger(__name__)


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
    # [NEW] IEP invariant hard-block event
    EVOLUTION_BLOCKED_IEP = "evolution.blocked.iep"

    # System
    HEALTH_CHECK    = "system.health_check"
    CONFIG_RELOAD   = "system.config_reload"
    ESCALATION      = "system.escalation"

    # Run lifecycle (canonical names — executor.py was using underscored variants)
    RUN_START    = "run.start"
    RUN_COMPLETE = "run.complete"
    REFINEMENT_PASS = "run.refinement_pass"

    # Audit
    AUDIT_FLAG      = "audit.flag"
    POLICY_BLOCK    = "audit.policy_block"

    # Governance (APEX-17 pressure state machine)
    # [V5.9-ENH-05] Pressure level transitions and governor snapshots
    PRESSURE_STATE_CHANGE  = "governance.pressure_state_change"
    GOVERNANCE_SNAPSHOT    = "governance.snapshot"

    # [V5.9-FIX-04] Worker job lifecycle — previously published as bare strings
    # which triggered strict-mode warnings on every job. Now canonical constants.
    WORKER_JOB_STARTED = "worker.job_started"
    WORKER_JOB_DONE    = "worker.job_done"
    WORKER_JOB_ERROR   = "worker.job_error"

    # [V5.9-FIX-04] Mission lifecycle — published by cli.py run() and worker.py
    MISSION_CREATED    = "mission.created"

    # [V5.9-FIX-04] Policy/governance events — published during run/evolve gates
    POLICY_ASSESSED    = "policy.assessed"

    # [V5.9-FIX-04] Run lifecycle aliases — cli.py uses run.started/run.completed
    # (distinct from the executor's run.start/run.complete for granularity parity)
    RUN_STARTED        = "run.started"
    RUN_COMPLETED      = "run.completed"

    # [V5.9-FIX-04] Evolution job lifecycle — published by cli.py evolve()
    EVOLUTION_STARTED  = "evolution.started"
    EVOLUTION_COMPLETED = "evolution.completed"

    @classmethod
    def all_kinds(cls) -> frozenset[str]:
        return frozenset(
            v for k, v in vars(cls).items()
            if not k.startswith("_") and isinstance(v, str)
        )


# ── Core API ──────────────────────────────────────────────────────────────────

def publish(
    runtime_home: Path,
    kind: str,
    payload: dict[str, Any],
) -> dict[str, Any]:
    """
    Publish an event to the journal.

    In strict mode (SWARMX_EVENT_STRICT=1), unknown kinds are printed to
    stderr and logged at WARNING — they are NOT raised as exceptions.
    A telemetry enforcement mechanism must never interrupt agent execution.

    In production mode (default), unknown kinds produce a logger.warning()
    call only. The payload is never silently mutated.

    [FIX-02] Re-reads env var on each call so test fixtures work without
    module reload.
    [FIX-03] Removes silent payload mutation in non-strict mode.
    """
    strict = os.environ.get("SWARMX_EVENT_STRICT", "0") == "1"

    if kind not in EventKind.all_kinds():
        msg = (
            f"[swarmx:event_bus] Unknown event kind '{kind}'. "
            f"Use EventKind constants. Known kinds: {sorted(EventKind.all_kinds())}"
        )
        if strict:
            # Print to stderr — visible in all environments, never crashes agents
            print(f"SWARMX_EVENT_STRICT: {msg}", file=sys.stderr)
        _log.warning(msg)
        # Do NOT mutate payload — publish the event as-is so the data is preserved

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