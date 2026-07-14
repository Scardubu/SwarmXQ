"""Shared option declarations and argument normalisation helpers."""
from __future__ import annotations

from pathlib import Path
from typing import Annotated

import typer

# ── Re-usable option types ────────────────────────────────────────────────────

RepoArg = Annotated[
    str,
    typer.Argument(
        default=".",
        help="Path to the repository root (defaults to current directory).",
        show_default=True,
    ),
]

JsonOption = Annotated[
    bool,
    typer.Option("--json", help="Output as JSON.", envvar="SWARMX_JSON"),
]


def resolve_repo(path: str) -> Path:
    """Expand and resolve *path* to an absolute directory."""
    p = Path(path).expanduser().resolve()
    return p.parent if p.is_file() else p
