from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from swarmx.config import SwarmConfig


def _safe_call(fn, *args, default=None, **kwargs):
    try:
        return fn(*args, **kwargs)
    except Exception:
        return default


@dataclass
class Observation:
    cycle_id: str
    timestamp: str
    repo: str
    model_router: str
    model_reason: str
    model_code: str
    runtime: dict[str, Any] = field(default_factory=dict)
    recent_runs: list[dict[str, Any]] = field(default_factory=list)
    recent_memories: list[dict[str, Any]] = field(default_factory=list)
    recent_proposals: list[dict[str, Any]] = field(default_factory=list)
    baseline: dict[str, Any] = field(default_factory=dict)
    model_filenames: dict[str, str] = field(default_factory=dict)


def collect_observation(repo: str | Path | None = None, cfg: SwarmConfig | None = None, *, limit: int = 10) -> dict[str, Any]:
    cfg = cfg or SwarmConfig()
    repo_path = Path(repo or ".").expanduser().resolve()

    from swarmx.core.evolution_engine import get_proposals
    from swarmx.memory import load_recent_memories, load_recent_runs
    from swarmx.metrics import build_metrics
    from swarmx.runtime import load_runtime_state

    observation = Observation(
        cycle_id=f"cycle-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}",
        timestamp=datetime.now(UTC).isoformat(),
        repo=str(repo_path),
        model_router=cfg.model_fast,
        model_reason=cfg.model_reason,
        model_code=cfg.model_code,
        runtime=_safe_call(load_runtime_state, cfg.home, default={}) or {},
        recent_runs=_safe_call(load_recent_runs, cfg.home, limit=limit, default=[]) or [],
        recent_memories=_safe_call(load_recent_memories, cfg.home, limit=limit, default=[]) or [],
        recent_proposals=_safe_call(get_proposals, cfg.home, limit=limit, default=[]) or [],
        baseline=_safe_call(build_metrics, cfg.home, default={}) or {},
        model_filenames={
            "router": "Phi-4-mini-Instruct-Q8_0.gguf",
            "reason": "DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf",
            "code": "Qwen2.5-Coder-7B-Instruct-Q5_K_M.gguf",
        },
    )
    return asdict(observation)
