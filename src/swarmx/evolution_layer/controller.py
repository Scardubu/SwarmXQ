from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from swarmx.config import SwarmConfig
from swarmx.utils import write_json

from .critique import critique_observation
from .deployment import stage_candidate
from .mutation import generate_mutations
from .observer import collect_observation
from .validation import validate_candidate


def _store_cycle(cfg: SwarmConfig, cycle: dict[str, Any]) -> Path:
    root = cfg.home / "evolution-layer"
    root.mkdir(parents=True, exist_ok=True)
    cycles = root / "cycles"
    cycles.mkdir(parents=True, exist_ok=True)
    cycle_path = cycles / f"{cycle['cycle_id']}.json"
    write_json(cycle_path, cycle)
    write_json(root / "latest-cycle.json", cycle)
    return cycle_path


def run_cycle(repo: str | Path | None = None, cfg: SwarmConfig | None = None, *, cycles: int = 1, auto_deploy: bool = False, dry_run: bool = True) -> dict[str, Any]:
    cfg = cfg or SwarmConfig()
    repo_path = Path(repo or ".").expanduser().resolve()
    cycle_results: list[dict[str, Any]] = []

    for _ in range(max(1, cycles)):
        observation = collect_observation(repo=repo_path, cfg=cfg)
        critique = critique_observation(observation, cfg=cfg)
        candidates = generate_mutations(observation, critique, cfg=cfg)

        validated = [
            {"candidate": candidate, "validation": validate_candidate(candidate, observation, critique)}
            for candidate in candidates
        ]
        validated.sort(key=lambda item: float(item["validation"].get("score", 0.0)), reverse=True)
        winner = validated[0] if validated else None

        stage_info = None
        if winner:
            summary = critique.get("summary", "V6 self-improvement cycle")
            should_deploy = bool(auto_deploy and not dry_run and winner["validation"].get("approved", False))
            stage_info = stage_candidate(
                repo=repo_path,
                cfg=cfg,
                cycle_id=observation["cycle_id"],
                candidate=winner["candidate"],
                validation=winner["validation"],
                summary=summary,
            )
            stage_info["deployed"] = should_deploy
        # [V6.1-ENH-02] Attach session baseline so post-cycle delta can be computed.
        _baseline: dict[str, Any] = {}
        try:
            from swarmx.startup import load_startup_summary  # type: ignore[import]
            _baseline = load_startup_summary(cfg.home) or {}
        except Exception:
            pass

        cycle = {
            "cycle_id": observation["cycle_id"],
            "timestamp": datetime.now(UTC).isoformat(),
            "repo": str(repo_path),
            "observation": observation,
            "critique": critique,
            "candidates": candidates,
            "validated": validated,
            "winner": winner,
            "staged": stage_info,
            "auto_deploy": bool(auto_deploy),
            "dry_run": bool(dry_run),
            "triad": {
                "router": cfg.model_fast,
                "reason": cfg.model_reason,
                "code": cfg.model_code,
            },
            # [V6.1-ENH-02] Session baseline captured at startup autopilot time.
            "session_baseline": _baseline,
        }
        _store_cycle(cfg, cycle)
        cycle_results.append(cycle)

    payload = {
        "layer": "v6-self-improving",
        "cycles": cycle_results,
        "repo": str(repo_path),
        "auto_deploy": bool(auto_deploy),
        "dry_run": bool(dry_run),
    }
    write_json(cfg.home / "evolution-layer" / "latest-run.json", payload)
    return payload


def run_autonomous_evolution(repo: str | Path | None = None, cfg: SwarmConfig | None = None, *, cycles: int = 1) -> dict[str, Any]:
    return run_cycle(repo=repo, cfg=cfg, cycles=cycles, auto_deploy=False, dry_run=True)
