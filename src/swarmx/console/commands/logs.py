"""``swarm logs`` — stream SwarmX runtime logs.

Reads from the SwarmX structured log file (SWARMX_HOME/logs/swarmx.jsonl)
and optionally tails it in real time. Supports JSON, level, and agent filters.
"""
from __future__ import annotations

import json
import logging
import sys
import time
from pathlib import Path
from typing import Annotated, Optional

import typer

from swarmx.console.output import get_console, safe_print, emit_json
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="Stream and filter SwarmX runtime logs.",
    invoke_without_command=True,
    no_args_is_help=False,
)

# Level ordering for filtering
_LEVEL_ORDER = {"debug": 0, "info": 1, "warn": 2, "warning": 2, "error": 3, "critical": 4}

_LEVEL_STYLE: dict[str, str] = {
    "debug":    "dim",
    "info":     "text.secondary",
    "warn":     "status.warn",
    "warning":  "status.warn",
    "error":    "status.error",
    "critical": "status.error",
}


@app.callback()
def logs_callback(
    ctx: typer.Context,
    lines: Annotated[int, typer.Option("--lines", "-n", help="Number of historical lines to show before tailing.")] = 50,
    follow: Annotated[bool, typer.Option("--follow", "-f", help="Tail the log stream in real time.")] = False,
    level: Annotated[str, typer.Option("--level", "-l", help="Minimum log level to show (debug/info/warn/error). ")] = "info",
    agent: Annotated[Optional[str], typer.Option("--agent", "-a", help="Filter by agent ID or name substring.")] = None,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Default to log streaming when ``swarm logs`` is invoked without a subcommand."""
    if ctx.invoked_subcommand is not None:
        return
    cmd_stream(lines=lines, follow=follow, level=level, agent=agent, json_out=json_out)


@app.command("stream")
def cmd_stream(
    lines: Annotated[int, typer.Option("--lines", "-n", help="Number of historical lines to show before tailing.")] = 50,
    follow: Annotated[bool, typer.Option("--follow", "-f", help="Tail the log stream in real time.")] = False,
    level: Annotated[str, typer.Option("--level", "-l", help="Minimum log level to show (debug/info/warn/error).")] = "info",
    agent: Annotated[Optional[str], typer.Option("--agent", "-a", help="Filter by agent ID or name substring.")] = None,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Show recent log entries from the SwarmX runtime log file."""
    from swarmx.config import SwarmConfig
    _json = json_out or is_json_mode()
    console = get_console()
    cfg = SwarmConfig()

    log_file = cfg.home / "logs" / "swarmx.jsonl"
    if not log_file.exists():
        # Fall back to structured stderr log if main file absent
        alt = cfg.home / "logs" / "swarmx-api.log"
        if alt.exists():
            log_file = alt
        else:
            if _json:
                emit_json({"error": "Log file not found", "path": str(log_file)})
            else:
                safe_print(f"[warn]No log file found at {log_file}[/warn]")
                safe_print("[dim]Start the SwarmX stack first: swarm up start[/dim]")
            raise typer.Exit(code=0)

    min_level = _LEVEL_ORDER.get(level.lower(), 1)

    def _passes(entry: dict[str, object]) -> bool:
        lvl = str(entry.get("level", "info")).lower()
        if _LEVEL_ORDER.get(lvl, 0) < min_level:
            return False
        if agent:
            agent_id = str(entry.get("agentId", entry.get("agent_id", entry.get("agent", ""))))
            if agent.lower() not in agent_id.lower():
                return False
        return True

    def _format(entry: dict[str, object]) -> None:
        if _json:
            emit_json(entry)
            return
        ts = str(entry.get("timestamp", entry.get("time", "")))[:23]
        lvl = str(entry.get("level", "info")).lower()
        style = _LEVEL_STYLE.get(lvl, "text.secondary")
        msg = str(entry.get("message", entry.get("msg", "")))
        aid = str(entry.get("agentId", entry.get("agent", "")))
        prefix = f"[dim]{ts}[/dim] [{style}]{lvl.upper():5}[/{style}]"
        if aid:
            prefix += f" [dim]{aid}[/dim]"
        console.print(f"{prefix} {msg}")

    def _parse_line(raw: str) -> Optional[dict[str, object]]:
        raw = raw.strip()
        if not raw:
            return None
        try:
            return json.loads(raw)  # type: ignore[return-value]
        except json.JSONDecodeError:
            # Treat as plain text log line
            return {"level": "info", "message": raw, "timestamp": ""}

    # ── Read tail of existing file ───────────────────────────────────────────
    try:
        all_lines = log_file.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError:
        all_lines = []

    recent = all_lines[-lines:] if lines > 0 else all_lines
    for raw in recent:
        entry = _parse_line(raw)
        if entry and _passes(entry):
            _format(entry)

    if not follow:
        return

    # ── Tail mode ────────────────────────────────────────────────────────────
    if not _json:
        console.print("[dim]--- following (Ctrl+C to stop) ---[/dim]")

    try:
        with log_file.open("r", encoding="utf-8", errors="replace") as fh:
            fh.seek(0, 2)  # seek to end
            while True:
                raw = fh.readline()
                if raw:
                    entry = _parse_line(raw)
                    if entry and _passes(entry):
                        _format(entry)
                else:
                    time.sleep(0.25)
    except KeyboardInterrupt:
        if not _json:
            console.print("\n[dim]Log stream stopped.[/dim]")
