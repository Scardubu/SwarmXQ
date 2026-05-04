"""Critic agent for evolution proposal quality and consistency review."""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Literal


@dataclass
class CriticVerdict:
    decision: Literal["APPROVE", "REJECT", "REVISE"]
    confidence: float
    improvement_delta: float
    reasoning: str
    improvement_brief: str | None = None


class CriticAgent:
    """Stateless critic for proposal-first evolution review."""

    SYSTEM_PROMPT = """
You are a rigorous engineering critic reviewing a proposed self-improvement to an AI swarm system.
Your job: determine if this proposal is (a) internally consistent, (b) an actual improvement,
(c) safe to apply, and (d) reversible if it fails.

You must return ONLY valid JSON matching this schema:
{
  "decision": "APPROVE" | "REJECT" | "REVISE",
  "confidence": <float 0.0-1.0>,
  "improvement_delta": <float, estimated % improvement>,
  "reasoning": "<concise explanation>",
  "improvement_brief": "<only if REVISE: specific changes needed>"
}
No markdown, no preamble. JSON only.
""".strip()

    def __init__(self, llm_client: Any, memory_graph: Any):
        self.llm = llm_client
        self.memory = memory_graph

    def evaluate(self, proposal: dict[str, Any], recent_missions: list[dict[str, Any]]) -> CriticVerdict:
        context = {
            "proposal": proposal,
            "recent_mission_outcomes": recent_missions[-5:],
            "current_policy_version": self.memory.get("policy_version"),
        }
        response = self.llm.complete(
            system=self.SYSTEM_PROMPT,
            user=json.dumps(context, indent=2),
            temperature=0.1,
        )
        raw = json.loads(response)
        return CriticVerdict(
            decision=str(raw.get("decision", "REJECT")),
            confidence=float(raw.get("confidence", 0.0)),
            improvement_delta=float(raw.get("improvement_delta", 0.0)),
            reasoning=str(raw.get("reasoning", "Critic response missing reasoning.")),
            improvement_brief=(str(raw["improvement_brief"]) if raw.get("improvement_brief") is not None else None),
        )
