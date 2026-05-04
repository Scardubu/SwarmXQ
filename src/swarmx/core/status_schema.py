"""Canonical status vocabulary for SwarmX CLI surfaces.

Provides a single source of truth for status strings, display icons, and
style tags — keeping the Rich CLI, dashboard, and API in sync.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal


# ── Agent / run status ─────────────────────────────────────────────────────

class AgentStatus(str, Enum):
    """Canonical agent lifecycle states."""
    IDLE = "idle"
    QUEUED = "queued"
    RUNNING = "running"
    THROTTLED = "throttled"
    ACTIVATING = "activating"
    ACTIVE = "active"
    DEACTIVATING = "deactivating"
    SUCCESS = "success"
    ERROR = "error"
    FATAL = "fatal"
    FAILED_PERMANENT = "failed_permanent"
    OOM_KILLED = "oom_killed"
    OOM = "oom"
    KILLED = "killed"
    RELOAD = "reload"
    RELOADING = "reloading"
    AWAITING_REVIEW = "awaiting_review"


# ── Health status ──────────────────────────────────────────────────────────

HealthStatus = Literal["ok", "warn", "error", "skip"]

_HEALTH_RANK: dict[HealthStatus, int] = {
    "ok": 0,
    "skip": 1,
    "warn": 2,
    "error": 3,
}


def worst_health(*statuses: HealthStatus) -> HealthStatus:
    """Return the worst health status from a list."""
    return max(statuses, key=lambda s: _HEALTH_RANK.get(s, 0))


# ── Risk level ─────────────────────────────────────────────────────────────

class RiskLevel(str, Enum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"
    CRITICAL = "critical"


# ── Normalisation ──────────────────────────────────────────────────────────

_ALIASES: dict[str, AgentStatus] = {
    # Legacy / abbreviated forms
    "active": AgentStatus.ACTIVE,
    "done": AgentStatus.SUCCESS,
    "ok": AgentStatus.SUCCESS,
    "complete": AgentStatus.SUCCESS,
    "failed": AgentStatus.ERROR,
    "fail": AgentStatus.ERROR,
    "crash": AgentStatus.FATAL,
    "pending": AgentStatus.QUEUED,
    "waiting": AgentStatus.QUEUED,
    "review": AgentStatus.AWAITING_REVIEW,
    "awaiting": AgentStatus.AWAITING_REVIEW,
}


def normalize_status(raw: str | None) -> AgentStatus:
    """Map a raw status string to a canonical AgentStatus.

    Returns ``AgentStatus.IDLE`` for unknown or None inputs so callers
    never receive an unexpected value.
    """
    if not raw:
        return AgentStatus.IDLE
    lower = raw.lower().strip()
    # Direct match first
    try:
        return AgentStatus(lower)
    except ValueError:
        pass
    # Alias table
    return _ALIASES.get(lower, AgentStatus.IDLE)


__all__ = [
    "AgentStatus",
    "HealthStatus",
    "RiskLevel",
    "normalize_status",
    "worst_health",
]
