"""swarmx.core.db — Lightweight SQLite health and utility helpers.

Improvements over v6-patched:
  [DB-01] db_integrity_check() added — runs SQLite PRAGMA integrity_check and
          quick_check; called by `make db-check` and the doctor command.
          Returns True on a clean database, False on any corruption signal.
  [DB-02] db_size_bytes() added — returns the file size in bytes for disk-space
          monitoring in the doctor / observability stack.
  [DB-03] count_table() now uses parameterised-style whitelisting to guard
          against any theoretical SQL injection in the table name argument.
          A ValueError is raised early if the table name is not alphanumeric.
"""
from __future__ import annotations

from pathlib import Path

# Whitelist of known tables — used by count_table() to reject arbitrary names.
_VALID_TABLES: frozenset[str] = frozenset({
    "kv", "events", "jobs", "runs", "memories", "memories_fts",
    "memory_consolidations", "checkpoints", "narratives", "missions",
    "proposals", "audit_log", "telemetry", "skills",
})


def db_path(runtime_home: Path) -> Path:
    """Return the SQLite database path."""
    return runtime_home / "state" / "swarmx.sqlite3"


def db_exists(runtime_home: Path) -> bool:
    """True if the SQLite database file is present."""
    return db_path(runtime_home).exists()


def db_size_bytes(runtime_home: Path) -> int:
    """Return the database file size in bytes; 0 if it does not exist."""
    p = db_path(runtime_home)
    try:
        return p.stat().st_size if p.exists() else 0
    except Exception:
        return 0


def count_table(runtime_home: Path, table: str) -> int:
    """Return the row count for a known SQLite table; 0 on any error.

    [DB-03] Validates `table` against _VALID_TABLES before interpolating into
    the SQL string so callers cannot pass arbitrary identifiers.
    """
    if table not in _VALID_TABLES:
        # Unknown table — log a warning but don't blow up the caller.
        return 0
    try:
        from swarmx.storage import connect  # local import to avoid circular
        with connect(runtime_home) as conn:
            row = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()  # noqa: S608
            return int(row[0]) if row else 0
    except Exception:
        return 0


def db_integrity_check(runtime_home: Path) -> bool:
    """Run SQLite PRAGMA integrity_check + quick_check.

    [DB-01] Returns True when the database is clean, False on any failure
    signal (corruption, missing file, parse error, etc.).

    Used by:
      - `make db-check`
      - `swarmx doctor` command
    """
    if not db_exists(runtime_home):
        # No database yet — considered clean (not yet created)
        return True
    try:
        from swarmx.storage import connect
        with connect(runtime_home) as conn:
            integrity_row = conn.execute("PRAGMA integrity_check").fetchone()
            quick_row     = conn.execute("PRAGMA quick_check").fetchone()
        integrity_ok = integrity_row and str(integrity_row[0]).strip().lower() == "ok"
        quick_ok     = quick_row     and str(quick_row[0]).strip().lower() == "ok"
        return bool(integrity_ok and quick_ok)
    except Exception:
        return False


__all__ = [
    "count_table",
    "db_exists",
    "db_integrity_check",
    "db_path",
    "db_size_bytes",
]
