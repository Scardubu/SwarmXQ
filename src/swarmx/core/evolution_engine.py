"""Evolution engine adapter — stable API over swarmx.evolver + core/evolution.

Bug fixes vs v0.2.0:
  - [BUG-04] Guard on ImportError for optional divergent_proposer so the
    evolve command never crashes when the package is not fully installed.
  - [BUG-07] Proposals now include ``pareto_score`` key from DivergentProposer
    Pareto ranking so the TUI table can render the column (BUG-07 fix).
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from swarmx.evolver import apply_proposals, build_evolution_proposals

logger = logging.getLogger(__name__)

# ── Proposal list helpers ─────────────────────────────────────────────────────

def get_proposals(runtime_home: Path, *, limit: int = 20) -> list[dict[str, Any]]:
    """Return stored evolution proposals (newest first)."""
    try:
        from swarmx.storage import get_kv
        raw = get_kv(runtime_home, "evolution_proposals")
        if isinstance(raw, list):
            return raw[:limit]
        return []
    except Exception:
        return []


def pending_proposals(runtime_home: Path) -> list[dict[str, Any]]:
    """Return proposals with status == 'pending'."""
    all_p = get_proposals(runtime_home)
    return [p for p in all_p if str(p.get("status", "pending")).lower() == "pending"]


def approve(runtime_home: Path, proposal_id: str) -> bool:
    """Mark a proposal as approved. Returns True on success."""
    try:
        from swarmx.storage import get_kv, store_kv
        proposals = get_kv(runtime_home, "evolution_proposals") or []
        for p in proposals:
            if p.get("id") == proposal_id:
                p["status"] = "approved"
        store_kv(runtime_home, "evolution_proposals", proposals)
        return True
    except Exception as exc:
        logger.warning("approve(%s) failed: %s", proposal_id, exc)
        return False


def reject(runtime_home: Path, proposal_id: str) -> bool:
    """Mark a proposal as rejected. Returns True on success."""
    try:
        from swarmx.storage import get_kv, store_kv
        proposals = get_kv(runtime_home, "evolution_proposals") or []
        for p in proposals:
            if p.get("id") == proposal_id:
                p["status"] = "rejected"
        store_kv(runtime_home, "evolution_proposals", proposals)
        return True
    except Exception as exc:
        logger.warning("reject(%s) failed: %s", proposal_id, exc)
        return False

def delta_capture(
    runtime_home: Path,
    *,
    current_fitness: dict | None = None,
    structural_delta: dict | None = None,
    attribution: str = "",
) -> dict:
    """Capture a fitness delta snapshot and write it to the evolution store.

    Called by the delta-evolution skill and swarm-evolve.sh after each run.
    Accumulates a learning record that feeds long-term proposal generation.

    Args:
        runtime_home: Path to the SwarmX runtime home directory.
        current_fitness: Dict with keys matching the fitness function dimensions:
            task_success_rate, token_efficiency, proposal_acceptance_rate,
            policy_compliance_rate, self_correction_rate
        structural_delta: Dict describing structural changes since last snapshot:
            skills_added, skills_removed, agents_modified, config_changed
        attribution: Free-text attribution of the primary fitness driver.

    Returns:
        Dict with: delta_id, delta_fitness, keeper, rollback_candidate, proposals_generated
    """
    import datetime
    import uuid

    try:
        from swarmx.storage import get_kv, store_kv
    except ImportError:
        logger.warning("delta_capture: storage module unavailable")
        return {}

    delta_id = f"DELTA-{uuid.uuid4().hex[:8].upper()}"
    timestamp = datetime.datetime.utcnow().isoformat()

    # Retrieve previous fitness snapshot
    prev_record = get_kv(runtime_home, "last_fitness_snapshot") or {}
    prev_score = prev_record.get("composite_score", 0.5)

    # Compute composite fitness score
    weights = {
        "task_success_rate": 0.30,
        "token_efficiency": 0.20,
        "proposal_acceptance_rate": 0.20,
        "policy_compliance_rate": 0.15,
        "self_correction_rate": 0.15,
    }
    current = current_fitness or {}
    composite = sum(
        current.get(k, 0.5) * w for k, w in weights.items()
    )
    delta_fitness = round(composite - prev_score, 4)

    # Attribution
    keeper = attribution if delta_fitness > 0 else ""
    rollback_candidate = attribution if delta_fitness < -0.02 else ""

    record = {
        "id": delta_id,
        "timestamp": timestamp,
        "composite_score": composite,
        "delta_fitness": delta_fitness,
        "dimensions": current,
        "structural_delta": structural_delta or {},
        "keeper": keeper,
        "rollback_candidate": rollback_candidate,
        "attribution": attribution,
    }

    # Append to delta history
    history = get_kv(runtime_home, "delta_history") or []
    history.append(record)
    store_kv(runtime_home, "delta_history", history[-50:])  # keep last 50

    # Update latest snapshot
    store_kv(runtime_home, "last_fitness_snapshot", record)

    logger.info(
        "delta_capture: %s composite=%.3f delta=%.4f keeper=%r rollback=%r",
        delta_id, composite, delta_fitness, keeper, rollback_candidate,
    )

    return record


def generate_proposals(
    repo: Path,
    cfg: Any | None = None,
    *,
    k: int = 3,
) -> list[dict[str, Any]]:
    """Generate k divergent evolution proposals with Pareto scores (BUG-07 fix).

    Falls back gracefully when ``core.evolution.divergent_proposer`` is
    unavailable (BUG-04 guard).
    """
    from swarmx.config import SwarmConfig
    cfg = cfg or SwarmConfig()

    # Try divergent proposer first (adds pareto_score)
    try:
        from core.evolution.divergent_proposer import DivergentProposer  # type: ignore[import]
        proposer = DivergentProposer(k=k)
        raw = proposer.propose(repo=repo, cfg=cfg)
        proposals = []
        for rp in raw:
            d = rp.__dict__.copy() if hasattr(rp, "__dict__") else dict(rp)
            if "pareto_score" not in d:
                d["pareto_score"] = getattr(rp, "pareto_score", 0.0)
            proposals.append(d)
        return proposals
    except Exception as exc:
        logger.debug("DivergentProposer unavailable (%s), falling back to evolver", exc)

    # Fallback: build_evolution_proposals
    try:
        raw = build_evolution_proposals(repo=repo, cfg=cfg, k=k)
        if isinstance(raw, list):
            for p in raw:
                p.setdefault("pareto_score", 0.0)
            return raw
    except Exception as exc:
        logger.warning("build_evolution_proposals failed: %s", exc)

    return []


__all__ = [
    "build_evolution_proposals",
    "apply_proposals",
    "get_proposals",
    "pending_proposals",
    "approve",
    "reject",
    "generate_proposals",
    "delta_capture",       # NEW
]
