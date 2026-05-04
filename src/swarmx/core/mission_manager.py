"""Mission manager adapter — delegates to swarmx.mission runtime module."""
from __future__ import annotations

from pathlib import Path
from typing import Any

# Re-export the raw builder and helpers from the existing runtime module so
# command modules can import from a stable ``swarmx.core`` namespace.
from swarmx.mission import (
    build_mission as _build_mission,
    save_mission,
    activate_mission,
    mission_list,
    mission_id,
)
from swarmx.storage import list_missions as _list_missions, update_mission_record


def get_active_mission(runtime_home: Path) -> dict[str, Any] | None:
    """Return the currently active mission record, or None."""
    try:
        from swarmx.storage import get_kv
        raw = get_kv(runtime_home, "active_mission")
        if isinstance(raw, dict):
            return raw
        return None
    except Exception:
        return None


def list_missions(runtime_home: Path, *, limit: int = 20) -> list[dict[str, Any]]:
    """Return recent mission records (newest first)."""
    try:
        rows = _list_missions(runtime_home)
        return list(rows)[:limit]
    except Exception:
        return []


def build_mission(
    repo: Path,
    target: str,
    cfg: Any | None = None,
    *,
    review_required: bool = False,
) -> dict[str, Any]:
    """Build a new mission dict (delegates to swarmx.mission.build_mission)."""
    from swarmx.config import SwarmConfig
    cfg = cfg or SwarmConfig()
    return _build_mission(repo=repo, target=target, cfg=cfg, review_required=review_required)


def mission_progress(mission: dict[str, Any]) -> float:
    """Return completion ratio in [0.0, 1.0] — always a float (BUG-02 fix)."""
    phases = mission.get("phases", [])
    if not phases:
        return 0.0
    done = sum(1 for p in phases if str(p.get("status", "")).lower() in {"done", "complete", "completed"})
    total = len(phases)
    return float(done) / float(total) if total else 0.0


__all__ = [
    "build_mission",
    "save_mission",
    "activate_mission",
    "mission_list",
    "mission_id",
    "get_active_mission",
    "list_missions",
    "mission_progress",
]
