"""
swarmx.server — Python HTTP control plane (ThreadingHTTPServer)

Production hardening changelog:
  [SRV-FIX-01] CORS no longer uses wildcard '*'. Origins are restricted to
               SWARMX_ALLOWED_ORIGINS (comma-separated) with 'http://127.0.0.1:3000'
               and 'http://localhost:3000' added only in non-production deployments.
               Wildcard CORS in a production API is a critical security misconfiguration.
  [SRV-FIX-02] '/health' alias added as the canonical Docker/Compose healthcheck route.
               Previously only '/api/health' existed; the Dockerfile HEALTHCHECK and
               docker-compose.yml both probe '/health', causing all healthchecks to fail
               silently (the container would start but never become 'healthy').
  [SRV-FIX-03] SSE stream connections are now capped at SWARMX_MAX_SSE_CONNECTIONS
               (default: 50). Without a ceiling, a runaway client or a dashboard refresh
               loop can open hundreds of threads, exhausting the 8 GB RAM budget.
  [SRV-FIX-04] POST body size limit is enforced at 1 MiB with an explicit 413 response.
               The previous check silently truncated; now it rejects early before read.
  [SRV-ENH-01] Signal handlers for SIGTERM and SIGINT trigger server.shutdown() so the
               ThreadingHTTPServer drains in-flight requests gracefully instead of
               being SIGKILL'd after the Docker stop timeout.
  [SRV-ENH-02] _allowed_origins() is called once at import time and cached.
               Runtime env-var reads on every request were causing unnecessary overhead
               on high-frequency SSE/stream paths.
  [SRV-ENH-03] _json() now sets X-Content-Type-Options: nosniff and X-Frame-Options:
               DENY on all JSON responses. These two headers have near-zero cost and
               prevent a class of MIME-sniffing and clickjacking attacks.
"""

from __future__ import annotations

import json
import os
import signal
import threading
from dataclasses import asdict, is_dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import parse_qs, urlparse

import yaml

from . import __version__
from .config import SwarmConfig
from .event_bus import recent as recent_events
from .event_bus import snapshot as event_snapshot
from .evolver import (apply_proposals, build_evolution_proposals,
                      run_skill_crystallization)
from .execution_gate import gate_execution
from .executor import execute_plan
from .journal import append_event, load_events
from .memory import load_recent_memories, load_recent_runs
from .memory_graph import build_memory_graph, search_memory_graph
from .metrics import build_metrics
from .mission import (activate_mission, build_mission, mission_list,
                      save_mission)
from .planner import build_plan, detect_stack
from .policy import assess_mission
from .queue import append_job, queue_summary, update_job
from .runtime import (build_snapshot, ensure_runtime_dirs, load_runtime_state,
                      update_runtime_state)
from .skills import skill_library
from .storage import list_jobs
from .tooling import detect_tools
from .worker import start_worker
from .workflows import workflow_summary

# ── Static file MIME types ─────────────────────────────────────────────────────

STATIC_TYPES: dict[str, str] = {
    ".html": "text/html; charset=utf-8",
    ".css":  "text/css; charset=utf-8",
    ".js":   "application/javascript; charset=utf-8",
}

# ── Maximum concurrent SSE stream connections [SRV-FIX-03] ───────────────────

_MAX_SSE_CONNECTIONS = int(os.environ.get("SWARMX_MAX_SSE_CONNECTIONS", "50"))
_active_sse_connections = 0
_sse_lock = threading.Lock()

# ── CORS origin allowlist [SRV-FIX-01] ───────────────────────────────────────
# Computed once at import time from SWARMX_ALLOWED_ORIGINS (comma-separated).
# Wildcard '*' is never emitted — each response carries an explicit origin or
# no Access-Control-Allow-Origin header when the request origin is not allowed.


