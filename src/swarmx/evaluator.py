from __future__ import annotations

import math
import random
from typing import Any


ISLAND_AXES = ("correctness", "leverage", "reversibility", "simplicity", "swarm_synergy")
AXIS_WEIGHTS = {
    "correctness":   0.30,
    "leverage":      0.25,
    "reversibility": 0.20,
    "simplicity":    0.15,
    "swarm_synergy": 0.10,
}


def score_text(text: str) -> dict[str, Any]:
    """Score a single text output on signal-density quality and content signals.

    Rewards concise, actionable outputs. Does not penalise precision-compressed
    outputs — a 4-line precise answer scores ≈ 0.6; 12-line padded answer ≈ 0.75.
    """
    clean = text.strip()
    lines = [line for line in clean.splitlines() if line.strip()]
    lower = clean.lower()
    line_count = len(lines)
    density_quality = round(1.0 - math.exp(-line_count / 10.0), 3) if line_count else 0.0
    return {
        "length": len(clean),
        "lines": line_count,
        "has_actions": any(kw in lower for kw in [
            "action", "implement", "validate", "review", "test", "fix", "step", "run", "apply",
        ]),
        "has_risk": any(kw in lower for kw in [
            "risk", "approval", "gate", "guardrail", "rollback",
        ]),
        "has_errors": any(kw in lower for kw in [
            "error", "failed", "failure", "exception", "bug",
        ]),
        "has_warnings": any(kw in lower for kw in ["warn", "caution", "note"]),
        "has_handoff_contract": any(kw in lower for kw in [
            "assumption", "stop condition", "validation evidence", "next-owner",
        ]),
        "quality": density_quality,
    }


def rank_outputs(candidates: list[dict[str, Any]]) -> dict[str, Any]:
    """Rank output candidates by composite fitness. Returns winner + sorted list."""
    if not candidates:
        return {"winner": None, "scores": []}
    scored = []
    for candidate in candidates:
        score = score_text(str(candidate.get("output", "")))
        total = (
            score["quality"]
            + (0.20 if score["has_actions"] else 0.0)
            + (0.10 if score["has_risk"] else 0.0)
            + (0.05 if score["has_handoff_contract"] else 0.0)
        )
        if score["has_errors"]:
            total -= 0.20
        scored.append({"candidate": candidate, "score": score, "total": round(total, 3)})
    scored.sort(key=lambda x: x["total"], reverse=True)
    return {"winner": scored[0], "scores": scored}


# ── Multi-island tournament scoring (since APEX.10, updated APEX.15) ────────────────────────

def score_island_candidate(
    candidate: dict[str, Any],
    island: str,
    *,
    prior_winners: list[str] | None = None,
) -> dict[str, Any]:
    """Score a single island candidate on the five IEP-ELITE fitness axes.

    Each axis estimated from output text and optional executor-supplied metadata.
    Returns per-axis scores, composite, and diversity bonus.
    """
    text = str(candidate.get("output", ""))
    meta = candidate.get("metadata") or {}
    base = score_text(text)

    correctness   = float(meta.get("correctness_signal",   base["quality"]))
    leverage      = float(meta.get("leverage_signal",      0.5 + 0.3 * float(base["has_actions"])))
    reversibility = float(meta.get("reversibility_signal", 0.5 + 0.2 * float(base["has_risk"])))
    simplicity    = float(meta.get("simplicity_signal",    max(0.0, 1.0 - min(base["lines"] / 40.0, 1.0))))
    swarm_synergy = float(meta.get("swarm_synergy_signal", 0.5 + 0.1 * float(base["has_handoff_contract"])))

    # Island-specific bias (natural strength of each island prior)
    if island == "A":    # Conservative: correctness + reversibility
        correctness   = min(1.0, correctness   + 0.05)
        reversibility = min(1.0, reversibility + 0.05)
    elif island == "B":  # Lateral: leverage + swarm synergy
        leverage      = min(1.0, leverage      + 0.08)
        swarm_synergy = min(1.0, swarm_synergy + 0.05)
    elif island == "C":  # Compressed: simplicity
        simplicity    = min(1.0, simplicity    + 0.10)

    axes = {
        "correctness":   round(correctness,   3),
        "leverage":      round(leverage,      3),
        "reversibility": round(reversibility, 3),
        "simplicity":    round(simplicity,    3),
        "swarm_synergy": round(swarm_synergy, 3),
    }
    composite = sum(axes[ax] * AXIS_WEIGHTS[ax] for ax in ISLAND_AXES)

    # Diversity bonus: reward breaking a 3-streak convergence
    diversity_bonus = 0.0
    prior_winners = prior_winners or []
    if len(prior_winners) >= 3 and all(w == prior_winners[-1] for w in prior_winners[-3:]):
        if island != prior_winners[-1]:
            diversity_bonus = 0.04

    return {
        "island": island,
        "axes": axes,
        "composite": round(composite, 3),
        "diversity_bonus": diversity_bonus,
        "total": round(min(composite + diversity_bonus, 1.0), 3),
        "candidate": candidate,
    }


