"""``swarm mission`` — create and queue missions."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def mission_default(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
    target: Annotated[str, typer.Option("--target", "-t", help="Mission target/objective.")] = "",
    review_required: Annotated[bool, typer.Option("--review-required", "--review", help="Require human review.")] = False,
    queue: Annotated[bool, typer.Option("--queue", help="Queue the mission for background execution.")] = False,
) -> None:
    """Create a mission and optionally queue it for execution."""
    if ctx.invoked_subcommand is not None:
        return
    if not target:
        typer.echo("Error: --target is required.", err=True)
        raise typer.Exit(1)
    from cli.commands import resolve_repo
    from swarmx.cli import mission_cmd as _mission

    raise SystemExit(
        _mission(
            str(resolve_repo(repo)),
            target=target,
            review_required=review_required,
            queue=queue,
        )
    )
