"""``swarm run`` — execute a mission target.

Bug fixes vs v0.2.0:
  - [BUG-01] Spinner is isolated in a Live context; safe_print is never called
    while the spinner is active to prevent stream interleaving.
  - [BUG-08] --dry-run flag does not start the executor; it prints the plan.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Annotated, Optional

import typer

from swarmx.console.output import get_console, safe_print, emit_json, emit_error
from swarmx.console.compat import is_json_mode

logger = logging.getLogger(__name__)

app = typer.Typer(help="Execute a mission target against a repository.")


@app.command()
def run(
    target: Annotated[str, typer.Argument(help="Mission target description.")],
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root path.")] = Path("."),
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Print the plan without executing.")] = False,
    review: Annotated[bool, typer.Option("--review", help="Require human review before execution.")] = False,
    json_out: Annotated[bool, typer.Option("--json", help="Output result as JSON.")] = False,
    quiet: Annotated[bool, typer.Option("--quiet", "-q", help="Minimal output.")] = False,
) -> None:
    """Run a SwarmX mission against a target."""
    from swarmx.config import SwarmConfig

    cfg = SwarmConfig()
    repo_path = repo.expanduser().resolve()

    if not repo_path.exists():
        emit_error(f"Repository path does not exist: {repo_path}", code=2)
        raise typer.Exit(code=2)

    _json = json_out or is_json_mode()
    c = get_console()

    if dry_run:
        # Build and display the mission plan without executing.
        if not _json and not quiet:
            safe_print(f"[brand]Building mission:[/brand] [highlight]{target}[/highlight]")
        try:
            from swarmx.core.mission_manager import build_mission
            mission = build_mission(repo=repo_path, target=target, cfg=cfg, review_required=review)
        except Exception as exc:
            emit_error(f"Mission build failed: {exc}", code=3)
            raise typer.Exit(code=3)
        if _json:
            emit_json(mission)
        else:
            from swarmx.console.output import kv_panel
            c.print(kv_panel({"id": mission.get("id", "?"), "target": target, "phases": len(mission.get("phases", []))}, title="Mission Plan (dry-run)"))
        return

    # Execute — delegate to the validated cli.run path (correct args, policy gate,
    # telemetry, mission persistence, and V5 checkpoint writes).
    # [V5.9-FIX-01] Prior code passed a bare dict to execute_plan and omitted the
    # required run_id and autonomous args, bypassing the policy assessment gate.
    from swarmx.cli import run as _cli_run

    try:
        exit_code = _cli_run(
            repo=repo_path,
            target=target,
            review_required=review,
        )
    except Exception as exc:
        emit_error(f"Mission execution failed: {exc}", code=4)
        raise typer.Exit(code=4)

    if exit_code != 0:
        raise typer.Exit(code=exit_code)
