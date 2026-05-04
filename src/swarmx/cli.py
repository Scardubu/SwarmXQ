from __future__ import annotations

import argparse
import json
import logging
import os
import threading
import webbrowser
from urllib.parse import urlencode
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from rich.console import Console
from rich.table import Table

from . import __version__
from .audit import write_audit
from .config import SwarmConfig
from .evolver import apply_proposals, build_evolution_proposals, run_skill_crystallization
from .executor import execute_plan
from .framework_adapters import adapter_matrix, adapter_summary, preferred_orchestrator
from .memory import load_recent_memories, load_recent_runs, store_checkpoint, summarize_memories, summarize_runs
from .journal import append_event
from .metrics import build_metrics
from .queue import append_job, queue_summary, update_job, enqueue_resume
from .runtime import load_runtime_state, update_runtime_state
from .planner import build_plan, detect_stack
from .skills import skill_library
from .tooling import detect_tools, load_mcp_manifest, summarize_tooling
from .server import serve_dashboard
from .worker import start_worker
from .memory_graph import build_memory_graph, search_memory_graph
from .mission import build_mission, save_mission, activate_mission, mission_list
from .policy import assess_mission, assess_action  # V4: assess_action added for run/evolve gates
from .storage import write_audit_log, payload_sha256, list_incomplete_step_checkpoints
from .utils import platform_summary, read_json, write_json

logger = logging.getLogger(__name__)

console = Console()

_LEGACY_ONLY_COMMANDS = {
    "agents",
    "branch",
    "checkpoints",
    "config",
    "dashboard",
    "frameworks",
    "graph",
    "memory",
    "metrics",
    "mission",
    "models",
    "plan",
    "resume",
    "risk-score",
    "search",
    "serve",
    "templates",
    "worker",
    "workflows",
}
_PREMIUM_SUBCOMMANDS: dict[str, set[str]] = {
    "audit": {"show", "count"},
    "doctor": {"check"},
    "evolve": {"show", "generate", "review", "apply"},
    "inspect": {"mission", "memory", "graph"},
    "skills": {"list", "search", "show"},
    "status": {"show", "dashboard"},
    "telemetry": {"show", "stats", "reset"},
    "gate": {"check", "assess"},
}
_LEGACY_RUN_FLAGS = {"--target", "--autonomous", "--max-iterations", "--review-required"}


def _repo_root(path: str | Path) -> Path:
    p = Path(path).expanduser().resolve()
    if p.is_file():
        return p.parent
    return p


def _bundle_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _runtime_target(repo: Path) -> Path:
    return repo / ".swarmx"


def _first_non_flag(tokens: list[str]) -> str | None:
    for token in tokens:
        if not token.startswith("-"):
            return token
    return None


def _looks_like_repo_path(value: str) -> bool:
    if value in {".", ".."}:
        return True
    if value.startswith(("~", "/", "./", "../")):
        return True
    if os.sep in value or (os.altsep is not None and os.altsep in value):
        return True
    return Path(value).exists()


def _prefer_legacy_cli(argv: list[str] | None) -> bool:
    if not argv:
        return False

    command = argv[0]
    if command in _LEGACY_ONLY_COMMANDS:
        return True
    if command in {"banner", "version", "telemetry", "gate"}:
        return False
    if command == "doctor":
        return len(argv) == 1 or argv[1].startswith("-")
    if command == "evolve":
        return len(argv) == 1 or argv[1].startswith("-") or argv[1] not in _PREMIUM_SUBCOMMANDS["evolve"]
    if command == "run":
        if any(flag in argv[1:] for flag in _LEGACY_RUN_FLAGS):
            return True
        first_arg = _first_non_flag(argv[1:])
        return bool(first_arg and _looks_like_repo_path(first_arg))
    if command == "skills":
        first_arg = _first_non_flag(argv[1:])
        return first_arg is None or first_arg not in _PREMIUM_SUBCOMMANDS["skills"]
    if command in {"audit", "inspect", "status"}:
        first_arg = _first_non_flag(argv[1:])
        return bool(first_arg and first_arg not in _PREMIUM_SUBCOMMANDS[command])
    return False


def _copy_bundle_assets(bundle_root: Path, runtime: Path) -> None:
    for folder in ["agents", "workflows", "skills", "examples", "configs", "docs"]:
        src = bundle_root / folder
        if src.exists():
            dest = runtime / folder
            dest.mkdir(parents=True, exist_ok=True)
            for item in src.rglob("*"):
                if item.is_file():
                    rel = item.relative_to(src)
                    out = dest / rel
                    out.parent.mkdir(parents=True, exist_ok=True)
                    out.write_text(item.read_text(encoding="utf-8"), encoding="utf-8")


