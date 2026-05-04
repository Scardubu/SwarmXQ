from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Any


@dataclass
class ValidationResult:
    candidate_id: str
    approved: bool
    score: float
    reasons: list[str]
    risk: str


def validate_candidate(candidate: dict[str, Any], observation: dict[str, Any], critique: dict[str, Any]) -> dict[str, Any]:
    reasons: list[str] = []
    score = float(candidate.get("expected_gain", 0.0) or 0.0)
    risk = str(candidate.get("risk", "medium")).lower()
    delta = candidate.get("config_delta", {}) or {}

    if risk == "high":
        reasons.append("risk too high for autonomous deployment")
        score -= 0.25
    if not delta:
        reasons.append("candidate has no config delta")
        score -= 0.2
    if candidate.get("kind") == "routing" and score < 0.05:
        reasons.append("routing candidate does not outperform baseline")
    if observation.get("baseline", {}).get("success_rate", 0.0) >= 0.9 and candidate.get("kind") == "routing":
        reasons.append("baseline already strong; keep routing changes conservative")
        score -= 0.05

    approved = score >= 0.05 and risk in {"low", "medium"}
    if approved and not reasons:
        reasons.append("candidate is small, reversible, and above the deployment threshold")
    return asdict(ValidationResult(candidate_id=str(candidate.get("id", "unknown")), approved=approved, score=round(score, 3), reasons=reasons, risk=risk))
