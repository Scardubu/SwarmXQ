"""src/swarmx/startup — SwarmX V6.2 Startup Autopilot
======================================================
Runs once per process launch:
  1. Fast health diagnostic (RAM, ZRAM, Ollama reachability)
  2. Pressure check and initial concurrency resolution
  3. phi4-fast model warmup — only if model is already resident in Ollama
  4. Evolver cycle sync (dry-run, background)
  5. Emit a structured StartupSummary with warm user narrative

Design invariants:
  - Every step is try/except with a hard time budget — never blocks launch.
  - No LLM calls for narrative generation (uses a static copy table).
  - Does not modify config or load models itself; only queries state.
  - StartupSummary.to_dict() emits camelCase JSON for API/SSE consumers.

[V6.1-ENH-01] New module. Wired into swarmx up (cmd_start) and exposed
              as a standalone entry point via `python -m swarmx.startup`.
[V6.2-FIX-25] _warmup_models() now checks /api/ps before sending a generate
              request. If phi4-fast is not resident, warmup is skipped. This
              prevents the Ollama HTTP deadlock: on 8 GB / no-GPU hosts,
              loading a fresh model (4.1 GB) via stream=false blocks Ollama's
              HTTP accept loop for 60-120 s. A 20 s warmup timeout would
              disconnect the client mid-load, leaving Ollama's handler blocked
              and deadlocking all subsequent probe calls (/api/version, etc.).
"""
from __future__ import annotations

import asyncio
import json
import os
import time
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import structlog

log = structlog.get_logger("swarmx.startup")

# ── Startup config helpers ────────────────────────────────────────────────────

# [V6.1-FIX-03] Startup budgets now resolve through the canonical config stack
# instead of living as hardcoded module constants.
def _startup_timeout(key: str, env_key: str, default: float) -> float:
    try:
        from .config import _cfg

        raw = os.environ.get(env_key)
        if raw is not None:
            return float(raw)
        return float(_cfg("startup", key, default=default))
    except Exception:
        raw = os.environ.get(env_key)
        return float(raw) if raw is not None else default


def _health_budget_s() -> float:
    return _startup_timeout("health_timeout_s", "SWARM_STARTUP_HEALTH_TIMEOUT_S", 6.0)


def _warmup_budget_s() -> float:
    return _startup_timeout("warmup_timeout_s", "SWARM_STARTUP_WARMUP_TIMEOUT_S", 20.0)


def _evolver_budget_s() -> float:
    return _startup_timeout("evolver_timeout_s", "SWARM_STARTUP_EVOLVER_TIMEOUT_S", 15.0)


def _exc_reason(exc: Exception) -> str:
    reason = str(exc).strip()
    if reason:
        return reason
    return exc.__class__.__name__

# ── Narrative copy table ──────────────────────────────────────────────────────
# Key: (overall_status, pressure_level) → user-facing string.
# Internal = concise logs; external = warm, confident, slightly playful.

_NARRATIVES: dict[tuple[str, str], str] = {
    ("ready",    "normal"):   "The swarm is humming beautifully. All systems nominal — models warm, memory green, ready to go.",
    ("ready",    "high"):     "Swarm is alive and lively! RAM is a bit snug today, but we're managing gracefully.",
    ("ready",    "critical"): "Running lean, but still sharp. Sequential mode active to protect stability — we've got this.",
    ("degraded", "normal"):   "Almost fully up — something minor didn't respond, but the core is solid. Check swarm-doctor for details.",
    ("degraded", "high"):     "Swarm is up with caution flags. Memory is tighter than ideal; watch for slowdowns.",
    ("degraded", "critical"): "Survival mode engaged — sequential execution, tight memory. Core tasks will still work.",
    ("critical", "normal"):   "Core services are unreachable. The swarm needs attention — run swarm-doctor to diagnose.",
    ("critical", "high"):     "Memory high and services unreachable. Run swarm-doctor and check Ollama status.",
    ("critical", "critical"): "The swarm needs urgent attention. Memory critical, services unreachable. Run swarm-doctor.",
}


