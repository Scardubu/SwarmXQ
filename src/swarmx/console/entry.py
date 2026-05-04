"""Entry point for the premium CLI.

This module is the target of ``swarm = "swarmx.console.entry:main"`` in
pyproject.toml's console_scripts.  It delegates to the Typer app defined in
``swarmx.console.app``.
"""
from __future__ import annotations


def main() -> None:
    """Premium CLI entry point."""
    from swarmx.console.app import app
    app()


if __name__ == "__main__":
    main()
