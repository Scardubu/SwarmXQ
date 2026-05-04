"""``swarm status`` — show runtime status and metrics."""
from __future__ import annotations

import os
from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def status_default(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
    json_out: Annotated[bool, typer.Option("--json", help="Output as JSON.")] = False,
    watch: Annotated[bool, typer.Option("--watch", "-w", help="Refresh continuously.")] = False,
) -> None:
    """Display runtime state, models, queue and recent missions."""
    if ctx.invoked_subcommand is not None:
        return
    if json_out:
        os.environ["SWARMX_JSON"] = "1"

    from cli.commands import resolve_repo
    repo_path = resolve_repo(repo)

    if watch:
        # Delegate to premium console status for Live refresh support.
        try:
            from swarmx.console.commands.status import status_show  # type: ignore[attr-defined]
            status_show(watch=True)
            return
        except Exception:
            pass

    from swarmx.cli import status as _status
    raise SystemExit(_status(repo_path))


@app.command("show")
def status_show(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
    json_out: Annotated[bool, typer.Option("--json", help="Output as JSON.")] = False,
    watch: Annotated[bool, typer.Option("--watch", "-w", help="Refresh continuously.")] = False,
) -> None:
    """Show detailed status (alias: ``swarm status show``)."""
    if json_out:
        os.environ["SWARMX_JSON"] = "1"
    from cli.commands import resolve_repo
    repo_path = resolve_repo(repo)
    if watch:
        try:
            from swarmx.console.commands.status import status_show as _pshow  # type: ignore[attr-defined]
            _pshow(watch=True)
            return
        except Exception:
            pass
    from swarmx.cli import status as _status
    raise SystemExit(_status(repo_path))


@app.command("dashboard")
def status_dashboard() -> None:
    """Open the status dashboard view."""
    try:
        from swarmx.console.commands.status import status_dashboard as _d  # type: ignore[attr-defined]
        _d()
    except Exception:
        from rich.console import Console
        Console().print("[yellow]Dashboard sub-command not available.[/yellow]")
        raise SystemExit(1)
