"""Core adapter facades package for SwarmX premium CLI.

Each sub-module provides a stable internal API that command modules import.
All implementations delegate to the existing runtime modules inside
``src/swarmx/`` to avoid code duplication.
"""
from __future__ import annotations

__all__ = [
    "mission_manager",
    "evolution_engine",
    "audit_log",
    "skill_manager",
    "telemetry_store",
    "db",
]
