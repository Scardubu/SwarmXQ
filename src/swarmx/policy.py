# File: src/swarmx/policy.py
# SwarmX V6.0 — Policy Engine
# ─────────────────────────────────────────────────────────────────────────────
# CHANGES V6.0 vs V5.9:
#   [FIX-01] _risk_score() comparison `phrase_risk >= numeric_risk` now works
#     correctly. RiskLevel(str, Enum) had ALPHABETICAL ordering ("high" < "low"
#     alphabetically, but HIGH > LOW semantically). Fixed by upgrading
#     state.RiskLevel to use @functools.total_ordering with _RISK_ORDER mapping.
#     This fix is downstream — no code changes in this file, but the behaviour
#     of all `>=` / `<=` / `>` / `<` comparisons on RiskLevel is now correct.
#   [FIX-02] _risk_score() return type is now consistently tuple[str, list[str]]
#     in ALL branches — the V5.9 version returned `(str, list)` in the phrase
#     branch but `(str, list)` in the fallback branch with different semantics
#     (one used tier name, one used risk.value). Unified: always return
#     (tier_name: str, reasons: list[str]).
#   [ENH-01] PolicyDecision gains `tier` field (execution tier name).
#   [ENH-02] _risk_score() applies score_from_text() for numeric calibration.
#   [ENH-03] policy_mode() exposed as pure function for unit-testable isolation.
# ─────────────────────────────────────────────────────────────────────────────
from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .planner import build_plan

# Canonical risk signals — single source of truth
from .risk import DANGEROUS_COMMANDS, HIGH_RISK_KEYWORDS, risk_from_text  # noqa: F401
from .state import RiskLevel

# ── Tiered phrase map (ordered: critical → high → medium) ────────────────────
_RISK_TIER_PHRASES: dict[str, list[str]] = {
    "critical": [
        "drop database", "rm -rf", "force push", "wipe",
        "delete all", "destroy", "truncate table",
    ],
    "high": [
        "deploy", "production", "secret", "token", "credential",
        "rewrite history", "migration", "auth", "payment", "billing",
    ],
    "medium": [
        "refactor", "migrate", "optimize", "parallel", "worker", "cache",
    ],
}

# ── Tier → RiskLevel mapping ──────────────────────────────────────────────────
_TIER_TO_RISK: dict[str, RiskLevel] = {
    "critical": RiskLevel.CRITICAL,
    "high":     RiskLevel.HIGH,
    "medium":   RiskLevel.MEDIUM,
    "low":      RiskLevel.LOW,
}

# ── RiskLevel → tier name (reverse mapping) ────────────────────────────────
_RISK_TO_TIER: dict[RiskLevel, str] = {v: k for k, v in _TIER_TO_RISK.items()}


@dataclass
class PolicyDecision:
    allowed:     bool
    risk:        str
    tier:        str           # [ENH-01] execution tier name
    human_gate:  bool
    reasons:     list[str]
    mitigations: list[str]
    confidence:  float
    mode:        str

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def get(self, key: str, default: Any = None) -> Any:
        return self.to_dict().get(key, default)

    def items(self):
        return self.to_dict().items()

    def keys(self):
        return self.to_dict().keys()

    def __getitem__(self, key: str) -> Any:
        return self.to_dict()[key]


def _risk_score(target: str, repo: Path | None = None) -> tuple[str, list[str]]:
    """
    Determine the risk tier for `target` text.

    Returns a consistent (tier_name: str, reasons: list[str]) tuple.

    [FIX-01] RiskLevel comparisons now use semantic ordering via
    @functools.total_ordering in state.py — HIGH >= MEDIUM is now True (correct).
    [FIX-02] Return type is always (tier_name, reasons) — never (risk.value, reasons).
    """
    text    = (target or "").lower()
    reasons: list[str] = []

    # Numeric risk scorer from risk.py (returns RiskLevel)
    numeric_risk: RiskLevel = risk_from_text(text)

    # Phrase-tier matching (ordered: critical → high → medium; first match wins)
    for tier, phrases in _RISK_TIER_PHRASES.items():
        for phrase in phrases:
            if phrase in text:
                reasons.append(f"matched:{tier}:{phrase}")
                phrase_risk = _TIER_TO_RISK.get(tier, RiskLevel.LOW)

                # [FIX-01] Comparison now uses semantic ordering — works correctly
                if phrase_risk >= numeric_risk:
                    # [FIX-02] Always return tier name (not risk.value)
                    return tier, reasons
                else:
                    numeric_tier = _RISK_TO_TIER.get(numeric_risk, "low")
                    return numeric_tier, [f"numeric_risk:{numeric_risk.value}"]

    # No phrase match: fall back to numeric scorer
    if numeric_risk != RiskLevel.LOW:
        numeric_tier = _RISK_TO_TIER.get(numeric_risk, "low")
        return numeric_tier, [f"numeric_risk:{numeric_risk.value}"]

    return "low", []


