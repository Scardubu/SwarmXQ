"""Shared output and process helpers for the canonical CLI."""
from __future__ import annotations

import json
import os
import sys


def is_json_mode() -> bool:
    """Return ``True`` when JSON-only output is requested."""
    return os.environ.get("SWARMX_JSON") == "1"


def is_quiet() -> bool:
    return os.environ.get("SWARMX_QUIET") == "1"


def emit_json(payload: object) -> None:
    """Print *payload* as compact JSON and flush."""
    print(json.dumps(payload, indent=2, ensure_ascii=False))
    sys.stdout.flush()


def exit_with(code: int) -> None:
    """Raise :class:`SystemExit` with *code*."""
    raise SystemExit(code)
