"""``swarm status`` — runtime state, Live watch mode.

Bug fix vs v0.2.0:
  - [BUG-03] JSON output goes to raw stdout (via emit_json), never Rich console.
  - Live watch mode (--watch) uses Rich Live with auto-refresh; no flicker
    because the Live object owns the entire output region (BUG-00 watch fix).
"""
from __future__ import annotations

import time
import logging
from pathlib import Path
from typing import Annotated

import typer
from rich.live import Live
from rich.table import Table

from swarmx.console.output import get_console, safe_print, emit_json, make_table
from swarmx.console.compat import is_json_mode, is_no_progress

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="Show swarm runtime status.",
    invoke_without_command=True,
    no_args_is_help=False,
)

_REFRESH_INTERVAL = 2.0  # seconds


def _mission_status_style(status: str) -> str:
    if status in {"done", "complete"}:
        return "success"
    if status == "running":
        return "warning"
    return "muted"


@app.callback()
def status_callback(
    ctx: typer.Context,
    watch: Annotated[bool, typer.Option("--watch", "-w", help="Live-refresh the status view.")] = False,
    interval: Annotated[float, typer.Option("--interval", help="Refresh interval in seconds.")] = _REFRESH_INTERVAL,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output (no watch). ")] = False,
) -> None:
    """Show status by default when ``swarm status`` is invoked without a subcommand."""
    if ctx.invoked_subcommand is not None:
        return
    status_show(watch=watch, interval=interval, json_out=json_out)


def _build_status_table(runtime_home: Path) -> Table:
    """Build a Rich table with current runtime status."""
    from swarmx.core.mission_manager import list_missions
    from swarmx.core.db import db_exists
    from swarmx.runtime import load_runtime_state

    t = make_table("Component", "Status", "Detail", title="SwarmX Status")

    # DB health
    db_ok = db_exists(runtime_home)
    t.add_row("Database", "[success]OK[/success]" if db_ok else "[error]MISSING[/error]", str(runtime_home / "state" / "swarmx.sqlite3"))

    # Recent missions
    try:
        missions = list_missions(runtime_home, limit=5)
        for m in missions:
            status = str(m.get("status", "?"))
            style = _mission_status_style(status)
            t.add_row(
                "Mission",
                f"[{style}]{status}[/{style}]",
                str(m.get("id", "?"))[:40],
            )
        if not missions:
            t.add_row("Missions", "[muted]none[/muted]", "")
    except Exception as exc:
        t.add_row("Missions", "[error]error[/error]", str(exc)[:60])

    # Runtime state
    try:
        state = load_runtime_state(runtime_home)
        for k, v in list(state.items())[:8]:
            t.add_row(str(k), "[brand]set[/brand]", str(v)[:60])
    except Exception:
        pass

    return t


@app.command("show")
def status_show(
    watch: Annotated[bool, typer.Option("--watch", "-w", help="Live-refresh the status view.")] = False,
    interval: Annotated[float, typer.Option("--interval", help="Refresh interval in seconds.")] = _REFRESH_INTERVAL,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output (no watch).")] = False,
) -> None:
    """Show current swarm status."""
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    _json = json_out or is_json_mode()

    if _json:
        from swarmx.core.mission_manager import list_missions
        from swarmx.core.db import db_exists
        emit_json({
            "db": db_exists(cfg.home),
            "missions": list_missions(cfg.home, limit=10),
        })
        return

    c = get_console()

    if watch and not is_no_progress():
        # BUG-00 Live watch fix: single Live context owns all rendering
        try:
            with Live(
                _build_status_table(cfg.home),
                console=c,
                refresh_per_second=1.0 / max(interval, 0.5),
                screen=False,
            ) as live:
                while True:
                    time.sleep(interval)
                    live.update(_build_status_table(cfg.home))
        except KeyboardInterrupt:
            pass
    else:
        c.print(_build_status_table(cfg.home))


@app.command("dashboard")
def status_dashboard(
    terminal: Annotated[bool, typer.Option("--terminal", help="Render in terminal (Live mode).")] = False,
    watch: Annotated[bool, typer.Option("--watch", help="Auto-refresh every 2 seconds.")] = False,
) -> None:
    """Open the SwarmX dashboard (browser or terminal Live mode)."""
    if terminal:
        # Delegate to show --watch in terminal
        status_show(watch=watch, interval=_REFRESH_INTERVAL, json_out=False)
    else:
        try:
            import webbrowser
            import threading
            from swarmx.config import SwarmConfig
            from swarmx.server import serve_dashboard
            cfg = SwarmConfig()
            host = "127.0.0.1"
            port = 8787
            httpd = serve_dashboard(host=host, port=port, cfg=cfg)
            url = f"http://{host}:{port}"
            safe_print(f"[brand]Dashboard:[/brand] {url}")
            threading.Thread(target=lambda: webbrowser.open(url), daemon=True).start()
            try:
                httpd.serve_forever()
            except KeyboardInterrupt:
                httpd.shutdown()
        except Exception as exc:
            emit_json({"error": str(exc)}) if is_json_mode() else safe_print(f"[error]{exc}[/error]")
