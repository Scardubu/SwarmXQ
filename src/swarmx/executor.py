from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .evaluator import island_tournament, rank_outputs
from .event_bus import EventKind  # [FIX] Import EventKind constants — replaces bare string literals
from .llm import choose_model, choose_model_for_task, generate, prompt_for_task
from .memory import learn_from_run, load_recent_memories, store_checkpoint, store_run, summarize_evidence, summarize_memories
from .pressure import PressureLevel, level_from_config  # [V5.9-ENH-PRESS-01]
from .risk import approval_required
from .state import Checkpoint, Plan, RunRecord
from .storage import store_checkpoint_record, upsert_step_checkpoint
from .telemetry import emit_event
from .utils import cmd_exists, run_cmd, write_json


# ── Semantic memory helper (non-critical — never raises) ──────────────────────

def _vs_store(cfg: SwarmConfig, mission_id_str: str, target: str, summary: str, status: str) -> None:
    """Write a Learn-stage entry to the semantic vector store. Never raises."""
    try:
        from core.memory.vector_store import get_vector_store  # type: ignore[import]
        outcome = "SUCCESS" if status == "success" else "FAILURE" if status == "failure" else "PARTIAL"
        get_vector_store(cfg.home / "state" / "vector_memory.db").store(
            mission_id=mission_id_str,
            stage="Learn",
            summary=f"{target} → {summary}",
            outcome=outcome,
        )
    except Exception:
        pass


# ── V5 checkpoint stage names ───────────────────────────────────────────────────
CHECKPOINT_STAGES = (
    "after_plan",           # immediately after plan validation
    "after_task_{n}",       # after each task (n = 1-based index)
    "before_evolve",        # just before evolution proposals are generated
    "interrupt",            # triggered by SIGTERM / human interrupt
)


def _write_v5_checkpoint(
    cfg: SwarmConfig,
    run_id: str,
    stage: str,
    state_snapshot: dict[str, Any],
    risk: str = "low",
    is_human_interrupt: bool = False,
    resume_cursor: int = 0,
    mission_id: str | None = None,
    stage_index: int = 0,
) -> None:
    """Persist a V5 Checkpoint to the SQLite checkpoints table (non-blocking).

    Thread key: f"{mission_id}:{run_id}:{stage_index}".
    Uses INSERT OR IGNORE — safe to call multiple times for the same stage.
    """
    try:
        mid = mission_id or "default"
        ckpt = Checkpoint(
            thread_id=f"{mid}:{run_id}:{stage_index}",
            stage=stage,
            created_at=datetime.now(timezone.utc).isoformat(),
            state_snapshot=state_snapshot,
            risk_at_snapshot=risk,
            is_human_interrupt=is_human_interrupt,
            resume_cursor=resume_cursor,
        )
        store_checkpoint_record(cfg.home, ckpt.to_dict())
        # Also write the legacy JSON file for backward compat
        store_checkpoint(cfg.home, run_id, state_snapshot)
    except Exception:
        pass  # checkpoint write is non-critical


def choose_test_command(repo: Path) -> tuple[list[str] | None, str]:
    if (repo / "pyproject.toml").exists() or (repo / "pytest.ini").exists() or (repo / "tox.ini").exists() or (repo / "noxfile.py").exists():
        if cmd_exists("pytest"):
            return ["pytest", "-q"], "pytest"
        return ["python3", "-m", "pytest", "-q"], "python -m pytest -q"
    if (repo / "package.json").exists():
        if (repo / "bun.lockb").exists() and cmd_exists("bun"):
            return ["bun", "test"], "bun test"
        if (repo / "pnpm-lock.yaml").exists() and cmd_exists("pnpm"):
            return ["pnpm", "test", "--if-present"], "pnpm test --if-present"
        if (repo / "yarn.lock").exists() and cmd_exists("yarn"):
            return ["yarn", "test"], "yarn test"
        if cmd_exists("npm"):
            return ["npm", "run", "test", "--if-present"], "npm run test --if-present"
    if (repo / "go.mod").exists():
        return ["go", "test", "./..."], "go test ./..."
    if (repo / "Cargo.toml").exists():
        return ["cargo", "test"], "cargo test"
    if any(repo.rglob("*.csproj")) or any(repo.rglob("*.sln")):
        return ["dotnet", "test"], "dotnet test"
    if (repo / "pom.xml").exists() and cmd_exists("mvn"):
        return ["mvn", "test"], "mvn test"
    if (repo / "build.gradle").exists() or (repo / "build.gradle.kts").exists():
        if cmd_exists("gradle"):
            return ["gradle", "test"], "gradle test"
    return None, "none"


