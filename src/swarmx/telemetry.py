"""swarmx.telemetry — Structured telemetry emission with optional structlog support.

Improvements over v6-patched:
  [TEL-01] structlog integration when available — all events emit structured
           JSON records in production; fallback to plain json.dumps in minimal
           environments (e.g. Docker without structlog installed separately).
  [TEL-02] JSONL telemetry file auto-rotation based on SWARMX_TELEMETRY_MAX_BYTES
           env var (default: 10 MB). Prevents unbounded disk growth in long-running
           containers without requiring an external log shipper.
  [TEL-03] emit_event now appends to the JSONL journal (journal.append_event)
           so the Fastify pyevents poller picks up events within ~2500 ms and
           broadcasts them over SSE. NOTE: there is no in-process pub/sub bus
           yet — the docstring previously overstated this as "in-process event
           bus". An async in-memory bus is planned for Phase 3.
  [TEL-04] emit_event accepts an optional `run_id` parameter threaded through
           all structured records so operators can correlate events across runs.
  [TEL-05] All I/O is wrapped in try/except — telemetry failure NEVER raises
           an exception that could interrupt the agent execution path.
"""

from __future__ import annotations

import json
import os
import sys
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .utils import write_json

# ── Structlog integration (optional) ─────────────────────────────────────────
# structlog is pinned in pyproject.toml [all,dev] and is always present in the
# production Docker image. In minimal / stripped installs it falls back to stderr.
try:
    import structlog  # type: ignore[import-untyped]

    _log = structlog.get_logger("swarmx.telemetry")
    _STRUCTLOG_AVAILABLE = True
except ImportError:  # pragma: no cover
    _log = None
    _STRUCTLOG_AVAILABLE = False


# ── Telemetry file rotation ───────────────────────────────────────────────────
# [TEL-02] Max bytes before the telemetry JSONL file is rotated.
# Set SWARMX_TELEMETRY_MAX_BYTES=0 to disable rotation entirely.
_MAX_TELEMETRY_BYTES = int(os.environ.get("SWARMX_TELEMETRY_MAX_BYTES", str(10 * 1024 * 1024)))


def _rotate_if_needed(path: Path) -> None:
    """Rotate `path` → `path.N` when it exceeds _MAX_TELEMETRY_BYTES."""
    if _MAX_TELEMETRY_BYTES <= 0 or not path.exists():
        return
    try:
        if path.stat().st_size < _MAX_TELEMETRY_BYTES:
            return
        # Find the next available rotation index
        idx = 1
        while (rotated := path.with_suffix(f".{idx}.jsonl")).exists():
            idx += 1
        path.rename(rotated)
    except Exception:
        pass  # Rotation failure must never interrupt the main path


def now_iso() -> str:
    """Return the current UTC timestamp in ISO-8601 format."""
    return datetime.now(UTC).isoformat()


# ── Structured event emission ──────────────────────────────────────────────────

def emit_event(
    runtime_dir: Path,
    kind: str,
    payload: dict[str, Any],
    *,
    run_id: str | None = None,  # [TEL-04]
) -> Path:
    """Write a structured telemetry event to the runtime traces directory.

    The event is simultaneously:
      1. Written as a JSON file to traces/ (for the Fastify API to index).
      2. Appended to traces/telemetry.jsonl (for log aggregators / rotation).
      3. Appended to traces/journal.jsonl for Fastify SSE fan-out [TEL-03].
      4. Logged via structlog when available [TEL-01].

    Never raises — all I/O is wrapped in try/except.
    Returns the path of the written JSON trace file.
    """
    ts = now_iso()
    record: dict[str, Any] = {
        "kind": kind,
        "created_at": ts,
        "payload": payload,
    }
    if run_id:
        record["run_id"] = run_id  # [TEL-04]

    # ── 1. Per-event JSON trace file ──────────────────────────────────────────
    ts_tag = datetime.now(UTC).strftime("trace-%Y%m%d%H%M%S%f")
    trace_path = runtime_dir / "traces" / f"{ts_tag}.json"
    try:
        write_json(trace_path, record)
    except Exception:
        pass

    # ── 2. Append to telemetry.jsonl with auto-rotation ───────────────────────
    try:
        jsonl_path = runtime_dir / "traces" / "telemetry.jsonl"
        jsonl_path.parent.mkdir(parents=True, exist_ok=True)
        _rotate_if_needed(jsonl_path)  # [TEL-02]
        with open(jsonl_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
    except Exception:
        pass

    # ── 3. Journal append for Fastify SSE poller ──────────────────────────────
    # [TEL-03] Writes to traces/journal.jsonl. The Fastify pyevents poller
    # polls this file every ~2500 ms and broadcasts new entries over SSE.
    # This is NOT an in-process pub/sub bus — it is file-backed fan-out.
    try:
        from .journal import append_event  # lazy import to avoid circular
        append_event(runtime_dir, kind, payload)
    except Exception:
        pass

    # ── 4. Structlog structured log ───────────────────────────────────────────
    if _STRUCTLOG_AVAILABLE and _log is not None:
        try:
            _log.info(kind, **{k: v for k, v in payload.items() if isinstance(k, str)})
        except Exception:
            pass
    else:
        # Minimal stderr fallback so events are visible even without structlog
        try:
            print(
                f"[swarmx.telemetry] {kind} {json.dumps(payload, ensure_ascii=False)[:200]}",
                file=sys.stderr,
            )
        except Exception:
            pass

    return trace_path
