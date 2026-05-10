"""``swarm up`` — start the SwarmX stack.

Starts the API server, background workers, and (optionally) the dashboard
server. Respects the SWARMX_HOME runtime directory and the config at
``configs/swarmx.defaults.yaml``.
"""
from __future__ import annotations

import logging
import os
import signal
import subprocess
import sys
from pathlib import Path
from typing import Annotated

import typer

from swarmx.console.compat import is_json_mode
from swarmx.console.output import emit_error, emit_json, get_console, safe_print

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="Start the SwarmX stack (API + workers + dashboard).",
    invoke_without_command=True,
    no_args_is_help=False,
)

# ── Service definitions ───────────────────────────────────────────────────────

# [V5.9-FIX-03] API is a Fastify Node.js server, not a Python ASGI module.
_DEFAULT_API_HOST = "0.0.0.0"
_DEFAULT_API_PORT = 3001


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[4]


def _api_dist() -> Path:
    """Absolute path to the compiled Fastify API entry point."""
    return _repo_root() / "apps" / "swarmx-api" / "dist" / "server.js"


def _dashboard_root() -> Path:
    return _repo_root() / "apps" / "swarmx-dashboard"


def _dashboard_workspace_root() -> Path:
    return _repo_root()


def _dashboard_command() -> list[str]:
    # [V5.9-FIX-03] Use production 'start' (next start) not 'dev' server.
    return ["pnpm", "--filter", "@swarmx/dashboard", "start"]


def _dashboard_api_url(host: str, port: int) -> str:
    """Return a stable API URL for dashboard rewrites.

    Next.js runs server-side rewrites from the local host process, so wildcard
    bind addresses should be normalized to loopback for reliable routing.
    """
    if host in {"0.0.0.0", "::", ""}:
        return f"http://127.0.0.1:{port}"
    if host == "localhost":
        return f"http://127.0.0.1:{port}"
    return f"http://{host}:{port}"


def _start_sidecar(
    cmd: list[str],
    *,
    name: str,
    cwd: str,
    env: dict[str, str] | None = None,
) -> subprocess.Popen[bytes]:
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    log_dir = cfg.home / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{name}.log"
    log_fh = log_file.open("ab")
    try:
        proc = subprocess.Popen(cmd, stdout=log_fh, stderr=log_fh, cwd=cwd, env=env)
    except Exception:
        log_fh.close()
        raise
    proc._swarmx_log_handle = log_fh  # type: ignore[attr-defined]
    return proc


