"""Audit log adapter — thin facade over swarmx.storage."""
from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from typing import Any


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


def write(runtime_home: Path, event: str, payload: dict[str, Any]) -> None:
    """Write an audit event. Never raises — silently logs on failure."""
    try:
        from swarmx.storage import write_audit_log
        write_audit_log(runtime_home, event, payload)
    except Exception:
        pass


def list_entries(runtime_home: Path, *, limit: int = 50) -> list[dict[str, Any]]:
    """Return the most recent audit log entries."""
    try:
        from swarmx.storage import list_audit_log
        return list(list_audit_log(runtime_home))[:limit]
    except AttributeError:
        # list_audit_log may not exist in older runtime versions — read JSON files
        return _list_from_files(runtime_home, limit=limit)
    except Exception:
        return []


def _list_from_files(runtime_home: Path, *, limit: int = 50) -> list[dict[str, Any]]:
    import json
    audit_dir = runtime_home / "audit"
    if not audit_dir.exists():
        return []
    entries = []
    for f in sorted(audit_dir.glob("*.json"), reverse=True)[:limit]:
        try:
            entries.append(json.loads(f.read_text(encoding="utf-8")))
        except Exception:
            pass
    return entries


def count(runtime_home: Path) -> int:
    """Return total number of audit log entries."""
    return len(list_entries(runtime_home, limit=9999))


__all__ = ["write", "list_entries", "count"]
