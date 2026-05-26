"""
src/swarmx/operator_map.py
─────────────────────────────────────────────────────────────────────────────
SwarmXQ Dual-Layer Naming System — Python Source of Truth
Version : v2026.5.25-apex17-r7-final

Mirrors packages/swarmx-types/src/operator-map.ts. The two files are kept
byte-exact equivalent in semantics — any change here requires the same change
in the TypeScript file, and the test suite verifies the mirror.

Layer 1 — Canonical runtime tags (machine truth)
    Grammar: <role>-<family>-<tier>-<quant>-<env>
    Example: route-phi4-lite-q4km-prod

Layer 2 — Operator names (human-facing brand identity)
    Relay, Pilot, Architect, Forge, Oracle, Auditor, Lab

Usage:
    from swarmx.operator_map import (
        MODEL_OPERATOR_MAP,
        MODEL_ALIASES,
        resolve_canonical_tag,
        resolve_operator_name,
        resolve_model_role,
        format_operator_label,
        OPERATOR_NAMES,
    )
─────────────────────────────────────────────────────────────────────────────
"""

from __future__ import annotations

from typing import Literal, TypedDict


# ─── Operator name literals ──────────────────────────────────────────────────

OPERATOR_NAMES: tuple[str, ...] = (
    "Relay",      # routing / gatekeeping
    "Pilot",      # fast generalist / intake
    "Architect",  # planning / orchestration
    "Forge",      # implementation / execution
    "Oracle",     # deep reasoning / diagnosis
    "Auditor",    # critique / validation / safety
    "Lab",        # experimental / evolve / non-prod
)

OperatorName = Literal["Relay", "Pilot", "Architect", "Forge", "Oracle", "Auditor", "Lab"]

# ─── Canonical role vocabulary ───────────────────────────────────────────────

CANONICAL_ROLES: tuple[str, ...] = (
    "route", "instruct", "plan", "code", "reason", "critique", "synth",
)

CanonicalRole = Literal["route", "instruct", "plan", "code", "reason", "critique", "synth"]

ModelFamily = Literal["phi4", "qwen25", "deepseekr1"]
ModelQuant = Literal["q4km", "q8", "q5km"]
ModelTier = Literal["lite", "pro", "exp"]
ModelEnv = Literal["prod", "dev"]


class OperatorEntry(TypedDict):
    operator:        OperatorName
    role:            CanonicalRole
    family:          ModelFamily
    tier:            ModelTier
    quant:           ModelQuant
    env:             ModelEnv
    is7B:            bool
    estimatedRamMb:  int
    defaultCtx:      int
    temperature:     float
    topP:            float
    description:     str


# ─── MODEL_OPERATOR_MAP — authoritative registry ─────────────────────────────

