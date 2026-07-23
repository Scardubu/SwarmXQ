import { describe, it, expect } from "vitest";
import { interpretFinding, runTemplateQc } from "../src/services/template-aware-qc.js";
import type { RawQcFinding } from "@swarmx/types/video-types";

function makeBlackFrame(durationSec: number): RawQcFinding {
  return { type: "BLACK_FRAME", startSec: 5, durationSec, severity: "MEDIUM" };
}

function makeFreeze(durationSec: number): RawQcFinding {
  return { type: "FREEZE_FRAME", startSec: 5, durationSec, severity: "MEDIUM" };
}

describe("kinetic_text — BLACK_FRAME", () => {
  it("marks any black frame as isExpected (intentional dark background)", () => {
    const r = interpretFinding(makeBlackFrame(15), "ffmpeg_kinetic_text");
    expect(r.isExpected).toBe(true);
    expect(r.interpretedSeverity).toBe("NONE");
    expect(r.plannedEvent).toContain("dark background");
  });
});

describe("kinetic_text — FREEZE_FRAME", () => {
  it("marks short freeze (≤3s) as expected text hold", () => {
    const r = interpretFinding(makeFreeze(2), "ffmpeg_kinetic_text");
    expect(r.isExpected).toBe(true);
    expect(r.interpretedSeverity).toBe("NONE");
  });

  it("marks long freeze (>3s) as unexpected MEDIUM", () => {
    const r = interpretFinding(makeFreeze(5), "ffmpeg_kinetic_text");
    expect(r.isExpected).toBe(false);
    expect(r.interpretedSeverity).toBe("MEDIUM");
    expect(r.plannedEvent).toBeNull();
  });
});

describe("faceless_broll — FREEZE_FRAME", () => {
  it("marks freeze ≤10s as expected static b-roll", () => {
    const r = interpretFinding(makeFreeze(8), "ffmpeg_faceless_broll");
    expect(r.isExpected).toBe(true);
    expect(r.interpretedSeverity).toBe("NONE");
    expect(r.plannedEvent).toContain("b-roll");
  });

  it("marks freeze >10s as unexpected HIGH (corrupt/missing asset)", () => {
    const r = interpretFinding(makeFreeze(12), "ffmpeg_faceless_broll");
    expect(r.isExpected).toBe(false);
    expect(r.interpretedSeverity).toBe("HIGH");
    expect(r.plannedEvent).toBeNull();
  });
});

describe("unconditional blockers", () => {
  const unconditionals: RawQcFinding["type"][] = ["MISSING_AUDIO", "FIRST_FRAME_EMPTY"];

  for (const type of unconditionals) {
    for (const tier of [
      "ffmpeg_text_smoke",
      "ffmpeg_kinetic_text",
      "ffmpeg_faceless_broll",
      "ffmpeg_cinematic_explainer",
    ] as const) {
      it(`${type} is HIGH and not expected in ${tier}`, () => {
        const finding: RawQcFinding = { type, startSec: 0, durationSec: 1, severity: "HIGH" };
        const r = interpretFinding(finding, tier);
        expect(r.isExpected).toBe(false);
        expect(r.interpretedSeverity).toBe("HIGH");
        expect(r.plannedEvent).toBeNull();
      });
    }
  }
});

describe("runTemplateQc", () => {
  it("pass=true when all findings are expected", () => {
    const result = runTemplateQc(
      [makeBlackFrame(1), makeFreeze(2)],
      "ffmpeg_kinetic_text",
    );
    expect(result.pass).toBe(true);
    expect(result.blockers).toHaveLength(0);
  });

  it("pass=false when an unconditional blocker is present", () => {
    const result = runTemplateQc(
      [{ type: "MISSING_AUDIO", startSec: 0, durationSec: 30, severity: "HIGH" }],
      "ffmpeg_kinetic_text",
    );
    expect(result.pass).toBe(false);
    expect(result.blockers).toHaveLength(1);
  });

  it("blockers contains only non-expected HIGH-severity interpretations", () => {
    const findings: RawQcFinding[] = [
      makeBlackFrame(1),           // expected (kinetic_text) → not a blocker
      makeFreeze(20),              // unexpected MEDIUM (kinetic_text >3s) → warning, not blocker
      { type: "MISSING_AUDIO", startSec: 0, durationSec: 30, severity: "HIGH" }, // blocker
    ];
    const result = runTemplateQc(findings, "ffmpeg_kinetic_text");
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].raw.type).toBe("MISSING_AUDIO");
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0].raw.type).toBe("FREEZE_FRAME");
  });
});
