"""``swarm run`` — run an autonomous task against a repository.

Accepts **both** argument forms for backward compatibility:

* Legacy:   ``swarm run <repo> --target "..." --autonomous --max-iterations N --review-required``
* New-style: ``swarm run "<target>" --repo <path> --review``
"""
from __future__ import annotations

import os
import signal
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

app = typer.Typer(no_args_is_help=False, invoke_without_command=True)


def _looks_like_repo(value: str) -> bool:
    """Return True when *value* is likely a filesystem path rather than a task description."""
    if value in {".", ".."}:
        return True
    if value.startswith(("~", "/", "./", "../")):
        return True
    if os.sep in value or (os.altsep is not None and os.altsep in value):
        return True
    return Path(value).exists()


@app.callback(invoke_without_command=True)
def run_task(
    target_or_repo: Annotated[
        str,
        typer.Argument(help="Task description *or* repo path (legacy form)."),
    ] = ".",
    target: Annotated[Optional[str], typer.Option("--target", "-t", help="Task description (legacy flag).")] = None,
    repo: Annotated[str, typer.Option("--repo", "-r", help="Repository root (new-style flag).")] = ".",
    autonomous: Annotated[bool, typer.Option("--autonomous", "-a", help="Run without human gates.")] = False,
    max_iterations: Annotated[int, typer.Option("--max-iterations", "-n", help="Max plan iterations.")] = 3,
    review_required: Annotated[bool, typer.Option("--review-required", "--review", help="Require human review.")] = False,
    dry_run: Annotated[bool, typer.Option("--dry-run", help="Plan only, do not execute.")] = False,
) -> None:
    """Run an autonomous task.  Accepts legacy and new-style argument forms."""
    # ── Resolve argument form ────────────────────────────────────────────────
    legacy_flags_present = target is not None
    if legacy_flags_present or _looks_like_repo(target_or_repo):
        # Legacy form: positional is repo path, --target carries description
        resolved_repo = Path(target_or_repo).expanduser().resolve()
        resolved_target = target or ""
    else:
        # New-style: positional is the task description, --repo is the path
        resolved_target = target_or_repo
        resolved_repo = Path(repo).expanduser().resolve()

    if not resolved_target:
        typer.echo("Error: target task description is required.", err=True)
        raise typer.Exit(1)

    if dry_run:
        from swarmx.cli import plan as _plan
        raise SystemExit(_plan(resolved_repo, resolved_target, review_required=review_required))

    # ── Signal handling ──────────────────────────────────────────────────────
    def _sigterm_handler(signum: int, frame: object) -> None:
        sys.stderr.write("\n[swarm run] received signal – cleaning up.\n")
        raise SystemExit(130)

    signal.signal(signal.SIGTERM, _sigterm_handler)

    from swarmx.cli import run as _run
    try:
        raise SystemExit(
            _run(
                resolved_repo,
                resolved_target,
                autonomous=autonomous,
                max_iterations=max_iterations,
                review_required=review_required,
            )
        )
    except KeyboardInterrupt:
        sys.stderr.write("\n[swarm run] interrupted.\n")
        raise SystemExit(130)
