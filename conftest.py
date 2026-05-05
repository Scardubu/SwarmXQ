"""
Root conftest — SwarmX pytest bootstrap.
Inserted at repository root so pytest loads it BEFORE any test module.
"""
from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "src"

# src/ for `swarmx` package
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

# repo root for `brain` and `agents` packages
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))
