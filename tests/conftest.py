"""
tests.conftest — SwarmX test bootstrap
======================================
Ensure the local `src/` package tree is importable during pytest collection.

CHANGES V5.9 vs V5.8:
  [FIX-02] Add `src/` to `sys.path` so tests can import `swarmx` without an
           editable install in the active virtual environment.
  [PRESERVED] Test discovery and runtime behavior remain unchanged.
"""
from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src"

# Ensure src/ (for `swarmx` package) is importable
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# Ensure repo root is importable so `brain` and `agents` packages resolve
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))