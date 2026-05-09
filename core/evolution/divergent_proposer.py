"""
core/evolution/divergent_proposer — REDIRECT SHIM
===================================================
Canonical implementation lives in src/core/evolution/divergent_proposer.py.
This shim exists only for backward-compat import paths.
"""
from __future__ import annotations

try:
    from src.core.evolution.divergent_proposer import *  # noqa: F401, F403
    from src.core.evolution.divergent_proposer import DivergentProposer  # noqa: F401
except ImportError:
    from swarmx.core.evolution.divergent_proposer import *  # noqa: F401, F403
    from swarmx.core.evolution.divergent_proposer import DivergentProposer  # noqa: F401