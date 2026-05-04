from __future__ import annotations

import json
import secrets
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .runtime import ensure_runtime_dirs, load_runtime_state, update_runtime_state
from .storage import claim_next_job as db_claim_next_job, list_jobs as db_list_jobs, upsert_job as db_upsert_job, update_job as db_update_job


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def queue_path(runtime_home: Path) -> Path:
    return runtime_home / "queue" / "jobs.jsonl"


def _job_id(kind: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    nonce = secrets.token_hex(3)
    return f"job-{kind}-{stamp}-{nonce}"


def load_jobs(runtime_home: Path, limit: int = 100) -> list[dict[str, Any]]:
    try:
        stored = db_list_jobs(runtime_home, limit=limit)
        if stored:
            return stored
    except Exception:
        pass
    path = queue_path(runtime_home)
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _write_jobs(runtime_home: Path, jobs: list[dict[str, Any]]) -> None:
    ensure_runtime_dirs(runtime_home)
    path = queue_path(runtime_home)
    text = "\n".join(json.dumps(job, ensure_ascii=False) for job in jobs)
    path.write_text((text + "\n") if text else "", encoding="utf-8")


def _active_job(jobs: list[dict[str, Any]]) -> dict[str, Any] | None:
    for job in reversed(jobs):
        if job.get("status") in {"running", "queued", "pending"}:
            return job
    return None


def append_job(runtime_home: Path, job: dict[str, Any]) -> dict[str, Any]:
    ensure_runtime_dirs(runtime_home)
    job = dict(job)
    job.setdefault("id", _job_id(str(job.get("kind") or "task")))
    job.setdefault("created_at", now_iso())
    job.setdefault("updated_at", job["created_at"])
    job.setdefault("status", "queued")
    job.setdefault("attempts", 0)
    job.setdefault("notes", [])
    jobs = load_jobs(runtime_home, limit=500)
    jobs.append(job)
    _write_jobs(runtime_home, jobs)
    try:
        db_upsert_job(runtime_home, job)
    except Exception:
        pass
    update_runtime_state(
        runtime_home,
        queue_depth=len([j for j in jobs if j.get("status") not in {"done", "failed", "cancelled"}]),
        active_job=_active_job(jobs),
    )
    return job


def claim_next_job(runtime_home: Path) -> dict[str, Any] | None:
    try:
        job = db_claim_next_job(runtime_home)
        if job:
            return job
    except Exception:
        pass
    jobs = load_jobs(runtime_home, limit=500)
    for job in jobs:
        if job.get("status") in {"queued", "pending"}:
            job["status"] = "running"
            job["attempts"] = int(job.get("attempts") or 0) + 1
            job["updated_at"] = now_iso()
            _write_jobs(runtime_home, jobs)
            return job
    return None


def update_job(runtime_home: Path, job_id: str, **patch: Any) -> dict[str, Any] | None:
    jobs = load_jobs(runtime_home, limit=500)
    updated = None
    for job in jobs:
        if job.get("id") == job_id:
            job.update(patch)
            job["updated_at"] = now_iso()
            updated = job
            break
    if updated is not None:
        _write_jobs(runtime_home, jobs)
        try:
            db_update_job(runtime_home, job_id, **patch)
        except Exception:
            pass
        update_runtime_state(
            runtime_home,
            queue_depth=len([j for j in jobs if j.get("status") not in {"done", "failed", "cancelled"}]),
            active_job=_active_job(jobs),
            last_run_id=updated.get("run_id") or updated.get("id"),
            last_run_status=updated.get("status"),
        )
    return updated


def queue_summary(runtime_home: Path) -> dict[str, Any]:
    jobs = load_jobs(runtime_home, limit=200)
    active = _active_job(jobs)
    pending = [j for j in jobs if j.get("status") in {"queued", "pending", "running"}]
    completed = [j for j in jobs if j.get("status") == "done"]
    failed = [j for j in jobs if j.get("status") == "failed"]
    runtime_state = load_runtime_state(runtime_home, default={})
    return {
        "jobs": jobs[-50:],
        "active_job": active,
        "queue_depth": len(pending),
        "completed": len(completed),
        "failed": len(failed),
        "status": runtime_state.get("status", "idle"),
    }


# ── V5 Resume job kind ──────────────────────────────────────────────────────────

def enqueue_resume(
    runtime_home: Path,
    run_id: str,
    stage: str,
    resume_cursor: int = 0,
    mission_id: str | None = None,
    branch_parent: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Enqueue a resume job that will restart execution from a named checkpoint.

    The worker loop's ``claim_next_job`` already claims any queued job regardless
    of kind; this function ensures the resume payload is fully formed so the
    worker can reconstruct context without re-reading the checkpoint table.

    Args:
        run_id:        The original run ID to resume.
        stage:         Checkpoint stage name to resume from (e.g. "after_task_3").
        resume_cursor: Task index to restart from (0-based).
        mission_id:    Optional parent mission ID.
        branch_parent: If this is a branch replay, the parent checkpoint thread_id.
        metadata:      Any additional key/value context to attach to the job.
    """
    job: dict[str, Any] = {
        "kind": "resume",
        "run_id": run_id,
        "stage": stage,
        "resume_cursor": resume_cursor,
        "mission_id": mission_id,
        "branch_parent": branch_parent,
        **(metadata or {}),
    }
    return append_job(runtime_home, job)


def claim_resume_job(runtime_home: Path) -> dict[str, Any] | None:
    """Claim the oldest pending resume job specifically.

    Workers that want to handle resume separately from normal run jobs
    should call this before ``claim_next_job`` to give resume jobs priority.
    Returns None if no resume jobs are waiting.
    """
    try:
        from .storage import connect
        with connect(runtime_home) as conn:
            row = conn.execute(
                """
                UPDATE jobs SET status='running', attempts=attempts+1, updated_at=?
                WHERE id = (
                    SELECT id FROM jobs
                    WHERE status IN ('queued','pending')
                      AND json_extract(payload,'$.kind') = 'resume'
                    ORDER BY created_at ASC
                    LIMIT 1
                )
                RETURNING payload
                """,
                (now_iso(),),
            ).fetchone()
            if row:
                import json as _j
                return _j.loads(row["payload"]) if isinstance(row["payload"], str) else dict(row)
    except Exception:
        pass

    # JSONL fallback
    jobs = load_jobs(runtime_home, limit=500)
    for job in jobs:
        if job.get("status") in {"queued", "pending"} and job.get("kind") == "resume":
            job["status"] = "running"
            job["attempts"] = int(job.get("attempts") or 0) + 1
            job["updated_at"] = now_iso()
            _write_jobs(runtime_home, jobs)
            return job
    return None
