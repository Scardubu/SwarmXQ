"""``swarm models`` — show model routing and local model view."""
from __future__ import annotations

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def models_default() -> None:
    """Show configured and discovered model routing state."""
    from swarmx.cli import models_cmd as _models

    raise SystemExit(_models())
