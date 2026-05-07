"""``swarm up`` — start and stop the SwarmX runtime stack.

CHANGES:
  [V5.9-ENH-06] Added CLI compatibility shim so the canonical ``cli`` entrypoint
  exposes ``swarm up`` and can launch the dashboard sidecar in one command.
"""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def up_default(
    ctx: typer.Context,
    down: Annotated[bool, typer.Option("--down", help="Stop detached SwarmX services.")] = False,
    restart: Annotated[bool, typer.Option("--restart", help="Restart detached SwarmX services.")] = False,
    host: Annotated[str, typer.Option("--host", "-H", help="Bind host for the API.")] = "0.0.0.0",
    port: Annotated[int, typer.Option("--port", "-p", help="Port for the API.")] = 3001,
    workers: Annotated[int, typer.Option("--workers", "-w", help="Number of API workers.")] = 1,
    dashboard: Annotated[bool, typer.Option("--dashboard/--no-dashboard", help="Also start the Next.js dashboard.")] = False,
    detach: Annotated[bool, typer.Option("--detach", "-d", help="Run services in the background.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="Output machine-readable JSON.")] = False,
) -> None:
    """Run default ``swarm up`` behaviour from the premium stack manager."""
    if ctx.invoked_subcommand is not None:
        return

    from swarmx.console.commands.up import up_callback as _up_callback

    _up_callback(
        ctx=ctx,
        down=down,
        restart=restart,
        host=host,
        port=port,
        workers=workers,
        dashboard=dashboard,
        detach=detach,
        json_out=json_out,
    )


@app.command("start")
def up_start(
    host: Annotated[str, typer.Option("--host", "-H", help="Bind host for the API.")] = "0.0.0.0",
    port: Annotated[int, typer.Option("--port", "-p", help="Port for the API.")] = 3001,
    workers: Annotated[int, typer.Option("--workers", "-w", help="Number of API workers.")] = 1,
    dashboard: Annotated[bool, typer.Option("--dashboard/--no-dashboard", help="Also start the Next.js dashboard.")] = False,
    detach: Annotated[bool, typer.Option("--detach", "-d", help="Run services in the background.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="Output machine-readable JSON.")] = False,
) -> None:
    """Start API and optional dashboard via premium runtime orchestration."""
    from swarmx.console.commands.up import cmd_start as _cmd_start

    _cmd_start(
        host=host,
        port=port,
        workers=workers,
        dashboard=dashboard,
        detach=detach,
        json_out=json_out,
    )


@app.command("stop")
def up_stop(
    json_out: Annotated[bool, typer.Option("--json", help="Output machine-readable JSON.")] = False,
) -> None:
    """Stop detached SwarmX services."""
    from swarmx.console.commands.up import cmd_stop as _cmd_stop

    _cmd_stop(json_out=json_out)