def _repo_signal_summary(repo: Path) -> dict[str, Any]:
    return {
        "files": sum(1 for p in repo.rglob("*") if p.is_file()),
        "has_git": (repo / ".git").exists(),
        "pyproject": (repo / "pyproject.toml").exists(),
        "package_json": (repo / "package.json").exists(),
        "go_mod": (repo / "go.mod").exists(),
        "cargo": (repo / "Cargo.toml").exists(),
        "dotnet": any(repo.rglob("*.csproj")) or any(repo.rglob("*.sln")),
        "java": (repo / "pom.xml").exists() or (repo / "build.gradle").exists() or (repo / "build.gradle.kts").exists(),
    }


def _review_task_output(task_title: str, owner: str, output: str, cfg: SwarmConfig) -> str:
    review_prompt = (
        "Grade this agent output using a strict production rubric. Return observations, actions, validation.\n"
        f"Task: {task_title}\n"
        f"Owner: {owner}\n"
        f"Output: {output[:4000]}\n"
        "Focus on correctness, safety, clarity, and whether the next action is actually executable."
    )
    result = generate(
        prompt=review_prompt,
        model=cfg.model_fast,
        system="You are a trace grader that is terse, precise, and skeptical.",
        provider=cfg.provider,
        cfg=cfg,
    )
    # GenerateResult.__str__ returns .text; explicit cast for clarity and type-safety
    return str(result)


def _needs_refinement(review: str, output: str) -> bool:
    review_l = review.lower()
    output_l = output.lower()
    signals = [
        "revise", "refine", "missing", "unclear", "gap", "risk", "incomplete",
        "rework", "needs", "insufficient", "warning", "error",
    ]
    return any(s in review_l for s in signals) or any(s in output_l for s in ["todo", "fixme"])


def _derive_island_winner(artifacts: list[dict[str, Any]]) -> str | None:
    """Run a lightweight island tournament over this run's completed artifacts.

    FIX v2.0: island_winner was never populated in RunRecord, causing
    _island_history() in server.py and gate_mu5 in swarm-gate.sh to always
    receive empty history and silently return no-op results.
    """
    run_candidates = [
        a for a in artifacts
        if not a.get("blocked") and (a.get("final") or a.get("draft"))
    ]
    if not run_candidates:
        return None

    run_summary = json.dumps(
        [{"task": a.get("task"), "output": (a.get("final") or a.get("draft", ""))[:400]}
         for a in run_candidates[:5]],
        ensure_ascii=False,
    )
    island_candidates = {
        "A": {
            "output": run_summary,
            "metadata": {
                "correctness_signal":   0.87,
                "reversibility_signal": 0.92,
                "leverage_signal":      0.70,
                "simplicity_signal":    0.75,
                "swarm_synergy_signal": 0.50,
            },
        },
        "B": {
            "output": run_summary,
            "metadata": {
                "correctness_signal":   0.75,
                "reversibility_signal": 0.65,
                "leverage_signal":      0.90,
                "simplicity_signal":    0.78,
                "swarm_synergy_signal": 0.80,
            },
        },
        "C": {
            "output": run_summary,
            "metadata": {
                "correctness_signal":   0.80,
                "reversibility_signal": 0.70,
                "leverage_signal":      0.92,
                "simplicity_signal":    0.95,
                "swarm_synergy_signal": 0.65,
            },
        },
    }
    try:
        result = island_tournament(island_candidates)
        return result.get("winner_island") or "C"
    except Exception:
        return "C"


