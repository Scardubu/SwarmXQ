from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .memory import load_recent_memories, load_recent_runs
from .memory_graph import build_memory_graph
from .queue import queue_summary
from .storage import list_events, list_jobs, list_memories, list_missions, list_proposals, list_runs


def build_metrics(runtime_home: Path) -> dict[str, Any]:
    runs = list_runs(runtime_home, limit=250) or load_recent_runs(runtime_home, limit=250)
    memories = list_memories(runtime_home, limit=250) or load_recent_memories(runtime_home, limit=250)
    proposals = list_proposals(runtime_home, limit=100)
    missions = list_missions(runtime_home, limit=200)
    jobs = list_jobs(runtime_home, limit=100)
    events = list_events(runtime_home, limit=250)
    queue = queue_summary(runtime_home)
    graph = build_memory_graph(runtime_home, limit=250)
    total = len(runs)
    succeeded = [r for r in runs if str(r.get("status", "")).lower() in {"done", "success", "succeeded", "completed"}]
    failed = [r for r in runs if str(r.get("status", "")).lower() in {"failed", "error", "partial"}]
    by_workflow = Counter(str(r.get("workflow") or "unknown") for r in runs)
    by_risk = Counter(str(r.get("risk") or "unknown") for r in runs)
    by_mission = Counter(str(m.get("status") or "unknown") for m in missions)
    last = runs[-1] if runs else None
    last_event = events[-1] if events else None
    active_mission = next((m for m in reversed(missions) if str(m.get("status") or "").lower() in {"proposed", "queued", "running", "active", "in_progress"}), None)
    return {
        "total_runs": total,
        "success_count": len(succeeded),
        "failure_count": len(failed),
        "success_rate": round(len(succeeded) / max(total, 1), 3),
        "memory_count": len(memories),
        "proposal_count": len(proposals),
        "mission_count": len(missions),
        "job_count": len(jobs),
        "event_count": len(events),
        "queue_depth": queue["queue_depth"],
        "active_job": queue["active_job"],
        "active_mission": active_mission,
        "last_run_id": last.get("id") if last else None,
        "last_run_status": last.get("status") if last else None,
        "last_event": last_event,
        "by_workflow": dict(by_workflow),
        "by_risk": dict(by_risk),
        "by_mission_status": dict(by_mission),
        "graph": graph["summary"],
    }


# ── V5 Metric Keys (17 new observable signals) ────────────────────────────────

NEW_V5_METRICS: list[str] = [
    # Checkpointing
    "checkpoint_count",             # V5 checkpoints written
    "resume_success_count",         # successful resume-from-checkpoint runs
    "resume_fail_count",            # failed resume runs
    # Memory health
    "memory_hit_rate",              # avg fraction of hybrid_search calls returning ≥1 result
    "memory_tournament_wins",       # Dr. Zero island A tournament wins
    "consolidation_count",          # memories successfully consolidated
    # Proposals
    "proposal_acceptance_rate",     # accepted proposals / total
    # Sandbox
    "sandbox_run_count",            # total sandbox execution calls
    # Narrative & coherence
    "narrative_generated_count",    # post-run narratives successfully generated
    "anomaly_detected_count",       # narrative.detect_anomaly flagged events
    "scs_history",                  # [float] last-N SCS readings
    # Dispatch telemetry
    "llm_routing_by_tier",          # {fast: N, reason: N, code: N}
    # Skills & evolution
    "skill_promotion_count",        # skills auto-promoted from runs
    "tournament_crossover_count",   # cross-island candidates evaluated
    # Resource
    "vram_ceiling_hits",            # μ-10 VRAM ceiling breach events
    "retry_count_by_model",         # {model_id: retry_count}
    "governor_snapshot",           # procfs-derived pressure and active governor limits
]


