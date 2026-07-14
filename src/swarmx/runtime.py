from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .utils import read_json, write_json

VERSION_FALLBACK = "2026.4.24.4"


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


@dataclass
class RuntimeSnapshot:
    version: str
    created_at: str
    updated_at: str
    repo: str | None
    runtime_home: str
    status: str
    active_job: dict[str, Any] | None
    queue_depth: int
    last_run_id: str | None
    last_run_status: str | None
    metrics: dict[str, Any]
    notes: list[str]
    storage: dict[str, Any] | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def runtime_home(cfg: SwarmConfig | None = None) -> Path:
    return (cfg or SwarmConfig()).home


def state_path(runtime_home: Path) -> Path:
    return runtime_home / "state" / "runtime.json"


def database_path(runtime_home: Path) -> Path:
    return runtime_home / "state" / "swarmx.sqlite3"


def ensure_runtime_dirs(runtime_home: Path) -> None:
    for sub in ("state", "queue", "traces", "audit", "metrics", "memory", "runs", "checkpoints", "evolution"):
        (runtime_home / sub).mkdir(parents=True, exist_ok=True)


def load_runtime_state(runtime_home: Path, default: dict[str, Any] | None = None) -> dict[str, Any]:
    default = default or {}
    path = state_path(runtime_home)
    if not path.exists():
        return default
    try:
        return read_json(path, default)
    except Exception:
        return default


def save_runtime_state(runtime_home: Path, state: dict[str, Any]) -> Path:
    ensure_runtime_dirs(runtime_home)
    state = dict(state)
    state.setdefault("created_at", now_iso())
    state["updated_at"] = now_iso()
    write_json(state_path(runtime_home), state)
    return state_path(runtime_home)


def update_runtime_state(runtime_home: Path, **patch: Any) -> dict[str, Any]:
    state = load_runtime_state(
        runtime_home,
        default={
            "version": VERSION_FALLBACK,
            "created_at": now_iso(),
            "updated_at": now_iso(),
            "status": "idle",
            "active_job": None,
            "queue_depth": 0,
            "last_run_id": None,
            "last_run_status": None,
            "metrics": {},
            "notes": [],
            "storage": {"backend": "sqlite+jsonl", "path": str(database_path(runtime_home))},
        },
    )
    state.update(patch)
    state.setdefault("storage", {"backend": "sqlite+jsonl", "path": str(database_path(runtime_home))})
    state["updated_at"] = now_iso()
    save_runtime_state(runtime_home, state)
    return state


def build_snapshot(
    runtime_home: Path,
    *,
    repo: str | None = None,
    metrics: dict[str, Any] | None = None,
    active_job: dict[str, Any] | None = None,
    queue_depth: int = 0,
    last_run_id: str | None = None,
    last_run_status: str | None = None,
    status: str | None = None,
    notes: list[str] | None = None,
) -> RuntimeSnapshot:
    state = load_runtime_state(runtime_home, default={})
    storage = state.get("storage") or {"backend": "sqlite+jsonl", "path": str(database_path(runtime_home))}
    return RuntimeSnapshot(
        version=str(state.get("version") or VERSION_FALLBACK),
        created_at=str(state.get("created_at") or now_iso()),
        updated_at=str(state.get("updated_at") or now_iso()),
        repo=repo,
        runtime_home=str(runtime_home),
        status=status or str(state.get("status") or "idle"),
        active_job=active_job if active_job is not None else state.get("active_job"),
        queue_depth=queue_depth,
        last_run_id=last_run_id if last_run_id is not None else state.get("last_run_id"),
        last_run_status=last_run_status if last_run_status is not None else state.get("last_run_status"),
        metrics=metrics or dict(state.get("metrics") or {}),
        notes=notes if notes is not None else list(state.get("notes") or []),
        storage=storage,
    )