def _bootstrap_snapshot(repo: Path, cfg: SwarmConfig) -> dict[str, Any]:
    runtime = _runtime_target(repo)
    return {
        "created_at": datetime.now(timezone.utc).isoformat(),
        "repo": str(repo),
        "runtime": str(runtime),
        "stack": detect_stack(repo),
        "tools": detect_tools(),
        "models": {
            "provider": cfg.provider,
            "router": cfg.model_fast,
            "reason": cfg.model_reason,
            "code": cfg.model_code,
        },
        "frameworks": [row["name"] for row in adapter_matrix() if row.get("available")],
        "orchestrator": preferred_orchestrator(),
        "workflow_preference": cfg.workflow_preference,
        "safety": {
            "autonomous_default": cfg.autonomous,
            "review_required_default": cfg.review_required,
            "auto_apply_default": cfg.auto_apply,
            "checkpoint_every": cfg.checkpoint_every,
            "trace_every_stage": cfg.trace_every_stage,
            "persist_run_artifacts": cfg.persist_run_artifacts,
        },
    }


def init_repo(repo: Path) -> int:
    runtime = _runtime_target(repo)
    runtime.mkdir(parents=True, exist_ok=True)
    for sub in ["agent_roles", "workflows", "memory", "evolution/proposals", "evolution/applied", "traces", "skills", "plans", "reports", "configs", "docs"]:
        (runtime / sub).mkdir(parents=True, exist_ok=True)

    cfg = SwarmConfig()
    bootstrap = _bootstrap_snapshot(repo, cfg)
    data = {
        "version": __version__,
        "repo": str(repo),
        "created_at": bootstrap["created_at"],
        "provider": os.environ.get("SWARM_LLM_PROVIDER", cfg.provider),
        "model": os.environ.get("SWARM_MODEL", cfg.model),
        "model_router": os.environ.get("SWARM_MODEL_FAST", cfg.model_fast),
        "model_reason": os.environ.get("SWARM_MODEL_REASON", cfg.model_reason),
        "model_code": os.environ.get("SWARM_MODEL_CODE", cfg.model_code),
        "autonomous": os.environ.get("SWARM_AUTONOMOUS", "1"),
        "review_required": os.environ.get("SWARM_REVIEW_REQUIRED", "0"),
        "max_iterations": int(os.environ.get("SWARM_MAX_ITERATIONS", str(cfg.max_iterations))),
        "checkpoint_every": int(os.environ.get("SWARM_CHECKPOINT_EVERY", str(cfg.checkpoint_every))),
        "workflow_preference": os.environ.get("SWARM_WORKFLOW", cfg.workflow_preference),
        "framework_preference": [x.strip() for x in os.environ.get("SWARM_FRAMEWORKS", "").split(",") if x.strip()],
        "tool_allowlist": cfg.tool_allowlist,
        "orchestrator": preferred_orchestrator(),
        "bootstrap": bootstrap,
    }
    write_json(runtime / "config.json", data)
    write_json(runtime / "bootstrap.json", bootstrap)
    try:
        import yaml
        (runtime / "config.yaml").write_text(yaml.safe_dump(data, sort_keys=False), encoding="utf-8")
    except Exception:
        pass

    bundle_root = _bundle_root()
    _copy_bundle_assets(bundle_root, runtime)
    console.print(f"[green]Initialized[/green] {runtime}")
    return 0


def _mcp_servers(repo: Path | None, cfg: SwarmConfig) -> list[str]:
    manifest = load_mcp_manifest(repo, cfg.home)
    return summarize_tooling(manifest)


def _skill_count(repo: Path | None, cfg: SwarmConfig) -> int:
    return len(skill_library(repo=repo, runtime_home=cfg.home))


def doctor(json_mode: bool = False) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    payload = {
        "version": __version__,
        "platform": platform_summary(),
        "paths": {
            "home": str(cfg.home),
            "runs": str(cfg.runs_dir),
            "memory": str(cfg.memory_dir),
            "skills": str(cfg.skills_dir),
            "reports": str(cfg.reports_dir),
        },
        "tools": detect_tools(),
        "frameworks": adapter_matrix(),
        "orchestrator": preferred_orchestrator(),
        "provider": cfg.provider,
        "model_router": cfg.model_fast,
        "model_reason": cfg.model_reason,
        "model_code": cfg.model_code,
        "workflow_preference": cfg.workflow_preference,
        "mcp_servers": _mcp_servers(None, cfg),
        "skill_count": _skill_count(None, cfg),
        "config_profile": cfg.runtime_profile(),
    }
    if json_mode:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return 0
    table = Table(title="SwarmX Doctor")
    table.add_column("Check")
    table.add_column("Value")
    table.add_row("Version", __version__)
    table.add_row("Runtime home", str(cfg.home))
    table.add_row("Provider", cfg.provider)
    table.add_row("Router (Phi-4-mini)", cfg.model_fast)
    table.add_row("Reasoning (DeepSeek-R1)", cfg.model_reason)
    table.add_row("Execution (Qwen2.5-Coder)", cfg.model_code)
    table.add_row("Git", "yes" if payload["tools"]["git"] else "no")
    table.add_row("Python", "yes" if payload["tools"]["python"] else "no")
    table.add_row("Tmux", "yes" if payload["tools"]["tmux"] else "no")
    table.add_row("Frameworks", ", ".join([f"{x['name']}{'✓' if x['available'] else '×'}" for x in payload["frameworks"]]))
    table.add_row("Skills", str(payload["skill_count"]))
    console.print(table)
    console.print(adapter_summary())
    return 0


