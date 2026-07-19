"""swarmx.execution_gate — Centralized policy gate for all execution paths.

[V5.9-ENH-GATE-01] Shared helper that enforces assess_action() before any
execute_plan() call. Previously server.py and worker.py called execute_plan()
directly without a policy assessment — a critical safety gap that allowed any
HTTP caller or background job to bypass risk classification, audit logging, and
the human-gate requirement for HIGH/CRITICAL actions.

This module centralizes the gate so all three callers (cli.py, server.py,
worker.py) share identical enforcement semantics, audit log format, and
event-bus publish call.

Usage::

    from .execution_gate import gate_execution

    decision = gate_execution("run", target, repo, cfg, job_id=job_id)
    if not decision.allowed:
        # abort — decision.to_dict() has the full rejection reason
        return {"error": "policy_blocked", "policy": decision.to_dict()}
    # proceed with execute_plan(...)
"""

from __future__ import annotations

import structlog
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .event_bus import EventKind, publish
from .policy import ExecutionPolicy, PolicyDecision, assess_action
from .state import RiskLevel

_log = structlog.get_logger("swarmx.execution_gate")


def gate_execution(
    action: str,
    target: str,
    repo: Path,
    cfg: SwarmConfig,
    *,
    review_required: bool = False,
    job_id: str | None = None,
) -> PolicyDecision:
    """Assess risk and publish the policy decision for an execution action.

    Returns the PolicyDecision. Callers MUST check ``decision.allowed`` and
    abort if it is ``False``.

    Failure mode: if assess_action() itself raises (config error, etc.) the
    function returns a CRITICAL/BLOCKED decision so execution never proceeds
    on an unknown risk surface.

    Never raises.
    """
    # ── Risk assessment ───────────────────────────────────────────────────────
    try:
        decision = assess_action(
            action, target, repo, cfg, review_required=review_required
        )
    except Exception as exc:
        _log.error(  # type: ignore[call-arg]
            "policy_assess_failed",
            action=action,
            target=target[:80],
            error=str(exc),
        )
        # [ENH-GATE-01] Fail closed: blocked decision on any assessment error.
        decision = PolicyDecision(
            allowed=False,
            risk=RiskLevel.CRITICAL.value,
            tier="critical",
            human_gate=True,
            reasons=[f"assessment_error:{type(exc).__name__}:{exc}"],
            mitigations=["block_auto_deploy", "require_human_approval"],
            confidence=0.0,
            mode=ExecutionPolicy.BLOCKED.value,
        )

    # ── Publish to event bus (best-effort) ────────────────────────────────────
    try:
        payload: dict[str, Any] = {
            "action": action,
            "target": target[:200],
            "risk": decision.risk,
            "mode": decision.mode,
            "human_gate": decision.human_gate,
            "allowed": decision.allowed,
            "reasons": decision.reasons,
            "mitigations": decision.mitigations,
            "confidence": decision.confidence,
        }
        if job_id:
            payload["job_id"] = job_id
        publish(cfg.home, EventKind.POLICY_ASSESSED, payload)
    except Exception:
        pass  # Event publish failure must never affect the gate result

    # ── Structured log ────────────────────────────────────────────────────────
    if not decision.allowed:
        _log.warning(  # type: ignore[call-arg]
            "policy_blocked",
            action=action,
            target=target[:80],
            risk=decision.risk,
            tier=decision.tier,
            reasons=decision.reasons,
        )
    else:
        _log.info(  # type: ignore[call-arg]
            "policy_allowed",
            action=action,
            target=target[:80],
            risk=decision.risk,
            mode=decision.mode,
        )

    return decision