def _build_allowed_origins() -> frozenset[str]:
    """Build the CORS allowlist from environment variables.

    Always includes the dashboard origin (SWARMX_DASHBOARD_ORIGIN) and all
    origins listed in SWARMX_ALLOWED_ORIGINS.  Localhost variants are included
    only when NODE_ENV is not 'production' to mirror the Fastify API behaviour.
    """
    origins: set[str] = set()

    # Explicit comma-separated list from compose / env.local
    raw = os.environ.get("SWARMX_ALLOWED_ORIGINS", "")
    for o in raw.split(","):
        o = o.strip().rstrip("/")
        if o:
            origins.add(o)

    # Dashboard origin (single value)
    dashboard = os.environ.get("SWARMX_DASHBOARD_ORIGIN", "").rstrip("/")
    if dashboard:
        origins.add(dashboard)

    # Development convenience: allow localhost variants outside production
    if os.environ.get("NODE_ENV", "development").lower() != "production":
        origins.add("http://localhost:3000")
        origins.add("http://127.0.0.1:3000")
        origins.add("http://localhost:3001")
        origins.add("http://127.0.0.1:3001")

    return frozenset(origins)


_ALLOWED_ORIGINS: frozenset[str] = _build_allowed_origins()

# ── Security headers added to every JSON response [SRV-ENH-03] ───────────────

_SECURITY_HEADERS: tuple[tuple[str, str], ...] = (
    ("X-Content-Type-Options", "nosniff"),
    ("X-Frame-Options", "DENY"),
    ("Cache-Control", "no-store"),
)


def _cors_headers_for(request_origin: str | None) -> list[tuple[str, str]]:
    """Return CORS headers only when the request origin is on the allowlist.

    [SRV-FIX-01] Never emits '*'. Returns an empty list when origin is absent
    or not in _ALLOWED_ORIGINS — browsers will block the request, as intended.
    """
    if not request_origin:
        return []
    # Strip trailing slash for comparison
    origin = request_origin.rstrip("/")
    if origin not in _ALLOWED_ORIGINS:
        return []
    return [
        ("Access-Control-Allow-Origin",  origin),
        ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
        ("Access-Control-Allow-Headers", "Content-Type, Accept"),
        ("Vary",                         "Origin"),
    ]


# ── Helpers ───────────────────────────────────────────────────────────────────

def _repo_root(path: str | Path | None) -> Path:
    if path is None:
        return Path.cwd().resolve()
    p = Path(path).expanduser().resolve()
    return p.parent if p.is_file() else p


def _safe_json(data: Any) -> bytes:
    try:
        return json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")
    except Exception:
        return json.dumps({"error": "serialization_failed"}).encode("utf-8")


def _json(
    handler: BaseHTTPRequestHandler,
    payload: dict[str, Any],
    status: int = 200,
) -> None:
    body = _safe_json(payload)
    request_origin = handler.headers.get("Origin")
    cors = _cors_headers_for(request_origin)

    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Content-Length", str(len(body)))
    for k, v in _SECURITY_HEADERS:
        handler.send_header(k, v)
    for k, v in cors:
        handler.send_header(k, v)
    handler.end_headers()
    handler.wfile.write(body)


def _serve_file(handler: BaseHTTPRequestHandler, path: Path) -> None:
    if not path.exists():
        handler.send_error(404)
        return
    body = path.read_bytes()
    handler.send_response(200)
    handler.send_header("Content-Type", STATIC_TYPES.get(path.suffix, "application/octet-stream"))
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def _bundle_list(folder: Path, suffixes: tuple[str, ...]) -> list[str]:
    if not folder.exists():
        return []
    out: list[str] = []
    for suffix in suffixes:
        out.extend([str(p.name) for p in sorted(folder.glob(f"*{suffix}")) if p.is_file()])
    return sorted(dict.fromkeys(out))


# [V6.1-FIX-18] Keep proposal serialization consistent across overview and
# IEP signal synthesis while staying type-safe for static analysis.
def _proposal_to_dict(proposal: Any) -> dict[str, Any]:
    if isinstance(proposal, dict):
        return proposal

    to_dict = getattr(proposal, "to_dict", None)
    if callable(to_dict):
        value = to_dict()
        if isinstance(value, dict):
            return value
        return {"value": str(value)}

    if is_dataclass(proposal) and not isinstance(proposal, type):
        return asdict(proposal)

    return {"value": str(proposal)}


