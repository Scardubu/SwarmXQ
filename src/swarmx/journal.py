from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .runtime import ensure_runtime_dirs
from .storage import list_events as db_list_events
from .storage import record_event


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def journal_path(runtime_home: Path) -> Path:
    return runtime_home / "traces" / "journal.jsonl"


def append_event(runtime_home: Path, kind: str, payload: dict[str, Any]) -> Path:
    ensure_runtime_dirs(runtime_home)
    record = {
        "kind": kind,
        "created_at": now_iso(),
        "payload": payload,
    }
    path = journal_path(runtime_home)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    try:
        record_event(runtime_home, kind, payload)
    except Exception:
        pass
    return path


def load_events(runtime_home: Path, limit: int = 100) -> list[dict[str, Any]]:
    try:
        stored = db_list_events(runtime_home, limit=limit)
        if stored:
            return stored
    except Exception:
        pass
    path = journal_path(runtime_home)
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out
