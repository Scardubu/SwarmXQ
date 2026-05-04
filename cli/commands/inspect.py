"""``swarm inspect`` — deep-inspect repo runtime state."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def inspect_default(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Inspect the SwarmX runtime state for *repo*."""
    if ctx.invoked_subcommand is not None:
        return
    from cli.commands import resolve_repo
    from swarmx.cli import inspect as _inspect

    raise SystemExit(_inspect(resolve_repo(repo)))


@app.command("mission")
def inspect_mission(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Inspect current missions."""
    try:
        from swarmx.console.commands.inspect import inspect_mission as _pm  # type: ignore[attr-defined]
        _pm(repo=repo)
    except Exception:
        inspect_default.callback(typer.Context(typer.main.get_command(app)), repo)  # type: ignore[attr-defined]


@app.command("memory")
def inspect_memory(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Inspect memory state."""
    try:
        from swarmx.console.commands.inspect import inspect_memory as _pmem  # type: ignore[attr-defined]
        _pmem(repo=repo)
    except Exception:
        from cli.commands import resolve_repo
        from swarmx.cli import inspect as _inspect
        raise SystemExit(_inspect(resolve_repo(repo)))


@app.command("graph")
def inspect_graph(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Inspect memory graph."""
    try:
        from swarmx.console.commands.inspect import inspect_graph as _pg  # type: ignore[attr-defined]
        _pg(repo=repo)
    except Exception:
        from cli.commands import resolve_repo
        from swarmx.cli import inspect as _inspect
        raise SystemExit(_inspect(resolve_repo(repo)))
