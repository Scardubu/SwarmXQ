"""Enable ``python -m cli`` execution."""
from __future__ import annotations

import pathlib
import sys


def _main() -> None:
    # [V5.9-FIX-07] Ensure repo-local ``src/swarmx`` is importable in uninstalled checkouts.
    repo_src = pathlib.Path(__file__).resolve().parents[1] / "src"
    if repo_src.is_dir():
        repo_src_str = str(repo_src)
        if repo_src_str not in sys.path:
            sys.path.insert(0, repo_src_str)

    from cli.main import app

    app()

if __name__ == "__main__":
    _main()
