"""``swarm plan`` — generate a stack-aware plan."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False)


@app.callback(invoke_without_command=True)
def plan_default(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
    target: Annotated[str, typer.Argument(help="Task description.")] = "repository acceleration",
    review_required: Annotated[bool, typer.Option("--review-required", "--review", help="Require human review.")] = False,
) -> None:
    """Generate and print a structured plan for the target."""
    from cli.commands import resolve_repo
    from swarmx.cli import plan as _plan

    raise SystemExit(_plan(resolve_repo(repo), target, review_required=review_required))
