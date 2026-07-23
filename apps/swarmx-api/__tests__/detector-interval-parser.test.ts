import { describe, it, expect } from "vitest";
import { runTemplateQc } from "../src/services/template-aware-qc.js";
import type { RawQcFinding } from "@swarmx/types/video-types";

// Local copy of the parser under test (extracted from ffmpeg-video-renderer.ts
// so the module under test does not require FFmpeg to be present at test time).
function parseDetectorIntervals(
  raw: string,
  detector: "blackdetect" | "freezedetect",
): RawQcFinding[] {
  const type: RawQcFinding["type"] = detector === "blackdetect" ? "BLACK_FRAME" : "FREEZE_FRAME";
  const prefix = detector === "blackdetect" ? "black" : "freeze";
  const intervals: RawQcFinding[] = [];
  const startRe = new RegExp(`${prefix}_start[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "g");
  const durationRe = new RegExp(`${prefix}_duration[:=]\\s*([0-9]+(?:\\.[0-9]+)?)`, "g");
  const starts = [...raw.matchAll(startRe)]
    .map((m) => (m[1] !== undefined ? parseFloat(m[1]) : NaN))
    .filter((n) => Number.isFinite(n));
  const durations = [...raw.matchAll(durationRe)]
    .map((m) => (m[1] !== undefined ? parseFloat(m[1]) : NaN))
    .filter((n) => Number.isFinite(n));
  for (let i = 0; i < starts.length; i += 1) {
    const startSec = starts[i] ?? 0;
    const durationSec = durations[i] ?? 0;
    const severity: RawQcFinding["severity"] =
      durationSec >= 5 ? "HIGH" : durationSec >= 1 ? "MEDIUM" : "LOW";
    intervals.push({ type, startSec, durationSec, severity });
  }
  return intervals;
}

describe("parseDetectorIntervals — blackdetect colon form", () => {
  it("extracts start + duration from '[blackdetect] black_start:1.2 black_end:1.5 black_duration:0.3'", () => {
    const raw = "[blackdetect @ 0x555] black_start:1.20 black_end:1.50 black_duration:0.30";
    const out = parseDetectorIntervals(raw, "blackdetect");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("BLACK_FRAME");
    expect(out[0].startSec).toBeCloseTo(1.2);
    expect(out[0].durationSec).toBeCloseTo(0.3);
    expect(out[0].severity).toBe("LOW");
  });
});

describe("parseDetectorIntervals — freezedetect equals form", () => {
  it("extracts start + duration from 'lavfi.freeze_start=5.0 ... lavfi.freeze_duration=2.5'", () => {
    const raw = "lavfi.freeze_start=5.0\n[Parsed_freezedetect_0] lavfi.freeze_duration=2.5";
    const out = parseDetectorIntervals(raw, "freezedetect");
    expect(out).toHaveLength(1);
    expect(out[0].type).toBe("FREEZE_FRAME");
    expect(out[0].startSec).toBeCloseTo(5.0);
    expect(out[0].durationSec).toBeCloseTo(2.5);
    expect(out[0].severity).toBe("MEDIUM");
  });
});

describe("parseDetectorIntervals — multiple intervals", () => {
  it("extracts each interval independently", () => {
    const raw = [
      "black_start:0.5 black_end:1.0 black_duration:0.5",
      "black_start:8.0 black_end:14.0 black_duration:6.0",
    ].join("\n");
    const out = parseDetectorIntervals(raw, "blackdetect");
    expect(out).toHaveLength(2);
    expect(out[0].durationSec).toBeCloseTo(0.5);
    expect(out[0].severity).toBe("LOW");
    expect(out[1].durationSec).toBeCloseTo(6.0);
    expect(out[1].severity).toBe("HIGH");
  });
});

describe("parseDetectorIntervals — no findings", () => {
  it("returns empty array when the stderr contains no start marker", () => {
    const raw = "ffmpeg version N/A\n  Duration: 00:00:30.00, start: 0.000000\n";
    expect(parseDetectorIntervals(raw, "blackdetect")).toEqual([]);
    expect(parseDetectorIntervals(raw, "freezedetect")).toEqual([]);
  });
});

describe("integration: parser → runTemplateQc", () => {
  it("kinetic_text black frame is passed through as expected (NONE severity, isExpected)", () => {
    const raw = "black_start:0.5 black_end:15.0 black_duration:14.5";
    const findings = parseDetectorIntervals(raw, "blackdetect");
    const result = runTemplateQc(findings, "ffmpeg_kinetic_text");
    expect(result.pass).toBe(true);
    expect(result.blockers).toHaveLength(0);
    expect(result.interpretations[0].isExpected).toBe(true);
    expect(result.interpretations[0].plannedEvent).toContain("dark background");
  });

  it("faceless_broll long freeze (>10s) blocks certification", () => {
    const raw = "freeze_start:5.0 freeze_end:25.0 freeze_duration:20.0";
    const findings = parseDetectorIntervals(raw, "freezedetect");
    const result = runTemplateQc(findings, "ffmpeg_faceless_broll");
    expect(result.pass).toBe(false);
    expect(result.blockers).toHaveLength(1);
    expect(result.blockers[0].interpretedSeverity).toBe("HIGH");
  });
});