# ── StartupSummary dataclass ──────────────────────────────────────────────────

@dataclass
class StartupSummary:
    """Structured summary of the startup autopilot execution."""

    timestamp: str           # ISO-8601 UTC
    status: str              # "ready" | "degraded" | "critical"
    narrative: str           # warm user-facing copy
    pressure_level: str      # "normal" | "high" | "critical"
    available_mb: int
    zram_used_pct: float
    concurrency_limit: int
    ollama_reachable: bool
    warmup_done: bool
    evolver_synced: bool
    evolver_proposals: int
    duration_ms: int

    def to_dict(self) -> dict[str, Any]:
        """camelCase JSON dict for API/SSE consumers."""
        d = asdict(self)
        return {
            "timestamp":        d["timestamp"],
            "status":           d["status"],
            "narrative":        d["narrative"],
            "pressureLevel":    d["pressure_level"],
            "availableMb":      d["available_mb"],
            "zramUsedPct":      d["zram_used_pct"],
            "concurrencyLimit": d["concurrency_limit"],
            "ollamaReachable":  d["ollama_reachable"],
            "warmupDone":       d["warmup_done"],
            "evolverSynced":    d["evolver_synced"],
            "evolverProposals": d["evolver_proposals"],
            "durationMs":       d["duration_ms"],
        }


# ── Step 1: Fast health diagnostic ───────────────────────────────────────────

async def _check_health(cfg: Any) -> bool:
    """
    Probes Ollama /api/version (lighter than /api/tags; not blocked by queued
    model operations) with a hard per-request timeout.
    Never raises; returns False on any error.

    [V6.2-FIX-28] Switched from /api/tags to /api/version so a deadlocked
    Ollama (HTTP handler blocked on a mid-load request) still triggers a
    clean False instead of hanging for the full health budget.
    """
    import httpx

    ollama_url: str = getattr(cfg, "ollama_url", "http://127.0.0.1:11434")
    # Use a tighter per-request timeout so this probe fails fast on a
    # deadlocked daemon, leaving budget headroom for the rest of startup.
    probe_timeout_s = min(_health_budget_s(), 4.0)

    try:
        async with asyncio.timeout(probe_timeout_s):
            async with httpx.AsyncClient(timeout=httpx.Timeout(probe_timeout_s)) as client:
                resp = await client.get(f"{ollama_url}/api/version")
                return resp.status_code == 200
    except Exception:
        return False


# ── Step 2: Pressure snapshot ─────────────────────────────────────────────────

def _check_pressure(cfg: Any) -> tuple[str, int, float, int]:
    """
    Returns (level_str, available_mb, zram_pct, concurrency_limit).
    Gracefully returns ("normal", 0, 0.0, 1) if pressure module unavailable.
    """
    try:
        from .pressure import concurrency_limit_from_config, get_pressure

        warn_mb = getattr(cfg, "pressure_warn_mb", 1500)
        crit_mb = getattr(cfg, "pressure_critical_mb", 800)
        ttl_s   = getattr(cfg, "pressure_check_interval_s", 5.0)

        snap = get_pressure(
            warn_mb=warn_mb,
            critical_mb=crit_mb,
            ttl_s=ttl_s,
            force=True,  # always fresh at startup
        )
        limit = concurrency_limit_from_config(cfg)
        return snap.level.value, snap.available_mb, snap.zram_used_pct, limit
    except Exception as exc:
        log.debug("startup_pressure_check_skipped", reason=_exc_reason(exc))
        return "normal", 0, 0.0, 1


# ── Step 3: Model warmup ──────────────────────────────────────────────────────

