from __future__ import annotations

from dataclasses import dataclass, asdict, field
from typing import Any
import os

from swarmx.config import SwarmConfig


@dataclass
class MutationCandidate:
    id: str
    title: str
    kind: str
    risk: str
    expected_gain: float
    config_delta: dict[str, Any] = field(default_factory=dict)
    rationale: str = ""
    model_used: str = ""


def _heuristic_candidates(observation: dict[str, Any], critique: dict[str, Any]) -> list[MutationCandidate]:
    baseline = observation.get("baseline", {}) or {}
    p95 = float(baseline.get("p95_latency_ms", 0.0) or 0.0)
    success_rate = float(baseline.get("success_rate", 0.6) or 0.6)
    issues = " ".join(critique.get("issues", []) or []).lower()

    candidates = [
        MutationCandidate(
            id="fast-path-router",
            title="Route simple tasks to the fast router sooner",
            kind="routing",
            risk="low",
            expected_gain=round(0.08 + (0.15 if p95 > 2000 else 0.02), 3),
            config_delta={
                "routing": {"prefer_fast_path_for_low_complexity": True, "router_bias": 0.15},
                "runtime": {"max_iterations": max(2, int(observation.get('runtime', {}).get('max_iterations', 3) or 3) - 1)},
            },
            rationale="High latency or low-complexity work benefits from a quicker router decision.",
        ),
        MutationCandidate(
            id="reasoning-escalation",
            title="Escalate ambiguous or risky tasks to the reasoning model",
            kind="routing",
            risk="low",
            expected_gain=round(0.07 + (0.08 if "success rate" in issues else 0.03), 3),
            config_delta={
                "routing": {"escalate_on_uncertainty": True, "reasoning_first_for_high_risk": True},
            },
            rationale="Ambiguous tasks should spend more budget on deep planning before execution.",
        ),
        MutationCandidate(
            id="validation-tightening",
            title="Tighten validation and learning capture",
            kind="validation",
            risk="low",
            expected_gain=round(0.06 + (0.05 if success_rate < 0.8 else 0.02), 3),
            config_delta={
                "evolution": {"proposal_only_by_default": True, "fitness_threshold": 0.76},
                "observability": {"persist_run_artifacts": True},
            },
            rationale="Better evidence capture makes later mutations safer and more reusable.",
        ),
    ]
    return candidates


def generate_mutations(observation: dict[str, Any], critique: dict[str, Any], cfg: SwarmConfig | None = None) -> list[dict[str, Any]]:
    cfg = cfg or SwarmConfig()
    prompt = (
        "You are the code/model mutation engine in a self-improving swarm. "
        "Return three bounded mutation candidates as JSON. Each candidate must be reversible, safe, and small. "
        f"Observation: {observation}\nCritique: {critique}"
    )

    if os.environ.get("SWARM_LAYER_USE_LLM", "0") != "1":
        return [asdict(candidate) for candidate in _heuristic_candidates(observation, critique)]

    try:
        from swarmx.llm import generate
        result = generate(
            prompt,
            model=cfg.model_code,
            provider=cfg.provider,
            cfg=cfg,
            role="backend-engineer",
            compress_prompt=True,
            inject_memory=False,
            inject_skills=False,
        )
        # We do not rely on the model output being strict JSON. The raw text is staged for inspection.
        return [
            {
                **asdict(candidate),
                "model_used": getattr(result, "model_used", cfg.model_code),
                "raw_text": result.text[:1200],
            }
            for candidate in _heuristic_candidates(observation, critique)
        ]
    except Exception:
        return [asdict(candidate) for candidate in _heuristic_candidates(observation, critique)]
