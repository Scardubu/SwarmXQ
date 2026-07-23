import { describe, expect, it } from "vitest";
import {
  HOOK_FAMILIES,
  classifyHookFamily,
  generateHookCandidatesStub,
  validateHookCandidate,
} from "../src/lib/hook-laboratory.js";
import { HOOK_BLOCKLIST } from "../src/lib/creative-quality.js";

describe("HOOK_FAMILIES", () => {
  it("has exactly 10 members", () => {
    expect(HOOK_FAMILIES).toHaveLength(10);
  });

  it("contains no duplicates", () => {
    expect(new Set(HOOK_FAMILIES).size).toBe(HOOK_FAMILIES.length);
  });
});

describe("validateHookCandidate", () => {
  it("passes a clean hook under 18 words", () => {
    const result = validateHookCandidate("Stop doing this one thing that is quietly destroying your focus.");
    expect(result.passes).toBe(true);
    expect(result.failedRules).toHaveLength(0);
  });

  it("rejects text exceeding 18 words", () => {
    const text = "one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen";
    const result = validateHookCandidate(text);
    expect(result.passes).toBe(false);
    expect(result.failedRules).toContain("exceeds_18_words");
    expect(result.wordCount).toBeGreaterThan(18);
  });

  it("rejects empty string", () => {
    const result = validateHookCandidate("  ");
    expect(result.passes).toBe(false);
    expect(result.failedRules).toContain("empty_text");
  });

  it("rejects each HOOK_BLOCKLIST prefix", () => {
    for (const phrase of HOOK_BLOCKLIST) {
      const hook = `${phrase} this is the rest of the hook text`;
      const result = validateHookCandidate(hook);
      expect(result.passes, `Expected "${hook}" to fail HOOK_BLOCKLIST`).toBe(false);
      expect(result.violations).toContain(phrase);
    }
  });

  it('rejects "I " opener (SCAR-X §10.3 forbidden openers)', () => {
    const result = validateHookCandidate("I discovered something that changed everything.");
    expect(result.passes).toBe(false);
    expect(result.failedRules).toContain("forbidden_opener");
  });

  it('rejects "My " opener', () => {
    const result = validateHookCandidate("My biggest mistake cost me three years.");
    expect(result.passes).toBe(false);
    expect(result.failedRules).toContain("forbidden_opener");
  });

  it("rejects \"In today's video\" opener", () => {
    const result = validateHookCandidate("In today's video we cover the top habits.");
    expect(result.passes).toBe(false);
    expect(result.failedRules).toContain("forbidden_opener");
  });

  it("rejects \"Let's\" opener", () => {
    const result = validateHookCandidate("Let's talk about what nobody tells you.");
    expect(result.passes).toBe(false);
    expect(result.failedRules).toContain("forbidden_opener");
  });

  it("returns correct wordCount", () => {
    const result = validateHookCandidate("Stop scrolling here is the best habit.");
    expect(result.wordCount).toBe(7);
  });

  it("is case-insensitive for blocklist matching", () => {
    const result = validateHookCandidate("TODAY WE cover the basics.");
    expect(result.passes).toBe(false);
  });
});

describe("classifyHookFamily", () => {
  it("classifies a curiosity-gap hook", () => {
    expect(classifyHookFamily("What most people don't know about saving money")).toBe("curiosity-gap");
  });

  it("classifies a counterintuitive-claim hook", () => {
    expect(classifyHookFamily("You're completely wrong about how to build habits")).toBe("counterintuitive-claim");
  });

  it("classifies an immediate-transformation hook", () => {
    expect(classifyHookFamily("Do this in 5 seconds and change everything")).toBe("immediate-transformation");
  });

  it("returns 'unknown' for unclassifiable text", () => {
    expect(classifyHookFamily("")).toBe("unknown");
  });
});

describe("generateHookCandidatesStub", () => {
  it("returns the requested count", () => {
    const candidates = generateHookCandidatesStub(5, "open-loop");
    expect(candidates).toHaveLength(5);
  });

  it("clamps count to 12 max", () => {
    const candidates = generateHookCandidatesStub(20, "relatable-pain");
    expect(candidates).toHaveLength(12);
  });

  it("clamps count to 1 min", () => {
    const candidates = generateHookCandidatesStub(0, "curiosity-gap");
    expect(candidates).toHaveLength(1);
  });

  it("assigns the requested family", () => {
    const candidates = generateHookCandidatesStub(3, "myth-correction");
    for (const c of candidates) {
      expect(c.family).toBe("myth-correction");
    }
  });

  it("each candidate has a unique id", () => {
    const candidates = generateHookCandidatesStub(5, "pattern-interruption");
    const ids = candidates.map((c) => c.id);
    expect(new Set(ids).size).toBe(5);
  });
});
