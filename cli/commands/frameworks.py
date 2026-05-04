"""``swarm frameworks`` — show optional framework adapter matrix."""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def frameworks_default() -> None:
    """Show framework adapter availability and capabilities."""
    from swarmx.cli import frameworks_cmd as _frameworks

    raise SystemExit(_frameworks())
