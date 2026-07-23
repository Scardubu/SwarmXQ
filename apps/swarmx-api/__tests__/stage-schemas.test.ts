import { describe, expect, test } from "vitest";
import {
  PlanningResultSchema,
  ScriptingResultSchema,
  StoryboardResultSchema,
  validateStageResult,
} from "../src/services/stage-schemas.js";

describe("PlanningResultSchema", () => {
  test("accepts a normal plan", () => {
    const result = PlanningResultSchema.safeParse({
      plan: [
        "Generate a bold hook that names the problem",
        "Show two examples of the failure mode",
        "Reveal the counterintuitive fix",
        "End with a memorable one-line CTA",
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty plan array", () => {
    const result = PlanningResultSchema.safeParse({ plan: [] });
    expect(result.success).toBe(false);
  });

  test("rejects a plan with more than 12 lines", () => {
    const plan = Array.from({ length: 13 }, (_, i) => `Step ${i + 1} matters`);
    const result = PlanningResultSchema.safeParse({ plan });
    expect(result.success).toBe(false);
  });

  test("rejects a line longer than 240 chars", () => {
    const longLine = "x".repeat(300);
    const result = PlanningResultSchema.safeParse({ plan: [longLine] });
    expect(result.success).toBe(false);
  });

  test("rejects a line under 3 chars", () => {
    const result = PlanningResultSchema.safeParse({ plan: ["a"] });
    expect(result.success).toBe(false);
  });
});

describe("ScriptingResultSchema", () => {
  test("accepts a normal script", () => {
    const result = ScriptingResultSchema.safeParse({
      scriptText: "Stop scrolling. Here is the one habit that changes everything. Save this for later.",
    });
    expect(result.success).toBe(true);
  });

  test("rejects a 5-char script body", () => {
    const result = ScriptingResultSchema.safeParse({ scriptText: "Hello" });
    expect(result.success).toBe(false);
  });

  test("rejects a script over 4000 chars", () => {
    const result = ScriptingResultSchema.safeParse({ scriptText: "a".repeat(5000) });
    expect(result.success).toBe(false);
  });

  test("rejects missing scriptText", () => {
    const result = ScriptingResultSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("StoryboardResultSchema", () => {
  test("accepts a normal storyboard", () => {
    const result = StoryboardResultSchema.safeParse({
      frames: [
        "Overhead shot: hands typing on a laptop, dim room, blue accent light",
        "Cut to: whiteboard sketch of two competing options, marker in motion",
        "Close-up: satisfied smile after picking the counterintuitive path",
      ],
    });
    expect(result.success).toBe(true);
  });

  test("rejects empty frames array", () => {
    const result = StoryboardResultSchema.safeParse({ frames: [] });
    expect(result.success).toBe(false);
  });

  test("rejects storyboard with 21 frames", () => {
    const frames = Array.from({ length: 21 }, (_, i) => `Frame ${i + 1} shows something`);
    const result = StoryboardResultSchema.safeParse({ frames });
    expect(result.success).toBe(false);
  });

  test("rejects a frame under 3 chars", () => {
    const result = StoryboardResultSchema.safeParse({ frames: ["ok"] });
    expect(result.success).toBe(false);
  });
});

describe("validateStageResult", () => {
  test("returns passed:true entry and typed data for a valid planning result", () => {
    const outcome = validateStageResult("planning", {
      plan: ["Open with hook", "Reveal insight", "End with CTA"],
    });
    expect(outcome.entry.passed).toBe(true);
    expect(outcome.entry.stage).toBe("planning");
    expect(outcome.entry.schemaVersion).toBe(1);
    expect(outcome.data).not.toBeNull();
    expect(outcome.data?.plan).toHaveLength(3);
  });

  test("returns passed:false entry with issues and null data for invalid scripting", () => {
    const outcome = validateStageResult("scripting", { scriptText: "no" });
    expect(outcome.entry.passed).toBe(false);
    expect(outcome.entry.issues).toBeDefined();
    expect(outcome.entry.issues?.length).toBeGreaterThan(0);
    expect(outcome.data).toBeNull();
  });

  test("returns passed:false entry for invalid storyboard input", () => {
    const outcome = validateStageResult("storyboard_generation", { frames: [] });
    expect(outcome.entry.passed).toBe(false);
    expect(outcome.data).toBeNull();
  });

  test("records the stage name on the entry", () => {
    const outcome = validateStageResult("storyboard_generation", { frames: ["Opening cinematic frame"] });
    expect(outcome.entry.stage).toBe("storyboard_generation");
  });
});
