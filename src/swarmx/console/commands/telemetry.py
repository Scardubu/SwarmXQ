"""``swarm telemetry`` — trace event aggregation and reset."""
from __future__ import annotations

import logging
from typing import Annotated

import typer

from swarmx.console.output import get_console, safe_print, emit_json, make_table, kv_panel
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="Inspect and manage telemetry traces.",
    invoke_without_command=True,
    no_args_is_help=False,
)


@app.callback()
def telemetry_callback(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max events to show.")] = 20,
    stats: Annotated[bool, typer.Option("--stats", help="Show aggregated telemetry statistics instead of recent events.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Default to recent telemetry events when no subcommand is supplied."""
    if ctx.invoked_subcommand is not None:
        return
    if stats:
        telemetry_stats(json_out=json_out)
        return
    telemetry_show(limit=limit, json_out=json_out)


@app.command("show")
def telemetry_show(
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max events to show.")] = 20,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Show recent telemetry trace events."""
    from swarmx.config import SwarmConfig
    from swarmx.core.telemetry_store import list_events

    cfg = SwarmConfig()
    events = list_events(cfg.home, limit=limit)
    _json = json_out or is_json_mode()

    if _json:
        emit_json(events)
        return

    if not events:
        safe_print("[muted]No telemetry events recorded.[/muted]")
        return

    c = get_console()
    t = make_table("Timestamp", "Kind", "Payload", title="Telemetry Events")
    for e in events:
        ts = str(e.get("created_at", ""))[:19]
        kind = str(e.get("kind", "?"))
        payload = str(e.get("payload", ""))[:80]
        t.add_row(ts, kind, payload)
    c.print(t)


@app.command("stats")
def telemetry_stats(
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Show aggregated telemetry statistics."""
    from swarmx.config import SwarmConfig
    from swarmx.core.telemetry_store import aggregate

    cfg = SwarmConfig()
    stats = aggregate(cfg.home)
    _json = json_out or is_json_mode()

    if _json:
        emit_json(stats)
        return

    c = get_console()
    # Summary panel
    c.print(kv_panel({
        "total_events": stats.get("total_events", 0),
        "first": stats.get("first") or "—",
        "last": stats.get("last") or "—",
    }, title="Telemetry Summary"))

    # By-kind breakdown
    by_kind = stats.get("by_kind", {})
    if by_kind:
        t = make_table("Event Kind", "Count", title="Events by Kind")
        for kind, count in sorted(by_kind.items(), key=lambda x: -x[1]):
            t.add_row(kind, str(count))
        c.print(t)


@app.command("reset")
def telemetry_reset(
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Confirm deletion without prompt.")] = False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Delete all stored telemetry trace events."""
    from swarmx.config import SwarmConfig
    from swarmx.core.telemetry_store import reset

    cfg = SwarmConfig()
    _json = json_out or is_json_mode()

    if not yes and not _json:
        confirm = typer.confirm("Delete all telemetry traces?", default=False)
        if not confirm:
            safe_print("[muted]Aborted.[/muted]")
            raise typer.Exit()

    deleted = reset(cfg.home)

    if _json:
        emit_json({"deleted": deleted})
    else:
        safe_print(f"[success]Deleted {deleted} trace file(s).[/success]")