async def _warmup_models(cfg: Any) -> bool:
    """
    Send a 1-token prompt to phi4-fast only when explicitly enabled and the
    model is ALREADY loaded in Ollama.

    [V6.2-FIX-25] Skip warmup when the model is not resident. On low-RAM
    systems (no GPU, 8 GB) loading a fresh model via /api/generate with
    stream=false blocks Ollama's HTTP accept loop for 60-120 s. When the
    warmup budget (20 s) expires and the client disconnects, Ollama's handler
    stays blocked — deadlocking all subsequent probe calls (/api/version,
    /api/tags) until the load eventually completes or times out.

    Safe warmup sequence:
      1. GET /api/ps — if model not listed, log and return False immediately.
      2. Model IS loaded → send the 1-token ping (safe; no load latency).
    Returns True if the warmup ping succeeds.
    """
    import httpx

    if os.environ.get("SWARMX_MODEL_STARTUP_PREWARM") != "1":
        log.info("startup_warmup_skipped", reason="startup_prewarm_disabled")
        return False

    ollama_url: str = getattr(cfg, "ollama_url", "http://127.0.0.1:11434")
    fast_model_raw: str = getattr(cfg, "model_fast", "phi4-fast")
    fast_model_tagged = fast_model_raw if ":" in fast_model_raw else f"{fast_model_raw}:latest"
    fast_models = [fast_model_raw, fast_model_tagged]
    budget_s = _warmup_budget_s()

    # ── Step A: Check /api/ps — only proceed if model is already loaded ───────
    try:
        async with asyncio.timeout(5.0):
            async with httpx.AsyncClient(timeout=5.0) as ps_client:
                ps_resp = await ps_client.get(f"{ollama_url}/api/ps")
                if ps_resp.status_code != 200:
                    log.info("startup_warmup_skipped", reason="ps_unavailable")
                    return False
                loaded = {m.get("name", "") for m in ps_resp.json().get("models", [])}
                if not any(m in loaded for m in fast_models):
                    log.info(
                        "startup_warmup_skipped",
                        reason="model_not_loaded",
                        model=fast_model_tagged,
                    )
                    return False
    except Exception as exc:
        # [V6.2-FIX-09] Raise log level to info so warmup misses are visible.
        log.info("startup_warmup_failed", reason=_exc_reason(exc))
        return False

    # ── Step B: Model is loaded — safe to send 1-token ping ──────────────────
    try:
        async with asyncio.timeout(budget_s):
            async with httpx.AsyncClient(timeout=budget_s) as client:
                for fast_model in fast_models:
                    resp = await client.post(
                        f"{ollama_url}/api/generate",
                        json={
                            "model": fast_model,
                            "prompt": "Hi",
                            "stream": False,
                            "keep_alive": "30s",
                            "options": {
                                "num_predict": 1,
                                "temperature": 0,
                                "num_ctx": 256,
                            },
                        },
                    )
                    if resp.status_code == 200:
                        return True
                return False
    except Exception as exc:
        log.info("startup_warmup_failed", reason=_exc_reason(exc))
        return False


# ── Step 4: Evolver sync ──────────────────────────────────────────────────────

async def _sync_evolver(cfg: Any) -> tuple[bool, int]:
    """
    Run one dry-run evolution cycle in a background thread.
    Returns (synced, proposal_count).
    Never blocks launch — aborts after EVOLVER_BUDGET_S.
    """
    budget_s = _evolver_budget_s()
    try:
        async with asyncio.timeout(budget_s):
            result = await asyncio.to_thread(_run_evolver_sync, cfg)
            proposals = len(result.get("cycles", [{}])[0].get("candidates", []))
            return True, proposals
    except Exception as exc:
        log.debug("startup_evolver_sync_failed", reason=_exc_reason(exc))
        return False, 0


def _run_evolver_sync(cfg: Any) -> dict[str, Any]:
    try:
        from .evolution_layer.controller import run_autonomous_evolution
        return run_autonomous_evolution(cfg=cfg, cycles=1)
    except Exception:
        return {}


# ── Narrative builder ─────────────────────────────────────────────────────────

