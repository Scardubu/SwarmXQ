from __future__ import annotations

import structlog
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .planner import build_plan, detect_stack
from .policy import assess_action
from .storage import list_missions as db_list_missions
from .storage import store_mission_record, update_mission_record

log = structlog.get_logger("swarmx.mission")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ── Semantic memory helpers (non-critical — never raises) ─────────────────────

def _vs_db_path(home: Path) -> Path:
    return home / "state" / "vector_memory.db"


def _vs_retrieve(home: Path, query: str, k: int = 5) -> list[dict[str, Any]]:
    """Retrieve top-k semantically similar prior missions. Returns [] on any error."""
    try:
        from core.memory.vector_store import get_vector_store  # type: ignore[import]
        return get_vector_store(_vs_db_path(home)).retrieve(query, k=k)
    except Exception:
        return []


def mission_id(target: str) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    slug = "".join(ch if ch.isalnum() else "-" for ch in target.lower()).strip("-")[:24] or "mission"
    return f"mission-{slug}-{stamp}"


def build_mission(
    repo: Path,
    target: str,
    cfg: SwarmConfig | None = None,
    *,
    review_required: bool = False,
    autonomous: bool | None = None,
) -> dict[str, Any]:
    cfg = cfg or SwarmConfig()
    repo = Path(repo).expanduser().resolve()
    plan = build_plan(target=target, repo=repo, review_required=review_required, cfg=cfg)
    policy = assess_action("mission", target, repo, cfg, review_required=review_required)

    # ── Intake: inject semantically similar prior missions ────────────────────
    prior_missions = _vs_retrieve(cfg.home, query=target, k=5)
    if prior_missions:
        log.info("memory.intake_injected", count=len(prior_missions))

    phases = [
        {"name": "intake",     "owner": "strategist",       "purpose": "Confirm the objective, scope, and stop condition."},
        {"name": "decompose",  "owner": "workflow-composer", "purpose": "Split the goal into actionable work units."},
        {"name": "execute",    "owner": "producer",          "purpose": "Run the plan with bounded autonomy."},
        {"name": "verify",     "owner": "evaluator",         "purpose": "Check results against acceptance criteria."},
        {"name": "learn",      "owner": "memory-curator",    "purpose": "Store the useful lessons for later runs."},
    ]

    # ── V4: Mission budget enforcement ────────────────────────────────────────
    budget_cap = int(cfg.mission_budget)
    budget = {
        "cap": budget_cap,
        "iterations_used": 0,
        "tokens_used": 0,
        "status": "under_budget",
    }
    # ── End budget enforcement ─────────────────────────────────────────────────

    mission = {
        "id": mission_id(target),
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "repo": str(repo),
        "target": target,
        "objective": plan.goal,
        "stack": detect_stack(repo),
        "workflow": plan.workflow,
        "risk": plan.risk.value,
        "autonomous": cfg.autonomous if autonomous is None else autonomous,
        "policy": policy.to_dict(),
        "plan": plan.to_dict(),
        "budget": budget,
        "phases": phases + [
            {"name": task.title, "owner": task.owner, "risk": task.risk.value, "detail": task.detail}
            for task in plan.tasks
        ],
        "stop_conditions": [
            "human_gate triggered",
            "risk escalates beyond configured floor",
            "verification fails twice",
            f"budget cap of {budget_cap} iterations reached",
        ],
        "prior_missions": prior_missions,
        "status": "proposed",
        "notes": [
            f"Mission aligned to {len(plan.tasks)} tasks",
            f"Policy mode: {policy.mode}",
            f"Budget cap: {budget_cap} iterations",
        ],
    }
    return mission


def save_mission(runtime_home: Path, mission: dict[str, Any]) -> dict[str, Any]:
    store_mission_record(runtime_home, mission)
    return mission


def activate_mission(runtime_home: Path, mission_id: str, **patch: Any) -> dict[str, Any] | None:
    return update_mission_record(runtime_home, mission_id, **patch)


def mission_list(runtime_home: Path, limit: int = 50) -> list[dict[str, Any]]:
    try:
        return db_list_missions(runtime_home, limit=limit)
    except Exception:
        return []


def record_mission_iteration(
    runtime_home: Path,
    mission_id_str: str,
    tokens: int = 0,
) -> dict[str, Any] | None:
    """Increment the iteration counter for a mission. Returns updated mission
    record, or None if the mission was not found.

    Call this from executor/worker after each iteration to enforce the budget cap.
    The returned dict includes ``budget.status`` which is ``"over_budget"`` once
    ``iterations_used > cap`` — the caller should halt and surface a warning.
    """
    missions = mission_list(runtime_home, limit=500)
    for m in missions:
        if m.get("id") == mission_id_str:
            existing = m.get("budget") or {}
            cap = int(existing.get("cap", 4))
            used = int(existing.get("iterations_used", 0)) + 1
            tokens_used = int(existing.get("tokens_used", 0)) + tokens
            over = used > cap
            updated_budget = {
                "cap": cap,
                "iterations_used": used,
                "tokens_used": tokens_used,
                "status": "over_budget" if over else "under_budget",
            }
            return update_mission_record(runtime_home, mission_id_str, budget=updated_budget)
    return None
