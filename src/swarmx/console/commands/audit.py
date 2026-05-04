"""``swarm audit`` — audit log viewing."""
from __future__ import annotations

import logging
from typing import Annotated

import typer

from swarmx.console.output import get_console, safe_print, emit_json, make_table
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(
    help="View the SwarmX audit log.",
    invoke_without_command=True,
    no_args_is_help=False,
)


@app.callback()
def audit_callback(
    ctx: typer.Context,
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max entries to show.")] = 25,
    event: Annotated[str, typer.Option("--event", "-e", help="Filter by event kind.")] = "",
    count: Annotated[bool, typer.Option("--count", help="Show the total audit entry count.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Default to showing recent audit entries when no subcommand is supplied."""
    if ctx.invoked_subcommand is not None:
        return
    if count:
        audit_count(json_out=json_out)
        return
    audit_show(limit=limit, event=event, json_out=json_out)


@app.command("show")
def audit_show(
    limit: Annotated[int, typer.Option("--limit", "-n", help="Max entries to show.")] = 25,
    event: Annotated[str, typer.Option("--event", "-e", help="Filter by event kind.")] = "",
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Show recent audit log entries."""
    from swarmx.config import SwarmConfig
    from swarmx.core.audit_log import list_entries

    cfg = SwarmConfig()
    entries = list_entries(cfg.home, limit=limit)

    if event:
        entries = [e for e in entries if str(e.get("event", e.get("kind", ""))).lower() == event.lower()]

    _json = json_out or is_json_mode()
    if _json:
        emit_json(entries)
        return

    if not entries:
        safe_print("[muted]No audit entries found.[/muted]")
        return

    c = get_console()
    t = make_table("Timestamp", "Event", "Detail", title="Audit Log")
    for e in entries:
        ts = str(e.get("created_at", e.get("timestamp", "")))[:19]
        ev = str(e.get("event", e.get("kind", "?")))
        detail = str(e.get("payload", e.get("detail", "")))[:80]
        t.add_row(ts, ev, detail)
    c.print(t)
    safe_print(f"[muted]{len(entries)} entries shown.[/muted]")


@app.command("count")
def audit_count(
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Print total audit entry count."""
    from swarmx.config import SwarmConfig
    from swarmx.core.audit_log import count

    cfg = SwarmConfig()
    n = count(cfg.home)

    if is_json_mode() or json_out:
        emit_json({"count": n})
    else:
        safe_print(f"Audit entries: [brand]{n}[/brand]")
