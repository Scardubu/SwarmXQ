"""
core/skills/crystallizer — REDIRECT SHIM
=========================================
Canonical implementation lives in src/core/skills/crystallizer.py.
This shim exists only for backward-compat import paths.
"""
from __future__ import annotations

try:
    from src.core.skills.crystallizer import *  # noqa: F401, F403
    from src.core.skills.crystallizer import SkillCrystallizer  # noqa: F401
except ImportError:
    from swarmx.core.skills.crystallizer import *  # noqa: F401, F403
    from swarmx.core.skills.crystallizer import SkillCrystallizer  # noqa: F401