def plan(repo: Path, target: str, review_required: bool = False) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    plan_obj = build_plan(target=target, repo=repo, review_required=review_required, cfg=cfg)
    print(json.dumps(plan_obj.to_dict(), indent=2, ensure_ascii=False))
    return 0


def run(repo: Path, target: str, autonomous: bool = False, max_iterations: int = 3, review_required: bool = False) -> int:
    cfg = SwarmConfig()
    cfg.ensure()

    # ── Startup: resume any incomplete Execute-stage checkpoints ──────────────
    incomplete = list_incomplete_step_checkpoints(cfg.home)
    if incomplete:
        logger.info("Resuming %d incomplete stage(s) from step checkpoints", len(incomplete))
        for cp in incomplete:
            logger.info(
                "  → mission=%s stage=%s step=%s ts=%s",
                cp.get("mission_id"), cp.get("stage"), cp.get("step_index"), cp.get("ts"),
            )
    # ── End startup recovery ───────────────────────────────────────────────────

    plan_obj = build_plan(target=target, repo=repo, review_required=review_required or cfg.review_required, cfg=cfg)
    mission = build_mission(repo, target, cfg=cfg, review_required=review_required or cfg.review_required, autonomous=autonomous or cfg.autonomous)
    save_mission(cfg.home, mission)
    append_event(cfg.home, "mission.created", {"mission_id": mission["id"], "repo": str(repo), "target": target})

    # ── V4 Policy gate: assess every run before execution ─────────────────────
    policy_decision = assess_action("run", target, repo, cfg, review_required=review_required or cfg.review_required)
    _policy_proposal = {"action": "run", "target": target, "risk": policy_decision.risk, "reasons": policy_decision.reasons}
    write_audit_log(
        cfg.home,
        mission_id=mission["id"],
        stage="run",
        actor="policy_engine",
        action="POLICY_APPROVED" if policy_decision.allowed else "POLICY_REJECTED",
        payload_sha=payload_sha256(_policy_proposal),
        risk_score=float({"low": 0.1, "medium": 0.5, "high": 0.8, "critical": 1.0}.get(policy_decision.risk, 0.5)),
        notes=", ".join(policy_decision.reasons) if not policy_decision.allowed else None,
    )
    append_event(cfg.home, "policy.assessed", {
        "action": "run",
        "target": target,
        "risk": policy_decision.risk,
        "mode": policy_decision.mode,
        "human_gate": policy_decision.human_gate,
        "allowed": policy_decision.allowed,
        "reasons": policy_decision.reasons,
        "mitigations": policy_decision.mitigations,
        "confidence": policy_decision.confidence,
    })
    if not policy_decision.allowed:
        console.print(f"[bold red]╳ Policy BLOCKED[/bold red]: risk={policy_decision.risk}")
        console.print(f"  Reasons: {', '.join(policy_decision.reasons) or 'critical action with auto_apply=False'}")
        console.print(f"  Set SWARM_REVIEW_REQUIRED=0 and SWARM_RISK_FLOOR=low to relax the gate.")
        return 1
    if policy_decision.human_gate and not (autonomous or cfg.autonomous):
        console.print(f"[bold yellow]⚠ Policy GATE[/bold yellow]: human review required (risk={policy_decision.risk}).")
        console.print(f"  Mitigations: {', '.join(policy_decision.mitigations)}")
        console.print(f"  Pass --autonomous to proceed in autonomous mode.")
        return 1
    # ── End policy gate ────────────────────────────────────────────────────────

    job = append_job(cfg.home, {"kind": "run", "repo": str(repo), "target": target, "payload": {"mission": mission}})
    update_job(cfg.home, job["id"], status="running", run_id=job["id"])
    append_event(cfg.home, "run.started", {"job_id": job["id"], "repo": str(repo), "target": target})

    run_id = datetime.now(timezone.utc).strftime("run-%Y%m%d%H%M%S%f")
    record = execute_plan(repo=repo, plan=plan_obj, run_id=run_id, autonomous=autonomous or cfg.autonomous, max_iterations=max_iterations, cfg=cfg)

    checkpoint = store_checkpoint(cfg.home, run_id, {"plan": plan_obj.to_dict(), "summary": record.summary, "mission": mission})
    record.metrics["checkpoint"] = str(checkpoint)
    write_audit(cfg.home, record.to_dict())
    activate_mission(cfg.home, mission["id"], status="completed", result=record.to_dict())
    update_job(cfg.home, job["id"], status=str(record.status), run_id=record.id, result=record.to_dict())
    update_runtime_state(cfg.home, status="idle", last_run_id=record.id, last_run_status=record.status)
    append_event(cfg.home, "run.completed", {"job_id": job["id"], "run_id": record.id, "status": record.status})
    print(json.dumps({"mission": mission, "policy": policy_decision.to_dict(), **record.to_dict()}, indent=2, ensure_ascii=False))
    return 0 if record.status in {"success", "partial"} else 1


