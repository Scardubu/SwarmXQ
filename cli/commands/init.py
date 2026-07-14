"""``swarm init`` — initialise a repository for SwarmX."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def init_repo(
    repo: Annotated[str, typer.Argument(help="Path to the repository root.")] = ".",
) -> None:
    """Create the ``.swarmx`` runtime directory tree inside *repo*."""
    from cli.commands import resolve_repo
    from swarmx.cli import init_repo as _init

    repo_path = resolve_repo(repo)
    raise SystemExit(_init(repo_path))