def _build_narrative(status: str, pressure: str, warmup_done: bool) -> str:
    base = _NARRATIVES.get(
        (status, pressure),
        _NARRATIVES.get(("degraded", "normal"), "SwarmX is starting up."),
    )
    # [V6.1-FIX-14] Avoid announcing "models warm" when warmup timed out.
    if not warmup_done:
        return (
            "Swarm core is ready. Model warmup is still pending, so the first"
            " composer/model call may be slower than usual."
        )
    return base


def _overall_status(ollama_ok: bool, pressure: str) -> str:
    if not ollama_ok:
        if pressure == "critical":
            return "critical"
        return "degraded"
    if pressure == "critical":
        return "degraded"
    return "ready"


# ── Public API ────────────────────────────────────────────────────────────────

async def run_startup_autopilot(cfg: Any | None = None) -> StartupSummary:
    """
    Execute the full startup autopilot sequence and return a StartupSummary.

    Each step has a hard time budget and fails open — the return value is
    always a complete StartupSummary regardless of individual step failures.

    Args:
        cfg: SwarmConfig instance. If None, creates one automatically.
    """
    t0 = time.monotonic()

    if cfg is None:
        try:
            from .config import SwarmConfig
            cfg = SwarmConfig()
        except Exception:
            cfg = None

    # Step 2: Pressure (sync, instant — no await needed)
    pressure_level, available_mb, zram_pct, concurrency = _check_pressure(cfg)

    # Steps 1, 3, 4: run concurrently to keep startup snappy
    health_task  = asyncio.create_task(_check_health(cfg))
    warmup_task  = asyncio.create_task(_warmup_models(cfg))
    evolver_task = asyncio.create_task(_sync_evolver(cfg))

    ollama_ok = await health_task
    warmup_done  = await warmup_task
    evolver_ok, proposals = await evolver_task

    duration_ms = int((time.monotonic() - t0) * 1000)
    status = _overall_status(ollama_ok, pressure_level)
    narrative = _build_narrative(status, pressure_level, warmup_done)

    summary = StartupSummary(
        timestamp=datetime.now(UTC).isoformat(),  # [V6.2-FIX-17] datetime.UTC alias (Python 3.11+, runtime is 3.12)
        status=status,
        narrative=narrative,
        pressure_level=pressure_level,
        available_mb=available_mb,
        zram_used_pct=round(zram_pct, 3),
        concurrency_limit=concurrency,
        ollama_reachable=ollama_ok,
        warmup_done=warmup_done,
        evolver_synced=evolver_ok,
        evolver_proposals=proposals,
        duration_ms=duration_ms,
    )

    log.info(
        "startup_autopilot_complete",
        status=status,
        pressure=pressure_level,
        ollama=ollama_ok,
        warmup=warmup_done,
        evolver=evolver_ok,
        proposals=proposals,
        duration_ms=duration_ms,
    )

    # Persist to SWARM_HOME for API to broadcast on next SSE cycle
    _persist_summary(summary, cfg)

    return summary


def run_startup_autopilot_sync(cfg: Any | None = None) -> StartupSummary:
    """Synchronous wrapper for run_startup_autopilot."""
    try:
        asyncio.get_running_loop()  # raises RuntimeError if no loop is running
        # Already inside an event loop — use run_in_executor pattern
        import concurrent.futures
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            return pool.submit(asyncio.run, run_startup_autopilot(cfg)).result()
    except RuntimeError:
        return asyncio.run(run_startup_autopilot(cfg))


# ── Persistence ───────────────────────────────────────────────────────────────

