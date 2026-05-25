/**
 * packages/swarmx-types/src/operator-map.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmXQ Dual-Layer Naming System — Single Source of Truth
 * Version : v2026.5.25-apex17-r7
 *
 * This module defines the authoritative mapping between:
 *   Layer 1 — Canonical runtime tags (machine truth)
 *   Layer 2 — Human-facing Operator names (memorable brand identity)
 *
 * Import this module in every file that needs to resolve, display, or validate
 * model identity. Do NOT hard-code model names elsewhere.
 *
 * Usage:
 *   import {
 *     MODEL_OPERATOR_MAP,
 *     MODEL_ALIASES,
 *     resolveCanonicalTag,
 *     resolveOperatorName,
 *     resolveModelRole,
 *     OPERATOR_NAMES,
 *   } from "@swarmx/types/operator-map";
 *
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

// ─── Role vocabulary ─────────────────────────────────────────────────────────

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

// ─── Model family vocabulary ─────────────────────────────────────────────────

export type ModelFamily = "phi4" | "qwen25" | "deepseekr1";

// ─── Operator entry ──────────────────────────────────────────────────────────

export interface OperatorEntry {
  operator: OperatorName;
  role:     CanonicalRole;
  family:   ModelFamily;
  tier:     "lite" | "pro" | "exp";
  env:      "prod" | "dev";
  is7B:     boolean;
}

// ─── MODEL_OPERATOR_MAP — the authoritative registry ─────────────────────────
//
// Every canonical runtime tag maps to its Operator identity.
// If a tag is not in this map, it is unknown to the naming system.

export const MODEL_OPERATOR_MAP: Record<string, OperatorEntry> = {
  // ── Relay ──────────────────────────────────────────────────────────────────
  "route-phi4-lite-q4km-prod": {
    operator: "Relay",
    role:     "route",
    family:   "phi4",
    tier:     "lite",
    env:      "prod",
    is7B:     false,
  },

  // ── Pilot ──────────────────────────────────────────────────────────────────
  "instruct-phi4-pro-q8-prod": {
    operator: "Pilot",
    role:     "instruct",
    family:   "phi4",
    tier:     "pro",
    env:      "prod",
    is7B:     false,
  },

  // ── Architect ──────────────────────────────────────────────────────────────
  "plan-phi4-pro-q8-prod": {
    operator: "Architect",
    role:     "plan",
    family:   "phi4",
    tier:     "pro",
    env:      "prod",
    is7B:     false,
  },
  "plan-qwen25-pro-q5km-prod": {
    operator: "Architect",
    role:     "plan",
    family:   "qwen25",
    tier:     "pro",
    env:      "prod",
    is7B:     true,
  },
  "plan-deepseekr1-pro-q5km-prod": {
    operator: "Architect",
    role:     "plan",
    family:   "deepseekr1",
    tier:     "pro",
    env:      "prod",
    is7B:     true,
  },

  // ── Forge ──────────────────────────────────────────────────────────────────
  "code-qwen25-pro-q5km-prod": {
    operator: "Forge",
    role:     "code",
    family:   "qwen25",
    tier:     "pro",
    env:      "prod",
    is7B:     true,
  },

  // ── Oracle ─────────────────────────────────────────────────────────────────
  "reason-deepseekr1-pro-q5km-prod": {
    operator: "Oracle",
    role:     "reason",
    family:   "deepseekr1",
    tier:     "pro",
    env:      "prod",
    is7B:     true,
  },

  // ── Auditor ────────────────────────────────────────────────────────────────
  "critique-deepseekr1-pro-q5km-prod": {
    operator: "Auditor",
    role:     "critique",
    family:   "deepseekr1",
    tier:     "pro",
    env:      "prod",
    is7B:     true,
  },

  // ── Lab (experimental / evolve) ────────────────────────────────────────────
  "synth-phi4-exp-q8-dev": {
    operator: "Lab",
    role:     "synth",
    family:   "phi4",
    tier:     "exp",
    env:      "dev",
    is7B:     false,
  },
  "synth-qwen25-exp-q5km-dev": {
    operator: "Lab",
    role:     "synth",
    family:   "qwen25",
    tier:     "exp",
    env:      "dev",
    is7B:     true,
  },
  "synth-deepseekr1-exp-q5km-dev": {
    operator: "Lab",
    role:     "synth",
    family:   "deepseekr1",
    tier:     "exp",
    env:      "dev",
    is7B:     true,
  },
} as const;

// ─── Backward-compatible alias resolver ──────────────────────────────────────
//
// Maps ALL known legacy names → canonical production tags.
// Used during the migration window; removable after one production cycle.

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
  "deepseek-reasoner":        "reason-deepseekr1-pro-q5km-prod",
  "deepseek-r1":              "reason-deepseekr1-pro-q5km-prod",
  "deepseek-r1:7b":           "reason-deepseekr1-pro-q5km-prod",
  "qwen-worker":              "code-qwen25-pro-q5km-prod",
  "qwen2.5-coder":            "code-qwen25-pro-q5km-prod",
  "qwen2.5-coder:7b":         "code-qwen25-pro-q5km-prod",

  // Evolve-era aliases
  "phi4-fast:swarmx-evolve":    "synth-phi4-exp-q8-dev",
  "phi4-mini:swarmx-evolve":    "synth-phi4-exp-q8-dev",
  "qwen2.5:swarmx-evolve":      "synth-qwen25-exp-q5km-dev",
  "deepseek-r1:swarmx-evolve":  "synth-deepseekr1-exp-q5km-dev",
};

// ─── Resolution helpers ──────────────────────────────────────────────────────

/**
 * Resolve a potentially legacy model tag to its canonical production name.
 * Returns the input unchanged if it is already canonical or unknown.
 */
export function resolveCanonicalTag(tag: string): string {
  return MODEL_ALIASES[tag] ?? tag;
}

/**
 * Resolve a canonical tag to its human-facing Operator name.
 * Returns the tag itself if not found in the map (unknown model).
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
 * Get all canonical tags that belong to a given Operator name.
 */
export function getTagsForOperator(name: OperatorName): string[] {
  return Object.entries(MODEL_OPERATOR_MAP)
    .filter(([, entry]) => entry.operator === name)
    .map(([tag]) => tag);
}

/**
 * Format a display string: "Operator (canonical-tag)"
 * Used in logs, dashboards, and documentation.
 */
export function formatOperatorLabel(tag: string): string {
  const canonical = resolveCanonicalTag(tag);
  const entry = MODEL_OPERATOR_MAP[canonical];
  if (!entry) return canonical;
  return `${entry.operator} (${canonical})`;
}

/**
 * Validate that a given tag is a known canonical tag (not a legacy alias).
 * Returns true only for tags that appear as keys in MODEL_OPERATOR_MAP.
 */
export function isCanonicalTag(tag: string): boolean {
  return tag in MODEL_OPERATOR_MAP;
}

/**
 * Validate that no legacy -scar or pre-scar tags appear in an array.
 * Returns an array of legacy tags found (empty if clean).
 */
export function findLegacyTags(tags: string[]): string[] {
  return tags.filter((t) => t in MODEL_ALIASES);
}