class ExecutionPolicy(str, Enum):
    AUTONOMOUS = "autonomous"
    SUPERVISED = "supervised"
    GATED      = "gated"
    BLOCKED    = "blocked"


TIER_MAP: dict[str, ExecutionPolicy] = {
    "low":      ExecutionPolicy.AUTONOMOUS,
    "medium":   ExecutionPolicy.SUPERVISED,
    "high":     ExecutionPolicy.GATED,
    "critical": ExecutionPolicy.BLOCKED,
}


def policy_mode(tier: str, cfg: SwarmConfig) -> str:
    """[ENH-03] Pure function: compute execution policy mode for a tier."""
    policy = TIER_MAP.get(tier, ExecutionPolicy.BLOCKED)
    if getattr(cfg, "review_required", False):
        return ExecutionPolicy.GATED.value
    return policy.value


def assess_action(
    action: str,
    target: str,
    repo: Path | None = None,
    cfg: SwarmConfig | None = None,
    review_required: bool = False,
) -> PolicyDecision:
    """
    Assess risk and return a PolicyDecision for executing an action against a target.

    [V5.9-FIX-02] Restore the compatibility signature used across the current
    CLI/server/runtime call sites: assess_action(action, target, repo, cfg,
    review_required=False). Earlier drift reduced the function to
    assess_action(target, cfg, repo=None), which broke all public callers.
    """
    cfg = cfg or SwarmConfig()
    text = " ".join(part for part in [action, target] if part).strip()
    tier, reasons = _risk_score(text, repo)
    risk_level    = _TIER_TO_RISK.get(tier, RiskLevel.LOW)
    policy        = TIER_MAP.get(tier, ExecutionPolicy.BLOCKED)
    if review_required and policy != ExecutionPolicy.BLOCKED:
        policy = ExecutionPolicy.GATED
    mode = ExecutionPolicy.GATED.value if review_required and policy != ExecutionPolicy.BLOCKED else policy_mode(tier, cfg)

    allowed    = policy in (ExecutionPolicy.AUTONOMOUS, ExecutionPolicy.SUPERVISED)
    human_gate = review_required or policy in (ExecutionPolicy.GATED, ExecutionPolicy.BLOCKED)

    # Enumerate mitigations
    mitigations: list[str] = []
    if risk_level >= RiskLevel.HIGH:
        mitigations.append("require_human_approval")
    if risk_level >= RiskLevel.MEDIUM:
        mitigations.append("audit_log_mandatory")
    if tier == "critical":
        mitigations.append("block_auto_deploy")

    # Confidence: higher when phrase-match fires; lower for numeric-only
    confidence = 0.90 if any("matched:" in r for r in reasons) else 0.70

    return PolicyDecision(
        allowed=allowed,
        risk=risk_level.value,
        tier=tier,
        human_gate=human_gate,
        reasons=reasons,
        mitigations=mitigations,
        confidence=confidence,
        mode=mode,
    )


def assess_mission(
    target: str,
    repo: Path | None = None,
    cfg: SwarmConfig | None = None,
    review_required: bool = False,
) -> dict[str, Any]:
    """Assess a mission target and return a serializable policy summary.

    [V5.9-FIX-03] Restore the public assess_mission() API exported by
    swarmx.__init__ and used by CLI/server/console routes. The summary folds the
    mission plan surface into the policy decision so callers can render a single
    response without duplicating plan construction logic.
    """
    cfg = cfg or SwarmConfig()
    repo_path = Path(repo or ".").expanduser().resolve()
    plan = build_plan(target=target, repo=repo_path, review_required=review_required, cfg=cfg)
    decision = assess_action("mission", target, repo_path, cfg, review_required=review_required)
    return {
        **decision.to_dict(),
        "target": target,
        "workflow": plan.workflow,
        "stack": plan.stack,
        "approval_required": plan.approval_required,
        "task_count": len(plan.tasks),
        "goal": plan.goal,
    }
