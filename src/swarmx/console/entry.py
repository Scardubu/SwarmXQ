"""Premium CLI entry point — delegates to the Typer app in swarmx.console.app.

NOTE: pyproject.toml currently maps ``swarm`` and ``swarmx`` to
``swarmx.cli:main``, not to this module.  This entry is available for direct
invocation (``python -m swarmx.console.entry``) and will become the primary
pyproject.toml target after CLI parity is confirmed.
"""
from __future__ import annotations


def main() -> None:
    """Premium CLI entry point."""
    from swarmx.console.app import app
    app()


if __name__ == "__main__":
    main()
