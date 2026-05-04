from __future__ import annotations

from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from swarmx.config import SwarmConfig
from swarmx.utils import write_json


@dataclass
class StageRecord:
    stage_id: str
    created_at: str
    repo: str
    cycle_id: str
    candidate_id: str
    approved: bool
    score: float
    artifact_path: str
    summary: str


def _stage_root(cfg: SwarmConfig) -> Path:
    root = cfg.home / "evolution-layer"
    root.mkdir(parents=True, exist_ok=True)
    (root / "cycles").mkdir(parents=True, exist_ok=True)
    (root / "staged").mkdir(parents=True, exist_ok=True)
    return root


def stage_candidate(*, repo: str | Path | None, cfg: SwarmConfig, cycle_id: str, candidate: dict[str, Any], validation: dict[str, Any], summary: str) -> dict[str, Any]:
    root = _stage_root(cfg)
    repo_path = Path(repo or ".").expanduser().resolve()
    stage_id = f"stage-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    artifact = {
        "stage_id": stage_id,
        "cycle_id": cycle_id,
        "repo": str(repo_path),
        "candidate": candidate,
        "validation": validation,
        "summary": summary,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    artifact_path = root / "staged" / f"{stage_id}.json"
    write_json(artifact_path, artifact)

    repo_overlay = repo_path / ".swarmx" / "evolution-layer"
    repo_overlay.mkdir(parents=True, exist_ok=True)
    write_json(repo_overlay / "latest.json", artifact)

    record = StageRecord(
        stage_id=stage_id,
        created_at=artifact["timestamp"],
        repo=str(repo_path),
        cycle_id=cycle_id,
        candidate_id=str(candidate.get("id", "unknown")),
        approved=bool(validation.get("approved", False)),
        score=float(validation.get("score", 0.0) or 0.0),
        artifact_path=str(artifact_path),
        summary=summary,
    )
    write_json(root / "latest-stage.json", asdict(record))
    return {**asdict(record), "artifact": artifact}