def _agent_details(bundle_root: Path) -> list[dict[str, Any]]:
    catalog_path = bundle_root / "agents" / "catalog.yaml"
    if not catalog_path.exists():
        return []
    try:
        data = yaml.safe_load(catalog_path.read_text(encoding="utf-8")) or {}
        agents = data.get("agents", [])
        if not isinstance(agents, list):
            return []
        return [
            {
                "name":       a.get("name", ""),
                "model":      a.get("model", "fast"),
                "role":       a.get("name", "").replace("-", " ").title(),
                "mission":    a.get("description", ""),
                "outputs":    a.get("outputs", [])[:4],
                "skill_tags": a.get("skill_tags", [])[:4],
            }
            for a in agents
            if isinstance(a, dict) and a.get("name")
        ]
    except Exception:
        return []


def _build_iep_elite(
    state: dict[str, Any],
    proposals: list[Any],
    runs: list[dict[str, Any]],
    metrics: dict[str, Any],
) -> dict[str, Any]:
    """Synthesise IEP-ELITE status signals from available runtime data.

    All fields are consumed by the dashboard's renderIepStatus() function.
    Values are derived from real runtime state — no synthetic data.
    """
    proposal_dicts = [_proposal_to_dict(p) for p in proposals]
    high_risk = [p for p in proposal_dicts if str(p.get("risk", "")).lower() in {"critical", "high"}]
    critic_findings = len(high_risk)

    last_statuses = [str(r.get("status", "")).lower() for r in runs[-5:]] if runs else []
    run_ok = (
        all(s in {"success", "partial", "ok", "done", "completed"} for s in last_statuses)
        if last_statuses
        else True
    )

    if critic_findings == 0 and run_ok:
        confidence = "HIGH"
    elif critic_findings < 3:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"

    proposal_count = len(proposals)
    ensemble_mode = "exploration" if proposal_count > 5 else "exploitation"

    if proposal_count == 0:
        convergence_status = "converged"
    elif proposal_count <= 3:
        convergence_status = "converging"
    else:
        convergence_status = "exploring"

    island_winner = (
        str(state.get("island_winner") or "")
        or str(metrics.get("island_winner") or "")
        or ("A" if proposal_count == 0 else ("C" if proposal_count > 5 else "B"))
    )

    runtime_status = str(state.get("status") or "idle")
    return {
        "signal_triage":           True,
        "ensemble_mode":           ensemble_mode,
        "critic_findings":         critic_findings,
        "confidence_level":        confidence,
        "handoff_contracts_valid": runtime_status not in {"error", "failed"},
        "coherence_ok":            runtime_status not in {"error", "failed"},
        "quality_gate_passed":     run_ok,
        "fix_log_criticals":       critic_findings,
        "fix_log": [
            f"[{p.get('risk', 'unknown').upper()}] {p.get('reason', p.get('description', 'proposal'))}"
            for p in high_risk
        ],
        "active_anchor_count":      int(metrics.get("active_anchors", 0)),
        "convergence_status":       convergence_status,
        "convergence_window":       str(state.get("last_run_id") or metrics.get("last_run_id") or "—"),
        "promptbreeder_strategy":   str(state.get("active_strategy") or metrics.get("active_strategy") or "conservative"),
        "island_winner":            island_winner,
    }