@app.callback()
def up_callback(
    ctx: typer.Context,
    down: Annotated[bool, typer.Option("--down", help="Stop detached SwarmX services.")] = False,
    restart: Annotated[bool, typer.Option("--restart", help="Restart detached SwarmX services.")] = False,
    host: Annotated[str, typer.Option("--host", "-H", help="Bind host for the API.")] = _DEFAULT_API_HOST,
    port: Annotated[int, typer.Option("--port", "-p", help="Port for the API.")] = _DEFAULT_API_PORT,
    workers: Annotated[int, typer.Option("--workers", "-w", help="Number of Uvicorn workers.")] = 1,
    dashboard: Annotated[bool, typer.Option("--dashboard/--no-dashboard", help="Also start the Next.js dashboard server.")] = False,
    detach: Annotated[bool, typer.Option("--detach", "-d", help="Run in background (detach from terminal).")]= False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Run the default ``swarm up`` action when no explicit subcommand is provided."""
    if ctx.invoked_subcommand is not None:
        return

    if down and restart:
        emit_error("Use either --down or --restart, not both.", code=1)
        raise typer.Exit(code=1)

    if down:
        cmd_stop(json_out=json_out)
        return

    if restart:
        cmd_stop(json_out=json_out)

    cmd_start(
        host=host,
        port=port,
        workers=workers,
        dashboard=dashboard,
        detach=detach,
        json_out=json_out,
    )


@app.command("start")
def cmd_start(
    host: Annotated[str, typer.Option("--host", "-H", help="Bind host for the API.")] = _DEFAULT_API_HOST,
    port: Annotated[int, typer.Option("--port", "-p", help="Port for the API.")] = _DEFAULT_API_PORT,
    workers: Annotated[int, typer.Option("--workers", "-w", help="Number of Uvicorn workers.")] = 1,
    dashboard: Annotated[bool, typer.Option("--dashboard/--no-dashboard", help="Also start the Next.js dashboard server.")] = False,
    detach: Annotated[bool, typer.Option("--detach", "-d", help="Run in background (detach from terminal).")] = False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Start the SwarmX API server and background workers."""
    console = get_console()
    _json = json_out or is_json_mode()

    services: list[dict[str, object]] = []
    dashboard_proc: subprocess.Popen[bytes] | None = None

    # ── Resolve Node.js API server ──────────────────────────────────────────
    # [V5.9-FIX-03] The API is Fastify (Node.js), not a Python ASGI application.
    import shutil
    node_bin = shutil.which("node")
    if node_bin is None:
        emit_error("node is not installed or not on PATH. Install Node.js 22+.", code=1)
        raise typer.Exit(code=1)

    api_dist = _api_dist()
    if not api_dist.exists():
        emit_error(
            f"Compiled API not found at {api_dist}. "
            "Run: pnpm --filter @swarmx/api build",
            code=1,
        )
        raise typer.Exit(code=1)

    repo_root = _repo_root()

    # [V6.1-FIX-06] Prefer the interpreter currently running SwarmX so API sidecars
    # inherit the active venv instead of falling back to a system python without the package.
    python_exe = sys.executable or shutil.which("python3") or shutil.which("python") or "python3"

    api_env = {
        **dict(os.environ),
        "SWARMX_API_PORT": str(port),
        "SWARMX_API_HOST": host,
        "SWARMX_PYTHON": python_exe,  # [V6.1-FIX-03] Pass resolved python to metrics poller
        "SWARMX_REPO_ROOT": str(repo_root),
    }
    # [V6.1-FIX-16] Do not force a short Composer timeout in `swarm up`.
    # Respect operator-provided env overrides; otherwise align with API default.
    if not api_env.get("SWARMX_COMPOSER_TIMEOUT_MS"):
        api_env["SWARMX_COMPOSER_TIMEOUT_MS"] = "60000"
    if not api_env.get("SWARMX_DASHBOARD_ORIGIN"):
        # [V6.1-FIX-02] Local `next start` runs in production mode; seed loopback dashboard origins
        # so direct API fallbacks (127.0.0.1/localhost) can pass CORS preflight checks.
        api_env["SWARMX_DASHBOARD_ORIGIN"] = "http://127.0.0.1:3000,http://localhost:3000"
    # [V5.9-FIX-07] Ensure dashboard rewrite target tracks the actual API bind.
    dashboard_env = {
        **dict(os.environ),
        "SWARMX_API_URL": _dashboard_api_url(host, port),
    }
    if not dashboard_env.get("SWARMX_COMPOSER_TIMEOUT_MS"):
        dashboard_env["SWARMX_COMPOSER_TIMEOUT_MS"] = "60000"
    api_cmd = [node_bin, str(api_dist)]

    dash_root = _dashboard_root()
    dash_workspace = _dashboard_workspace_root()
    dash_cmd = _dashboard_command()

    if dashboard and not dash_root.exists():
        if not _json:
            console.print(f"[warn]Dashboard not found at {dash_root}[/warn]")
        dashboard = False

    # ── Startup Autopilot ─────────────────────────────────────────────────────
    # [V6.1-ENH-01] Run before API launch: health check, pressure snapshot,
    # model warmup, evolver sync. Fail-open — never blocks launch.
    _run_startup_autopilot(console=console, _json=_json)

    if detach:
        _start_detached(api_cmd, name="swarmx-api", _json=_json, env=api_env)
        services.append({"name": "swarmx-api", "pid": "detached", "url": f"http://{host}:{port}"})
        if dashboard:
            _start_detached(
                dash_cmd,
                name="swarmx-dashboard",
                cwd=str(dash_workspace),
                _json=_json,
                env=dashboard_env,
            )
            services.append({"name": "swarmx-dashboard", "pid": "detached", "url": "http://localhost:3000"})
    else:
        if dashboard:
            dashboard_proc = _start_sidecar(
                dash_cmd,
                name="swarmx-dashboard",
                cwd=str(dash_workspace),
                env=dashboard_env,
            )
            services.append({"name": "swarmx-dashboard", "pid": dashboard_proc.pid, "url": "http://localhost:3000"})
        if not _json:
            console.print(f"[brand]SwarmX[/brand] starting API on [highlight]http://{host}:{port}[/highlight]")
            if dashboard_proc is not None:
                console.print("[dim]Dashboard sidecar logging to SWARMX_HOME/logs/swarmx-dashboard.log[/dim]")
            console.print("[dim]Press Ctrl+C to stop[/dim]")
        _run_foreground(api_cmd, sidecar=dashboard_proc, env=api_env)
        return

    if _json:
        emit_json({"services": services})
    else:
        for svc in services:
            safe_print(f"[success]Started:[/success] {svc['name']}  [dim]{svc.get('url', '')}[/dim]")


def _run_startup_autopilot(*, console: object, _json: bool) -> None:
    """Run the startup autopilot. Fail-open — never blocks launch."""
    # [V6.1-ENH-01] Imports are deferred so import errors are non-fatal.
    try:
        from swarmx.startup import format_startup_banner, run_startup_autopilot_sync  # type: ignore[import]
        summary = run_startup_autopilot_sync()
        if not _json:
            console.print(format_startup_banner(summary))  # type: ignore[union-attr]
    except Exception as exc:
        logger.debug("startup_autopilot_skipped", exc_info=exc)


def _start_detached(
    cmd: list[str],
    *,
    name: str,
    cwd: str | None = None,
    _json: bool = False,
    env: dict[str, str] | None = None,
) -> None:
    """Fork the process to the background, writing its PID to SWARMX_HOME/pids/."""
    from swarmx.config import SwarmConfig
    cfg = SwarmConfig()
    pid_dir = cfg.home / "pids"
    pid_dir.mkdir(parents=True, exist_ok=True)
    pid_file = pid_dir / f"{name}.pid"

    log_dir = cfg.home / "logs"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_file = log_dir / f"{name}.log"

    with log_file.open("ab") as log_fh:
        proc = subprocess.Popen(
            cmd,
            stdout=log_fh,
            stderr=log_fh,
            cwd=cwd,
            env=env,
            start_new_session=True,  # detach from terminal's process group
        )
    pid_file.write_text(str(proc.pid), encoding="utf-8")
    if not _json:
        get_console().print(f"[dim]{name} PID {proc.pid} → {log_file}[/dim]")


def _run_foreground(
    cmd: list[str],
    sidecar: subprocess.Popen[bytes] | None = None,
    env: dict[str, str] | None = None,
) -> None:
    """Run a command in the foreground, forwarding signals."""
    proc = subprocess.Popen(cmd, env=env)
    try:
        proc.wait()
    except KeyboardInterrupt:
        proc.send_signal(signal.SIGINT)
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
    finally:
        if sidecar is not None:
            if sidecar.poll() is None:
                sidecar.terminate()
                try:
                    sidecar.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    sidecar.kill()
            log_handle = getattr(sidecar, "_swarmx_log_handle", None)
            if log_handle is not None:
                log_handle.close()


@app.command("stop")
def cmd_stop(
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Stop detached SwarmX services via stored PID files."""
    from swarmx.config import SwarmConfig
    _json = json_out or is_json_mode()
    cfg = SwarmConfig()
    pid_dir = cfg.home / "pids"
    stopped: list[str] = []
    not_running: list[str] = []

    if not pid_dir.exists():
        if _json:
            emit_json({"stopped": [], "message": "No PID directory found"})
        else:
            safe_print("[warn]No running SwarmX services found.[/warn]")
        return

    for pid_file in pid_dir.glob("*.pid"):
        name = pid_file.stem
        try:
            pid = int(pid_file.read_text(encoding="utf-8").strip())
            os.kill(pid, signal.SIGTERM)
            stopped.append(name)
            pid_file.unlink(missing_ok=True)
        except (ProcessLookupError, ValueError):
            not_running.append(name)
            pid_file.unlink(missing_ok=True)
        except PermissionError:
            emit_error(f"Permission denied stopping {name} (PID file: {pid_file})", code=1)

    if _json:
        emit_json({"stopped": stopped, "not_running": not_running})
    else:
        for name in stopped:
            safe_print(f"[success]Stopped:[/success] {name}")
        for name in not_running:
            safe_print(f"[dim]Already stopped:[/dim] {name}")
