"""Root Typer application — SwarmX canonical CLI.

Delegates all command behaviour to existing ``swarmx`` package functions so
that 100 % of current semantics are preserved during the Phase 1 transition.

CHANGES:
  [FIX-01] _add() no longer silently swallows import failures at DEBUG level.
           A WARNING is now emitted to both the Python logger and stderr.
           Identical fix applied to swarmx.console.app — kept in sync.
"""
from __future__ import annotations

import logging
import os
import sys
from pathlib import Path
from typing import Annotated, Optional

import typer

_log = logging.getLogger(__name__)

# ── Version import (graceful fallback) ───────────────────────────────────────

try:
    from swarmx import __version__
except Exception:  # pragma: no cover
    __version__ = "unknown"

# ── Root app ──────────────────────────────────────────────────────────────────

app = typer.Typer(
    name="swarm",
    help="SwarmX — Unified Operator Platform",
    no_args_is_help=True,
    rich_markup_mode="rich",
    pretty_exceptions_enable=False,
    add_completion=True,
)


# ── Global flags ──────────────────────────────────────────────────────────────

def _version_callback(value: bool) -> None:
    if value:
        json_mode = os.environ.get("SWARMX_JSON") == "1"
        if json_mode:
            import json
            print(json.dumps({"version": __version__}))
        else:
            from rich.console import Console
            Console().print(f"[bold cyan]SwarmX[/bold cyan] [green]{__version__}[/green]")
        raise typer.Exit()


@app.callback()
def root_callback(
    version: Annotated[
        Optional[bool],
        typer.Option(
            "--version",
            "-V",
            callback=_version_callback,
            is_eager=True,
            help="Show version and exit.",
        ),
    ] = None,
    json_out: Annotated[
        Optional[bool],
        typer.Option("--json", help="Output as JSON (sets SWARMX_JSON=1).", is_eager=False),
    ] = None,
    no_color: Annotated[
        Optional[bool],
        typer.Option("--no-color", help="Disable colour output.", is_eager=False),
    ] = None,
    quiet: Annotated[
        Optional[bool],
        typer.Option("--quiet", "-q", help="Suppress decorative output.", is_eager=False),
    ] = None,
) -> None:
    """SwarmX Unified Operator Platform — autonomous swarm control plane."""
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
      - logs at WARNING level
      - prints a one-line notice to stderr (visible without a logging config)
      - never raises
    Run `swarm doctor` for detailed diagnostics.
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
        print(f"⚠ {msg}", file=sys.stderr)


_add("doctor", "cli.commands.doctor", help="Health-check the SwarmX installation.")
_add("status", "cli.commands.status", help="Show runtime status and metrics.")
_add("init", "cli.commands.init", help="Initialise a repository for SwarmX.")
_add("plan", "cli.commands.plan", help="Generate a stack-aware execution plan.")
_add("run", "cli.commands.run", help="Run an autonomous task against a repo.")
_add("evolve", "cli.commands.evolve", help="Generate, review, and apply evolution proposals.")
_add("inspect", "cli.commands.inspect", help="Deep-inspect repo runtime state.")
_add("audit", "cli.commands.audit", help="Show audit trail for a repository.")
_add("skills", "cli.commands.skills", help="Show available skill library entries.")
_add("workflows", "cli.commands.workflows", help="List available workflows.")
_add("models", "cli.commands.models", help="Show model routing and local model state.")
_add("frameworks", "cli.commands.frameworks", help="Show framework adapter matrix.")
_add("config", "cli.commands.config", help="Show merged runtime configuration.")
_add("dashboard", "cli.commands.dashboard", help="Start the SwarmX dashboard server.")
_add("mission", "cli.commands.mission", help="Create and queue missions.")
