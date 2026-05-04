"""``swarm audit`` — show audit trail for a repository."""
from __future__ import annotations

from typing import Annotated

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def audit_default(
    ctx: typer.Context,
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Display the audit trail for *repo*."""
    if ctx.invoked_subcommand is not None:
        return
    from cli.commands import resolve_repo
    from swarmx.cli import audit_cmd as _audit

    raise SystemExit(_audit(resolve_repo(repo)))


@app.command("show")
def audit_show(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Show audit log (alias: ``swarm audit show``)."""
    try:
        from swarmx.console.commands.audit import audit_show as _ps  # type: ignore[attr-defined]
        _ps(repo=repo)
    except Exception:
        from cli.commands import resolve_repo
        from swarmx.cli import audit_cmd as _audit
        raise SystemExit(_audit(resolve_repo(repo)))


@app.command("count")
def audit_count(
    repo: Annotated[str, typer.Argument(help="Repository path.")] = ".",
) -> None:
    """Count audit log entries."""
    try:
        from swarmx.console.commands.audit import audit_count as _pc  # type: ignore[attr-defined]
        _pc(repo=repo)
    except Exception:
        from cli.commands import resolve_repo
        from swarmx.cli import audit_cmd as _audit
        raise SystemExit(_audit(resolve_repo(repo)))
