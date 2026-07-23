/**
 * Hook laboratory — deterministic hook validation and family classification.
 *
 * No I/O, no LLM. Imports HOOK_BLOCKLIST from creative-quality.ts (single source of truth).
 * LLM-backed candidate generation is a stub here; wiring to Ollama happens in the script stage.
 */
import { randomUUID } from "node:crypto";
import { findHookBlocklistViolations } from "./creative-quality.js";

export const HOOK_FAMILIES = [
  "curiosity-gap",
  "counterintuitive-claim",
  "immediate-transformation",
  "high-stakes-question",
  "pattern-interruption",
  "concrete-result",
  "myth-correction",
  "open-loop",
  "relatable-pain",
  "visual-surprise",
] as const;

export type HookFamily = (typeof HOOK_FAMILIES)[number];

export interface HookValidationResult {
  passes: boolean;
  wordCount: number;
  violations: string[];
  failedRules: string[];
}

export interface HookCandidate {
  id: string;
  text: string;
  family: HookFamily | "unknown";
  wordCount: number;
  validationResult: HookValidationResult;
}

const FORBIDDEN_OPENER_RE =
  /^(in today'?s|welcome|hi everyone|today we|i |my |this video|let'?s|we'?re going)/i;

const FAMILY_SIGNALS: Array<{ family: HookFamily; patterns: RegExp[] }> = [
  { family: "curiosity-gap",            patterns: [/\bwhat (most|nobody|no one)\b/i, /\bsecret\b/i, /\bwhy .+ (don't|won't|can't)\b/i] },
  { family: "counterintuitive-claim",   patterns: [/\bactually\b/i, /\bcontrary\b/i, /\bwrong about\b/i, /\bopposite\b/i] },
  { family: "immediate-transformation", patterns: [/\bin \d+ (second|minute|day|week|step)/i, /\binstantly\b/i, /\bright now\b/i] },
  { family: "high-stakes-question",     patterns: [/\?$/, /\bwhat (would|happens|if)\b/i, /\bcan you\b/i] },
  { family: "pattern-interruption",     patterns: [/^stop\b/i, /\bforget everything\b/i, /\bwait\b/i] },
  { family: "concrete-result",          patterns: [/\b\d+(%|x|times|dollars|k|m)\b/i, /\bexact(ly)?\b/i, /\bproven\b/i] },
  { family: "myth-correction",          patterns: [/\bmyth\b/i, /\blie\b/i, /\bfalse\b/i, /\bthink .+ wrong\b/i] },
  { family: "open-loop",                patterns: [/\bbefore (i|you|we)\b/i, /\bhere'?s what\b/i, /\bstay with\b/i] },
  { family: "relatable-pain",           patterns: [/\bstrug(gle|gling)\b/i, /\btired of\b/i, /\beveryone .+(feel|know|hate)\b/i] },
  { family: "visual-surprise",          patterns: [/\blook at\b/i, /\bwatch (this|what)\b/i, /\bno one (has|will)\b/i] },
];

export function validateHookCandidate(text: string): HookValidationResult {
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  const wordCount = words.length;
  const failedRules: string[] = [];
  const violations = findHookBlocklistViolations(trimmed);

  if (wordCount === 0) failedRules.push("empty_text");
  if (wordCount > 18) failedRules.push("exceeds_18_words");
  if (violations.length > 0) failedRules.push("hook_blocklist_match");
  if (FORBIDDEN_OPENER_RE.test(trimmed)) failedRules.push("forbidden_opener");

  return {
    passes: failedRules.length === 0,
    wordCount,
    violations,
    failedRules,
  };
}

export function classifyHookFamily(text: string): HookFamily | "unknown" {
  for (const { family, patterns } of FAMILY_SIGNALS) {
    if (patterns.some((re) => re.test(text))) return family;
  }
  return "unknown";
}

/**
 * Stub — returns well-typed placeholder records for the given count and family.
 * Real generation is performed by the Architect operator in the script stage.
 */
export function generateHookCandidatesStub(count: number, family: HookFamily): HookCandidate[] {
  const clamped = Math.min(Math.max(count, 1), 12);
  return Array.from({ length: clamped }, (_, i) => {
    const text = `[${family} hook placeholder ${i + 1} — replace with Architect output]`;
    return {
      id: randomUUID(),
      text,
      family,
      wordCount: text.split(/\s+/).length,
      validationResult: validateHookCandidate(text),
    };
  });
}
