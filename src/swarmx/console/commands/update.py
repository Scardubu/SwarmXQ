"""``swarm update`` — update SwarmX to the latest release.

Checks the current version against the latest available package version,
prompts the user, then runs pip upgrade with a rollback prompt on failure.
"""
from __future__ import annotations

import importlib.metadata
import structlog
import subprocess
import sys
from typing import Annotated

import typer

from swarmx.console.compat import is_json_mode
from swarmx.console.output import emit_error, emit_json, get_console, safe_print

logger = structlog.get_logger("swarmx.console.commands.update")

app = typer.Typer(
    help="Update SwarmX to the latest release.",
    invoke_without_command=True,
    no_args_is_help=False,
)

_PACKAGE_NAME = "swarmx"


@app.callback()
def update_callback(
    ctx: typer.Context,
    apply: Annotated[bool, typer.Option("--apply", help="Install the available update instead of only checking.")] = False,
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip confirmation prompt when applying.")] = False,
    pre: Annotated[bool, typer.Option("--pre", help="Include pre-release versions when applying.")] = False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Check for updates by default when ``swarm update`` is invoked without a subcommand."""
    if ctx.invoked_subcommand is not None:
        return
    if apply:
        cmd_apply(yes=yes, pre=pre, json_out=json_out)
        return
    cmd_check(json_out=json_out)


@app.command("check")
def cmd_check(
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Check if a newer SwarmX version is available."""
    _json = json_out or is_json_mode()
    current = _current_version()
    latest = _latest_version()

    result = {
        "current": current,
        "latest": latest,
        "up_to_date": current == latest,
    }
    if _json:
        emit_json(result)
    elif current == latest:
        safe_print(f"[success]Up to date:[/success] {current}")
    else:
        safe_print(f"[warn]Update available:[/warn] {current} → [highlight]{latest}[/highlight]")
        safe_print("[dim]Run: swarm update apply[/dim]")


@app.command("apply")
def cmd_apply(
    yes: Annotated[bool, typer.Option("--yes", "-y", help="Skip confirmation prompt.")] = False,
    pre: Annotated[bool, typer.Option("--pre", help="Include pre-release versions.")] = False,
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Apply available SwarmX update."""
    _json = json_out or is_json_mode()
    console = get_console()

    current = _current_version()
    latest = _latest_version()

    if current == latest:
        result = {"current": current, "action": "none", "message": "Already up to date"}
        if _json:
            emit_json(result)
        else:
            safe_print(f"[success]Already up to date:[/success] {current}")
        return

    if not _json:
        console.print(f"[brand]SwarmX[/brand] update: {current} → [highlight]{latest}[/highlight]")

    if not yes and not _json:
        confirmed = typer.confirm(f"Update SwarmX from {current} to {latest}?", default=True)
        if not confirmed:
            console.print("[dim]Update cancelled.[/dim]")
            raise typer.Exit(code=0)

    # ── Pre-update backup ────────────────────────────────────────────────────
    if not _json:
        console.print("[dim]Creating pre-update backup…[/dim]")
    try:
        from swarmx.console.commands.backup import cmd_create
        cmd_create(compress=False, tag=f"pre-update-{current}", json_out=_json)
    except Exception as exc:
        logger.debug("pre_update_backup_skipped", exc=str(exc))
        if not _json:
            console.print(f"[dim]Pre-update backup skipped: {exc}[/dim]")

    # ── Run pip upgrade ───────────────────────────────────────────────────────
    pip_cmd = [sys.executable, "-m", "pip", "install", "--upgrade", _PACKAGE_NAME]
    if pre:
        pip_cmd.append("--pre")

    if not _json:
        console.print(f"[dim]Running: {' '.join(pip_cmd)}[/dim]")

    result = subprocess.run(pip_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        emit_error(f"pip upgrade failed:\n{result.stderr}", code=1)
        if not _json:
            console.print("[dim]Your previous version is still installed. Run: swarm restore run <backup>[/dim]")
        raise typer.Exit(code=1)

    # ── Verify new version ───────────────────────────────────────────────────
    new_version = _current_version(refresh=True)
    update_result = {
        "previous": current,
        "installed": new_version,
        "success": True,
    }
    if _json:
        emit_json(update_result)
    else:
        console.print(f"[success]Updated:[/success] {current} → [highlight]{new_version}[/highlight]")
        console.print("[dim]Restart the SwarmX stack to apply: swarm up --down && swarm up[/dim]")


def _current_version(*, refresh: bool = False) -> str:
    if refresh:
        # Force re-read from importlib (works in same process for editable installs)
        try:
            importlib.metadata.packages_distributions()  # bust cache
        except Exception:
            pass
    try:
        return importlib.metadata.version(_PACKAGE_NAME)
    except importlib.metadata.PackageNotFoundError:
        return "0.0.0+dev"


def _latest_version() -> str:
    """Query PyPI for the latest swarmx release. Falls back to current on error."""
    try:
        import json as _json
        import urllib.request  # noqa: E401
        url = f"https://pypi.org/pypi/{_PACKAGE_NAME}/json"
        with urllib.request.urlopen(url, timeout=8) as resp:  # noqa: S310
            data = _json.loads(resp.read().decode())
            return str(data["info"]["version"])
    except Exception as exc:
        logger.debug("pypi_version_fetch_failed", exc=str(exc))
        return _current_version()
