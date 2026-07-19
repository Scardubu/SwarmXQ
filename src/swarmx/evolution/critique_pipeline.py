"""Critique pipeline that orchestrates Critic, RedTeam, code-diagnose, and delta-driven learning before policy gate."""

from __future__ import annotations

import structlog
from pathlib import Path
from typing import Any

from ..storage import payload_sha256, write_audit_log
from .critic_agent import CriticAgent, CriticVerdict
from .redteam_agent import RedTeamAgent, RedTeamVerdict

logger = structlog.get_logger("swarmx.evolution.critique_pipeline")

SEVERITY_BLOCK = {"HIGH", "CRITICAL"}

# ── Delta-driven learning constants ──────────────────────────────────────────

DELTA_SKILL_TRIGGERS = {
    "code-diagnose":        ["root_cause_confirmed", "hypothesis_eliminated", "blast_radius_high"],
    "grill-with-docs":      ["assumption_contradicted", "undocumented_surface", "deprecated_api"],
    "zoom-out":             ["mission_drift_detected", "max_iterations_reached", "assumption_debt_high"],
    "dynamic-team-factory": ["fitness_below_threshold", "handoff_failure", "pattern_underperforming"],
}


def _detect_skill_trigger(proposal: dict) -> list[str]:
    """Scan a proposal's evidence and findings for skill activation triggers."""
    text = str(proposal).lower()
    triggered = []
    for skill, keywords in DELTA_SKILL_TRIGGERS.items():
        if any(kw.replace("_", " ") in text for kw in keywords):
            triggered.append(skill)
    return triggered


def _build_delta(proposal: dict, critic_verdict: Any, redteam_verdict: Any) -> dict:
    """Capture structured delta for the evolution loop memory graph."""
    return {
        "proposal_id": proposal.get("id", "unknown"),
        "critic_severity": getattr(critic_verdict, "severity", "UNKNOWN"),
        "redteam_severity": getattr(redteam_verdict, "severity", "UNKNOWN"),
        "triggered_skills": _detect_skill_trigger(proposal),
        "fitness_axes": proposal.get("scoring", {}),
        "composite_score": proposal.get("composite_score", 0.0),
        "delta_action": "promote" if proposal.get("composite_score", 0) >= 0.72 else "hold",
        "evolution_signal": None,  # populated after convergence check
    }


