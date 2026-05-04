"""``swarm workflows`` — show available workflows."""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def workflows_default() -> None:
    """List runtime workflows."""
    from swarmx.cli import workflows_cmd as _workflows

    raise SystemExit(_workflows())
