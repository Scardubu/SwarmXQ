"""Root Typer application — SwarmX Premium CLI v0.3.0.

Lazy-registers all command sub-apps so a missing optional dependency in any
one command module never crashes the entire CLI.

CHANGES:
  [FIX-01] _add() no longer silently swallows import failures at DEBUG level.
           A WARNING is now emitted to both the Python logger and stderr so
           operators can see broken commands without running `swarm doctor`.
           The warning includes the exact module path and exception message.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

from swarmx import __version__
from swarmx.console.output import get_console, safe_print, emit_json, print_banner
from swarmx.console.compat import is_json_mode

_log = logging.getLogger(__name__)

# ── Root app ──────────────────────────────────────────────────────────────────

app = typer.Typer(
    name="swarm",
    help="SwarmX - Unified Operator Platform",
    no_args_is_help=True,
    rich_markup_mode="rich",
    pretty_exceptions_enable=False,  # we handle errors ourselves
    add_completion=True,
)


# ── Global callback (version flag) ───────────────────────────────────────────

def _version_callback(value: bool) -> None:
    if value:
        if is_json_mode():
            emit_json({"version": __version__})
        else:
            safe_print(f"[brand]SwarmX[/brand] [highlight]{__version__}[/highlight]")
        raise typer.Exit()


@app.callback()
def root_callback(
    version: Annotated[
        Optional[bool],
        typer.Option("--version", "-V", callback=_version_callback, is_eager=True, help="Show version and exit."),
    ] = None,
    json_out: Annotated[
        Optional[bool],
        typer.Option("--json", help="Output as JSON (sets SWARMX_JSON env var).", is_eager=False),
    ] = None,
    no_color: Annotated[
        Optional[bool],
        typer.Option("--no-color", help="Disable color output.", is_eager=False),
    ] = None,
    quiet: Annotated[
        Optional[bool],
        typer.Option("--quiet", "-q", help="Suppress decorative output.", is_eager=False),
    ] = None,
) -> None:
    """SwarmX Unified Operator Platform — autonomous swarm control plane."""
    import os

    if json_out:
        os.environ["SWARMX_JSON"] = "1"
    if no_color:
        os.environ["SWARMX_NO_COLOR"] = "1"
    if quiet:
        os.environ["SWARMX_QUIET"] = "1"


# ── Sub-command lazy registration ─────────────────────────────────────────────

def _add(name: str, module_path: str, **kwargs: object) -> None:
    """Register a sub-app. Emits a visible WARNING if the module fails to load.

    [FIX-01] Previous behaviour logged at DEBUG — invisible to operators.
    New behaviour:
      - logs at WARNING level (appears in any non-quiet logging config)
      - prints a one-line notice to stderr so it is visible even without logging
      - never raises — a broken command module must not break the entire CLI
    Run `swarm doctor` for detailed diagnostics on registration failures.
    """
    try:
        import importlib
        mod = importlib.import_module(module_path)
        sub_app: typer.Typer = mod.app
        app.add_typer(sub_app, name=name, **kwargs)  # type: ignore[arg-type]
    except Exception as exc:
        msg = (
            f"[swarmx] Command '{name}' could not be registered "
            f"(module: {module_path}): {exc}. "
            f"Run `swarm doctor` to diagnose."
        )
        _log.warning(msg)
        # Also print to stderr so the warning is visible without a logging
        # config — this is the key fix: operators must see broken commands.
        print(f"⚠ {msg}", file=sys.stderr)


_add("run",       "swarmx.console.commands.run",       help="Execute a mission target.")
_add("evolve",    "swarmx.console.commands.evolve",    help="Generate and review evolution proposals.")
_add("status",    "swarmx.console.commands.status",    help="Show swarm runtime status.")
_add("inspect",   "swarmx.console.commands.inspect",   help="Inspect missions, memory, and graph.")
_add("gate",      "swarmx.console.commands.gate",      help="Policy gate assessment.")
_add("skills",    "swarmx.console.commands.skills",    help="Browse the skill library.")
_add("audit",     "swarmx.console.commands.audit",     help="View the audit log.")
_add("telemetry", "swarmx.console.commands.telemetry", help="Inspect telemetry traces.")
_add("doctor",    "swarmx.console.commands.doctor",    help="Run environment health checks.")
# ── RC1 operational commands ─────────────────────────────────────────────────
_add("up",      "swarmx.console.commands.up",      help="Start / stop the SwarmX stack.")
_add("logs",    "swarmx.console.commands.logs",    help="Stream runtime logs.")
_add("backup",  "swarmx.console.commands.backup",  help="Back up runtime state (DB + audit log + config).")
_add("restore", "swarmx.console.commands.restore", help="Restore runtime state from a backup.")
_add("update",  "swarmx.console.commands.update",  help="Update SwarmX to the latest release.")


# ── Top-level convenience commands ───────────────────────────────────────────

@app.command("version")
def cmd_version(
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Print the SwarmX version."""
    if json_out or is_json_mode():
        emit_json({"version": __version__})
    else:
        safe_print(f"[brand]SwarmX[/brand] [highlight]{__version__}[/highlight]")


@app.command("init")
def cmd_init(
    path: Annotated[Path, typer.Argument(help="Directory to initialize.")] = Path("."),  # type: ignore[assignment]
    json_out: Annotated[bool, typer.Option("--json")] = False,
) -> None:
    """Initialize a SwarmX workspace."""
    from pathlib import Path as _Path
    from swarmx.config import SwarmConfig

    repo = _Path(str(path)).expanduser().resolve()
    try:
        from swarmx.runtime import ensure_runtime_dirs
        cfg = SwarmConfig()
        ensure_runtime_dirs(cfg.home)
        if json_out or is_json_mode():
            emit_json({"initialized": str(repo), "runtime": str(cfg.home)})
        else:
            safe_print(f"[success]Initialized:[/success] {repo}")
    except Exception as exc:
        from swarmx.console.output import emit_error
        emit_error(f"Init failed: {exc}", code=1)
        raise typer.Exit(code=1)


@app.command("banner")
def cmd_banner() -> None:
    """Print the SwarmX ASCII/Unicode banner."""
    print_banner(__version__)