MODEL_OPERATOR_MAP: dict[str, OperatorEntry] = {
    # ── Relay ─────────────────────────────────────────────────────────────────
    "route-phi4-lite-q4km-prod": {
        "operator":       "Relay",
        "role":           "route",
        "family":         "phi4",
        "tier":           "lite",
        "quant":          "q4km",
        "env":            "prod",
        "is7B":           False,
        "estimatedRamMb": 2500,
        "defaultCtx":     2048,
        "temperature":    0.0,
        "topP":           0.90,
        "description":    "Ultra-light router. Intent classification and safety gating only.",
    },
    # ── Pilot ─────────────────────────────────────────────────────────────────
    "instruct-phi4-pro-q8-prod": {
        "operator":       "Pilot",
        "role":           "instruct",
        "family":         "phi4",
        "tier":           "pro",
        "quant":          "q8",
        "env":            "prod",
        "is7B":           False,
        "estimatedRamMb": 4270,
        "defaultCtx":     2048,
        "temperature":    0.2,
        "topP":           0.90,
        "description":    "Fast generalist. Session routing, short Q&A, intake.",
    },
    # ── Architect ─────────────────────────────────────────────────────────────
    "plan-phi4-pro-q8-prod": {
        "operator":       "Architect",
        "role":           "plan",
        "family":         "phi4",
        "tier":           "pro",
        "quant":          "q8",
        "env":            "prod",
        "is7B":           False,
        "estimatedRamMb": 4340,
        "defaultCtx":     4096,
        "temperature":    0.2,
        "topP":           0.90,
        "description":    "Lightweight planner. Tool sequencing, structured task decomposition.",
    },
    "plan-qwen25-pro-q5km-prod": {
        "operator":       "Architect",
        "role":           "plan",
        "family":         "qwen25",
        "tier":           "pro",
        "quant":          "q5km",
        "env":            "prod",
        "is7B":           True,
        "estimatedRamMb": 5370,
        "defaultCtx":     6144,
        "temperature":    0.15,
        "topP":           0.95,
        "description":    "Code-aware planner. Multi-step implementation plans with tool calls.",
    },
    "plan-deepseekr1-pro-q5km-prod": {
        "operator":       "Architect",
        "role":           "plan",
        "family":         "deepseekr1",
        "tier":           "pro",
        "quant":          "q5km",
        "env":            "prod",
        "is7B":           True,
        "estimatedRamMb": 5370,
        "defaultCtx":     6144,
        "temperature":    0.4,
        "topP":           0.92,
        "description":    "Reasoning-grade planner. Long-horizon strategy and architecture.",
    },
    # ── Forge ─────────────────────────────────────────────────────────────────
    "code-qwen25-pro-q5km-prod": {
        "operator":       "Forge",
        "role":           "code",
        "family":         "qwen25",
        "tier":           "pro",
        "quant":          "q5km",
        "env":            "prod",
        "is7B":           True,
        "estimatedRamMb": 5370,
        "defaultCtx":     6144,
        "temperature":    0.15,
        "topP":           0.95,
        "description":    "Production code engine. Implementation, refactoring, tool execution.",
    },
    # ── Oracle ────────────────────────────────────────────────────────────────
    "reason-deepseekr1-pro-q5km-prod": {
        "operator":       "Oracle",
        "role":           "reason",
        "family":         "deepseekr1",
        "tier":           "pro",
        "quant":          "q5km",
        "env":            "prod",
        "is7B":           True,
        "estimatedRamMb": 5370,
        "defaultCtx":     6144,
        "temperature":    0.4,
        "topP":           0.92,
        "description":    "Deep reasoning engine. Architecture review, causal analysis, diagnosis.",
    },
    # ── Auditor ───────────────────────────────────────────────────────────────
    "critique-deepseekr1-pro-q5km-prod": {
        "operator":       "Auditor",
        "role":           "critique",
        "family":         "deepseekr1",
        "tier":           "pro",
        "quant":          "q5km",
        "env":            "prod",
        "is7B":           True,
        "estimatedRamMb": 5420,
        "defaultCtx":     8192,
        "temperature":    0.35,
        "topP":           0.92,
        "description":    "Adversarial reviewer. Safety gate, defect finding, counter-analysis.",
    },
    # ── Lab (experimental / evolve) ───────────────────────────────────────────
    "synth-phi4-exp-q8-dev": {
        "operator":       "Lab",
        "role":           "synth",
        "family":         "phi4",
        "tier":           "exp",
        "quant":          "q8",
        "env":            "dev",
        "is7B":           False,
        "estimatedRamMb": 4440,
        "defaultCtx":     6144,
        "temperature":    0.25,
        "topP":           0.92,
        "description":    "Lightweight observer. Evolution Phase 1 — fitness snapshot.",
    },
    "synth-qwen25-exp-q5km-dev": {
        "operator":       "Lab",
        "role":           "synth",
        "family":         "qwen25",
        "tier":           "exp",
        "quant":          "q5km",
        "env":            "dev",
        "is7B":           True,
        "estimatedRamMb": 5370,
        "defaultCtx":     6144,
        "temperature":    0.2,
        "topP":           0.95,
        "description":    "Mutation engine. Evolution Phase 3 — prompt/system improvements.",
    },
    "synth-deepseekr1-exp-q5km-dev": {
        "operator":       "Lab",
        "role":           "synth",
        "family":         "deepseekr1",
        "tier":           "exp",
        "quant":          "q5km",
        "env":            "dev",
        "is7B":           True,
        "estimatedRamMb": 5370,
        "defaultCtx":     6144,
        "temperature":    0.4,
        "topP":           0.92,
        "description":    "Critique-validate. Evolution Phase 2 + Phase 4 — adversarial review.",
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
    "phi4-mini-instruct":       "instruct-phi4-pro-q8-prod",
    "phi4-worker":              "plan-phi4-pro-q8-prod",
    "deepseek-reasoner":        "reason-deepseekr1-pro-q5km-prod",
    "deepseek-r1":              "reason-deepseekr1-pro-q5km-prod",
    "deepseek-r1:7b":           "reason-deepseekr1-pro-q5km-prod",
    "deepseek-critic":          "critique-deepseekr1-pro-q5km-prod",
    "qwen-worker":              "code-qwen25-pro-q5km-prod",
    "qwen2.5-coder":            "code-qwen25-pro-q5km-prod",
    "qwen2.5-coder:7b":         "code-qwen25-pro-q5km-prod",
    "qwen-supervisor":          "plan-qwen25-pro-q5km-prod",
    # Evolve-era aliases
    "phi4-fast:swarmx-evolve":    "synth-phi4-exp-q8-dev",
    "phi4-mini:swarmx-evolve":    "synth-phi4-exp-q8-dev",
    "qwen2.5:swarmx-evolve":      "synth-qwen25-exp-q5km-dev",
    "deepseek-r1:swarmx-evolve":  "synth-deepseekr1-exp-q5km-dev",
}


# ─── Resolution helpers ──────────────────────────────────────────────────────

def resolve_canonical_tag(tag: str) -> str:
    """Resolve a potentially legacy tag to its canonical production name.

    O(1) hash lookup. Safe to call on every model dispatch.
    """
    if not tag:
        return tag
    return MODEL_ALIASES.get(tag, tag)


def resolve_operator_name(tag: str) -> str:
    """Resolve a canonical tag to its human-facing Operator name."""
    canonical = resolve_canonical_tag(tag)
    entry = MODEL_OPERATOR_MAP.get(canonical)
    return entry["operator"] if entry else canonical


def resolve_model_role(tag: str) -> str:
    """Resolve a canonical tag to its role string ('unknown' if not found)."""
    canonical = resolve_canonical_tag(tag)
    entry = MODEL_OPERATOR_MAP.get(canonical)
    return entry["role"] if entry else "unknown"


def get_operator_entry(tag: str) -> OperatorEntry | None:
    """Get the full OperatorEntry for a tag (or None if unknown)."""
    canonical = resolve_canonical_tag(tag)
    return MODEL_OPERATOR_MAP.get(canonical)


def get_tags_for_operator(name: str) -> list[str]:
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


def is_legacy_alias(tag: str) -> bool:
    """Validate that a tag is a known legacy alias (not canonical)."""
    return tag in MODEL_ALIASES


def find_legacy_tags(tags: list[str]) -> list[str]:
    """Return any legacy tags found in the input list."""
    return [t for t in tags if t in MODEL_ALIASES]


def tags_by_operator() -> dict[str, list[str]]:
    """Return all canonical tags grouped by Operator name."""
    result: dict[str, list[str]] = {name: [] for name in OPERATOR_NAMES}
    for tag, entry in MODEL_OPERATOR_MAP.items():
        result[entry["operator"]].append(tag)
    return result


def get_7b_tags() -> list[str]:
    """Return all 7B-class canonical tags (for SINGLE-7B LOCK enforcement)."""
    return [t for t, e in MODEL_OPERATOR_MAP.items() if e["is7B"]]


__all__ = [
    "OPERATOR_NAMES",
    "CANONICAL_ROLES",
    "OperatorName",
    "CanonicalRole",
    "ModelFamily",
    "ModelQuant",
    "ModelTier",
    "ModelEnv",
    "OperatorEntry",
    "MODEL_OPERATOR_MAP",
    "MODEL_ALIASES",
    "resolve_canonical_tag",
    "resolve_operator_name",
    "resolve_model_role",
    "get_operator_entry",
    "get_tags_for_operator",
    "format_operator_label",
    "is_canonical_tag",
    "is_legacy_alias",
    "find_legacy_tags",
    "tags_by_operator",
    "get_7b_tags",
]