def _persist_summary(summary: StartupSummary, cfg: Any | None) -> None:
    """Write summary JSON to SWARM_HOME/state/startup_summary.json (atomic)."""
    try:
        home = getattr(cfg, "home", None) or Path(
            os.environ.get("SWARM_HOME", Path.home() / ".swarmx")
        )
        state_dir = Path(home) / "state"
        state_dir.mkdir(parents=True, exist_ok=True)
        target = state_dir / "startup_summary.json"
        tmp = target.with_suffix(".tmp")
        tmp.write_text(json.dumps(summary.to_dict(), indent=2), encoding="utf-8")
        tmp.replace(target)
    except OSError as e:
        # [V6.2-FIX-10] Log persistence failures at warning so operators know
        # the startup summary will not be available to the API broadcast.
        log.warning("startup_summary_persist_failed", reason=str(e))


def load_startup_summary(home: Path | None = None) -> dict[str, Any] | None:
    """Load the last persisted startup summary, or None if absent."""
    try:
        h = home or Path(os.environ.get("SWARM_HOME", Path.home() / ".swarmx"))
        p = Path(h) / "state" / "startup_summary.json"
        if p.exists():
            loaded = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                return loaded
    except Exception:
        pass
    return None


# ── Rich banner for CLI ───────────────────────────────────────────────────────

def _summary_value(summary: StartupSummary | dict[str, Any], attr: str, key: str) -> Any:
    if isinstance(summary, dict):
        return summary.get(key)
    return getattr(summary, attr)


def format_startup_banner(summary: StartupSummary | dict[str, Any]) -> str:
    """
    Return a Rich-formatted panel string for CLI display.
    Warm and playful — no internal jargon visible to the user.
    """
    _STATUS_ICON = {"ready": "✦", "degraded": "⚠", "critical": "✗"}
    _STATUS_STYLE = {"ready": "bold green", "degraded": "bold yellow", "critical": "bold red"}

    status = _summary_value(summary, "status", "status") or "degraded"
    narrative = _summary_value(summary, "narrative", "narrative") or "SwarmX is starting up."
    available_mb = int(_summary_value(summary, "available_mb", "availableMb") or 0)
    zram_used_pct = float(_summary_value(summary, "zram_used_pct", "zramUsedPct") or 0.0)
    concurrency_limit = int(_summary_value(summary, "concurrency_limit", "concurrencyLimit") or 1)
    ollama_reachable = bool(_summary_value(summary, "ollama_reachable", "ollamaReachable"))
    warmup_done = bool(_summary_value(summary, "warmup_done", "warmupDone"))
    duration_ms = int(_summary_value(summary, "duration_ms", "durationMs") or 0)
    evolver_synced = bool(_summary_value(summary, "evolver_synced", "evolverSynced"))
    evolver_proposals = int(_summary_value(summary, "evolver_proposals", "evolverProposals") or 0)

    icon  = _STATUS_ICON.get(status, "·")
    style = _STATUS_STYLE.get(status, "bold")

    lines = [
        f"[{style}]{icon} {narrative}[/{style}]",
        "",
        f"  [dim]RAM [/dim]{available_mb} MB free · "
        f"[dim]ZRAM [/dim]{zram_used_pct * 100:.0f}% · "
        f"[dim]Concurrency [/dim]x{concurrency_limit} · "
        f"[dim]Ollama [/dim]{'✓' if ollama_reachable else '✗'} · "
        f"[dim]Warmup [/dim]{'✓' if warmup_done else '✗'} · "
        f"[dim]{duration_ms} ms[/dim]",
    ]
    if evolver_synced and evolver_proposals:
        lines.append(
            f"  [dim]Evolver staged [/dim][cyan]{evolver_proposals}[/cyan][dim] improvement proposal(s)[/dim]"
        )

    return "\n".join(lines)


# ── Standalone entry point ────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys

    try:
        from rich.console import Console
        from rich.panel import Panel

        c = Console()
        summary = run_startup_autopilot_sync()
        c.print(Panel(format_startup_banner(summary), title="SwarmX Startup Autopilot", border_style="dim"))
        sys.exit(0 if summary.status != "critical" else 1)
    except ImportError:
        summary = run_startup_autopilot_sync()
        print(json.dumps(summary.to_dict(), indent=2))
        sys.exit(0 if summary.status != "critical" else 1)