class CritiquePipeline:
    """Evaluate proposal via Critic, RedTeam, then policy gate."""

    def __init__(
        self,
        critic: CriticAgent,
        red_team: RedTeamAgent,
        policy_engine: Any,
        runtime_dir: Path | None = None,
    ):
        self.critic = critic
        self.red_team = red_team
        self.policy = policy_engine
        self.runtime_dir = runtime_dir
        self.last_delta: dict | None = None          # NEW: expose delta for evolution loop
        self.last_improvement_brief: dict[str, Any] | None = None

    def _audit(
        self,
        *,
        mission_id: str,
        actor: str,
        action: str,
        proposal: dict[str, Any],
        notes: str,
        risk_score: float | None = None,
    ) -> None:
        if self.runtime_dir is None:
            return
        write_audit_log(
            self.runtime_dir,
            mission_id=mission_id,
            stage="Evolution",
            actor=actor,
            action=action,
            payload_sha=payload_sha256(proposal),
            risk_score=risk_score,
            notes=notes,
        )

    def _emit_delta(self, delta: dict, mission_id: str) -> None:
        """Write the delta to the audit trail and expose it on self.last_delta."""
        if self.runtime_dir is None:
            self.last_delta = delta
            return
        write_audit_log(
            self.runtime_dir,
            mission_id=mission_id,
            stage="CritiquePipeline.delta",
            actor="delta_capture",
            action="DELTA_RECORDED",
            payload_sha=payload_sha256(delta),
            risk_score=0.0,
            notes=f"triggered_skills={delta['triggered_skills']} action={delta['delta_action']}",
        )
        self.last_delta = delta

    def evaluate(
        self,
        proposal: dict[str, Any],
        mission_id: str,
        recent_missions: list[dict[str, Any]],
        policy_rules: list[str],
    ) -> tuple[bool, str]:
        """Return (approved, reason) and record full audit trail."""
        self.last_improvement_brief = None

        critic_verdict: CriticVerdict = self.critic.evaluate(proposal, recent_missions)
        logger.info("critique_critic_verdict", decision=critic_verdict.decision, improvement_delta_pct=round(critic_verdict.improvement_delta, 1))

        if critic_verdict.decision in {"REJECT", "REVISE"}:
            self.last_improvement_brief = {
                "source": "critic_agent",
                "decision": critic_verdict.decision,
                "reasoning": critic_verdict.reasoning,
                "improvement_brief": critic_verdict.improvement_brief
                or "Address consistency, safety, and reversibility concerns before resubmission.",
            }
            self._audit(
                mission_id=mission_id,
                actor="critic_agent",
                action="PROPOSAL_REJECTED",
                proposal=proposal,
                notes=critic_verdict.reasoning,
                risk_score=1.0 - max(0.0, min(critic_verdict.confidence, 1.0)),
            )
            return False, f"Critic rejected: {critic_verdict.reasoning}"

        rt_verdict: RedTeamVerdict = self.red_team.attack(proposal, policy_rules)
        logger.info("critique_redteam_verdict", decision=rt_verdict.decision, severity=rt_verdict.severity)

        if rt_verdict.decision == "FAIL" and rt_verdict.severity in SEVERITY_BLOCK:
            scenario = rt_verdict.failure_scenario or rt_verdict.reasoning
            self.last_improvement_brief = {
                "source": "redteam_agent",
                "decision": "REJECT",
                "attack_vector": rt_verdict.attack_vector,
                "failure_scenario": scenario,
                "severity": rt_verdict.severity,
                "improvement_brief": "Mitigate the documented failure scenario and provide rollback safeguards.",
            }
            self._audit(
                mission_id=mission_id,
                actor="redteam_agent",
                action="PROPOSAL_BLOCKED",
                proposal=proposal,
                notes=f"{rt_verdict.attack_vector}: {scenario}",
                risk_score=1.0,
            )
            return False, f"Red-team blocked (severity={rt_verdict.severity}): {scenario}"

        policy_approved, policy_reason = self.policy.evaluate(proposal)
        self._audit(
            mission_id=mission_id,
            actor="policy_engine",
            action="POLICY_APPROVED" if policy_approved else "POLICY_REJECTED",
            proposal=proposal,
            notes=policy_reason,
            risk_score=0.2 if policy_approved else 0.8,
        )

        return policy_approved, policy_reason

    def run(
        self,
        proposal: dict[str, Any],
        mission_id: str,
        recent_missions: list[dict[str, Any]] | None = None,
        policy_rules: list[str] | None = None,
    ) -> dict[str, Any]:
        """Critic → RedTeam → delta capture → policy gate. Returns a rich result dict.

        APEX-16 richer interface. Callers should store
        ``result["delta"]["triggered_skills"]`` in the memory graph and use
        ``result["delta"]["evolution_signal"]`` to gate next-stage skill invocation.
        """
        self.last_improvement_brief = None
        recent_missions = recent_missions or []
        policy_rules = policy_rules or []

        critic_verdict: CriticVerdict = self.critic.evaluate(proposal, recent_missions)
        logger.info(
            "[CRITIQUE/run] Critic: %s (delta=%.1f%%)",
            critic_verdict.decision,
            critic_verdict.improvement_delta,
        )

        if critic_verdict.decision in {"REJECT", "REVISE"}:
            self.last_improvement_brief = {
                "source": "critic_agent",
                "decision": critic_verdict.decision,
                "reasoning": critic_verdict.reasoning,
                "improvement_brief": critic_verdict.improvement_brief
                    or "Address consistency, safety, and reversibility concerns before resubmission.",
            }
            self._audit(
                mission_id=mission_id,
                actor="critic_agent",
                action="PROPOSAL_REJECTED",
                proposal=proposal,
                notes=critic_verdict.reasoning,
                risk_score=1.0 - max(0.0, min(critic_verdict.confidence, 1.0)),
            )
            return {
                "allowed": False,
                "reason": f"Critic rejected: {critic_verdict.reasoning}",
                "critic": critic_verdict,
            }

        rt_verdict: RedTeamVerdict = self.red_team.attack(proposal, policy_rules)
        logger.info(
            "[CRITIQUE/run] RedTeam: %s severity=%s",
            rt_verdict.decision,
            rt_verdict.severity,
        )

        if rt_verdict.decision == "FAIL" and rt_verdict.severity in SEVERITY_BLOCK:
            scenario = rt_verdict.failure_scenario or rt_verdict.reasoning
            self.last_improvement_brief = {
                "source": "redteam_agent",
                "decision": "REJECT",
                "attack_vector": rt_verdict.attack_vector,
                "failure_scenario": scenario,
                "severity": rt_verdict.severity,
                "improvement_brief": "Mitigate the documented failure scenario and provide rollback safeguards.",
            }
            self._audit(
                mission_id=mission_id,
                actor="redteam_agent",
                action="PROPOSAL_BLOCKED",
                proposal=proposal,
                notes=f"{rt_verdict.attack_vector}: {scenario}",
                risk_score=1.0,
            )
            return {
                "allowed": False,
                "reason": f"RedTeam blocked (severity={rt_verdict.severity}): {scenario}",
                "redteam": rt_verdict,
            }

        # ── Delta capture (APEX-16 delta-driven learning integration) ────────
        delta = _build_delta(proposal, critic_verdict, rt_verdict)
        score = float(proposal.get("composite_score", 0.0))
        if score < 0.72 and delta["triggered_skills"]:
            delta["evolution_signal"] = "invoke_skill:" + delta["triggered_skills"][0]
        elif score >= 0.72:
            delta["evolution_signal"] = "promote"
        else:
            delta["evolution_signal"] = "hold_for_review"
        self._emit_delta(delta, mission_id)
        # ─────────────────────────────────────────────────────────────────────

        # ── Policy gate ──────────────────────────────────────────────────────
        policy_approved, policy_reason = self.policy.evaluate(proposal)
        self._audit(
            mission_id=mission_id,
            actor="policy_engine",
            action="POLICY_APPROVED" if policy_approved else "POLICY_REJECTED",
            proposal=proposal,
            notes=policy_reason,
            risk_score=0.2 if policy_approved else 0.8,
        )

        if not policy_approved:
            return {
                "allowed": False,
                "reason": f"Policy blocked: {policy_reason}",
                "policy": policy_approved,
                "delta": delta,
            }

        return {
            "allowed": True,
            "critic": critic_verdict,
            "redteam": rt_verdict,
            "delta": delta,                          # exposed to callers
            "policy": policy_approved,
            "improvement_brief": self.last_improvement_brief,
        }
