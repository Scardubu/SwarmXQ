/**
 * packages/swarmx-types/src/operator-map.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmXQ Dual-Layer Naming System — TypeScript Source of Truth
 * Version : v2026.5.25-apex17-r7-final
 *
 * Layer 1 — Canonical runtime tags (machine truth)
 *   Grammar: <role>-<family>-<tier>-<quant>-<env>
 *   Examples: route-phi4-lite-q4km-prod, code-qwen25-pro-q5km-prod
 *
 * Layer 2 — Operator names (human-facing brand identity)
 *   Relay, Pilot, Architect, Forge, Oracle, Auditor, Lab
 *
 * Both layers are synchronized through MODEL_OPERATOR_MAP, which is the
 * authoritative source. Every TypeScript file in the SwarmXQ codebase that
 * needs model identity MUST import from this module.
 *
 * Mirror file: src/swarmx/operator_map.py (Python). The two are kept byte-
 * exact equivalent in semantics — any change here requires the same change
 * in the Python file, and the test suite verifies the mirror.
 *
 * Usage:
 *   import {
 *     MODEL_OPERATOR_MAP,
 *     MODEL_ALIASES,
 *     resolveCanonicalTag,
 *     resolveOperatorName,
 *     resolveModelRole,
 *     formatOperatorLabel,
 *     OPERATOR_NAMES,
 *   } from "@swarmx/types/operator-map";
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Operator name literals ──────────────────────────────────────────────────

export const OPERATOR_NAMES = [
  "Relay",     // routing / gatekeeping
  "Pilot",     // fast generalist / intake
  "Architect", // planning / orchestration
  "Forge",     // implementation / execution
  "Oracle",    // deep reasoning / diagnosis
  "Auditor",   // critique / validation / safety
  "Lab",       // experimental / evolve / non-prod
] as const;

export type OperatorName = (typeof OPERATOR_NAMES)[number];

// ─── Canonical role vocabulary ───────────────────────────────────────────────

export const CANONICAL_ROLES = [
  "route",    // ultra-light classification and gating
  "instruct", // fast generalist assistant
  "plan",     // structure, sequencing, strategy
  "code",     // implementation and execution
  "reason",   // deep analysis and logic
  "critique", // adversarial review and validation
  "synth",    // experimental mutation / evolution
] as const;

export type CanonicalRole = (typeof CANONICAL_ROLES)[number];

// ─── Model family / quant / tier / env vocabularies ──────────────────────────

export type ModelFamily = "phi4" | "qwen25" | "deepseekr1";
export type ModelQuant  = "q4km" | "q8" | "q5km";
export type ModelTier   = "lite" | "pro" | "exp";
export type ModelEnv    = "prod" | "dev";

// ─── Operator entry shape ────────────────────────────────────────────────────

export interface OperatorEntry {
  /** Human-facing brand identity. */
  operator:        OperatorName;
  /** Canonical role keyword (matches the tag prefix). */
  role:            CanonicalRole;
  /** Base model family. */
  family:          ModelFamily;
  /** Capability tier — lite (smallest), pro (production), exp (experimental). */
  tier:            ModelTier;
  /** GGUF quantization. */
  quant:           ModelQuant;
  /** Deployment environment. */
  env:             ModelEnv;
  /** Whether this is a 7B-class model requiring SINGLE-7B LOCK. */
  is7B:            boolean;
  /** Estimated steady-state RAM footprint in MB. */
  estimatedRamMb:  number;
  /** Default context window. */
  defaultCtx:      number;
  /** Default temperature. */
  temperature:     number;
  /** Default top-p. */
  topP:            number;
  /** One-line operational description. */
  description:     string;
}

// ─── MODEL_OPERATOR_MAP — the authoritative registry ─────────────────────────

