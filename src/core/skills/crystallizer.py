"""
SkillCrystallizer — detects high-frequency sub-task patterns and proposes
their extraction into reusable skill templates.

Pattern detection uses normalized task fingerprints (intent + tool sequence hash).
When a fingerprint exceeds CRYSTALLIZATION_THRESHOLD across distinct missions,
a skill template proposal is generated and submitted to the evolution loop via
the standard adversarial critique + policy gate (``apply_proposals``).
"""
from __future__ import annotations

import hashlib
import json
import logging
from collections import Counter
from dataclasses import dataclass, field
from typing import Any, Callable

logger = logging.getLogger(__name__)

CRYSTALLIZATION_THRESHOLD: int = 3   # distinct missions before proposing
MIN_SUCCESS_RATE: float = 0.75       # must have succeeded ≥75 % of the time


@dataclass
class TaskFingerprint:
    intent_hash: str
    tool_sequence: list[str]
    avg_duration_ms: float
    success_rate: float
    example_missions: list[str] = field(default_factory=list)

    @property
    def key(self) -> str:
        return f"{self.intent_hash}:{':'.join(self.tool_sequence)}"


class SkillCrystallizer:
    """
    Detects recurring sub-task patterns across missions and proposes extraction
    into versioned skill templates.

    ``propose_fn`` is the hook that routes each proposal through the standard
    SwarmX evolution gate (critique pipeline + policy gate).  Pass
    ``apply_proposals`` from ``swarmx.evolver`` — or any callable with the
    same contract — at construction time.
    """

    def __init__(
        self,
        propose_fn: Callable[..., list[dict[str, Any]]],
    ) -> None:
        self.propose = propose_fn  # routes through critique pipeline + policy gate

    # ------------------------------------------------------------------
    # Fingerprinting
    # ------------------------------------------------------------------

    def _fingerprint_task(self, task: dict[str, Any]) -> str:
        """Normalize and hash a task's intent + tool usage."""
        normalized = {
            "intent": task.get("intent", "").lower().strip(),
            "tools": sorted(task.get("tools_used", [])),
        }
        return hashlib.sha256(
            json.dumps(normalized, sort_keys=True).encode()
        ).hexdigest()[:16]

    # ------------------------------------------------------------------
    # Analysis
    # ------------------------------------------------------------------

    def analyze(self, recent_missions: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """
        Scan *recent_missions* for recurring task patterns.

        Returns a list of skill template proposal dicts ready for the evolution
        gate. Only patterns that appear in at least CRYSTALLIZATION_THRESHOLD
        distinct missions AND have a success rate ≥ MIN_SUCCESS_RATE are
        proposed.
        """
        fingerprint_counts: Counter[str] = Counter()
        fingerprint_data: dict[str, list[dict[str, Any]]] = {}

        for mission in recent_missions:
            seen_in_mission: set[str] = set()
            for task in mission.get("completed_tasks", []):
                fp = self._fingerprint_task(task)
                # Count each fingerprint once per mission to measure breadth
                if fp not in seen_in_mission:
                    fingerprint_counts[fp] += 1
                    seen_in_mission.add(fp)
                fingerprint_data.setdefault(fp, []).append(
                    {
                        "task": task,
                        "mission_id": mission.get("id", "unknown"),
                        "outcome": task.get("outcome", "UNKNOWN"),
                        "duration_ms": task.get("duration_ms", 0),
                    }
                )

        proposals: list[dict[str, Any]] = []
        for fp, mission_count in fingerprint_counts.items():
            if mission_count < CRYSTALLIZATION_THRESHOLD:
                continue

            examples = fingerprint_data[fp]
            total = len(examples)
            success_rate = (
                sum(1 for e in examples if e["outcome"] == "SUCCESS") / total
            )

            if success_rate < MIN_SUCCESS_RATE:
                logger.info(
                    "[CRYSTALLIZE] Skipping %s: success_rate=%.2f below threshold",
                    fp,
                    success_rate,
                )
                continue

            sample_task = examples[0]["task"]
            avg_duration = sum(e["duration_ms"] for e in examples) / total
            observed_missions = list(
                {e["mission_id"] for e in examples}  # deduplicated
            )

            proposal: dict[str, Any] = {
                "type": "SKILL_CRYSTALLIZATION",
                "skill_name": f"auto_skill_{fp[:8]}",
                "description": sample_task.get("intent", "auto-generated skill"),
                "tool_sequence": sample_task.get("tools_used", []),
                "avg_duration_ms": avg_duration,
                "success_rate": success_rate,
                "observed_in_missions": observed_missions,
                "template": self._generate_template(sample_task),
                # Fields required by the standard EvolutionProposal path
                "scope": "skills",
                "reason": (
                    f"Pattern '{sample_task.get('intent', fp)}' observed in "
                    f"{mission_count} missions with {success_rate:.0%} success rate."
                ),
                "risk": "low",
                "patch": {
                    "skills": {
                        "crystallized": {
                            fp[:8]: {
                                "name": f"auto_skill_{fp[:8]}",
                                "description": sample_task.get("intent", ""),
                                "tools": sample_task.get("tools_used", []),
                                "success_rate": round(success_rate, 3),
                                "avg_duration_ms": round(avg_duration, 1),
                                "source": "crystallized",
                                "status": "proposed",
                                "template": self._generate_template(sample_task),
                            }
                        }
                    }
                },
            }
            proposals.append(proposal)
            logger.info(
                "[CRYSTALLIZE] Proposing skill: %s (seen in %d missions, success=%s)",
                proposal["skill_name"],
                mission_count,
                f"{success_rate:.0%}",
            )

        return proposals

    def _generate_template(self, task: dict[str, Any]) -> dict[str, Any]:
        return {
            "version": "1.0",
            "intent_pattern": task.get("intent", ""),
            "tools": task.get("tools_used", []),
            "parameters": task.get("parameters", {}),
            "success_criteria": task.get("success_criteria", "outcome == SUCCESS"),
        }

    # ------------------------------------------------------------------
    # Run
    # ------------------------------------------------------------------

    def run(
        self,
        recent_missions: list[dict[str, Any]],
        *,
        runtime_dir: Any = None,
        auto_apply: bool = False,
        cfg: Any = None,
    ) -> int:
        """
        Full crystallization pass.  Call at the end of each Evolve stage.

        Analyzed patterns that exceed the threshold are converted to
        EvolutionProposal objects and submitted through ``propose_fn``
        (the standard critique + policy gate).

        Returns the number of proposals submitted.
        """
        raw_proposals = self.analyze(recent_missions)
        if not raw_proposals:
            return 0

        # Convert raw dicts to EvolutionProposal objects so they traverse the
        # same gate as all other evolution proposals.
        try:
            import secrets
            from datetime import datetime, timezone

            from swarmx.evolver import _proposal_id  # type: ignore[import]
            from swarmx.state import EvolutionProposal  # type: ignore[import]

            evolution_proposals = [
                EvolutionProposal(
                    id=_proposal_id("skill-crystallization"),
                    created_at=datetime.now(timezone.utc).isoformat(),
                    scope=p.get("scope", "skills"),
                    reason=p.get("reason", ""),
                    patch=p.get("patch", {}),
                    risk=p.get("risk", "low"),
                    score=0.80,
                )
                for p in raw_proposals
            ]
            self.propose(evolution_proposals, runtime_dir=runtime_dir, auto_apply=auto_apply, cfg=cfg)
        except Exception as exc:
            # [V6.1-FIX-12] Non-critical path: swallow submission errors and still
            # return the analyzed count so callers know how many patterns were found.
            logger.warning("[CRYSTALLIZE] Proposal submission failed: %s", exc)

        return len(raw_proposals)
