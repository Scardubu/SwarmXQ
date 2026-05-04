"""
DivergentProposer — generates K=3 proposals per evolution cycle using distinct
cognitive stances (conservative, aggressive, lateral), runs each through the
adversarial critique pipeline, and selects the Pareto-optimal survivor based on
(improvement_delta × confidence) / (1 + risk_score).

Integration contract
--------------------
- ``llm_client`` must expose ``complete(system, user, temperature) -> str``
  where the return value is a JSON-encoded dict.
- ``critique_pipeline`` must expose
  ``evaluate(proposal, mission_id, recent_missions, policy_rules)
  -> tuple[bool, str]``
  matching the ``CritiquePipeline.evaluate`` signature in
  ``src/swarmx/evolution/critique_pipeline.py``.
- ``base_system_prompt`` is prepended to each stance-specific suffix before
  the LLM call; it should describe the expected output JSON schema.
"""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stance configuration
# ---------------------------------------------------------------------------

STANCES: dict[str, dict[str, Any]] = {
    "conservative": {
        "temperature": 0.1,
        "system_suffix": (
            "Be incremental. Prefer small, safe, reversible changes. "
            "Each patch field must be independently rollback-safe."
        ),
    },
    "aggressive": {
        "temperature": 0.8,
        "system_suffix": (
            "Be bold. Propose the most impactful change you can justify. "
            "Prioritize maximum measurable improvement even if it requires "
            "restructuring defaults."
        ),
    },
    "lateral": {
        "temperature": 0.6,
        "system_suffix": (
            "Think sideways. Consider non-obvious improvements — different "
            "abstractions, architectural shifts, or analogies from unrelated "
            "domains. Avoid repeating what a conservative or aggressive stance "
            "would produce."
        ),
    },
}

# Required by the LLM: proposals must embed these three scoring fields so the
# Pareto calculation is deterministic regardless of which stance produces them.
_SCHEMA_HINT = (
    "\n\nReturn ONLY valid JSON with AT MINIMUM these fields:\n"
    "{\n"
    '  "scope": "<str>",\n'
    '  "reason": "<str>",\n'
    '  "patch": {<dict>},\n'
    '  "risk": "low" | "medium" | "high",\n'
    '  "estimated_improvement_delta": <float, 0.0–1.0>,\n'
    '  "confidence": <float, 0.0–1.0>,\n'
    '  "risk_score": <float, 0.0–1.0>\n'
    "}\n"
    "No markdown, no preamble. JSON only."
)

# ---------------------------------------------------------------------------
# Protocols — keep DivergentProposer decoupled from concrete implementations
# ---------------------------------------------------------------------------


@runtime_checkable
class _LLMClient(Protocol):
    def complete(self, system: str, user: str, temperature: float = 0.1) -> str: ...


@runtime_checkable
class _CritiquePipeline(Protocol):
    def evaluate(
        self,
        proposal: dict[str, Any],
        mission_id: str,
        recent_missions: list[dict[str, Any]],
        policy_rules: list[str],
    ) -> tuple[bool, str]: ...


# ---------------------------------------------------------------------------
# Data classes
# ---------------------------------------------------------------------------


@dataclass
class RankedProposal:
    """A critique-approved proposal annotated with its Pareto score."""

    stance: str
    proposal: dict[str, Any]
    improvement_delta: float
    confidence: float
    risk_score: float

    @property
    def pareto_score(self) -> float:
        """Higher is better.  Penalizes risk non-linearly (1 + risk_score divisor)."""
        return (self.improvement_delta * self.confidence) / (1.0 + self.risk_score)


# ---------------------------------------------------------------------------
# DivergentProposer
# ---------------------------------------------------------------------------


class DivergentProposer:
    """
    Generate K=3 proposals per cycle (conservative / aggressive / lateral),
    run each through the adversarial critique pipeline, and return the
    Pareto-optimal survivor.

    Parameters
    ----------
    llm_client:
        LLM adapter with a ``complete(system, user, temperature) -> str``
        interface.  SwarmX's ``_LLMClientAdapter`` satisfies this.
    critique_pipeline:
        Critique gate with an ``evaluate(proposal, mission_id,
        recent_missions, policy_rules) -> (bool, str)`` interface.
        SwarmX's ``CritiquePipeline`` satisfies this.
    base_system_prompt:
        Shared preamble describing the swarm, the evolution objective, and
        the required JSON output schema.  A stance-specific suffix is
        appended before each call.
    """

    def __init__(
        self,
        llm_client: _LLMClient,
        critique_pipeline: _CritiquePipeline,
        base_system_prompt: str,
    ) -> None:
        self.llm = llm_client
        self.critique = critique_pipeline
        self.base_prompt = base_system_prompt

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def generate_proposals(
        self,
        evolution_context: dict[str, Any],
        mission_id: str,
        recent_missions: list[dict[str, Any]],
        policy_rules: list[str],
    ) -> RankedProposal | None:
        """
        Generate K proposals, critique each, return the Pareto-optimal survivor.

        Returns ``None`` if all proposals are rejected or fail JSON parsing.
        Each approved proposal is logged with its Pareto score so the selection
        rationale is auditable.
        """
        survivors: list[RankedProposal] = []

        for stance_name, stance_cfg in STANCES.items():
            system = self.base_prompt + _SCHEMA_HINT + "\n\n" + stance_cfg["system_suffix"]
            try:
                raw = self.llm.complete(
                    system=system,
                    user=json.dumps(evolution_context, default=str),
                    temperature=float(stance_cfg["temperature"]),
                )
            except Exception as exc:
                logger.warning("[DIVERGENT] %s LLM call failed: %s", stance_name, exc)
                continue

            try:
                proposal = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                logger.warning("[DIVERGENT] %s proposal failed JSON parse; raw=%r", stance_name, raw[:120])
                continue

            if not isinstance(proposal, dict):
                logger.warning("[DIVERGENT] %s returned non-dict JSON; skipping", stance_name)
                continue

            try:
                approved, reason = self.critique.evaluate(
                    proposal=proposal,
                    mission_id=mission_id,
                    recent_missions=recent_missions,
                    policy_rules=policy_rules,
                )
            except Exception as exc:
                logger.warning("[DIVERGENT] %s critique raised: %s", stance_name, exc)
                continue

            if not approved:
                logger.info("[DIVERGENT] %s rejected: %s", stance_name, reason)
                continue

            ranked = RankedProposal(
                stance=stance_name,
                proposal=proposal,
                improvement_delta=float(proposal.get("estimated_improvement_delta") or 1.0),
                confidence=float(proposal.get("confidence") or 0.5),
                risk_score=float(proposal.get("risk_score") or 0.5),
            )
            survivors.append(ranked)
            logger.info(
                "[DIVERGENT] %s approved — pareto_score=%.3f",
                stance_name,
                ranked.pareto_score,
            )

        if not survivors:
            logger.info("[DIVERGENT] All proposals rejected this cycle")
            return None

        best = max(survivors, key=lambda r: r.pareto_score)
        logger.info(
            "[DIVERGENT] Selected: %s (pareto=%.3f, delta=%.2f, conf=%.2f, risk=%.2f)",
            best.stance,
            best.pareto_score,
            best.improvement_delta,
            best.confidence,
            best.risk_score,
        )
        return best