def island_tournament(
    islands: dict[str, dict[str, Any]],
    *,
    prior_winners: list[str] | None = None,
    crossover_probability: float = 0.30,
) -> dict[str, Any]:
    """Run a multi-island tournament and return the winner.

    Parameters
    ----------
    islands:
        Mapping of island label ("A", "B", "C") to candidate dict.
    prior_winners:
        Recent island winner labels — used for convergence detection and
        diversity bonus calculation.
    crossover_probability:
        Probability of hybridizing top-2 islands when no single island
        scores >= 0.80 on all axes. Use 0.60 in exploration mode.

    Returns
    -------
    dict with: winner_island, winner_score, winner_candidate, all_scores,
    crossover_applied, convergence_detected.
    """
    prior_winners = prior_winners or []
    all_scores: list[dict[str, Any]] = []
    for label, candidate in islands.items():
        all_scores.append(score_island_candidate(candidate, label, prior_winners=prior_winners))
    all_scores.sort(key=lambda s: s["total"], reverse=True)
    best = all_scores[0]

    convergence = (
        len(prior_winners) >= 3
        and all(w == prior_winners[-1] for w in prior_winners[-3:])
    )

    # Crossover: hybridize top-2 if best misses the 0.80 bar
    crossover_applied = False
    if best["total"] < 0.80 and len(all_scores) >= 2 and random.random() < crossover_probability:
        second = all_scores[1]
        hybrid_axes = {ax: max(best["axes"][ax], second["axes"][ax]) for ax in ISLAND_AXES}
        hybrid_composite = sum(hybrid_axes[ax] * AXIS_WEIGHTS[ax] for ax in ISLAND_AXES)
        hybrid_total = round(min(hybrid_composite, 1.0), 3)
        if hybrid_total > best["total"]:
            best = {
                "island": f"{best['island']}×{second['island']}",
                "axes": hybrid_axes,
                "composite": round(hybrid_composite, 3),
                "diversity_bonus": 0.0,
                "total": hybrid_total,
                "candidate": best["candidate"],
            }
            crossover_applied = True

    return {
        "winner_island": best["island"],
        "winner_score": best["total"],
        "winner_candidate": best["candidate"],
        "all_scores": all_scores,
        "crossover_applied": crossover_applied,
        "convergence_detected": convergence,
    }


# ── V5 Memory Tournament ────────────────────────────────────────────────────────

def memory_tournament(
    memories: list[dict[str, Any]],
    *,
    query: str = "",
    top_k: int = 5,
    decay_weight: float = 0.25,
    usage_weight: float = 0.25,
    relevance_weight: float = 0.50,
) -> dict[str, Any]:
    """Select the top-k most valuable memories via a lightweight tournament.

    Combines three signals:
      relevance_score  — token frequency match against query (0.0–1.0)
      decay_score      — temporal decay (from memory.decay_score)
      usage_score      — normalised usage_count

    Usage:
        from .evaluator import memory_tournament
        result = memory_tournament(memories, query="test failure pattern", top_k=5)
        winners = result["winners"]   # list of memory dicts, best-first

    Returns
    -------
    dict with: winners (list), all_scored (list), tournament_params
    """
    from .memory import decay_score as _decay_score  # avoid circular at import time

    if not memories:
        return {"winners": [], "all_scored": [], "tournament_params": {
            "query": query, "top_k": top_k,
            "decay_weight": decay_weight, "usage_weight": usage_weight, "relevance_weight": relevance_weight,
        }}

    terms = [t.lower() for t in query.split() if t] if query else []
    max_usage = max(int(m.get("usage_count") or 1) for m in memories) or 1

    scored: list[tuple[float, dict[str, Any]]] = []
    for mem in memories:
        if mem.get("superseded"):
            continue
        # Relevance
        if terms:
            hay = " ".join([
                str(mem.get("kind", "")),
                str(mem.get("summary", "")),
                str(mem.get("content", "")),
                " ".join(mem.get("tags", []) or []),
            ]).lower()
            raw = sum(hay.count(t) for t in terms)
            relevance = min(raw / 5.0, 1.0)  # cap at 1.0 beyond 5 matches
        else:
            relevance = 0.5  # no query → neutral

        # Decay
        d_score = _decay_score(mem)

        # Usage normalised
        usage_norm = int(mem.get("usage_count") or 1) / max_usage

        composite = (
            relevance * relevance_weight
            + d_score * decay_weight
            + usage_norm * usage_weight
        )
        scored.append((round(composite, 4), mem))

    scored.sort(key=lambda x: x[0], reverse=True)
    winners = [m for _, m in scored[:top_k]]
    all_scored = [{"score": s, "id": m.get("id"), "summary": m.get("summary")} for s, m in scored]

    return {
        "winners": winners,
        "all_scored": all_scored,
        "tournament_params": {
            "query": query,
            "top_k": top_k,
            "decay_weight": decay_weight,
            "usage_weight": usage_weight,
            "relevance_weight": relevance_weight,
        },
    }
