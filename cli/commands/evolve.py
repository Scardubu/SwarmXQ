"""``swarm evolve`` — generate, review, and apply evolution proposals."""
from __future__ import annotations

import os
from typing import Annotated, Optional

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def evolve_default(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
    auto_apply: Annotated[bool, typer.Option("--auto-apply", help="Auto-apply approved proposals.")] = False,
) -> None:
    """Run the full evolution cycle (propose → review → apply)."""
    if ctx.invoked_subcommand is not None:
        return
    from cli.commands import resolve_repo
    from swarmx.cli import evolve as _evolve

    raise SystemExit(_evolve(resolve_repo(repo), auto_apply=auto_apply))


@app.command("generate")
def evolve_generate(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Generate evolution proposals without applying them."""
    try:
        from swarmx.console.commands.evolve import evolve_generate as _pgen  # type: ignore[attr-defined]
        _pgen(repo=repo)
    except Exception:
        from cli.commands import resolve_repo
        from swarmx.cli import evolve as _evolve
        raise SystemExit(_evolve(resolve_repo(repo), auto_apply=False))


@app.command("review")
def evolve_review(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Review pending evolution proposals interactively."""
    try:
        from swarmx.console.commands.evolve import evolve_review as _prev  # type: ignore[attr-defined]
        _prev(repo=repo)
    except Exception:
        from rich.console import Console
        Console().print("[yellow]Evolve review not available; run 'swarm evolve' instead.[/yellow]")
        raise typer.Exit(1)


@app.command("apply")
def evolve_apply(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Apply all approved evolution proposals."""
    try:
        from swarmx.console.commands.evolve import evolve_apply as _papply  # type: ignore[attr-defined]
        _papply(repo=repo)
    except Exception:
        from cli.commands import resolve_repo
        from swarmx.cli import evolve as _evolve
        raise SystemExit(_evolve(resolve_repo(repo), auto_apply=True))


@app.command("show")
def evolve_show(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Show evolution history."""
    try:
        from swarmx.console.commands.evolve import evolve_show as _pshow  # type: ignore[attr-defined]
        _pshow(repo=repo)
    except Exception:
        from rich.console import Console
        Console().print("[yellow]Evolve show not available.[/yellow]")
        raise typer.Exit(1)