export const MODEL_OPERATOR_MAP: Record<string, OperatorEntry> = {
  // ── Relay ──────────────────────────────────────────────────────────────────
  "route-phi4-lite-q4km-prod": {
    operator:       "Relay",
    role:           "route",
    family:         "phi4",
    tier:           "lite",
    quant:          "q4km",
    env:            "prod",
    is7B:           false,
    estimatedRamMb: 2500,
    defaultCtx:     2048,
    temperature:    0.0,
    topP:           0.90,
    description:    "Ultra-light router. Intent classification and safety gating only.",
  },

  // ── Pilot ──────────────────────────────────────────────────────────────────
  "instruct-phi4-pro-q8-prod": {
    operator:       "Pilot",
    role:           "instruct",
    family:         "phi4",
    tier:           "pro",
    quant:          "q8",
    env:            "prod",
    is7B:           false,
    estimatedRamMb: 4270,
    defaultCtx:     2048,
    temperature:    0.2,
    topP:           0.90,
    description:    "Fast generalist. Session routing, short Q&A, intake.",
  },

  // ── Architect ──────────────────────────────────────────────────────────────
  "plan-phi4-pro-q8-prod": {
    operator:       "Architect",
    role:           "plan",
    family:         "phi4",
    tier:           "pro",
    quant:          "q8",
    env:            "prod",
    is7B:           false,
    estimatedRamMb: 4340,
    defaultCtx:     4096,
    temperature:    0.2,
    topP:           0.90,
    description:    "Lightweight planner. Tool sequencing, structured task decomposition.",
  },
  "plan-qwen25-pro-q5km-prod": {
    operator:       "Architect",
    role:           "plan",
    family:         "qwen25",
    tier:           "pro",
    quant:          "q5km",
    env:            "prod",
    is7B:           true,
    estimatedRamMb: 5370,
    defaultCtx:     6144,
    temperature:    0.15,
    topP:           0.95,
    description:    "Code-aware planner. Multi-step implementation plans with tool calls.",
  },
  "plan-deepseekr1-pro-q5km-prod": {
    operator:       "Architect",
    role:           "plan",
    family:         "deepseekr1",
    tier:           "pro",
    quant:          "q5km",
    env:            "prod",
    is7B:           true,
    estimatedRamMb: 5370,
    defaultCtx:     6144,
    temperature:    0.4,
    topP:           0.92,
    description:    "Reasoning-grade planner. Long-horizon strategy and architecture.",
  },

  // ── Forge ──────────────────────────────────────────────────────────────────
  "code-qwen25-pro-q5km-prod": {
    operator:       "Forge",
    role:           "code",
    family:         "qwen25",
    tier:           "pro",
    quant:          "q5km",
    env:            "prod",
    is7B:           true,
    estimatedRamMb: 5370,
    defaultCtx:     6144,
    temperature:    0.15,
    topP:           0.95,
    description:    "Production code engine. Implementation, refactoring, tool execution.",
  },

  // ── Oracle ─────────────────────────────────────────────────────────────────
  "reason-deepseekr1-pro-q5km-prod": {
    operator:       "Oracle",
    role:           "reason",
    family:         "deepseekr1",
    tier:           "pro",
    quant:          "q5km",
    env:            "prod",
    is7B:           true,
    estimatedRamMb: 5370,
    defaultCtx:     6144,
    temperature:    0.4,
    topP:           0.92,
    description:    "Deep reasoning engine. Architecture review, causal analysis, diagnosis.",
  },

  // ── Auditor ────────────────────────────────────────────────────────────────
  "critique-deepseekr1-pro-q5km-prod": {
    operator:       "Auditor",
    role:           "critique",
    family:         "deepseekr1",
    tier:           "pro",
    quant:          "q5km",
    env:            "prod",
    is7B:           true,
    estimatedRamMb: 5420,
    defaultCtx:     8192,
    temperature:    0.35,
    topP:           0.92,
    description:    "Adversarial reviewer. Safety gate, defect finding, counter-analysis.",
  },

  // ── Lab (experimental / evolve) ────────────────────────────────────────────
  "synth-phi4-exp-q8-dev": {
    operator:       "Lab",
    role:           "synth",
    family:         "phi4",
    tier:           "exp",
    quant:          "q8",
    env:            "dev",
    is7B:           false,
    estimatedRamMb: 4440,
    defaultCtx:     6144,
    temperature:    0.25,
    topP:           0.92,
    description:    "Lightweight observer. Evolution Phase 1 — fitness snapshot.",
  },
  "synth-qwen25-exp-q5km-dev": {
    operator:       "Lab",
    role:           "synth",
    family:         "qwen25",
    tier:           "exp",
    quant:          "q5km",
    env:            "dev",
    is7B:           true,
    estimatedRamMb: 5370,
    defaultCtx:     6144,
    temperature:    0.2,
    topP:           0.95,
    description:    "Mutation engine. Evolution Phase 3 — prompt/system improvements.",
  },
  "synth-deepseekr1-exp-q5km-dev": {
    operator:       "Lab",
    role:           "synth",
    family:         "deepseekr1",
    tier:           "exp",
    quant:          "q5km",
    env:            "dev",
    is7B:           true,
    estimatedRamMb: 5370,
    defaultCtx:     6144,
    temperature:    0.4,
    topP:           0.92,
    description:    "Critique-validate. Evolution Phase 2 + Phase 4 — adversarial review.",
  },
} as const;

