"""
core — SwarmX Core Package
===========================
Registers the core/ package path for relative imports and exposes the
canonical sub-package APIs.

Sub-packages:
  core.memory    — VectorStore wrapper
  core.evolution — DivergentProposer, evolution helpers
  core.skills    — SkillCrystallizer
"""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure `core` is importable as a top-level package regardless of CWD
_CORE_ROOT = Path(__file__).parent.parent
if str(_CORE_ROOT) not in sys.path:
    sys.path.insert(0, str(_CORE_ROOT))

__version__ = "5.8.0"
__all__ = ["__version__"]