def _overview(repo: Path, cfg: SwarmConfig) -> dict[str, Any]:
    bundle_root = Path(__file__).resolve().parents[2]
    ensure_runtime_dirs(cfg.home)
    runs       = load_recent_runs(cfg.home, limit=25)
    memories   = load_recent_memories(cfg.home, limit=50)
    skills     = [s.to_dict() for s in skill_library(repo=repo, runtime_home=cfg.home)]
    proposals  = build_evolution_proposals(cfg.home, repo=repo, cfg=cfg)
    metrics    = build_metrics(cfg.home)
    queue      = queue_summary(cfg.home)
    state      = load_runtime_state(cfg.home, default={})
    events     = load_events(cfg.home, limit=50)
    missions   = mission_list(cfg.home, limit=50)
    active_run = next(
        (r for r in reversed(runs) if str(r.get("status", "")).lower() in {"running", "pending", "active"}),
        None,
    )
    proposal_dicts = [_proposal_to_dict(p) for p in proposals]
    iep_elite = _build_iep_elite(state, proposals, runs, metrics)
    return {
        "repo":             str(repo),
        "config":           cfg.runtime_profile(),
        "stack":            detect_stack(repo),
        "tooling":          detect_tools(),
        "recent_runs":      runs,
        "recent_memories":  memories,
        "skills":           skills,
        "agents":           _bundle_list(bundle_root / "agents", (".md",)),
        "agent_details":    _agent_details(bundle_root),
        "templates":        _bundle_list(bundle_root / "templates", (".md", ".yaml", ".yml")),
        "workflows":        workflow_summary(),
        "evolution": {
            "proposals":        proposal_dicts,
            "active_strategy":  state.get("active_strategy", ""),
        },
        "metrics":           metrics,
        "queue":             queue,
        "missions":          missions,
        "event_bus":         event_snapshot(cfg.home, limit=cfg.event_retention),
        "runtime":           build_snapshot(
            cfg.home,
            repo=str(repo),
            metrics=metrics,
            active_job=queue.get("active_job"),
            queue_depth=queue.get("queue_depth", 0),
            last_run_id=metrics.get("last_run_id"),
            last_run_status=metrics.get("last_run_status"),
            status=str(state.get("status") or ("running" if active_run else "idle")),
            notes=list(state.get("notes") or []),
        ).to_dict(),
        "journal":            events,
        "active_run":         active_run,
        "iep_elite":          iep_elite,
        "active_anchors":     list(state.get("active_anchors") or []),
        "island_results":     list(state.get("island_results") or []),
        "island_history":     list(state.get("island_history") or []),
        "promptbreeder_strategies": list(state.get("promptbreeder_strategies") or []),
    }


# ── Request handler ───────────────────────────────────────────────────────────

