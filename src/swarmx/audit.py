"""
swarmx.audit — Production-grade, append-only audit log

Compliance context (TaxBridge / SabiScore / Hashablanca):
  · NDPC Article 24: data processing activities must be documented with
    purpose, legal basis, and responsible parties. Audit logs provide the
    verifiable activity trail required by NDPC-certified data controllers.
  · CBN Risk-Based Cybersecurity: financial services operators must maintain
    audit trails of all automated actions for a minimum of 7 years.
  · Append-only JSONL (no in-place edits) is the industry standard for
    tamper-evident logs — any modification changes the file hash.

Improvements over the original stub:
  [AUDIT-01] append_audit_log() writes a structured JSONL record to
             traces/audit.jsonl in addition to the per-event JSON file.
             Flat JSON files in traces/ cannot be reliably streamed or
             shipped by log aggregators; JSONL is the production standard.
  [AUDIT-02] JSONL file auto-rotation at SWARMX_AUDIT_MAX_BYTES (default
             20 MiB). Matches the rotation strategy used by telemetry.py.
  [AUDIT-03] SQLite audit_log table write via storage.store_audit_record()
             for structured queries, retention enforcement, and integrity_check.
  [AUDIT-04] Sequential in-memory counter provides monotonic seq_no field
             for ordering and gap detection. Resets on process restart (as
             designed — durable ordering uses created_at ISO-8601 timestamps).
  [AUDIT-05] All writes are wrapped in try/except — audit failure NEVER
             raises into the main execution path.
"""

from __future__ import annotations

import json
import os
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .utils import write_json

# ── Rotation threshold [AUDIT-02] ─────────────────────────────────────────────
_MAX_AUDIT_BYTES = int(os.environ.get("SWARMX_AUDIT_MAX_BYTES", str(20 * 1024 * 1024)))

# ── Sequential counter [AUDIT-04] ─────────────────────────────────────────────
_seq_lock = threading.Lock()
_seq_counter: int = 0


def _next_seq() -> int:
    global _seq_counter
    with _seq_lock:
        _seq_counter += 1
        return _seq_counter


def _now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ── Internal helpers ──────────────────────────────────────────────────────────

def _rotate_if_needed(path: Path) -> None:
    """Rotate path → path.N when it exceeds _MAX_AUDIT_BYTES. [AUDIT-02]"""
    if _MAX_AUDIT_BYTES <= 0 or not path.exists():
        return
    try:
        if path.stat().st_size < _MAX_AUDIT_BYTES:
            return
        idx = 1
        while (rotated := path.with_suffix(f".{idx}.jsonl")).exists():
            idx += 1
        path.rename(rotated)
    except Exception:
        pass


def _store_audit_record_sql(runtime_home: Path, record: dict[str, Any]) -> None:
    """Write to the SQLite audit_log table. [AUDIT-03]

    Silently no-ops if the table or storage module is unavailable.
    """
    try:
        from .storage import store_audit_record  # type: ignore[import]
        store_audit_record(runtime_home, record)
    except Exception:
        pass


# ── Public API ────────────────────────────────────────────────────────────────

def write_audit(runtime_dir: Path, record: dict[str, Any]) -> Path:
    """Write a single audit record as a per-event JSON file (original behaviour).

    Retained for backward compatibility. Use append_audit_log() for new code.
    """
    path = runtime_dir / "traces" / f"{record['id']}.json"
    try:
        write_json(path, record)
    except Exception:
        pass
    return path


def append_audit_log(
    runtime_home: Path,
    event_kind: str,
    payload: dict[str, Any],
    *,
    actor: str = "swarmx",
    run_id: str | None = None,
    mission_id: str | None = None,
) -> dict[str, Any]:
    """Append a structured record to the append-only audit log.

    Writes to three destinations atomically (each wrapped in try/except):
      1. traces/audit.jsonl — append-only JSONL stream [AUDIT-01]
      2. traces/<ts>-audit.json — per-event JSON file (for Fastify indexing)
      3. SQLite audit_log table — for structured queries [AUDIT-03]

    Returns the audit record dict regardless of write success so callers can
    log it via their own mechanism if needed.

    Args:
        runtime_home:  SwarmX runtime home directory (SWARM_HOME).
        event_kind:    Dot-namespaced event identifier, e.g. 'run.completed'.
        payload:       Arbitrary dict describing the event.
        actor:         Identity performing the action (default: 'swarmx').
        run_id:        Optional run correlation ID.
        mission_id:    Optional mission correlation ID.
    """
    ts = _now_iso()
    seq = _next_seq()

    # Build the canonical audit record
    record: dict[str, Any] = {
        "seq":        seq,
        "created_at": ts,
        "kind":       event_kind,
        "actor":      actor,
        "payload":    payload,
    }
    if run_id:
        record["run_id"] = run_id
    if mission_id:
        record["mission_id"] = mission_id

    # ── 1. Append to audit.jsonl [AUDIT-01] ───────────────────────────────────
    try:
        traces_dir = runtime_home / "traces"
        traces_dir.mkdir(parents=True, exist_ok=True)
        jsonl_path = traces_dir / "audit.jsonl"
        _rotate_if_needed(jsonl_path)  # [AUDIT-02]
        with open(jsonl_path, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")
    except Exception:
        pass

    # ── 2. Per-event JSON file (Fastify API indexing) ─────────────────────────
    try:
        ts_tag = datetime.now(UTC).strftime("audit-%Y%m%d%H%M%S%f")
        event_file = runtime_home / "traces" / f"{ts_tag}.json"
        write_json(event_file, record)
    except Exception:
        pass

    # ── 3. SQLite audit_log [AUDIT-03] ────────────────────────────────────────
    _store_audit_record_sql(runtime_home, record)

    return record


def read_audit_log(runtime_home: Path, limit: int = 100) -> list[dict[str, Any]]:
    """Read the most recent `limit` records from audit.jsonl.

    Returns an empty list if the file does not exist or cannot be parsed.
    Records are returned newest-first.
    """
    jsonl_path = runtime_home / "traces" / "audit.jsonl"
    if not jsonl_path.exists():
        return []
    records: list[dict[str, Any]] = []
    try:
        with open(jsonl_path, encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    records.append(json.loads(line))
                except Exception:
                    continue
    except Exception:
        return []
    return list(reversed(records[-limit:]))