// ─── Backward-compatible alias resolver ──────────────────────────────────────
//
// Maps ALL known legacy names → canonical production tags.
// Used during the migration window; removable after one full production cycle
// once `rg -rn "scar|phi4-mini|deepseek-r1:7b|qwen2.5-coder" .` returns zero
// hits outside this file.

export const MODEL_ALIASES: Record<string, string> = {
  // -scar era (APEX-17 r1–r6)
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

  // Pre-scar era (V5 and earlier)
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

  // Evolve-era aliases
  "phi4-fast:swarmx-evolve":    "synth-phi4-exp-q8-dev",
  "phi4-mini:swarmx-evolve":    "synth-phi4-exp-q8-dev",
  "qwen2.5:swarmx-evolve":      "synth-qwen25-exp-q5km-dev",
  "deepseek-r1:swarmx-evolve":  "synth-deepseekr1-exp-q5km-dev",
};

// ─── Resolution helpers ──────────────────────────────────────────────────────

/**
 * Resolve a potentially legacy tag to its canonical production name.
 * Returns the input unchanged if it is already canonical or unknown.
 *
 * Performance: O(1) hash lookup. Safe to call on every model dispatch.
 */
export function resolveCanonicalTag(tag: string): string {
  return MODEL_ALIASES[tag] ?? tag;
}

/**
 * Resolve a canonical tag to its human-facing Operator name.
 * Returns the canonical tag itself if not found (unknown model).
 */
export function resolveOperatorName(tag: string): string {
  const canonical = resolveCanonicalTag(tag);
  return MODEL_OPERATOR_MAP[canonical]?.operator ?? canonical;
}

/**
 * Resolve a canonical tag to its role string.
 * Returns "unknown" for unrecognized tags.
 */
export function resolveModelRole(tag: string): CanonicalRole | "unknown" {
  const canonical = resolveCanonicalTag(tag);
  return MODEL_OPERATOR_MAP[canonical]?.role ?? "unknown";
}

/**
 * Get the full OperatorEntry for a tag (or null if unknown).
 */
export function getOperatorEntry(tag: string): OperatorEntry | null {
  const canonical = resolveCanonicalTag(tag);
  return MODEL_OPERATOR_MAP[canonical] ?? null;
}

/**
 * Get all canonical tags that belong to a given Operator name.
 */
export function getTagsForOperator(name: OperatorName): string[] {
  return Object.entries(MODEL_OPERATOR_MAP)
    .filter(([, entry]) => entry.operator === name)
    .map(([tag]) => tag);
}

/**
 * Format a display string: "Operator (canonical-tag)".
 * Used in logs, dashboards, and documentation where both layers are visible.
 */
export function formatOperatorLabel(tag: string): string {
  const canonical = resolveCanonicalTag(tag);
  const entry = MODEL_OPERATOR_MAP[canonical];
  if (!entry) return canonical;
  return `${entry.operator} (${canonical})`;
}

/**
 * Validate that a given tag is a known canonical tag.
 */
export function isCanonicalTag(tag: string): boolean {
  return tag in MODEL_OPERATOR_MAP;
}

/**
 * Validate that a tag is a known legacy alias (not canonical).
 */
export function isLegacyAlias(tag: string): boolean {
  return tag in MODEL_ALIASES;
}

/**
 * Return any legacy tags found in the input list.
 */
export function findLegacyTags(tags: string[]): string[] {
  return tags.filter((t) => t in MODEL_ALIASES);
}

/**
 * Return all canonical tags grouped by Operator name.
 * Useful for dashboard "by operator" group views.
 */
export function tagsByOperator(): Record<OperatorName, string[]> {
  const result = {} as Record<OperatorName, string[]>;
  for (const name of OPERATOR_NAMES) result[name] = [];
  for (const [tag, entry] of Object.entries(MODEL_OPERATOR_MAP)) {
    result[entry.operator].push(tag);
  }
  return result;
}

/**
 * Return all 7B-class canonical tags. Used by SINGLE-7B LOCK enforcement.
 */
export function get7BTags(): string[] {
  return Object.entries(MODEL_OPERATOR_MAP)
    .filter(([, e]) => e.is7B)
    .map(([t]) => t);
}
