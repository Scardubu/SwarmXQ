"""Config and path helpers for the canonical CLI.

Thin wrappers over :class:`swarmx.config.SwarmConfig` — never re-implements
config logic.
"""
from __future__ import annotations

from pathlib import Path


def get_config():  # type: ignore[return]
    """Return an initialised :class:`~swarmx.config.SwarmConfig` instance."""
    from swarmx.config import SwarmConfig
    cfg = SwarmConfig()
    cfg.ensure()
    return cfg


def repo_root(path: str | Path) -> Path:
    """Resolve *path* to an absolute directory path."""
    p = Path(path).expanduser().resolve()
    return p.parent if p.is_file() else p


def runtime_target(repo: Path) -> Path:
    """Return the ``<repo>/.swarmx`` runtime directory path."""
    return repo / ".swarmx"
