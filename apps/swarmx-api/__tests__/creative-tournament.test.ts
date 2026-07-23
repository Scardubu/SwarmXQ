import { describe, expect, it } from "vitest";
import {
  SCORING_VERSION,
  fingerprintCandidate,
  pairwiseDiversityWarnings,
  runConceptTournament,
  scoreCandidate,
} from "../src/services/creative-tournament.js";
import type { ConceptCandidate } from "@swarmx/types/video-types";

function makeCandidate(id: string, overrides: Partial<ConceptCandidate> = {}): ConceptCandidate {
  return {
    id,
    title: `Concept ${id}`,
    premise: `Premise for ${id}`,
    hookFamily: "curiosity-gap",
    visualLanguage: "cinematic",
    emotionalArc: "tension-resolution",
    CTAStyle: "subscribe-now",
    feasibility: 0.7,
    originality: 0.7,
    confidence: 0.7,
    ...overrides,
  };
}

describe("scoreCandidate", () => {
  it("computes weighted composite: feasibility×0.4 + originality×0.4 + confidence×0.2", () => {
    const c = makeCandidate("a", { feasibility: 0.8, originality: 0.6, confidence: 0.5 });
    // 0.8×0.4 + 0.6×0.4 + 0.5×0.2 = 0.32 + 0.24 + 0.10 = 0.66
    expect(scoreCandidate(c)).toBeCloseTo(0.66);
  });
});

describe("fingerprintCandidate", () => {
  it("joins hookFamily, emotionalArc, CTAStyle pipe-separated and lowercased", () => {
    const c = makeCandidate("a", {
      hookFamily: "Curiosity-Gap",
      emotionalArc: "Tension-Resolution",
      CTAStyle: "Subscribe Now",
    });
    expect(fingerprintCandidate(c)).toBe("curiosity-gap|tension-resolution|subscribe now");
  });
});

describe("pairwiseDiversityWarnings", () => {
  it("returns empty array for sufficiently diverse candidates", () => {
    const a = makeCandidate("a", {
      hookFamily: "curiosity-gap",
      emotionalArc: "arc-alpha-long",
      CTAStyle: "cta-alpha-long",
    });
    const b = makeCandidate("b", {
      hookFamily: "counterintuitive-claim",
      emotionalArc: "arc-beta-completely-different",
      CTAStyle: "cta-beta-completely-different",
    });
    expect(pairwiseDiversityWarnings([a, b])).toHaveLength(0);
  });

  it("warns when two candidates share identical fingerprints", () => {
    const shared = { hookFamily: "x", emotionalArc: "y", CTAStyle: "z" };
    const a = makeCandidate("a", shared);
    const b = makeCandidate("b", shared);
    const warnings = pairwiseDiversityWarnings([a, b]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("a");
    expect(warnings[0]).toContain("b");
  });
});

describe("runConceptTournament", () => {
  it("throws when given fewer than 2 candidates", () => {
    expect(() => runConceptTournament([makeCandidate("a")], "dna-1")).toThrow(
      /at least 2 candidates/,
    );
  });

  it("throws with code TOURNAMENT_INSUFFICIENT_CANDIDATES on empty input", () => {
    try {
      runConceptTournament([], "dna-1");
      expect.fail("expected throw");
    } catch (err) {
      expect((err as { code?: string }).code).toBe("TOURNAMENT_INSUFFICIENT_CANDIDATES");
    }
  });

  it("scoringVersion is v1", () => {
    const t = runConceptTournament([makeCandidate("a"), makeCandidate("b")], "dna-1");
    expect(t.scoringVersion).toBe(SCORING_VERSION);
    expect(t.scoringVersion).toBe("v1");
  });

  it("result has schemaVersion 1", () => {
    const t = runConceptTournament([makeCandidate("a"), makeCandidate("b")], "dna-1");
    expect(t.schemaVersion).toBe(1);
  });

  it("winner has the highest composite score", () => {
    const low = makeCandidate("low", { feasibility: 0.2, originality: 0.2, confidence: 0.2 });
    const high = makeCandidate("high", { feasibility: 0.9, originality: 0.9, confidence: 0.9 });
    const mid = makeCandidate("mid", { feasibility: 0.5, originality: 0.5, confidence: 0.5 });
    const t = runConceptTournament([low, high, mid], "dna-1");
    expect(t.winnerId).toBe("high");
  });

  it("winnerId and backupId are valid candidate IDs", () => {
    const candidates = [makeCandidate("x"), makeCandidate("y"), makeCandidate("z")];
    const ids = candidates.map((c) => c.id);
    const t = runConceptTournament(candidates, "dna-1");
    expect(ids).toContain(t.winnerId);
    expect(ids).toContain(t.backupId);
  });

  it("winner and backup are always different candidates", () => {
    const t = runConceptTournament([makeCandidate("a"), makeCandidate("b")], "dna-1");
    expect(t.winnerId).not.toBe(t.backupId);
  });

  it("backup has fingerprint distance >= 3 from winner when a diverse alternative exists", () => {
    const a = makeCandidate("a", {
      feasibility: 0.9, originality: 0.9, confidence: 0.9,
      hookFamily: "curiosity-gap",
      emotionalArc: "tension-build-release",
      CTAStyle: "subscribe",
    });
    const b = makeCandidate("b", {
      feasibility: 0.1, originality: 0.1, confidence: 0.1,
      hookFamily: "immediate-transformation",
      emotionalArc: "rags-to-riches-journey-long",
      CTAStyle: "follow-for-more-content",
    });
    const t = runConceptTournament([a, b], "dna-1");
    expect(t.winnerId).toBe("a");
    expect(t.backupId).toBe("b");
    const fallbackWarning = t.diversityWarnings.find((w) => w.includes("no diverse alternative"));
    expect(fallbackWarning).toBeUndefined();
  });

  it("adds a diversity warning when no diverse backup exists", () => {
    const shared = { hookFamily: "x", emotionalArc: "y", CTAStyle: "z" };
    const a = makeCandidate("a", { feasibility: 0.9, originality: 0.9, confidence: 0.9, ...shared });
    const b = makeCandidate("b", { feasibility: 0.1, originality: 0.1, confidence: 0.1, ...shared });
    const t = runConceptTournament([a, b], "dna-1");
    expect(t.diversityWarnings.some((w) => w.includes("no diverse alternative"))).toBe(true);
  });

  it("diversityWarnings populated when candidates share fingerprints", () => {
    const shared = { hookFamily: "same", emotionalArc: "same", CTAStyle: "same" };
    const a = makeCandidate("a", shared);
    const b = makeCandidate("b", shared);
    const t = runConceptTournament([a, b], "dna-1");
    expect(t.diversityWarnings.length).toBeGreaterThan(0);
  });
});
