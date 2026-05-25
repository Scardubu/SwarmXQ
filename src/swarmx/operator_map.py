"""
src/swarmx/operator_map.py
─────────────────────────────────────────────────────────────────────────────
SwarmXQ Dual-Layer Naming System — Python Source of Truth
Version : v2026.5.25-apex17-r7

Mirrors packages/swarmx-types/src/operator-map.ts exactly.
Import this module in every Python file that needs model identity resolution.

Usage:
    from swarmx.operator_map import (
        MODEL_OPERATOR_MAP,
        MODEL_ALIASES,
        resolve_canonical_tag,
        resolve_operator_name,
        resolve_model_role,
    )
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from typing import TypedDict, Literal


# ─── Type definitions ─────────────────────────────────────────────────────────

OperatorName = Literal[
    "Relay", "Pilot", "Architect", "Forge", "Oracle", "Auditor", "Lab"
]

CanonicalRole = Literal[
    "route", "instruct", "plan", "code", "reason", "critique", "synth"
]

ModelFamily = Literal["phi4", "qwen25", "deepseekr1"]


class OperatorEntry(TypedDict):
    operator: OperatorName
    role: CanonicalRole
    family: ModelFamily
    tier: Literal["lite", "pro", "exp"]
    env: Literal["prod", "dev"]
    is7B: bool


# ─── MODEL_OPERATOR_MAP — authoritative registry ─────────────────────────────

MODEL_OPERATOR_MAP: dict[str, OperatorEntry] = {
    # ── Relay ─────────────────────────────────────────────────────────────────
    "route-phi4-lite-q4km-prod": {
        "operator": "Relay",
        "role":     "route",
        "family":   "phi4",
        "tier":     "lite",
        "env":      "prod",
        "is7B":     False,
    },
    # ── Pilot ─────────────────────────────────────────────────────────────────
    "instruct-phi4-pro-q8-prod": {
        "operator": "Pilot",
        "role":     "instruct",
        "family":   "phi4",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     False,
    },
    # ── Architect ─────────────────────────────────────────────────────────────
    "plan-phi4-pro-q8-prod": {
        "operator": "Architect",
        "role":     "plan",
        "family":   "phi4",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     False,
    },
    "plan-qwen25-pro-q5km-prod": {
        "operator": "Architect",
        "role":     "plan",
        "family":   "qwen25",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     True,
    },
    "plan-deepseekr1-pro-q5km-prod": {
        "operator": "Architect",
        "role":     "plan",
        "family":   "deepseekr1",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     True,
    },
    # ── Forge ─────────────────────────────────────────────────────────────────
    "code-qwen25-pro-q5km-prod": {
        "operator": "Forge",
        "role":     "code",
        "family":   "qwen25",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     True,
    },
    # ── Oracle ────────────────────────────────────────────────────────────────
    "reason-deepseekr1-pro-q5km-prod": {
        "operator": "Oracle",
        "role":     "reason",
        "family":   "deepseekr1",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     True,
    },
    # ── Auditor ───────────────────────────────────────────────────────────────
    "critique-deepseekr1-pro-q5km-prod": {
        "operator": "Auditor",
        "role":     "critique",
        "family":   "deepseekr1",
        "tier":     "pro",
        "env":      "prod",
        "is7B":     True,
    },
    # ── Lab (experimental / evolve) ───────────────────────────────────────────
    "synth-phi4-exp-q8-dev": {
        "operator": "Lab",
        "role":     "synth",
        "family":   "phi4",
        "tier":     "exp",
        "env":      "dev",
        "is7B":     False,
    },
    "synth-qwen25-exp-q5km-dev": {
        "operator": "Lab",
        "role":     "synth",
        "family":   "qwen25",
        "tier":     "exp",
        "env":      "dev",
        "is7B":     True,
    },
    "synth-deepseekr1-exp-q5km-dev": {
        "operator": "Lab",
        "role":     "synth",
        "family":   "deepseekr1",
        "tier":     "exp",
        "env":      "dev",
        "is7B":     True,
    },
}

# ─── Backward-compatible alias resolver ───────────────────────────────────────

MODEL_ALIASES: dict[str, str] = {
    # -scar era (APEX-17 r1–r6)
    "phi4-router-lite-scar":    "route-phi4-lite-q4km-prod",
    "phi4-fast-scar":           "instruct-phi4-pro-q8-prod",
    "phi4-worker-scar":         "plan-phi4-pro-q8-prod",
    "phi4-evolve-scar":         "synth-phi4-exp-q8-dev",
    "qwen-worker-scar":         "code-qwen25-pro-q5km-prod",
    "qwen-supervisor-scar":     "plan-qwen25-pro-q5km-prod",
    "qwen-evolve-scar":         "synth-qwen25-exp-q5km-dev",
    "deepseek-supervisor-scar": "plan-deepseekr1-pro-q5km-prod",
    "deepseek-reasoner-scar":   "reason-deepseekr1-pro-q5km-prod",
    "deepseek-critic-scar":     "critique-deepseekr1-pro-q5km-prod",
    "deepseek-evolve-scar":     "synth-deepseekr1-exp-q5km-dev",
    # Pre-scar era (V5 and earlier)
    "phi4-fast":                "instruct-phi4-pro-q8-prod",
    "phi4-mini":                "instruct-phi4-pro-q8-prod",
    "phi4:mini":                "instruct-phi4-pro-q8-prod",
    "deepseek-reasoner":        "reason-deepseekr1-pro-q5km-prod",
    "deepseek-r1":              "reason-deepseekr1-pro-q5km-prod",
    "deepseek-r1:7b":           "reason-deepseekr1-pro-q5km-prod",
    "qwen-worker":              "code-qwen25-pro-q5km-prod",
    "qwen2.5-coder":            "code-qwen25-pro-q5km-prod",
    "qwen2.5-coder:7b":         "code-qwen25-pro-q5km-prod",
    # Evolve-era aliases
    "phi4-fast:swarmx-evolve":    "synth-phi4-exp-q8-dev",
    "phi4-mini:swarmx-evolve":    "synth-phi4-exp-q8-dev",
    "qwen2.5:swarmx-evolve":      "synth-qwen25-exp-q5km-dev",
    "deepseek-r1:swarmx-evolve":  "synth-deepseekr1-exp-q5km-dev",
}


# ─── Resolution helpers ──────────────────────────────────────────────────────

def resolve_canonical_tag(tag: str) -> str:
    """Resolve a potentially legacy model tag to its canonical production name."""
    return MODEL_ALIASES.get(tag, tag)


def resolve_operator_name(tag: str) -> str:
    """Resolve a canonical tag to its human-facing Operator name."""
    canonical = resolve_canonical_tag(tag)
    entry = MODEL_OPERATOR_MAP.get(canonical)
    return entry["operator"] if entry else canonical


def resolve_model_role(tag: str) -> str:
    """Resolve a canonical tag to its role string."""
    canonical = resolve_canonical_tag(tag)
    entry = MODEL_OPERATOR_MAP.get(canonical)
    return entry["role"] if entry else "unknown"


def get_tags_for_operator(name: OperatorName) -> list[str]:
    """Get all canonical tags belonging to a given Operator name."""
    return [
        tag for tag, entry in MODEL_OPERATOR_MAP.items()
        if entry["operator"] == name
    ]


def format_operator_label(tag: str) -> str:
    """Format a display string: 'Operator (canonical-tag)'."""
    canonical = resolve_canonical_tag(tag)
    entry = MODEL_OPERATOR_MAP.get(canonical)
    if not entry:
        return canonical
    return f"{entry['operator']} ({canonical})"


def is_canonical_tag(tag: str) -> bool:
    """Validate that a given tag is a known canonical tag."""
    return tag in MODEL_OPERATOR_MAP


def find_legacy_tags(tags: list[str]) -> list[str]:
    """Return any legacy tags found in the input list."""
    return [t for t in tags if t in MODEL_ALIASES]
