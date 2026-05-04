"""``swarm config`` — show merged runtime configuration."""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def config_default() -> None:
    """Print merged runtime configuration and templates."""
    from swarmx.cli import config_cmd as _config

    raise SystemExit(_config())