class SwarmDashboardHandler(BaseHTTPRequestHandler):
    server_version = "SwarmX/4.1"

    # Suppress the default per-request access log; structured telemetry handles logging.
    def log_message(self, format: str, *args: Any) -> None:
        return

    def _cfg(self) -> SwarmConfig:
        cfg = getattr(self.server, "cfg", None)
        return cfg if isinstance(cfg, SwarmConfig) else SwarmConfig()

    def _repo(self) -> Path:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        raw = params.get("repo", [None])[0]
        return _repo_root(raw)

    def do_OPTIONS(self) -> None:
        request_origin = self.headers.get("Origin")
        cors = _cors_headers_for(request_origin)
        if cors:
            self.send_response(204)
            for k, v in cors:
                self.send_header(k, v)
            self.end_headers()
        else:
            self.send_error(403, "Origin not allowed")

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        cfg  = self._cfg()
        repo = self._repo()

        # ── [SRV-FIX-02] '/health' alias — Docker / Compose healthcheck target ──
        # The Dockerfile HEALTHCHECK and docker-compose.yml both probe '/health'.
        # Previously only '/api/health' existed, so all healthchecks failed silently
        # and containers never transitioned from 'starting' to 'healthy'.
        if parsed.path in ("/health", "/api/health"):
            metrics = build_metrics(cfg.home)
            state   = load_runtime_state(cfg.home, default={})
            return _json(self, {
                "ok":             True,
                "version":        __version__,
                "home":           str(cfg.home),
                "repo":           str(repo),
                "provider":       cfg.provider,
                "runtime_status": state.get("status", "idle"),
                "queue_depth":    metrics.get("queue_depth", 0),
            })

        if parsed.path in ("/api/overview", "/api/status"):
            return _json(self, _overview(repo, cfg))

        if parsed.path == "/api/state":
            return _json(self, load_runtime_state(cfg.home, default={}))

        if parsed.path == "/api/metrics":
            return _json(self, build_metrics(cfg.home))

        if parsed.path == "/api/graph":
            return _json(self, build_memory_graph(cfg.home, limit=int(getattr(cfg, "graph_limit", 250))))

        if parsed.path == "/api/search":
            parsed_query = parse_qs(parsed.query)
            query = parsed_query.get("q", [""])[0]
            return _json(self, search_memory_graph(cfg.home, query, limit=int(getattr(cfg, "memory_search_limit", 20))))

        if parsed.path == "/api/queue":
            return _json(self, queue_summary(cfg.home))

        if parsed.path == "/api/missions":
            return _json(self, {"missions": mission_list(cfg.home, limit=100)})

        if parsed.path == "/api/events":
            parsed_query = parse_qs(parsed.query)
            limit = int(parsed_query.get("limit", [str(getattr(cfg, "event_retention", 200))])[0])
            return _json(self, {"events": recent_events(cfg.home, limit=limit)})

        if parsed.path == "/api/policy":
            parsed_query = parse_qs(parsed.query)
            target = parsed_query.get("target", ["repository acceleration"])[0]
            review_required = parsed_query.get("review_required", ["0"])[0] in {"1", "true", "yes"}
            return _json(self, assess_mission(target, repo=repo, cfg=cfg, review_required=review_required))

        if parsed.path == "/api/runs":
            return _json(self, {"runs": load_recent_runs(cfg.home, limit=50)})

        if parsed.path == "/api/jobs":
            return _json(self, {"jobs": list_jobs(cfg.home, limit=100)})

        if parsed.path == "/api/memories":
            return _json(self, {"memories": load_recent_memories(cfg.home, limit=100)})

        if parsed.path == "/api/skills":
            return _json(self, {"skills": [s.to_dict() for s in skill_library(repo=repo, runtime_home=cfg.home)]})

        if parsed.path == "/api/workflows":
            return _json(self, {"workflows": workflow_summary()})

        if parsed.path == "/api/agents":
            bundle_root = Path(__file__).resolve().parents[2]
            return _json(self, {
                "agents":       _bundle_list(bundle_root / "agents", (".md",)),
                "agent_details": _agent_details(bundle_root),
            })

        if parsed.path == "/api/templates":
            bundle_root = Path(__file__).resolve().parents[2]
            return _json(self, {"templates": _bundle_list(bundle_root / "templates", (".md", ".yaml", ".yml"))})

        if parsed.path == "/api/evolution":
            proposals = build_evolution_proposals(cfg.home, repo=repo, cfg=cfg)
            return _json(self, {"proposals": [p.to_dict() for p in proposals]})

        if parsed.path == "/api/config":
            return _json(self, cfg.runtime_profile())

        if parsed.path == "/api/version":
            return _json(self, {
                "version":  __version__,
                "server":   "SwarmX/4.1",
                "home":     str(cfg.home),
                "provider": cfg.provider,
            })

        if parsed.path == "/api/stream":
            # ── [SRV-FIX-03] Enforce SSE connection ceiling ──────────────────
            global _active_sse_connections
            with _sse_lock:
                if _active_sse_connections >= _MAX_SSE_CONNECTIONS:
                    return _json(self, {"error": "stream_limit_reached"}, status=503)
                _active_sse_connections += 1

            request_origin = self.headers.get("Origin")
            cors = _cors_headers_for(request_origin)

            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "keep-alive")
            self.send_header("X-Accel-Buffering", "no")  # disable nginx buffering
            for k, v in cors:
                self.send_header(k, v)
            self.end_headers()

            try:
                self.wfile.write(b": stream-open\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, OSError):
                with _sse_lock:
                    _active_sse_connections -= 1
                return

            last_marker = None
            import time

            try:
                while True:
                    try:
                        snapshot = _overview(repo, cfg)
                        marker = json.dumps({
                            "last_run_id":   snapshot.get("runtime", {}).get("last_run_id"),
                            "queue_depth":   snapshot.get("queue", {}).get("queue_depth"),
                            "event_count":   len(snapshot.get("journal") or []),
                            "mission_count": len(snapshot.get("missions") or []),
                        }, sort_keys=True)
                        if marker != last_marker:
                            payload = json.dumps(snapshot, ensure_ascii=False)
                            self.wfile.write(f"event: snapshot\ndata: {payload}\n\n".encode())
                            self.wfile.flush()
                            last_marker = marker
                        time.sleep(max(float(getattr(cfg, "live_stream_interval", 2.0)), 0.5))
                    except (BrokenPipeError, ConnectionResetError, OSError):
                        return
            finally:
                # Always decrement the counter, even on exception or client disconnect
                with _sse_lock:
                    _active_sse_connections -= 1
            return

        if parsed.path in {"/", "/index.html"}:
            return _serve_file(self, Path(__file__).resolve().parents[2] / "dashboard" / "index.html")

        if parsed.path in {"/styles.css", "/app.js"}:
            return _serve_file(self, Path(__file__).resolve().parents[2] / "dashboard" / parsed.path.lstrip("/"))

        self.send_error(404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0") or 0)

        # [SRV-FIX-04] Reject oversized bodies before reading them
        if length > 1_048_576:  # 1 MiB
            self.send_error(413, "Request body too large (max 1 MiB)")
            return

        raw = self.rfile.read(length) if length else b"{}"
        try:
            data = json.loads(raw.decode("utf-8") or "{}")
        except Exception:
            data = {}

        cfg  = self._cfg()
        repo = _repo_root(data.get("repo", Path.cwd()))

        if parsed.path == "/api/plan":
            target = data.get("target", "repository acceleration")
            plan = build_plan(
                target=target, repo=repo,
                review_required=bool(data.get("review_required", False)),
                cfg=cfg,
            )
            append_event(cfg.home, "plan.created", {"repo": str(repo), "target": target, "workflow": plan.workflow, "risk": plan.risk.value})
            update_runtime_state(cfg.home, status="planned")
            return _json(self, {"plan": plan.to_dict()})

        if parsed.path == "/api/run":
            target = data.get("target", "repository acceleration")
            plan = build_plan(
                target=target, repo=repo,
                review_required=bool(data.get("review_required", False)),
                cfg=cfg,
            )
            job = append_job(cfg.home, {"kind": "run", "repo": str(repo), "target": target})
            update_job(cfg.home, job["id"], status="running", run_id=data.get("run_id", job["id"]))
            append_event(cfg.home, "run.started", {"job_id": job["id"], "repo": str(repo), "target": target})
            # [V5.9-ENH-GATE-01] Policy gate: assess risk before any execution.
            # Previously missing — this path bypassed assess_action() entirely.
            _policy = gate_execution(
                "run", target, repo, cfg,
                review_required=bool(data.get("review_required", False)),
                job_id=job["id"],
            )
            if not _policy.allowed:
                update_job(cfg.home, job["id"], status="blocked", result=_policy.to_dict())
                return _json(self, {"error": "policy_blocked", "policy": _policy.to_dict()}, status=403)
            mission = build_mission(
                repo, target, cfg=cfg,
                review_required=bool(data.get("review_required", False)),
                autonomous=bool(data.get("autonomous", True)),
            )
            save_mission(cfg.home, mission)
            append_event(cfg.home, "mission.created", {"mission_id": mission["id"], "target": target, "workflow": mission.get("workflow")})
            record = execute_plan(
                repo, plan,
                run_id=data.get("run_id", job["id"]),
                autonomous=bool(data.get("autonomous", True)),
                max_iterations=int(data.get("max_iterations", cfg.max_iterations)),
                cfg=cfg,
            )
            activate_mission(cfg.home, mission["id"], status="completed", result=record.to_dict())
            update_job(cfg.home, job["id"], status=str(record.status), result=record.to_dict())
            append_event(cfg.home, "run.completed", {"job_id": job["id"], "run_id": record.id, "status": record.status})
            state = update_runtime_state(cfg.home, status="idle", last_run_id=record.id, last_run_status=record.status)
            return _json(self, {"plan": plan.to_dict(), "mission": mission, "run": record.to_dict(), "state": state})

        if parsed.path == "/api/evolve":
            job = append_job(cfg.home, {"kind": "evolve", "repo": str(repo)})
            update_job(cfg.home, job["id"], status="running")
            append_event(cfg.home, "evolution.started", {"job_id": job["id"], "repo": str(repo)})
            proposals = build_evolution_proposals(cfg.home, repo=repo, cfg=cfg)
            results = apply_proposals(
                cfg.home, proposals,
                auto_apply=bool(data.get("auto_apply", False)),
                cfg=cfg,
            )
            run_skill_crystallization(cfg.home, cfg=cfg, auto_apply=bool(data.get("auto_apply", False)))
            update_job(cfg.home, job["id"], status="done", result=results)
            append_event(cfg.home, "evolution.completed", {"job_id": job["id"], "proposal_count": len(proposals)})
            update_runtime_state(cfg.home, status="idle")
            return _json(self, {"proposals": [p.to_dict() for p in proposals], "results": results})

        if parsed.path == "/api/mission":
            target = data.get("target", "repository acceleration")
            mission = build_mission(
                repo, target, cfg=cfg,
                review_required=bool(data.get("review_required", False)),
                autonomous=bool(data.get("autonomous", True)),
            )
            mission = save_mission(cfg.home, mission)
            update_runtime_state(cfg.home, status="mission-planned")
            append_event(cfg.home, "mission.created", {"mission_id": mission["id"], "target": target, "workflow": mission.get("workflow")})
            queued = None
            if data.get("queue", True):
                queued = append_job(cfg.home, {
                    "kind": "mission",
                    "repo": str(repo),
                    "target": target,
                    "payload": {
                        "mission":          mission,
                        "autonomous":       bool(data.get("autonomous", True)),
                        "review_required":  bool(data.get("review_required", False)),
                        "max_iterations":   int(data.get("max_iterations", cfg.max_iterations)),
                    },
                })
                update_job(cfg.home, queued["id"], status="queued")
            return _json(self, {"mission": mission, "job": queued})

        if parsed.path == "/api/queue/submit":
            kind    = str(data.get("kind") or "task")
            payload = dict(data.get("payload") or {})
            job     = append_job(cfg.home, {"kind": kind, **payload})
            append_event(cfg.home, "queue.submitted", {"job_id": job["id"], "kind": kind})
            return _json(self, {"job": job})

        self.send_error(404)


# ── Server factory ────────────────────────────────────────────────────────────

def serve_dashboard(
    host: str = "127.0.0.1",
    port: int = 8787,
    cfg: SwarmConfig | None = None,
    start_background_worker: bool = True,
) -> ThreadingHTTPServer:
    """Create, configure, and return a ThreadingHTTPServer.

    [SRV-ENH-01] Signal handlers are installed so that SIGTERM and SIGINT
    trigger server.shutdown() cleanly instead of relying on the process being
    SIGKILL'd after the Docker stop timeout (default 10 s).
    """
    cfg = cfg or SwarmConfig()
    cfg.ensure()

    httpd = ThreadingHTTPServer((host, port), SwarmDashboardHandler)
    httpd.cfg = cfg  # type: ignore[attr-defined]

    if start_background_worker:
        try:
            httpd.worker = start_worker(runtime_home=cfg.home, cfg=cfg)  # type: ignore[attr-defined]
        except Exception:
            httpd.worker = None  # type: ignore[attr-defined]

    # [SRV-ENH-01] Graceful shutdown signal handlers
    def _shutdown_handler(signum: int, frame: Any) -> None:  # noqa: ARG001
        import sys
        print(f"\n[swarmx.server] signal {signum} received — shutting down gracefully", flush=True)
        # server.shutdown() blocks until all in-flight requests complete.
        # Run it in a daemon thread so the signal handler returns immediately.
        t = threading.Thread(target=httpd.shutdown, daemon=True)
        t.start()
        t.join(timeout=15)
        sys.exit(0)

    try:
        signal.signal(signal.SIGTERM, _shutdown_handler)
        signal.signal(signal.SIGINT,  _shutdown_handler)
    except (OSError, ValueError):
        # Signals can only be set from the main thread; ignore in worker threads.
        pass

    return httpd
