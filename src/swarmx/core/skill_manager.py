"""Skill manager adapter — delegates to swarmx.skills."""
from __future__ import annotations

from pathlib import Path
from typing import Any

from swarmx.skills import skill_library, SkillCard


def list_skills(runtime_home: Path | None = None) -> list[SkillCard]:
    """Return the full skill library."""
    return skill_library()


def get_skill(name: str) -> SkillCard | None:
    """Return a skill by name, or None."""
    for s in skill_library():
        if s.name.lower() == name.lower():
            return s
    return None


def search_skills(query: str) -> list[SkillCard]:
    """Return skills whose name, purpose, or triggers match the query."""
    q = query.lower()
    results = []
    for s in skill_library():
        haystack = " ".join([s.name, s.purpose] + s.triggers).lower()
        if q in haystack:
            results.append(s)
    return results


def skill_to_dict(s: SkillCard) -> dict[str, Any]:
    """Convert a SkillCard to a plain dict."""
    return s.to_dict()


__all__ = ["list_skills", "get_skill", "search_skills", "skill_to_dict"]