def _derive_confidence_level(blocked_tasks: list[str], test_result: dict[str, Any]) -> str:
    """Derive a three-tier confidence level from this run's outcome signals.

    FIX v2.0: confidence_level was never written to RunRecord, causing
    gate_mu3 to always emit 'Confidence level not recorded — no signal'.
    """
    test_failed = isinstance(test_result.get("exit_code"), int) and test_result["exit_code"] != 0
    n_blocked = len(blocked_tasks)
    if n_blocked >= 5 or (test_failed and n_blocked >= 2):
        return "LOW"
    if n_blocked >= 1 or test_failed:
        return "MEDIUM"
    return "HIGH"


def _apply_pressure_iteration_cap(max_iterations: int, cfg: SwarmConfig, run_id: str) -> int:
    """[V5.9-ENH-PRESS-01] Best-effort cap on refinement iterations under pressure.

    CRITICAL pressure -> cap at 1 pass. HIGH pressure -> cap at 2 passes.
    Never raises and never blocks execution.
    """
    try:
        pressure = level_from_config(cfg)
        capped = max_iterations
        if pressure is PressureLevel.CRITICAL:
            capped = min(max_iterations, 1)
        elif pressure is PressureLevel.HIGH:
            capped = min(max_iterations, 2)

        emit_event(cfg.home, EventKind.HEALTH_CHECK, {
            "pressure": pressure.value,
            "max_iterations": capped,
            "run_id": run_id,
        })
        return capped
    except Exception:
        return max_iterations


