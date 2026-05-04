"""``swarm skills`` — show skill library."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def skills_default(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Show available skills for the runtime and repository context."""
    from cli.commands import resolve_repo
    from swarmx.cli import skills_cmd as _skills

    raise SystemExit(_skills(resolve_repo(repo)))
