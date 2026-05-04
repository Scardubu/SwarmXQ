from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Any
import os

from swarmx.config import SwarmConfig


@dataclass
class CritiqueResult:
    score: float
    severity: str
    summary: str
    issues: list[str] = field(default_factory=list)
    recommendations: list[str] = field(default_factory=list)
    model_used: str = ""
    raw_text: str = ""


def _heuristic_critique(observation: dict[str, Any]) -> CritiqueResult:
    baseline = observation.get("baseline", {}) or {}
    recent_runs = observation.get("recent_runs", []) or []
    recent_memories = observation.get("recent_memories", []) or []

    success_rate = float(baseline.get("success_rate", 0.6) or 0.6)
    p95 = float(baseline.get("p95_latency_ms", 0.0) or 0.0)
    issue_list: list[str] = []
    recommendations: list[str] = []

    if success_rate < 0.8:
        issue_list.append(f"success rate is only {success_rate:.2f}")
        recommendations.append("tighten task routing and validation gates")
    if p95 and p95 > 2500:
        issue_list.append(f"p95 latency is high at {p95:.0f} ms")
        recommendations.append("prefer the fast router path for low-complexity tasks")
    if len(recent_runs) < 3:
        issue_list.append("insufficient recent run evidence")
        recommendations.append("collect more traces before making aggressive mutations")
    if len(recent_memories) == 0:
        issue_list.append("memory surface is sparse")
        recommendations.append("store richer post-run summaries")

    score = max(0.1, min(0.99, 0.55 + (success_rate - 0.5) * 0.5 - min(p95 / 10000.0, 0.2)))
    severity = "low" if score >= 0.8 else "medium" if score >= 0.6 else "high"
    summary = "Heuristic critique identified routing, latency, and learning-surface opportunities."
    return CritiqueResult(score=round(score, 3), severity=severity, summary=summary, issues=issue_list, recommendations=recommendations)


def critique_observation(observation: dict[str, Any], cfg: SwarmConfig | None = None) -> dict[str, Any]:
    cfg = cfg or SwarmConfig()

    prompt = (
        "You are the reasoning critic in a self-improving swarm. "
        "Given this observation, return a concise JSON critique with score, issues, "
        "recommendations, and severity. Observation: "
        f"{observation}"
    )

    # Prefer the reasoning model only when explicitly enabled; otherwise use the fast deterministic path.
    if os.environ.get("SWARM_LAYER_USE_LLM", "0") != "1":
        return asdict(_heuristic_critique(observation))

    try:
        from swarmx.llm import generate
        result = generate(
            prompt,
            model=cfg.model_reason,
            provider=cfg.provider,
            cfg=cfg,
            role="evaluator",
            compress_prompt=True,
            inject_memory=False,
            inject_skills=False,
        )
        heuristic = _heuristic_critique(observation)
        return {
            "score": float(getattr(result, "fitness_score", 0.0) or heuristic.score),
            "severity": "medium",
            "summary": result.text[:800],
            "issues": heuristic.issues,
            "recommendations": heuristic.recommendations,
            "model_used": getattr(result, "model_used", cfg.model_reason),
            "raw_text": result.text,
        }
    except Exception:
        return asdict(_heuristic_critique(observation))