def evolve(repo: Path | None = None, auto_apply: bool = False, self_improve: bool = False, cycles: int = 1) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    repo = repo or Path.cwd()

    # ── V4 Policy gate: assess evolve flow before running proposals ───────────
    policy_decision = assess_action("evolve", "evolution proposals", repo, cfg)
    _evolve_mission_id = f"evolve-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S%f')}"
    _evolve_proposal = {"action": "evolve", "risk": policy_decision.risk, "reasons": policy_decision.reasons}
    write_audit_log(
        cfg.home,
        mission_id=_evolve_mission_id,
        stage="evolve",
        actor="policy_engine",
        action="POLICY_APPROVED" if policy_decision.allowed else "POLICY_REJECTED",
        payload_sha=payload_sha256(_evolve_proposal),
        risk_score=float({"low": 0.1, "medium": 0.5, "high": 0.8, "critical": 1.0}.get(policy_decision.risk, 0.5)),
        notes=", ".join(policy_decision.reasons) if not policy_decision.allowed else None,
    )
    append_event(cfg.home, "policy.assessed", {
        "action": "evolve",
        "risk": policy_decision.risk,
        "mode": policy_decision.mode,
        "allowed": policy_decision.allowed,
        "reasons": policy_decision.reasons,
    })
    if not policy_decision.allowed:
        console.print(f"[bold red]╳ Evolution BLOCKED by policy[/bold red]: {policy_decision.reasons}")
        return 1
    # ── End policy gate ────────────────────────────────────────────────────────

    job = append_job(cfg.home, {"kind": "evolve", "repo": str(repo)})
    update_job(cfg.home, job["id"], status="running")
    append_event(cfg.home, "evolution.started", {"job_id": job["id"], "repo": str(repo)})

    proposals = build_evolution_proposals(cfg.home, repo=repo, cfg=cfg)
    results = apply_proposals(cfg.home, proposals, auto_apply=auto_apply or cfg.auto_apply, cfg=cfg)
    run_skill_crystallization(cfg.home, cfg=cfg, auto_apply=auto_apply or cfg.auto_apply)

    update_job(cfg.home, job["id"], status="done", result=results)
    update_runtime_state(cfg.home, status="idle")
    append_event(cfg.home, "evolution.completed", {"job_id": job["id"], "proposal_count": len(proposals)})
    layer_payload = None
    if self_improve or os.environ.get("SWARM_SELF_IMPROVE", "0") == "1":
        try:
            from .evolution_layer.controller import run_cycle as run_v6_cycle
            layer_payload = run_v6_cycle(repo=repo, cfg=cfg, cycles=max(1, cycles), auto_deploy=auto_apply or cfg.auto_apply, dry_run=not (auto_apply or cfg.auto_apply))
        except Exception as exc:
            layer_payload = {"error": str(exc)}

    print(json.dumps({
        "proposals": [p.to_dict() for p in proposals],
        "results": results,
        "policy": policy_decision.to_dict(),
        "self_improve": layer_payload,
    }, indent=2, ensure_ascii=False))
    return 0


