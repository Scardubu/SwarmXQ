from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
from collections.abc import Iterable
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

from .runtime import ensure_runtime_dirs
from .utils import write_json

_DB_LOCK = threading.RLock()


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def database_path(runtime_home: Path) -> Path:
    return runtime_home / "state" / "swarmx.sqlite3"


def _json_dumps(payload: Any) -> str:
    try:
        return json.dumps(payload, ensure_ascii=False, sort_keys=True)
    except Exception:
        return json.dumps({"_repr": repr(payload)}, ensure_ascii=False)


def _json_loads(value: str | None, default: Any = None) -> Any:
    if not value:
        return default
    try:
        return json.loads(value)
    except Exception:
        return default


@contextmanager
def connect(runtime_home: Path):
    ensure_runtime_dirs(runtime_home)
    db = database_path(runtime_home)
    db.parent.mkdir(parents=True, exist_ok=True)
    with _DB_LOCK:
        conn = sqlite3.connect(db, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.execute("PRAGMA foreign_keys=ON")
            conn.execute("PRAGMA busy_timeout=5000")
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()


def init_store(runtime_home: Path) -> Path:
    with connect(runtime_home) as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS kv (
                value TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS jobs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                status TEXT NOT NULL,
                repo TEXT,
                target TEXT,
                run_id TEXT,
                attempts INTEGER NOT NULL DEFAULT 0,
                payload TEXT NOT NULL,
                result TEXT
            );
            CREATE TABLE IF NOT EXISTS runs (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                workflow TEXT,
                status TEXT,
                risk TEXT,
                target TEXT,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS memories (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                kind TEXT NOT NULL,
                summary TEXT,
                content TEXT,
                tags TEXT,
                source_run TEXT,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS proposals (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                scope TEXT,
                status TEXT,
                score REAL,
                payload TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS missions (
                id TEXT PRIMARY KEY,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                repo TEXT,
                target TEXT,
                objective TEXT,
                workflow TEXT,
                risk TEXT,
                status TEXT,
                policy TEXT,
                plan TEXT,
                result TEXT,
                payload TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
            CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
            CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
            CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind, created_at);
            CREATE INDEX IF NOT EXISTS idx_memories_tags ON memories(tags);
            CREATE INDEX IF NOT EXISTS idx_proposals_scope ON proposals(scope, created_at);
            CREATE INDEX IF NOT EXISTS idx_missions_status ON missions(status, created_at);
            CREATE TABLE IF NOT EXISTS audit_log (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                ts          TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                mission_id  TEXT    NOT NULL,
                stage       TEXT    NOT NULL,
                actor       TEXT    NOT NULL,
                action      TEXT    NOT NULL,
                payload_sha TEXT,
                risk_score  REAL,
                notes       TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_audit_mission ON audit_log(mission_id, ts);
            CREATE TABLE IF NOT EXISTS step_checkpoints (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                mission_id  TEXT NOT NULL,
                stage       TEXT NOT NULL,
                step_index  INTEGER NOT NULL DEFAULT 0,
                state_json  TEXT NOT NULL,
                ts          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                UNIQUE(mission_id, stage, step_index)
            );
            CREATE TABLE IF NOT EXISTS skills (
                id           TEXT PRIMARY KEY,
                name         TEXT NOT NULL,
                description  TEXT,
                template     TEXT NOT NULL,
                version      INTEGER NOT NULL DEFAULT 1,
                source       TEXT NOT NULL DEFAULT 'crystallized',
                status       TEXT NOT NULL DEFAULT 'proposed',
                created_ts   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
                activated_ts TEXT
            );
            CREATE INDEX IF NOT EXISTS idx_skills_status ON skills(status, created_ts);
            """
        )
    # Run V5 idempotent migration (checkpoints, narratives, FTS5, etc.)
    try:
        from .migrations.v5_memory import run_v5_migration
        run_v5_migration(runtime_home)
    except Exception:
        pass  # V5 migration is additive; never block startup
    return database_path(runtime_home)


def set_kv(runtime_home: Path, key: str, value: Any) -> None:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        conn.execute(
            "INSERT INTO kv(key, value, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, _json_dumps(value), now_iso()),
        )


def get_kv(runtime_home: Path, key: str, default: Any = None) -> Any:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        row = conn.execute("SELECT value FROM kv WHERE key=?", (key,)).fetchone()
    if not row:
        return default
    return _json_loads(row[0], default)


def record_event(runtime_home: Path, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
    init_store(runtime_home)
    event = {"kind": kind, "created_at": now_iso(), "payload": payload}
    with connect(runtime_home) as conn:
        conn.execute(
            "INSERT INTO events(created_at, kind, payload) VALUES (?, ?, ?)",
            (event["created_at"], event["kind"], _json_dumps(event["payload"])),
        )
    return event


def list_events(runtime_home: Path, limit: int = 100) -> list[dict[str, Any]]:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        rows = conn.execute(
            "SELECT created_at, kind, payload FROM events ORDER BY id DESC LIMIT ?",
            (max(int(limit), 0),),
        ).fetchall()
    return [
        {"created_at": row[0], "kind": row[1], "payload": _json_loads(row[2], {})}
        for row in reversed(rows)
    ]


def upsert_job(runtime_home: Path, job: dict[str, Any]) -> dict[str, Any]:
    init_store(runtime_home)
    payload = dict(job)
    payload.setdefault("id", f"job-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}")
    payload.setdefault("created_at", now_iso())
    payload.setdefault("updated_at", payload["created_at"])
    payload.setdefault("status", "queued")
    payload.setdefault("attempts", 0)
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO jobs(id, created_at, updated_at, kind, status, repo, target, run_id, attempts, payload, result)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                updated_at=excluded.updated_at,
                kind=excluded.kind,
                status=excluded.status,
                repo=excluded.repo,
                target=excluded.target,
                run_id=excluded.run_id,
                attempts=excluded.attempts,
                payload=excluded.payload,
                result=excluded.result
            """,
            (
                payload["id"],
                payload["created_at"],
                payload["updated_at"],
                str(payload.get("kind") or "task"),
                str(payload.get("status") or "queued"),
                payload.get("repo"),
                payload.get("target"),
                payload.get("run_id"),
                int(payload.get("attempts") or 0),
                _json_dumps(payload),
                _json_dumps(payload.get("result")) if payload.get("result") is not None else None,
            ),
        )
    return payload


def update_job(runtime_home: Path, job_id: str, **patch: Any) -> dict[str, Any] | None:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        row = conn.execute("SELECT payload FROM jobs WHERE id=?", (job_id,)).fetchone()
        if not row:
            return None
        job = _json_loads(row[0], {}) or {}
        job.update(patch)
        job["updated_at"] = now_iso()
        conn.execute(
            """
            UPDATE jobs
            SET updated_at=?, kind=?, status=?, repo=?, target=?, run_id=?, attempts=?, payload=?, result=?
            WHERE id=?
            """,
            (
                job["updated_at"],
                str(job.get("kind") or "task"),
                str(job.get("status") or "queued"),
                job.get("repo"),
                job.get("target"),
                job.get("run_id"),
                int(job.get("attempts") or 0),
                _json_dumps(job),
                _json_dumps(job.get("result")) if job.get("result") is not None else None,
                job_id,
            ),
        )
    return job


def list_jobs(runtime_home: Path, limit: int = 200) -> list[dict[str, Any]]:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        rows = conn.execute(
            "SELECT payload FROM jobs ORDER BY created_at DESC LIMIT ?",
            (max(int(limit), 0),),
        ).fetchall()
    out = []
    for row in reversed(rows):
        job = _json_loads(row[0], {}) or {}
        if job:
            out.append(job)
    return out


def claim_next_job(runtime_home: Path) -> dict[str, Any] | None:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        row = conn.execute(
            "SELECT id, payload FROM jobs WHERE status IN ('queued', 'pending') ORDER BY created_at ASC LIMIT 1",
        ).fetchone()
        if not row:
            return None
        job = _json_loads(row[1], {}) or {}
        job["status"] = "running"
        job["attempts"] = int(job.get("attempts") or 0) + 1
        job["updated_at"] = now_iso()
        conn.execute(
            "UPDATE jobs SET status='running', attempts=?, updated_at=?, payload=? WHERE id=?",
            (job["attempts"], job["updated_at"], _json_dumps(job), row[0]),
        )
    return job


def store_run_record(runtime_home: Path, record: dict[str, Any]) -> dict[str, Any]:
    init_store(runtime_home)
    payload = dict(record)
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO runs(id, created_at, workflow, status, risk, target, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                created_at=excluded.created_at,
                workflow=excluded.workflow,
                status=excluded.status,
                risk=excluded.risk,
                target=excluded.target,
                payload=excluded.payload
            """,
            (
                payload.get("id"),
                payload.get("created_at") or now_iso(),
                payload.get("workflow"),
                payload.get("status"),
                payload.get("risk"),
                payload.get("target"),
                _json_dumps(payload),
            ),
        )
    return payload


def list_runs(runtime_home: Path, limit: int = 200) -> list[dict[str, Any]]:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        rows = conn.execute(
            "SELECT payload FROM runs ORDER BY created_at DESC LIMIT ?",
            (max(int(limit), 0),),
        ).fetchall()
    return [(_json_loads(row[0], {}) or {}) for row in reversed(rows)]


def store_memory_record(runtime_home: Path, entry: dict[str, Any]) -> dict[str, Any]:
    init_store(runtime_home)
    payload = dict(entry)
    payload.setdefault("id", f"memory-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}")
    payload.setdefault("created_at", now_iso())
    payload.setdefault("kind", "lesson")
    tags = payload.get("tags") or []
    if isinstance(tags, str):
        tags = [tags]
    tags = [str(tag) for tag in tags if str(tag).strip()]
    payload["tags"] = tags
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO memories(id, created_at, kind, summary, content, tags, source_run, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                created_at=excluded.created_at,
                kind=excluded.kind,
                summary=excluded.summary,
                content=excluded.content,
                tags=excluded.tags,
                source_run=excluded.source_run,
                payload=excluded.payload
            """,
            (
                payload["id"],
                payload["created_at"],
                payload.get("kind", "lesson"),
                payload.get("summary"),
                payload.get("content"),
                _json_dumps(tags),
                payload.get("source_run"),
                _json_dumps(payload),
            ),
        )
    return payload


def list_memories(runtime_home: Path, limit: int = 200) -> list[dict[str, Any]]:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        rows = conn.execute(
            "SELECT payload FROM memories ORDER BY created_at DESC LIMIT ?",
            (max(int(limit), 0),),
        ).fetchall()
    return [(_json_loads(row[0], {}) or {}) for row in reversed(rows)]


def search_memories(runtime_home: Path, query: str, limit: int = 20) -> list[dict[str, Any]]:
    terms = [term for term in query.lower().split() if term]
    if not terms:
        return list_memories(runtime_home, limit=limit)
    matches: list[tuple[int, dict[str, Any]]] = []
    for memory in list_memories(runtime_home, limit=500):
        hay = " ".join([
            str(memory.get("kind", "")),
            str(memory.get("summary", "")),
            str(memory.get("content", "")),
            " ".join(memory.get("tags", []) or []),
        ]).lower()
        score = sum(hay.count(term) for term in terms)
        if score:
            matches.append((score, memory))
    matches.sort(key=lambda item: (item[0], str(item[1].get("created_at", ""))), reverse=True)
    return [memory for _, memory in matches[:limit]]


def store_proposal_record(runtime_home: Path, proposal: dict[str, Any]) -> dict[str, Any]:
    init_store(runtime_home)
    payload = dict(proposal)
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO proposals(id, created_at, scope, status, score, payload)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                created_at=excluded.created_at,
                scope=excluded.scope,
                status=excluded.status,
                score=excluded.score,
                payload=excluded.payload
            """,
            (
                payload.get("id"),
                payload.get("created_at") or now_iso(),
                payload.get("scope"),
                payload.get("status"),
                payload.get("score"),
                _json_dumps(payload),
            ),
        )
    return payload


def list_proposals(runtime_home: Path, limit: int = 100) -> list[dict[str, Any]]:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        rows = conn.execute(
            "SELECT payload FROM proposals ORDER BY created_at DESC LIMIT ?",
            (max(int(limit), 0),),
        ).fetchall()
    return [(_json_loads(row[0], {}) or {}) for row in reversed(rows)]


def store_snapshot(runtime_home: Path, name: str, payload: dict[str, Any]) -> Path:
    init_store(runtime_home)
    path = runtime_home / "state" / f"{name}.json"
    write_json(path, payload)
    set_kv(runtime_home, f"snapshot:{name}", payload)
    return path


def store_bulk_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as fh:
        for row in rows:
            fh.write(json.dumps(row, ensure_ascii=False) + "\n")


def store_mission_record(runtime_home: Path, mission: dict[str, Any]) -> dict[str, Any]:
    init_store(runtime_home)
    payload = dict(mission)
    payload.setdefault("id", f"mission-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}")
    payload.setdefault("created_at", now_iso())
    payload.setdefault("updated_at", payload["created_at"])
    payload.setdefault("status", "proposed")
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO missions(id, created_at, updated_at, repo, target, objective, workflow, risk, status, policy, plan, result, payload)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                updated_at=excluded.updated_at,
                repo=excluded.repo,
                target=excluded.target,
                objective=excluded.objective,
                workflow=excluded.workflow,
                risk=excluded.risk,
                status=excluded.status,
                policy=excluded.policy,
                plan=excluded.plan,
                result=excluded.result,
                payload=excluded.payload
            """,
            (
                payload["id"],
                payload["created_at"],
                payload["updated_at"],
                payload.get("repo"),
                payload.get("target"),
                payload.get("objective"),
                payload.get("workflow"),
                payload.get("risk"),
                payload.get("status"),
                _json_dumps(payload.get("policy")) if payload.get("policy") is not None else None,
                _json_dumps(payload.get("plan")) if payload.get("plan") is not None else None,
                _json_dumps(payload.get("result")) if payload.get("result") is not None else None,
                _json_dumps(payload),
            ),
        )
    return payload


def update_mission_record(runtime_home: Path, mission_id: str, **patch: Any) -> dict[str, Any] | None:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        row = conn.execute("SELECT payload FROM missions WHERE id=?", (mission_id,)).fetchone()
        if not row:
            return None
        mission = _json_loads(row[0], {}) or {}
        mission.update(patch)
        mission["updated_at"] = now_iso()
        conn.execute(
            """
            UPDATE missions
            SET updated_at=?, repo=?, target=?, objective=?, workflow=?, risk=?, status=?, policy=?, plan=?, result=?, payload=?
            WHERE id=?
            """,
            (
                mission["updated_at"],
                mission.get("repo"),
                mission.get("target"),
                mission.get("objective"),
                mission.get("workflow"),
                mission.get("risk"),
                mission.get("status"),
                _json_dumps(mission.get("policy")) if mission.get("policy") is not None else None,
                _json_dumps(mission.get("plan")) if mission.get("plan") is not None else None,
                _json_dumps(mission.get("result")) if mission.get("result") is not None else None,
                _json_dumps(mission),
                mission_id,
            ),
        )
    return mission


def list_missions(runtime_home: Path, limit: int = 100) -> list[dict[str, Any]]:
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        rows = conn.execute(
            "SELECT payload FROM missions ORDER BY created_at DESC LIMIT ?",
            (max(int(limit), 0),),
        ).fetchall()
    return [(_json_loads(row[0], {}) or {}) for row in reversed(rows)]


# ── V5 StorageBackend Protocol ─────────────────────────────────────────────────

@runtime_checkable
class StorageBackend(Protocol):
    """Structural interface for pluggable storage backends.

    The default backend is the SQLite WAL implementation above.
    Third-party integrations may provide alternative backends (e.g. Redis,
    Postgres) by satisfying this protocol without inheriting from any base class.
    """

    def get(self, key: str, default: Any = None) -> Any: ...
    def set(self, key: str, value: Any) -> None: ...
    def list_runs(self, limit: int = 200) -> list[dict[str, Any]]: ...
    def list_memories(self, limit: int = 200) -> list[dict[str, Any]]: ...
    def list_events(self, limit: int = 100) -> list[dict[str, Any]]: ...
    def record_event(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]: ...


class _SQLiteBackend:
    """Default StorageBackend backed by SQLite WAL (satisfies the protocol)."""

    def __init__(self, runtime_home: Path) -> None:
        self._home = runtime_home

    def get(self, key: str, default: Any = None) -> Any:
        return get_kv(self._home, key, default)

    def set(self, key: str, value: Any) -> None:
        set_kv(self._home, key, value)

    def list_runs(self, limit: int = 200) -> list[dict[str, Any]]:
        return list_runs(self._home, limit=limit)

    def list_memories(self, limit: int = 200) -> list[dict[str, Any]]:
        return list_memories(self._home, limit=limit)

    def list_events(self, limit: int = 100) -> list[dict[str, Any]]:
        return list_events(self._home, limit=limit)

    def record_event(self, kind: str, payload: dict[str, Any]) -> dict[str, Any]:
        return record_event(self._home, kind, payload)


_BACKEND_CACHE: dict[Path, StorageBackend] = {}
_BACKEND_LOCK = threading.Lock()


def get_backend(runtime_home: Path) -> StorageBackend:
    """Return the singleton StorageBackend for the given runtime_home.

    Thread-safe. Uses _SQLiteBackend by default.
    Override for testing by replacing _BACKEND_CACHE[runtime_home] before use.
    """
    with _BACKEND_LOCK:
        if runtime_home not in _BACKEND_CACHE:
            _BACKEND_CACHE[runtime_home] = _SQLiteBackend(runtime_home)
        return _BACKEND_CACHE[runtime_home]


# ── V5 checkpoint helpers ───────────────────────────────────────────────────────

def store_checkpoint_record(runtime_home: Path, ckpt: dict[str, Any]) -> dict[str, Any]:
    """Persist a Checkpoint (as dict) to the checkpoints table.

    Requires V5 migration to have run (init_store handles this).
    Append-only: IGNORE on conflict preserves historical checkpoints.
    """
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT OR IGNORE INTO checkpoints
                (thread_id, stage, created_at, state_snapshot, risk_at_snapshot,
                 is_human_interrupt, resume_cursor, branch_parent)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                ckpt.get("thread_id"),
                ckpt.get("stage"),
                ckpt.get("created_at") or now_iso(),
                _json_dumps(ckpt.get("state_snapshot", {})),
                ckpt.get("risk_at_snapshot", "low"),
                int(bool(ckpt.get("is_human_interrupt", False))),
                int(ckpt.get("resume_cursor") or 0),
                ckpt.get("branch_parent"),
            ),
        )
    return ckpt


def list_checkpoints(runtime_home: Path, thread_id: str) -> list[dict[str, Any]]:
    """Return all checkpoints for a given thread, ordered by creation time."""
    init_store(runtime_home)
    try:
        with connect(runtime_home) as conn:
            rows = conn.execute(
                "SELECT * FROM checkpoints WHERE thread_id=? ORDER BY created_at ASC",
                (thread_id,),
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception:
        return []


def store_dispatch_telemetry(runtime_home: Path, record: dict[str, Any]) -> None:
    """Append a triadic dispatch telemetry record (non-critical; never raises)."""
    try:
        init_store(runtime_home)
        with connect(runtime_home) as conn:
            conn.execute(
                """
                INSERT INTO dispatch_telemetry
                    (run_id, task_id, model_fast, model_reason, model_code,
                     selected_model, latency_ms, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    record.get("run_id"),
                    record.get("task_id"),
                    record.get("model_fast"),
                    record.get("model_reason"),
                    record.get("model_code"),
                    record.get("selected_model"),
                    record.get("latency_ms"),
                    record.get("created_at") or now_iso(),
                ),
            )
    except Exception:
        pass


# ── Audit log ──────────────────────────────────────────────────────────────────

def payload_sha256(payload: Any) -> str:
    """Return the hex SHA-256 of the canonical JSON encoding of *payload*."""
    canonical = json.dumps(payload, sort_keys=True, ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


def write_audit_log(
    runtime_home: Path,
    *,
    mission_id: str,
    stage: str,
    actor: str,
    action: str,
    payload_sha: str | None = None,
    risk_score: float | None = None,
    notes: str | None = None,
) -> None:
    """Append an immutable audit record to the audit_log table.

    Non-critical path: exceptions are silently swallowed so that a logging
    failure never interrupts the main execution flow.
    """
    try:
        init_store(runtime_home)
        with connect(runtime_home) as conn:
            conn.execute(
                """
                INSERT INTO audit_log(mission_id, stage, actor, action, payload_sha, risk_score, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (mission_id, stage, actor, action, payload_sha, risk_score, notes),
            )
    except Exception:
        pass


# ── Step-granular checkpoints (mission / stage / step) ────────────────────────

# ── Skills (crystallized + human) ─────────────────────────────────────────────────────

def store_skill_record(runtime_home: Path, skill: dict[str, Any]) -> dict[str, Any]:
    """Upsert a skill record into the skills table.

    ``skill`` must contain at minimum ``id``, ``name``, and ``template``.
    On conflict the name, description, template, and status are updated;
    ``version`` is incremented and ``source`` is preserved from the original row.
    """
    init_store(runtime_home)
    skill = dict(skill)
    skill.setdefault("id", f"skill-{skill.get('name', 'unknown')}")
    skill.setdefault("source", "crystallized")
    skill.setdefault("status", "proposed")
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO skills(id, name, description, template, version, source, status)
            VALUES (?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                name         = excluded.name,
                description  = excluded.description,
                template     = excluded.template,
                version      = skills.version + 1,
                status       = excluded.status
            """,
            (
                skill["id"],
                skill["name"],
                skill.get("description"),
                _json_dumps(skill.get("template", {})),
                skill["source"],
                skill["status"],
            ),
        )
    return skill


def list_skill_records(
    runtime_home: Path,
    status: str | None = None,
    limit: int = 100,
) -> list[dict[str, Any]]:
    """Return skill records, optionally filtered by status.

    Each returned dict has the DB columns plus a deserialized ``template`` key.
    """
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        if status:
            rows = conn.execute(
                "SELECT id, name, description, template, version, source, status, "
                "created_ts, activated_ts FROM skills WHERE status=? "
                "ORDER BY created_ts DESC LIMIT ?",
                (status, max(int(limit), 0)),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT id, name, description, template, version, source, status, "
                "created_ts, activated_ts FROM skills "
                "ORDER BY created_ts DESC LIMIT ?",
                (max(int(limit), 0),),
            ).fetchall()
    result: list[dict[str, Any]] = []
    for row in rows:
        record = dict(row)
        record["template"] = _json_loads(record.get("template"), {})
        result.append(record)
    return result


def upsert_step_checkpoint(
    runtime_home: Path,
    mission_id: str,
    stage: str,
    step_index: int,
    state: dict[str, Any],
) -> None:
    """Persist a step-granular checkpoint (upsert — idempotent on conflict)."""
    init_store(runtime_home)
    with connect(runtime_home) as conn:
        conn.execute(
            """
            INSERT INTO step_checkpoints(mission_id, stage, step_index, state_json)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(mission_id, stage, step_index)
            DO UPDATE SET
                state_json = excluded.state_json,
                ts         = strftime('%Y-%m-%dT%H:%M:%fZ','now')
            """,
            (mission_id, stage, step_index, _json_dumps(state)),
        )


def list_incomplete_step_checkpoints(runtime_home: Path) -> list[dict[str, Any]]:
    """Return step checkpoints for missions whose status is not 'COMPLETE'.

    Used at startup to detect and resume interrupted Execute stages.
    """
    init_store(runtime_home)
    try:
        with connect(runtime_home) as conn:
            rows = conn.execute(
                """
                SELECT sc.*
                FROM step_checkpoints sc
                WHERE sc.mission_id NOT IN (
                    SELECT id FROM missions WHERE status = 'COMPLETE'
                )
                ORDER BY sc.mission_id, sc.stage, sc.step_index
                """,
            ).fetchall()
        return [dict(row) for row in rows]
    except Exception:
        return []