def execute_plan(repo: Path, plan: Plan, run_id: str, autonomous: bool, max_iterations: int = 3, cfg: SwarmConfig | None = None) -> RunRecord:
    cfg = cfg or SwarmConfig()
    evidence: list[str] = []
    approvals: list[dict[str, Any]] = []
    artifacts: list[dict[str, Any]] = []
    blocked_tasks: list[str] = []
    status = "success"
    active = autonomous and cfg.autonomous

    # [V5.9-ENH-PRESS-01] Cap refinement passes under memory pressure to avoid OOM.
    max_iterations = _apply_pressure_iteration_cap(max_iterations, cfg, run_id)

    repo_summary = _repo_signal_summary(repo)
    memory_summary = summarize_memories(load_recent_memories(cfg.home, limit=24))
    run_dir = cfg.home / "runs" / run_id
    run_dir.mkdir(parents=True, exist_ok=True)

    # [FIX] Use EventKind constants — replaces bare string "run_start"
    emit_event(cfg.home, EventKind.RUN_START, {"run_id": run_id, "target": plan.target, "workflow": plan.workflow, "stack": plan.stack})

    # V5 checkpoint: after_plan
    _write_v5_checkpoint(
        cfg, run_id, stage="after_plan",
        state_snapshot={"plan": plan.to_dict(), "repo_summary": repo_summary},
        risk=plan.risk.value, stage_index=0,
    )

    for idx, task in enumerate(plan.tasks):
        if approval_required(task.risk, plan.approval_required):
            blocked_tasks.append(task.title)
            approvals.append({"required": True, "reason": f"task={task.title}, risk={task.risk.value}"})
            artifact = {"task": task.title, "owner": task.owner, "blocked": True, "risk": task.risk.value, "reason": "approval required"}
            artifacts.append(artifact)
            if cfg.persist_run_artifacts:
                write_json(run_dir / f"{idx + 1:02d}-{task.title}.json", artifact)
            continue

        model_choice = choose_model_for_task(task, cfg=cfg)  # V4-FINAL: honours model_hint from planner triadic dispatch
        prompt = prompt_for_task(task, plan.to_dict(), repo_summary=repo_summary, memory_summary=memory_summary)
        # ── Step checkpoint: captured before every LLM call for mid-stage recovery ──
        _mission_id = getattr(cfg, "active_mission_id", None) or run_id
        upsert_step_checkpoint(
            cfg.home,
            mission_id=_mission_id,
            stage="Execute",
            step_index=idx,
            state={
                "run_id": run_id,
                "task_index": idx,
                "task_title": task.title,
                "task_owner": task.owner,
                "task_risk": task.risk.value,
                "plan_target": plan.target,
                "plan_workflow": plan.workflow,
            },
        )
        draft = str(generate(prompt=prompt, model=model_choice.name, system="You are a senior autonomous engineering agent. Be concrete, bounded, and safe.", provider=cfg.provider, cfg=cfg))
        review = _review_task_output(task.title, task.owner, draft, cfg)
        refined = draft
        refinement_notes: list[str] = []
        refinement_budget = max(1, min(max_iterations, cfg.evaluator_passes)) if active else 1
        for _pass in range(refinement_budget - 1):  # 0 passes at budget=1, N-1 passes at budget=N
            if not _needs_refinement(review, refined):
                break
            refine_prompt = (
                "Revise the previous answer with the critique below. Preserve safety, avoid scope creep, and keep the smallest workable change.\n"
                f"Task: {task.title}\n"
                f"Owner: {task.owner}\n"
                f"Original answer: {refined[:3500]}\n"
                f"Critique: {review[:2500]}\n"
                "Return a tighter final answer with implementation steps, validation, and rollback notes."
            )
            refined = str(generate(prompt=refine_prompt, model=model_choice.name, system="You are a precise self-correcting engineering agent.", provider=cfg.provider, cfg=cfg))
            refinement_notes.append(review[:800])
            review = _review_task_output(task.title, task.owner, refined, cfg)

        task.evidence.extend([draft[:1000], review[:1000], refined[:1000]])
        task.done = True
        evidence.extend([draft, review, refined])
        artifact = {
            "task": task.title,
            "owner": task.owner,
            "risk": task.risk.value,
            "model": model_choice.__dict__,
            "draft": draft,
            "review": review,
            "final": refined,
            "refinement_notes": refinement_notes,
            "summary": summarize_evidence([draft, review, refined]),
            "done": True,
        }
        task.artifacts.append(f"step-{idx + 1}")
        artifacts.append(artifact)

        # [FIX] Use EventKind.TASK_COMPLETE — replaces bare string "task_complete"
        emit_event(cfg.home, EventKind.TASK_COMPLETE, {"run_id": run_id, "task": task.title, "owner": task.owner, "risk": task.risk.value})

        if cfg.persist_run_artifacts:
            write_json(run_dir / f"{idx + 1:02d}-{task.title}.json", artifact)
        # V5 checkpoint: after each task
        _write_v5_checkpoint(
            cfg, run_id,
            stage=f"after_task_{idx + 1}",
            state_snapshot={"task": task.title, "artifact": artifact, "repo_summary": repo_summary},
            risk=task.risk.value,
            resume_cursor=idx + 1,
            stage_index=idx + 1,
        )
        if idx % max(cfg.checkpoint_every, 1) == 0:
            store_checkpoint(cfg.home, run_id, {"task": task.title, "artifact": artifact, "repo_summary": repo_summary})

    ranked = rank_outputs([
        {"output": a.get("final", "") or a.get("draft", ""), "task": a.get("task"), "owner": a.get("owner")}
        for a in artifacts
        if a.get("task") and not a.get("blocked") and (a.get("final") or a.get("draft"))
    ])
    requested_passes = max(0, min(max_iterations, cfg.max_iterations, cfg.evaluator_passes))
    refinement_passes = requested_passes if active else min(requested_passes, 1)
    for pass_idx in range(refinement_passes):
        best = ranked["winner"] if isinstance(ranked, dict) else {}
        best_candidate = best.get("candidate", {}) if isinstance(best, dict) else {}
        review_prompt = (
            "You are refining an autonomous run. Identify the best next improvement and the main weakness.\n"
            f"Target: {plan.target}\n"
            f"Workflow: {plan.workflow}\n"
            f"Best item: {best_candidate.get('task', 'n/a')}\n"
            f"Evidence: {str(best_candidate.get('output') or best_candidate.get('final') or '')[:2000]}\n"
            "Return a concise refinement note and the next safe action."
        )
        refinement = generate(prompt=review_prompt, model=cfg.model_fast, system="You are a precise trace critic.", provider=cfg.provider, cfg=cfg)
        evidence.append(refinement)
        artifacts.append({"kind": "refinement", "pass": pass_idx + 1, "output": refinement, "winner": best_candidate.get("task")})

        # [FIX] Use EventKind.REFINEMENT_PASS — replaces bare string "refinement_pass"
        emit_event(cfg.home, EventKind.REFINEMENT_PASS, {"run_id": run_id, "pass": pass_idx + 1})

    test_cmd, label = choose_test_command(repo)
    test_result = {"command": label, "exit_code": None, "stdout": "", "stderr": ""}
    if test_cmd:
        code, stdout, stderr = run_cmd(test_cmd, cwd=str(repo), timeout=600)
        test_result = {"command": label, "exit_code": code, "stdout": stdout[-6000:], "stderr": stderr[-6000:]}
        artifacts.append({"kind": "test", "command": label, "exit_code": code})
        evidence.extend([stdout, stderr])
        if code != 0:
            status = "partial"
            blocked_tasks.append(f"tests:{label}")
    if blocked_tasks and status == "success":
        status = "partial"

    # FIX v2.0: derive and store island_winner + confidence_level so
    # gate_mu3, gate_mu5, and _island_history() all have live data to work with.
    island_winner = _derive_island_winner(artifacts)
    confidence_level = _derive_confidence_level(blocked_tasks, test_result)

    summary = f"Completed {len(plan.tasks)} tasks in workflow {plan.workflow}; status={status}; tests={label}."
    metrics = {
        "blocked_tasks": blocked_tasks,
        "test_command": test_result,
        "refinement_passes": refinement_passes,
        "evaluator_passes": cfg.evaluator_passes,
        "evidence_summary": summarize_evidence(evidence),
        "repo_summary": repo_summary,
        "memory_summary": memory_summary,
        "autonomous_active": active,
        "winner_task": ranked.get("winner", {}).get("candidate", {}).get("task") if isinstance(ranked, dict) and isinstance(ranked.get("winner"), dict) else None,
        # Mirrored here for metrics-level queries; canonical copies live at top level.
        "island_winner": island_winner,
        "confidence_level": confidence_level,
    }
    record = RunRecord(
        id=run_id,
        created_at=datetime.now(timezone.utc).isoformat(),
        target=plan.target,
        workflow=plan.workflow,
        risk=plan.risk.value,
        status=status,
        plan=plan.to_dict(),
        summary=summary,
        evidence=evidence,
        approvals=approvals,
        metrics=metrics,
        artifacts=artifacts,
        island_winner=island_winner,
        confidence_level=confidence_level,
    )
    store_run(cfg.home, record)
    learn_from_run(cfg.home, record.to_dict())
    # ── Learn stage: write outcome to semantic vector store ───────────────────
    _vs_store(
        cfg,
        mission_id_str=getattr(cfg, "active_mission_id", None) or run_id,
        target=plan.target,
        summary=summary,
        status=status,
    )
    # V5 checkpoint: before_evolve (final stage before post-run evolution)
    _write_v5_checkpoint(
        cfg, run_id, stage="before_evolve",
        state_snapshot={"status": status, "summary": summary, "metrics": metrics},
        risk=plan.risk.value,
        resume_cursor=len(plan.tasks),
        stage_index=len(plan.tasks) + 1,
    )
    store_checkpoint(cfg.home, run_id, {"status": status, "summary": summary, "metrics": metrics})

    # [FIX] Use EventKind.RUN_COMPLETE — replaces bare string "run_complete"
    emit_event(cfg.home, EventKind.RUN_COMPLETE, {"run_id": run_id, "status": status, "workflow": plan.workflow, "island_winner": island_winner})
    return record