def evolve_layer(repo: Path | None = None, cycles: int = 1, auto_deploy: bool = False) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    repo = repo or Path.cwd()
    try:
        from .evolution_layer.controller import run_cycle as run_v6_cycle
        payload = run_v6_cycle(repo=repo, cfg=cfg, cycles=max(1, cycles), auto_deploy=auto_deploy, dry_run=not auto_deploy)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}, indent=2, ensure_ascii=False))
        return 1
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def inspect(repo: Path) -> int:
    cfg = SwarmConfig()
    runtime = _runtime_target(repo)
    payload = {
        "repo": str(repo),
        "runtime_exists": runtime.exists(),
        "stack": detect_stack(repo),
        "repo_config": SwarmConfig.load_repo(repo),
        "tooling": detect_tools(),
        "mcp_servers": _mcp_servers(repo, cfg),
        "recent_runs": summarize_runs(load_recent_runs(cfg.home, limit=10)),
        "memory": summarize_memories(load_recent_memories(cfg.home, limit=20)),
        "missions": mission_list(cfg.home, limit=10),
        "skills_loaded": _skill_count(repo, cfg),
        "config_profile": cfg.runtime_profile(),
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def status(repo: Path) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    runtime = _runtime_target(repo)
    payload = {
        "repo": str(repo),
        "runtime_exists": runtime.exists(),
        "bootstrap": read_json(runtime / "bootstrap.json", {}),
        "repo_config": SwarmConfig.load_repo(repo),
        "stack": detect_stack(repo),
        "tooling": detect_tools(),
        "mcp_servers": _mcp_servers(repo, cfg),
        "frameworks": adapter_matrix(),
        "orchestrator": preferred_orchestrator(),
        "models": {
            "provider": cfg.provider,
            "router": cfg.model_fast,
            "reason": cfg.model_reason,
            "code": cfg.model_code,
        },
        "workflow_preference": cfg.workflow_preference,
        "config_profile": cfg.runtime_profile(),
        "recent_runs": summarize_runs(load_recent_runs(cfg.home, limit=10)),
        "memory": summarize_memories(load_recent_memories(cfg.home, limit=20)),
        "missions": mission_list(cfg.home, limit=20),
        "paths": {
            "home": str(cfg.home),
            "runs": str(cfg.runs_dir),
            "memory": str(cfg.memory_dir),
            "reports": str(cfg.reports_dir),
            "traces": str(cfg.traces_dir),
        },
        "skills_loaded": _skill_count(repo, cfg),
        "runtime_state": load_runtime_state(cfg.home, default={}),
        "metrics": build_metrics(cfg.home),
        "queue": queue_summary(cfg.home),
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def agents_cmd(repo: Path | None = None) -> int:
    bundle_root = _bundle_root()
    agents = []
    for path in sorted((bundle_root / "agents").glob("*.md")):
        agents.append({"name": path.stem, "summary": path.read_text(encoding="utf-8").splitlines()[:6]})
    print(json.dumps({"agents": agents}, indent=2, ensure_ascii=False))
    return 0


def templates_cmd() -> int:
    bundle_root = _bundle_root()
    templates = []
    for path in sorted((bundle_root / "templates").glob("*")):
        if path.is_file():
            templates.append({"name": path.name, "size": path.stat().st_size})
    print(json.dumps({"templates": templates}, indent=2, ensure_ascii=False))
    return 0


def skills_cmd(repo: Path | None = None) -> int:
    cfg = SwarmConfig()
    skills = [s.to_dict() for s in skill_library(repo=repo, runtime_home=cfg.home)]
    print(json.dumps({"skills": skills}, indent=2, ensure_ascii=False))
    return 0


def config_cmd() -> int:
    cfg = SwarmConfig()
    bundle_root = _bundle_root()
    payload = {
        "version": __version__,
        "runtime": cfg.runtime_profile(),
        "bundle": {
            "root": str(bundle_root),
            "agents": len(list((bundle_root / "agents").glob("*.md"))),
            "skills": len(list((bundle_root / "skills").glob("*.md"))),
            "templates": len(list((bundle_root / "templates").glob("*"))),
            "workflows": len(list((bundle_root / "workflows").glob("*.yaml"))),
            "configs": [str(p.relative_to(bundle_root)) for p in (bundle_root / "configs").glob("*.yaml")],
        },
        "tool_allowlist": cfg.tool_allowlist,
        "paths": {
            "home": str(cfg.home),
            "reports": str(cfg.reports_dir),
            "skills": str(cfg.skills_dir),
            "traces": str(cfg.traces_dir),
        },
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def audit_cmd(repo: Path) -> int:
    cfg = SwarmConfig()
    runtime = _runtime_target(repo)
    runs = load_jsonl(cfg.memory_dir / "runs.jsonl")
    payload = {
        "repo": str(repo),
        "runtime_exists": runtime.exists(),
        "bootstrap": read_json(runtime / "bootstrap.json", {}),
        "summary": summarize_runs(runs),
        "recent_runs": summarize_runs(load_recent_runs(cfg.home, limit=10)),
        "memory": summarize_memories(load_recent_memories(cfg.home, limit=20)),
        "missions": mission_list(cfg.home, limit=10),
        "config_profile": cfg.runtime_profile(),
    }
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def memory_cmd() -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    memories = load_recent_memories(cfg.home, limit=50)
    print(json.dumps({"summary": summarize_memories(memories), "memories": memories}, indent=2, ensure_ascii=False))
    return 0


def graph_cmd(repo: str | None = None) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    data = build_memory_graph(cfg.home, limit=getattr(cfg, "graph_limit", 250))
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


def search_cmd(query: str) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    data = search_memory_graph(cfg.home, query, limit=getattr(cfg, "memory_search_limit", 20))
    print(json.dumps(data, indent=2, ensure_ascii=False))
    return 0


def mission_cmd(repo: str, target: str, review_required: bool = False, queue: bool = False) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    repo_path = _repo_root(repo)
    mission = build_mission(repo_path, target, cfg=cfg, review_required=review_required, autonomous=cfg.autonomous)
    save_mission(cfg.home, mission)
    append_event(cfg.home, "mission.created", {"mission_id": mission["id"], "repo": str(repo_path), "target": target})
    if queue:
        job = append_job(cfg.home, {"kind": "mission", "repo": str(repo_path), "target": target, "payload": {"mission": mission}})
        update_job(cfg.home, job["id"], status="queued")
        mission = {**mission, "queued_job": job}
    print(json.dumps({"mission": mission, "policy": assess_mission(target, repo=repo_path, cfg=cfg, review_required=review_required)}, indent=2, ensure_ascii=False))
    return 0


def worker_cmd(repo: str | None = None, once: bool = False) -> int:
    cfg = SwarmConfig()
    cfg.ensure()
    repo_path = _repo_root(repo) if repo else None
    handle = start_worker(runtime_home=cfg.home, repo=repo_path, cfg=cfg, interval=getattr(cfg, "worker_interval", 2.0), pool_size=getattr(cfg, "worker_pool_size", 1))
    if once:
        import time
        time.sleep(max(getattr(cfg, "worker_interval", 2.0), 0.5))
        handle.stop()
        handle.join(timeout=5)
        return 0
    try:
        handle.join()
    except KeyboardInterrupt:
        handle.stop()
        handle.join(timeout=5)
    return 0


def workflows_cmd() -> int:
    from .workflows import list_workflows, load_workflow
    items = []
    bundle_root = _bundle_root()
    for name in list_workflows():
        items.append(load_workflow(name, bundle_root=bundle_root))
    print(json.dumps({"workflows": items}, indent=2, ensure_ascii=False))
    return 0


def models_cmd() -> int:
    cfg = SwarmConfig()
    from .llm import local_models
    print(json.dumps({"provider": cfg.provider, "models": local_models(cfg), "config": cfg.runtime_profile()}, indent=2, ensure_ascii=False))
    return 0


def frameworks_cmd() -> int:
    table = Table(title="SwarmX Framework Matrix")
    table.add_column("Framework")
    table.add_column("Available")
    table.add_column("Description")
    for row in adapter_matrix():
        table.add_row(row["name"], "yes" if row.get("available") else "no", row.get("description", ""))
    console.print(table)
    return 0


def resume_cmd(run_id: str, *, stage: str = "after_plan") -> int:
    """Re-enqueue a stalled or interrupted run from its last checkpoint."""
    cfg = SwarmConfig()
    cfg.ensure()
    job = enqueue_resume(cfg.home, run_id=run_id, stage=stage, resume_cursor=0)
    console.print(f"[green]✓ Resume job enqueued[/green]  run_id={run_id}  stage={stage}  job_id={job['id']}")
    return 0


def branch_cmd(run_id: str, stage: str) -> int:
    """Branch a run from a specific checkpoint stage into a new run."""
    cfg = SwarmConfig()
    cfg.ensure()
    job = enqueue_resume(cfg.home, run_id=run_id, stage=stage, resume_cursor=0, branch_parent=run_id)
    console.print(f"[green]✓ Branch job enqueued[/green]  parent={run_id}  stage={stage}  job_id={job['id']}")
    return 0


def checkpoints_cmd(run_id: str) -> int:
    """List all checkpoints recorded for a given run_id."""
    from .storage import list_checkpoints
    cfg = SwarmConfig()
    cfg.ensure()
    records = list_checkpoints(cfg.home, thread_id=None)
    matching = [r for r in records if r.get("run_id") == run_id or run_id in str(r.get("run_id", ""))]
    if not matching:
        console.print(f"[yellow]No checkpoints found for run_id={run_id}[/yellow]")
        return 0
    table = Table(title=f"Checkpoints — {run_id}")
    table.add_column("stage")
    table.add_column("created_at")
    table.add_column("run_id")
    for r in matching:
        table.add_row(str(r.get("stage", "")), str(r.get("created_at", "")), str(r.get("run_id", "")))
    console.print(table)
    return 0


def risk_score_cmd(target: str, *, repo: Path) -> int:
    """Compute and print the risk score for a target without executing a run."""
    cfg = SwarmConfig()
    plan_obj = build_plan(target=target, repo=repo, cfg=cfg)
    risk = getattr(plan_obj, "risk", None)
    risk_val = risk.value if hasattr(risk, "value") else str(risk)
    print(json.dumps({"target": target, "repo": str(repo), "risk": risk_val, "plan_summary": plan_obj.to_dict()}, indent=2, ensure_ascii=False))
    return 0


def metrics_cmd() -> int:
    """Print V5 observable metrics as JSON to stdout."""
    from .metrics import build_v5_metrics
    cfg = SwarmConfig()
    cfg.ensure()
    payload = build_v5_metrics(cfg.home)
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    return 0


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        try:
            out.append(json.loads(line))
        except Exception:
            continue
    return out


def _legacy_main(argv: list[str] | None = None) -> int:
    """Original argparse-based CLI — preserved for backward compatibility."""
    parser = argparse.ArgumentParser(prog="swarm", description="SwarmX autonomous swarm control plane")
    parser.add_argument("-V", "--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    p_doctor = sub.add_parser("doctor", help="Check runtime and framework availability")
    p_doctor.add_argument("--json", action="store_true")

    p_init = sub.add_parser("init", help="Initialize a repo with .swarmx scaffolding")
    p_init.add_argument("repo")

    p_plan = sub.add_parser("plan", help="Generate a stack-aware plan")
    p_plan.add_argument("repo")
    p_plan.add_argument("target")
    p_plan.add_argument("--review-required", action="store_true")

    p_run = sub.add_parser("run", help="Run the autonomous swarm")
    p_run.add_argument("repo")
    p_run.add_argument("--target", default="repository acceleration")
    p_run.add_argument("--autonomous", action="store_true")
    p_run.add_argument("--max-iterations", type=int, default=3)
    p_run.add_argument("--review-required", action="store_true")

    p_evolve = sub.add_parser("evolve", help="Generate evolution proposals")
    p_evolve.add_argument("repo", nargs="?")
    p_evolve.add_argument("--auto-apply", action="store_true")
    p_evolve.add_argument("--self-improve", action="store_true", help="Run the V6 self-improving layer after proposal generation")
    p_evolve.add_argument("--cycles", type=int, default=1, help="Number of self-improving cycles to run when enabled")

    p_evolve_layer = sub.add_parser("evolve-layer", help="Run the V6 self-improving autonomous swarm layer")
    p_evolve_layer.add_argument("repo", nargs="?")
    p_evolve_layer.add_argument("--cycles", type=int, default=1)
    p_evolve_layer.add_argument("--auto-deploy", action="store_true")

    p_inspect = sub.add_parser("inspect", help="Inspect repo stack and runtime signals")
    p_inspect.add_argument("repo")

    p_agents = sub.add_parser("agents", help="Show the agent roster")
    p_agents.add_argument("repo", nargs="?")

    p_skills = sub.add_parser("skills", help="Show the skill library")
    p_skills.add_argument("repo", nargs="?")

    sub.add_parser("templates", help="Show the template library")

    p_audit = sub.add_parser("audit", help="Show a runtime summary")
    p_audit.add_argument("repo")

    sub.add_parser("memory", help="Show recent learned memories")
    sub.add_parser("workflows", help="Show available workflows")

    p_graph = sub.add_parser("graph", help="Show the durable memory graph")
    p_graph.add_argument("repo", nargs="?")

    # ── V5 subcommands ─────────────────────────────────────────────────────────
    p_resume = sub.add_parser("resume", help="Re-enqueue a run from its last checkpoint")
    p_resume.add_argument("run_id", help="Run ID to resume")
    p_resume.add_argument("--stage", default="after_plan", help="Checkpoint stage to resume from")

    p_branch = sub.add_parser("branch", help="Branch a run from a specific checkpoint stage")
    p_branch.add_argument("run_id", help="Parent run ID to branch from")
    p_branch.add_argument("stage", help="Checkpoint stage to branch from")

    p_checkpoints = sub.add_parser("checkpoints", help="List checkpoints for a run")
    p_checkpoints.add_argument("run_id", help="Run ID")

    p_risk = sub.add_parser("risk-score", help="Compute risk score for a target without executing")
    p_risk.add_argument("target", help="Mission target string")
    p_risk.add_argument("--repo", default=".")

    sub.add_parser("metrics", help="Print V5 observable metrics as JSON")

    p_search = sub.add_parser("search", help="Search memories and graph nodes")
    p_search.add_argument("query")

    p_mission = sub.add_parser("mission", help="Build and optionally queue a mission blueprint")
    p_mission.add_argument("repo")
    p_mission.add_argument("target")
    p_mission.add_argument("--review-required", action="store_true")
    p_mission.add_argument("--queue", action="store_true")

    p_worker = sub.add_parser("worker", help="Run the background job worker")
    p_worker.add_argument("repo", nargs="?")
    p_worker.add_argument("--once", action="store_true")

    sub.add_parser("models", help="Show local model routing")
    sub.add_parser("frameworks", help="Show optional framework adapters")
    sub.add_parser("config", help="Show merged configuration and templates")

    p_status = sub.add_parser("status", help="Show repo and runtime status")
    p_status.add_argument("repo")

    p_dashboard = sub.add_parser("dashboard", help="Serve the local dashboard")
    p_dashboard.add_argument("--repo", default=None)
    p_dashboard.add_argument("--host", default="127.0.0.1")
    p_dashboard.add_argument("--port", type=int, default=8787)
    p_dashboard.add_argument("--open-browser", action="store_true")

    p_serve = sub.add_parser("serve", help="Alias for dashboard")
    p_serve.add_argument("--repo", default=None)
    p_serve.add_argument("--host", default="127.0.0.1")
    p_serve.add_argument("--port", type=int, default=8787)
    p_serve.add_argument("--open-browser", action="store_true")

    args = parser.parse_args(argv)

    if args.command == "doctor":
        return doctor(json_mode=args.json)
    if args.command == "init":
        return init_repo(_repo_root(args.repo))
    if args.command == "plan":
        return plan(_repo_root(args.repo), args.target, review_required=args.review_required)
    if args.command == "run":
        return run(_repo_root(args.repo), args.target, autonomous=args.autonomous, max_iterations=args.max_iterations, review_required=args.review_required)
    if args.command == "evolve":
        return evolve(_repo_root(args.repo) if args.repo else None, auto_apply=args.auto_apply, self_improve=getattr(args, "self_improve", False), cycles=getattr(args, "cycles", 1))
    if args.command == "evolve-layer":
        return evolve_layer(_repo_root(args.repo) if args.repo else None, cycles=getattr(args, "cycles", 1), auto_deploy=getattr(args, "auto_deploy", False))
    if args.command == "inspect":
        return inspect(_repo_root(args.repo))
    if args.command == "agents":
        return agents_cmd(_repo_root(args.repo) if args.repo else None)
    if args.command == "skills":
        return skills_cmd(_repo_root(args.repo) if args.repo else None)
    if args.command == "templates":
        return templates_cmd()
    if args.command == "audit":
        return audit_cmd(_repo_root(args.repo))
    if args.command == "memory":
        return memory_cmd()
    if args.command == "graph":
        return graph_cmd(getattr(args, "repo", None))
    if args.command == "search":
        return search_cmd(args.query)
    if args.command == "mission":
        return mission_cmd(args.repo, args.target, review_required=args.review_required, queue=args.queue)
    if args.command == "worker":
        return worker_cmd(getattr(args, "repo", None), once=getattr(args, "once", False))
    if args.command == "workflows":
        return workflows_cmd()
    if args.command == "models":
        return models_cmd()
    if args.command == "frameworks":
        return frameworks_cmd()
    if args.command == "config":
        return config_cmd()
    if args.command == "status":
        return status(_repo_root(args.repo))
    if args.command == "resume":
        return resume_cmd(args.run_id, stage=args.stage)
    if args.command == "branch":
        return branch_cmd(args.run_id, args.stage)
    if args.command == "checkpoints":
        return checkpoints_cmd(args.run_id)
    if args.command == "risk-score":
        return risk_score_cmd(args.target, repo=_repo_root(args.repo))
    if args.command == "metrics":
        return metrics_cmd()
    if args.command in {"dashboard", "serve"}:
        cfg = SwarmConfig()
        cfg.ensure()
        host = getattr(args, "host", "127.0.0.1")
        port = getattr(args, "port", 8787)
        repo_arg = getattr(args, "repo", None)
        httpd = serve_dashboard(host=host, port=port, cfg=cfg)
        url = f"http://{host}:{port}"
        browser_url = url
        if repo_arg:
            browser_url = f"{url}?{urlencode({'repo': str(_repo_root(repo_arg))})}"
        if getattr(args, "open_browser", False):
            threading.Thread(target=lambda: webbrowser.open(browser_url), daemon=True).start()
        console.print(f"[green]SwarmX dashboard ready[/green] {browser_url}")
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.shutdown()
        return 0
    return 2


def main(argv: list[str] | None = None) -> int:  # noqa: D401
    """CLI entry point — delegates to the premium Typer app when available.

    Falls back to the legacy argparse implementation so that the ``swarm`` /
    ``swarmx`` entry points keep working even when *typer* is not installed.
    """
    if _prefer_legacy_cli(argv):
        return _legacy_main(argv)
    try:
        from swarmx.console.entry import main as _premium_main  # type: ignore[import]

        # Typer does not accept an *argv* argument — it always reads sys.argv.
        # When called via the legacy shim path, we splice argv into sys.argv so
        # the Typer app sees the right arguments.
        if argv is not None:
            import sys
            _orig, sys.argv = sys.argv[:], [sys.argv[0]] + list(argv)
            try:
                _premium_main()
            finally:
                sys.argv = _orig
        else:
            _premium_main()
        return 0
    except SystemExit as exc:
        return int(exc.code) if exc.code is not None else 0
    except ImportError:
        return _legacy_main(argv)