def _build_governor_snapshot() -> dict[str, Any]:
    """Return the current runtime governor snapshot for API/dashboard consumers."""
    try:
        from .config import SwarmConfig, _cfg
        from .pressure import concurrency_limit_from_config, get_pressure

        swarm_cfg = SwarmConfig()
        zram_device_mb = int(_cfg("system", "zram_device_size_mb", default=4096))
        zram_warn_pct = float(_cfg("governance", "pressure", "zram_warn_used_pct", default=0.60))
        zram_critical_pct = float(_cfg("governance", "pressure", "zram_critical_used_pct", default=0.85))
        token_ceilings = _cfg(
            "governance",
            "token_ceilings",
            default={
                "fast": 512,
                "worker": 1024,
                "supervisor": 1536,
                "reasoner": 4096,
                "critic": 2048,
            },
        ) or {}

        snapshot = get_pressure(
            warn_mb=swarm_cfg.pressure_warn_mb,
            critical_mb=swarm_cfg.pressure_critical_mb,
            zram_warn_pct=zram_warn_pct,
            zram_critical_pct=zram_critical_pct,
            zram_device_mb=zram_device_mb,
            ttl_s=swarm_cfg.pressure_check_interval_s,
        )

        return {
            "pressureLevel": snapshot.level.value,
            "availableMb": snapshot.available_mb,
            "zramUsedPct": snapshot.zram_used_pct,
            "concurrencyLimit": int(concurrency_limit_from_config(swarm_cfg)),
            "observeOnly": bool(swarm_cfg.governance_observe_only),
            "tokenCeilings": {str(key): int(value) for key, value in dict(token_ceilings).items()},
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception:
        return {
            "pressureLevel": "normal",
            "availableMb": 0,
            "zramUsedPct": 0.0,
            "concurrencyLimit": 1,
            "observeOnly": False,
            "tokenCeilings": {
                "fast": 512,
                "worker": 1024,
                "supervisor": 1536,
                "reasoner": 4096,
                "critic": 2048,
            },
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }


def build_v5_metrics(runtime_home: Path) -> dict[str, Any]:
    """Compute V5-specific observable signals.

    Extends build_metrics() with NEW_V5_METRICS.
    Performance contract: < 20ms (all reads from SQLite WAL; no LLM calls).
    """
    from .storage import connect, get_kv
    from .narrative import compute_scs

    base = build_metrics(runtime_home)

    v5: dict[str, Any] = {}

    try:
        with connect(runtime_home) as conn:
            # checkpoint_count
            try:
                row = conn.execute("SELECT COUNT(*) as c FROM checkpoints").fetchone()
                v5["checkpoint_count"] = int(row["c"]) if row else 0
            except Exception:
                v5["checkpoint_count"] = 0

            # consolidation_count
            try:
                row = conn.execute("SELECT COUNT(*) as c FROM memory_consolidations").fetchone()
                v5["consolidation_count"] = int(row["c"]) if row else 0
            except Exception:
                v5["consolidation_count"] = 0

            # llm_routing_by_tier — {fast: N, reason: N, code: N}
            try:
                tier_counts: dict[str, int] = {"fast": 0, "reason": 0, "code": 0}
                for tier, model_key in (("fast", "model_fast"), ("reason", "model_reason"), ("code", "model_code")):
                    row = conn.execute(
                        "SELECT COUNT(*) as c FROM dispatch_telemetry WHERE selected_model=?",
                        (model_key,),
                    ).fetchone()
                    tier_counts[tier] = int(row["c"]) if row else 0
                v5["llm_routing_by_tier"] = tier_counts
            except Exception:
                v5["llm_routing_by_tier"] = {"fast": 0, "reason": 0, "code": 0}

            # proposal_acceptance_rate
            try:
                row_accepted = conn.execute(
                    "SELECT COUNT(*) as c FROM proposals WHERE status IN ('accepted','applied')"
                ).fetchone()
                row_total = conn.execute("SELECT COUNT(*) as c FROM proposals").fetchone()
                total_p = int(row_total["c"]) if row_total else 0
                accepted_p = int(row_accepted["c"]) if row_accepted else 0
                v5["proposal_acceptance_rate"] = round(accepted_p / max(total_p, 1), 4)
            except Exception:
                v5["proposal_acceptance_rate"] = 0.0

    except Exception:
        pass

    # KV-based scalar counters (incremented by respective modules at runtime)
    _kv_scalar: list[str] = [
        "resume_success_count",
        "resume_fail_count",
        "memory_hit_rate",
        "memory_tournament_wins",
        "sandbox_run_count",
        "narrative_generated_count",
        "anomaly_detected_count",
        "skill_promotion_count",
        "tournament_crossover_count",
        "vram_ceiling_hits",
    ]
    for key in _kv_scalar:
        if key not in v5:
            try:
                raw = get_kv(runtime_home, f"metric:{key}")
                v5[key] = float(raw) if raw is not None else 0
            except Exception:
                v5[key] = 0

    # retry_count_by_model — {model_id: int}
    if "retry_count_by_model" not in v5:
        try:
            raw = get_kv(runtime_home, "metric:retry_count_by_model")
            v5["retry_count_by_model"] = raw if isinstance(raw, dict) else {}
        except Exception:
            v5["retry_count_by_model"] = {}

    # scs_history — append current SCS to stored list, return last 20 readings
    try:
        current_scs = compute_scs(runtime_home)
        try:
            history: list[float] = get_kv(runtime_home, "metric:scs_history") or []
            if not isinstance(history, list):
                history = []
            history.append(round(current_scs, 4))
            history = history[-20:]  # keep last 20 readings
            from .storage import set_kv
            set_kv(runtime_home, "metric:scs_history", history)
            v5["scs_history"] = history
        except Exception:
            v5["scs_history"] = [round(current_scs, 4)]
    except Exception:
        v5["scs_history"] = []

    v5["governor_snapshot"] = _build_governor_snapshot()

    return {**base, **v5}
