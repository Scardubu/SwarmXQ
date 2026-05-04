"""``swarm doctor`` — health-check the SwarmX installation."""
from __future__ import annotations

import os
from typing import Annotated, Optional

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


@app.callback(invoke_without_command=True)
def doctor_default(
    ctx: typer.Context,
    json_out: Annotated[bool, typer.Option("--json", help="Output as JSON.")] = False,
) -> None:
    """Run health checks and display system diagnostics."""
    if ctx.invoked_subcommand is not None:
        return
    if json_out:
        os.environ["SWARMX_JSON"] = "1"
    from swarmx.cli import doctor as _doctor
    raise SystemExit(_doctor(json_mode=(os.environ.get("SWARMX_JSON") == "1")))


@app.command("check")
def doctor_check(
    json_out: Annotated[bool, typer.Option("--json", help="Output as JSON.")] = False,
    strict: Annotated[bool, typer.Option("--strict", help="Exit non-zero if any check warns.")] = False,
) -> None:
    """Run structured health checks (alias: ``swarm doctor check``)."""
    if json_out:
        os.environ["SWARMX_JSON"] = "1"
    # Prefer the premium console doctor if available; fall back to cli.doctor.
    try:
        from swarmx.console.commands.doctor import doctor_check as _premium_check  # type: ignore[attr-defined]
        import inspect
        sig = inspect.signature(_premium_check)
        kwargs: dict = {}
        if "strict" in sig.parameters:
            kwargs["strict"] = strict
        _premium_check(**kwargs)
    except Exception:
        from swarmx.cli import doctor as _doctor
        raise SystemExit(_doctor(json_mode=(os.environ.get("SWARMX_JSON") == "1")))
