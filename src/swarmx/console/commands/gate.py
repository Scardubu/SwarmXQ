"""``swarm gate`` — policy gate assessment for actions.

Bug fix vs v0.2.0:
  - [BUG-01] Spinner stop/start isolated from print calls (Live context).
"""
from __future__ import annotations

import structlog
from pathlib import Path
from typing import Annotated

import typer
from rich.live import Live

from swarmx.console.compat import is_json_mode, is_no_progress
from swarmx.console.output import emit_error, emit_json, get_console, kv_panel, make_spinner, safe_print

logger = structlog.get_logger("swarmx.console.commands.gate")

app = typer.Typer(help="Evaluate policy gate for a given action.")


@app.command("check")
def gate_check(
    action: Annotated[str, typer.Argument(help="Action name to assess (e.g. 'run', 'evolve_apply').")],
    target: Annotated[str, typer.Option("--target", "-t", help="Target description.")] = "",
    repo: Annotated[Path, typer.Option("--repo", "-r", help="Repository root.")] = Path("."),
    json_out: Annotated[bool, typer.Option("--json", help="JSON output.")] = False,
) -> None:
    """Check if an action passes the policy gate."""
    from swarmx.config import SwarmConfig
    from swarmx.policy import assess_action

    cfg = SwarmConfig()
    repo_path = repo.expanduser().resolve()
    _json = json_out or is_json_mode()
    target = target or action

    c = get_console()
    spinner = make_spinner(f"Assessing gate for: {action}")
    result: dict = {}
    error: Exception | None = None

    # BUG-01: spinner isolated in Live block
    if not _json and not is_no_progress():
        with Live(spinner, console=c, refresh_per_second=8, transient=True):
            try:
                result = assess_action(action, target, repo_path, cfg)
            except Exception as exc:
                error = exc
    else:
        try:
            result = assess_action(action, target, repo_path, cfg)
        except Exception as exc:
            error = exc

    if error:
        emit_error(f"Gate assessment failed: {error}", code=3)
        raise typer.Exit(code=3)

    if _json:
        emit_json(result)
        return

    allowed = result.get("allowed", True)
    style = "success" if allowed else "error"
    verdict = "ALLOWED" if allowed else "BLOCKED"
    c.print(f"\n[{style}]Gate: {verdict}[/{style}]")
    c.print(kv_panel({k: v for k, v in result.items() if k != "allowed"}, title="Assessment Detail"))


@app.command("assess")
def gate_assess(
    mission: Annotated[str, typer.Argument(help="Mission target text.")],
    repo: Annotated[Path, typer.Option("--repo", "-r")] = Path("."),
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Assess a mission description for policy compliance."""
    from swarmx.config import SwarmConfig
    from swarmx.policy import assess_mission

    cfg = SwarmConfig()
    repo_path = repo.expanduser().resolve()
    _json = json_out or is_json_mode()

    try:
        result = assess_mission(mission, repo_path, cfg)
    except Exception as exc:
        emit_error(f"Mission assessment failed: {exc}", code=3)
        raise typer.Exit(code=3)

    if _json:
        emit_json(result)
        return

    allowed = result.get("allowed", True)
    style = "success" if allowed else "error"
    verdict = "APPROVED" if allowed else "REJECTED"
    safe_print(f"\n[{style}]Mission Assessment: {verdict}[/{style}]")
    get_console().print(kv_panel({k: v for k, v in result.items() if k != "allowed"}, title="Policy Detail"))
