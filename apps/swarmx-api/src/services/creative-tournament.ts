/**
 * Concept tournament — deterministic diversity scoring and winner selection.
 *
 * No I/O, no LLM. Consumes ConceptCandidate / ConceptTournament types from
 * @swarmx/types/video-types. Called by the CONCEPT_TOURNAMENT workflow stage.
 */
import { randomUUID } from "node:crypto";
import type { ConceptCandidate, ConceptTournament } from "@swarmx/types/video-types";

export const SCORING_VERSION = "v1" as const;

/**
 * Structural fingerprint used for diversity comparison.
 * Encodes all 11 SCAR-X concept axes so diversity scoring catches more sameness patterns.
 * Optional axes fall back to "" — absent fields still contribute a delimiter, preventing
 * collisions between candidates that set different subsets of optional axes.
 */
export function fingerprintCandidate(c: ConceptCandidate): string {
  return [
    c.hookFamily,
    c.emotionalArc,
    c.CTAStyle,
    c.visualLanguage,
    c.premise,
    c.narrativeStructure ?? "",
    c.proofMechanism ?? "",
    c.soundStyle ?? "",
    c.pacing ?? "",
    c.productionComplexity ?? "",
    c.pointOfView ?? "",
  ]
    .map((s) => s.trim().toLowerCase())
    .join("|");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i]![j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1]![j - 1]!
          : 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
    }
  }
  return dp[m]![n]!;
}

export function pairwiseDiversityWarnings(candidates: ConceptCandidate[]): string[] {
  const warnings: string[] = [];
  for (let i = 0; i < candidates.length; i++) {
    for (let j = i + 1; j < candidates.length; j++) {
      const a = candidates[i]!;
      const b = candidates[j]!;
      const fpA = fingerprintCandidate(a);
      const fpB = fingerprintCandidate(b);
      if (levenshtein(fpA, fpB) < 3) {
        warnings.push(
          `candidates ${a.id} and ${b.id} are structurally similar (fingerprint distance < 3)`,
        );
      }
    }
  }
  return warnings;
}

/** Weighted composite score: feasibility×0.4 + originality×0.4 + confidence×0.2 */
export function scoreCandidate(c: ConceptCandidate): number {
  return c.feasibility * 0.4 + c.originality * 0.4 + c.confidence * 0.2;
}

export function runConceptTournament(
  candidates: ConceptCandidate[],
  creativeDnaId: string,
): ConceptTournament {
  if (candidates.length < 2) {
    throw Object.assign(
      new Error(`runConceptTournament requires at least 2 candidates, got ${candidates.length}`),
      { code: "TOURNAMENT_INSUFFICIENT_CANDIDATES" },
    );
  }

  const diversityWarnings = pairwiseDiversityWarnings(candidates);
  const ranked = [...candidates].sort((a, b) => scoreCandidate(b) - scoreCandidate(a));
  const winner = ranked[0]!;
  const winnerFp = fingerprintCandidate(winner);

  let backup = ranked.find(
    (c) => c.id !== winner.id && levenshtein(fingerprintCandidate(c), winnerFp) >= 3,
  );
  if (!backup) {
    backup = ranked.find((c) => c.id !== winner.id)!;
    diversityWarnings.push(
      `backup ${backup.id} is structurally similar to winner ${winner.id}; no diverse alternative found`,
    );
  }

  return {
    id: randomUUID(),
    schemaVersion: 1,
    creativeDnaId,
    candidates,
    winnerId: winner.id,
    backupId: backup.id,
    scoringVersion: SCORING_VERSION,
    rationale: `Winner scored ${scoreCandidate(winner).toFixed(3)} (feasibility=${winner.feasibility} originality=${winner.originality} confidence=${winner.confidence})`,
    diversityWarnings,
    createdAt: new Date().toISOString(),
  };
}
