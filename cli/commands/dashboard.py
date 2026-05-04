"""``swarm dashboard`` — start the SwarmX dashboard server."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def dashboard_default(
    ctx: typer.Context,
    host: Annotated[str, typer.Option("--host", help="Bind host.")] = "127.0.0.1",
    port: Annotated[int, typer.Option("--port", "-p", help="Listen port.")] = 7860,
    open_browser: Annotated[bool, typer.Option("--open-browser", help="Open browser automatically.")] = False,
) -> None:
    """Start the SwarmX web dashboard."""
    if ctx.invoked_subcommand is not None:
        return
    try:
        from swarmx.server import serve_dashboard  # type: ignore[attr-defined]
        serve_dashboard(host=host, port=port, open_browser=open_browser)
    except TypeError:
        # Older signature without kwargs
        from swarmx.server import serve_dashboard  # type: ignore[attr-defined]
        serve_dashboard()
    except Exception as exc:
        from rich.console import Console
        Console().print(f"[red]Dashboard error:[/red] {exc}")
        raise typer.Exit(1)
