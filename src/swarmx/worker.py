"""
swarmx.worker — Background job processing loop.

Runs as a daemon thread inside the Python HTTP server process.
Claims jobs from the SQLite queue, dispatches them to the appropriate
handler, and updates job state with results.

Supports job kinds: run, mission, evolve, plan, graph, search, inspect,
resume (V5 checkpoint-resume), and generic task.
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .event_bus import EventKind, publish  # [V5.9-FIX-05] EventKind added for strict-mode compliance
from .evolver import apply_proposals, build_evolution_proposals, run_skill_crystallization
from .execution_gate import gate_execution  # [V5.9-ENH-GATE-01] shared policy gate
from .executor import execute_plan
from .memory_graph import build_memory_graph, search_memory_graph
from .mission import build_mission, save_mission, activate_mission
from .planner import build_plan
# Single, consolidated queue import — includes V5 resume helpers.
# Previously there were two import lines for this module; the first was a stale
# duplicate left over from the V5 merge and shadowed by the second.
from .queue import claim_next_job, claim_resume_job, enqueue_resume, queue_summary, update_job
from .runtime import update_runtime_state
from .storage import list_jobs  # used in "inspect" job handler


class WorkerHandle:
    """Handle returned by start_worker(); allows the caller to stop the loop."""

    def __init__(self, stop_event: threading.Event, threads: list[threading.Thread]) -> None:
        self.stop_event = stop_event
        self.threads = threads

    def stop(self) -> None:
        """Signal all worker threads to exit on their next iteration."""
        self.stop_event.set()

    def join(self, timeout: float | None = None) -> None:
        """Wait for all worker threads to terminate."""
        for thread in self.threads:
            thread.join(timeout=timeout)


_DEF_TARGET = "repository acceleration"


def _process_job(
    runtime_home: Path,
    job: dict[str, Any],
    cfg: SwarmConfig,
    repo: Path | None,
) -> dict[str, Any]:
    """Dispatch a single job to its handler and return the result dict."""
    kind = str(job.get("kind") or "task")
    payload = dict(job.get("payload") or {})
    repo_path = Path(
        job.get("repo") or payload.get("repo") or repo or Path.cwd()
    ).expanduser().resolve()
    target = str(job.get("target") or payload.get("target") or _DEF_TARGET)

    publish(  # [V5.9-FIX-05] EventKind constant replaces bare string
        cfg.home, EventKind.WORKER_JOB_STARTED,
        {"job_id": job.get("id"), "kind": kind, "repo": str(repo_path), "target": target},
    )
    update_runtime_state(cfg.home, status="running", active_job=job)

    result: dict[str, Any]

    if kind in {"run", "run-repo", "mission", "orchestrate"}:
        mission = payload.get("mission")
        if not isinstance(mission, dict):
            mission = build_mission(
                repo_path, target, cfg=cfg,
                review_required=bool(payload.get("review_required", False)),
                autonomous=bool(payload.get("autonomous", True)),
            )
        mission = save_mission(cfg.home, mission)
        activate_mission(cfg.home, str(mission["id"]), status="running")
        plan = build_plan(
            target=target, repo=repo_path,
            review_required=bool(payload.get("review_required", False)),
            cfg=cfg,
        )
        # [V5.9-ENH-GATE-01] Policy gate: previously missing on the worker path.
        _policy = gate_execution(
            kind, target, repo_path, cfg,
            review_required=bool(payload.get("review_required", False)),
            job_id=str(job.get("id") or ""),
        )
        if not _policy.allowed:
            activate_mission(cfg.home, str(mission["id"]), status="blocked")
            return {"error": "policy_blocked", "policy": _policy.to_dict(), "target": target}
        record = execute_plan(
            repo_path, plan,
            run_id=str(job.get("run_id") or job.get("id")),
            autonomous=bool(payload.get("autonomous", True)),
            max_iterations=int(payload.get("max_iterations", cfg.max_iterations)),
            cfg=cfg,
        )
        mission_result = {"mission": mission, "plan": plan.to_dict(), "run": record.to_dict()}
        activate_mission(cfg.home, str(mission["id"]), status="completed", result=mission_result)
        result = mission_result

    elif kind in {"evolve", "evolution"}:
        proposals = build_evolution_proposals(cfg.home, repo=repo_path, cfg=cfg)
        results = apply_proposals(
            cfg.home, proposals,
            auto_apply=bool(payload.get("auto_apply", cfg.auto_apply)),
            cfg=cfg,
        )
        run_skill_crystallization(
            cfg.home, cfg=cfg,
            auto_apply=bool(payload.get("auto_apply", cfg.auto_apply)),
        )
        result = {
            "proposals": [p.to_dict() for p in proposals],
            "results": results,
        }

    elif kind in {"plan", "planning"}:
        plan = build_plan(
            target=target, repo=repo_path,
            review_required=bool(payload.get("review_required", False)),
            cfg=cfg,
        )
        result = {"plan": plan.to_dict()}

    elif kind in {"graph", "memory-graph"}:
        result = build_memory_graph(cfg.home, limit=int(payload.get("limit", 200)))

    elif kind in {"search", "memory-search"}:
        result = search_memory_graph(
            cfg.home,
            str(payload.get("query") or target),
            limit=int(payload.get("limit", 20)),
        )

    elif kind in {"inspect", "status"}:
        result = {"queue": queue_summary(cfg.home), "jobs": list_jobs(cfg.home, limit=25)}

    elif kind == "resume":
        # ── V5 Checkpoint-resume handler ─────────────────────────────────────
        # Re-enters execute_plan from a named checkpoint stage.
        # The job payload must carry: run_id, stage, resume_cursor (task index).
        run_id = str(job.get("run_id") or job.get("id"))
        resume_cursor = int(job.get("resume_cursor") or payload.get("resume_cursor") or 0)
        try:
            from .storage import list_checkpoints
            checkpoints = list_checkpoints(cfg.home, thread_id=None)
            matching = [
                c for c in checkpoints
                if run_id in str(c.get("thread_id", ""))
                and int(c.get("resume_cursor") or 0) <= resume_cursor
            ]
            state_snapshot: dict[str, Any] = {}
            if matching:
                latest = max(matching, key=lambda c: str(c.get("created_at", "")))
                state_snapshot = latest.get("state_snapshot") or {}

            plan_dict = state_snapshot.get("plan") or {}
            if plan_dict:
                from .state import Plan, TaskItem, RiskLevel
                tasks_raw = plan_dict.get("tasks", [])
                tasks = [
                    TaskItem(**{k: v for k, v in t.items() if k in TaskItem.__dataclass_fields__})
                    for t in tasks_raw[resume_cursor:]
                ]
                plan = Plan(
                    target=plan_dict.get("target", target),
                    workflow=plan_dict.get("workflow", cfg.workflow_preference),
                    stack=plan_dict.get("stack", []),
                    risk=RiskLevel(plan_dict.get("risk", "low")),
                    tasks=tasks,
                    approval_required=bool(plan_dict.get("approval_required", False)),
                    notes=plan_dict.get("notes", []),
                    frameworks=plan_dict.get("frameworks", []),
                )
            else:
                plan = build_plan(target=target, repo=repo_path, cfg=cfg)

            # [V5.9-FIX-03] resume_cursor is consumed above to slice tasks;
            # execute_plan signature does not accept it — passing it raised TypeError.
            # [V5.9-ENH-GATE-01] Policy gate for resume path.
            _policy = gate_execution(
                "resume", target, repo_path, cfg,
                job_id=run_id,
            )
            if not _policy.allowed:
                result = {"error": "policy_blocked", "policy": _policy.to_dict(), "resumed_from": resume_cursor}
            else:
                record = execute_plan(
                    repo_path, plan,
                    run_id=run_id,
                    autonomous=bool(payload.get("autonomous", True)),
                    max_iterations=int(payload.get("max_iterations", cfg.max_iterations)),
                    cfg=cfg,
                )
                result = {"run": record.to_dict(), "resumed_from": resume_cursor}
        except Exception as exc:
            result = {"error": str(exc), "resumed_from": resume_cursor}

    else:
        # Fallback: treat as a basic planning task
        plan = build_plan(target=target, repo=repo_path, cfg=cfg)
        result = {"plan": plan.to_dict(), "kind": kind}

    return result


def _worker_loop(
    runtime_home: Path,
    cfg: SwarmConfig,
    stop_event: threading.Event,
    repo: Path | None,
    interval: float,
) -> None:
    """Main worker loop: claim → dispatch → update, then sleep."""
    import time

    while not stop_event.is_set():
        try:
            # Check for a pending resume job first (higher priority)
            job = claim_resume_job(runtime_home) or claim_next_job(runtime_home)
            if job:
                job_id = str(job.get("id", ""))
                try:
                    result = _process_job(runtime_home, job, cfg, repo)
                    update_job(runtime_home, job_id, status="done", result=result)
                    publish(cfg.home, EventKind.WORKER_JOB_DONE, {"job_id": job_id, "result": result})  # [V5.9-FIX-05]
                except Exception as exc:
                    update_job(runtime_home, job_id, status="error", result={"error": str(exc)})
                    publish(cfg.home, EventKind.WORKER_JOB_ERROR, {"job_id": job_id, "error": str(exc)})  # [V5.9-FIX-05]
                finally:
                    update_runtime_state(runtime_home, status="idle", active_job=None)
        except Exception:
            # The loop must never crash — log and continue
            pass

        stop_event.wait(timeout=interval)


def start_worker(
    runtime_home: Path,
    cfg: SwarmConfig | None = None,
    repo: Path | None = None,
    n_threads: int = 1,
) -> WorkerHandle:
    """Start `n_threads` background worker daemon threads.

    Returns a WorkerHandle that can be used to stop the workers gracefully.
    Worker threads are daemon threads — they will not prevent process exit.
    """
    _cfg = cfg or SwarmConfig()
    interval = float(getattr(_cfg, "worker_interval", 2.0))
    stop_event = threading.Event()
    threads: list[threading.Thread] = []

    for i in range(max(1, n_threads)):
        t = threading.Thread(
            target=_worker_loop,
            args=(runtime_home, _cfg, stop_event, repo, interval),
            name=f"swarmx-worker-{i}",
            daemon=True,
        )
        t.start()
        threads.append(t)

    return WorkerHandle(stop_event=stop_event, threads=threads)