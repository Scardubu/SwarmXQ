import { describe, expect, it } from "vitest";
import { generateRetentionMap } from "../src/services/retention-map.js";

const BEAT_LABELS = [
  "HOOK",
  "ORIENTATION",
  "ESCALATION",
  "INSIGHT",
  "PROOF",
  "PAYOFF",
  "CTA_OR_LOOP",
] as const;

const BEAT_TIMESTAMPS = [0, 3, 6, 12, 18, 24, 28];

function richScript(wordCount: number): string {
  return Array.from({ length: wordCount }, (_, i) => `word${i}`).join(" ");
}

describe("generateRetentionMap", () => {
  it("generates exactly 7 beats for a standard script", () => {
    const result = generateRetentionMap(richScript(150));
    expect(result.beats).toHaveLength(7);
  });

  it("schemaVersion is 1", () => {
    const result = generateRetentionMap("some text");
    expect(result.schemaVersion).toBe(1);
  });

  it("beat labels match the canonical 7-beat sequence in order", () => {
    const result = generateRetentionMap(richScript(150));
    expect(result.beats.map((b) => b.beatLabel)).toEqual(BEAT_LABELS);
  });

  it("beat timestamps match canonical timings", () => {
    const result = generateRetentionMap(richScript(150));
    expect(result.beats.map((b) => b.timestamp)).toEqual(BEAT_TIMESTAMPS);
  });

  it("thin content (< 10 words per beat section) upgrades MEDIUM beats to HIGH", () => {
    const result = generateRetentionMap("very short");
    const escalation = result.beats.find((b) => b.beatLabel === "ESCALATION")!;
    expect(escalation.dropOffRisk).toBe("HIGH");
  });

  it("overallRisk is HIGH when any beat is HIGH", () => {
    const result = generateRetentionMap("very short");
    expect(result.overallRisk).toBe("HIGH");
  });

  it("highRiskCount matches actual count of HIGH-risk beats", () => {
    const result = generateRetentionMap("very short");
    const actual = result.beats.filter((b) => b.dropOffRisk === "HIGH").length;
    expect(result.highRiskCount).toBe(actual);
  });

  it("unrecoveredHighRiskCount matches HIGH beats where plannedRecovery is null", () => {
    const result = generateRetentionMap("very short");
    const expected = result.beats.filter(
      (b) => b.dropOffRisk === "HIGH" && b.plannedRecovery === null,
    ).length;
    expect(result.unrecoveredHighRiskCount).toBe(expected);
  });

  it("a rich script keeps MEDIUM beats from upgrading to HIGH", () => {
    const result = generateRetentionMap(richScript(200));
    const highBeats = result.beats.filter((b) => b.dropOffRisk === "HIGH");
    expect(highBeats).toHaveLength(0);
  });

  it("overallRisk is at most MEDIUM for a rich script", () => {
    const result = generateRetentionMap(richScript(200));
    expect(result.overallRisk).not.toBe("HIGH");
  });

  it("generatedAt is a valid ISO 8601 timestamp", () => {
    const result = generateRetentionMap("test");
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(new Date(result.generatedAt).toISOString()).toBe(result.generatedAt);
  });
});
