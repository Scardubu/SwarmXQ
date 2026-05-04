from __future__ import annotations

import functools
from dataclasses import dataclass, field, asdict
from enum import Enum
from typing import Any

# ── Risk level ordering map (semantic, not alphabetical) ───────────────────────
# RiskLevel(str, Enum) inherits string comparison, which is ALPHABETICAL:
#   "critical" < "high" < "low" < "medium"
# This is the OPPOSITE of the intended semantic order for high/low and wrong
# for critical/high.  Fix: override __lt__ via @total_ordering so all
# comparisons (>=, <=, >, <) use the correct semantic ordering.
_RISK_ORDER: dict[str, int] = {"low": 0, "medium": 1, "high": 2, "critical": 3}


@functools.total_ordering
class RiskLevel(str, Enum):
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"

    # ── Semantic ordering (not alphabetical) ──────────────────────────────────
    def __lt__(self, other: object) -> bool:
        if isinstance(other, RiskLevel):
            return _RISK_ORDER[self.value] < _RISK_ORDER[other.value]
        return NotImplemented

    def __eq__(self, other: object) -> bool:  # type: ignore[override]
        if isinstance(other, RiskLevel):
            return self.value == other.value
        if isinstance(other, str):
            return self.value == other
        return NotImplemented

    def __hash__(self) -> int:
        return hash(self.value)

    # ── Convenience helpers ───────────────────────────────────────────────────
    def is_elevated(self) -> bool:
        """True for HIGH or CRITICAL — triggers human-gate or BLOCK envelope."""
        return self >= RiskLevel.HIGH

    @classmethod
    def from_str(cls, value: str, default: "RiskLevel" = None) -> "RiskLevel":
        """Case-insensitive coercion; returns `default` (LOW) if unknown."""
        try:
            return cls(value.lower())
        except ValueError:
            return default if default is not None else cls.LOW


@dataclass
class AgentRole:
    name: str
    mission: str
    tools: list[str] = field(default_factory=list)
    model_hint: str | None = None
    can_autorun: bool = True
    human_gate: bool = False
    skill_tags: list[str] = field(default_factory=list)
    framework_tags: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class TaskItem:
    title: str
    detail: str
    owner: str
    risk: RiskLevel = RiskLevel.LOW
    done: bool = False
    evidence: list[str] = field(default_factory=list)
    skill_tags: list[str] = field(default_factory=list)
    artifacts: list[str] = field(default_factory=list)
    # model_hint propagated from AgentRole so choose_model_for_task()
    # honours triadic_dispatch config instead of falling back to heuristics.
    # Values: "code" → Qwen2.5-Coder | "reason" → DeepSeek-R1 | "fast" → Phi-4-mini
    model_hint: str | None = None


@dataclass
class Plan:
    target: str
    stack: list[str]
    workflow: str
    risk: RiskLevel
    goal: str
    tasks: list[TaskItem]
    roles: list[AgentRole]
    approval_required: bool = False
    notes: list[str] = field(default_factory=list)
    workflow_meta: dict[str, Any] = field(default_factory=dict)
    skill_matches: list[str] = field(default_factory=list)
    frameworks: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["risk"] = self.risk.value
        for task in payload["tasks"]:
            task["risk"] = task["risk"].value if isinstance(task["risk"], RiskLevel) else task["risk"]
        return payload


@dataclass
class RunRecord:
    id: str
    created_at: str
    target: str
    workflow: str
    risk: str
    status: str
    plan: dict[str, Any]
    summary: str
    evidence: list[str] = field(default_factory=list)
    approvals: list[dict[str, Any]] = field(default_factory=list)
    metrics: dict[str, Any] = field(default_factory=dict)
    artifacts: list[dict[str, Any]] = field(default_factory=list)
    island_winner: str | None = None
    confidence_level: str = "HIGH"

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class EvolutionProposal:
    id: str
    created_at: str
    scope: str
    reason: str
    patch: dict[str, Any]
    risk: str = "low"
    status: str = "proposed"
    score: float = 0.0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class Checkpoint:
    """Immutable snapshot of swarm state at a task boundary.

    thread_id format: "{mission_id}:{run_id}:{stage_index}"
    Composite primary key: (thread_id, stage) — one row per thread+stage boundary.
    """
    thread_id: str
    stage: str            # "after_plan" | f"after_task_{n}" | "before_evolve" | "interrupt"
    created_at: str
    state_snapshot: dict[str, Any]
    risk_at_snapshot: str
    is_human_interrupt: bool = False
    resume_cursor: int = 0
    branch_parent: str | None = None

    def thread_key(self) -> tuple[str, str]:
        return (self.thread_id, self.stage)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
