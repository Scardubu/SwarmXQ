import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { resetEnvForTesting } from "../src/lib/env.js";
import {
  isTextVideoStage,
  readBoundedEnvInt,
  stageTimeoutMs,
  resolveVideoModelTag,
  videoModelTagsForRequest,
  LOW_RAM_VIDEO_MODEL,
  VIDEO_TEXT_STAGES,
} from "../src/services/video-runtime-config.js";

beforeEach(() => {
  resetEnvForTesting();
  delete process.env["VIDEO_INTENT_CLASSIFY_TIMEOUT_MS"];
  delete process.env["SWARMX_VIDEO_LOW_RAM_MODE"];
  delete process.env["TEST_BOUNDED_INT"];
});

afterEach(() => {
  resetEnvForTesting();
  delete process.env["VIDEO_INTENT_CLASSIFY_TIMEOUT_MS"];
  delete process.env["SWARMX_VIDEO_LOW_RAM_MODE"];
  delete process.env["TEST_BOUNDED_INT"];
});

describe("isTextVideoStage", () => {
  test("returns true for intent_classification", () => {
    expect(isTextVideoStage("intent_classification")).toBe(true);
  });

  test("returns true for scripting", () => {
    expect(isTextVideoStage("scripting")).toBe(true);
  });

  test("returns false for render_assembly", () => {
    expect(isTextVideoStage("render_assembly")).toBe(false);
  });

  test("returns false for finalizing", () => {
    expect(isTextVideoStage("finalizing")).toBe(false);
  });
});

describe("readBoundedEnvInt", () => {
  test("returns fallback when env var is not set", () => {
    expect(readBoundedEnvInt("TEST_BOUNDED_INT", 50, 0, 100)).toBe(50);
  });

  test("clamps value above max to max", () => {
    process.env["TEST_BOUNDED_INT"] = "200";
    expect(readBoundedEnvInt("TEST_BOUNDED_INT", 50, 0, 100)).toBe(100);
  });

  test("clamps value below min to min", () => {
    process.env["TEST_BOUNDED_INT"] = "-10";
    expect(readBoundedEnvInt("TEST_BOUNDED_INT", 50, 0, 100)).toBe(0);
  });

  test("returns parsed value when within bounds", () => {
    process.env["TEST_BOUNDED_INT"] = "75";
    expect(readBoundedEnvInt("TEST_BOUNDED_INT", 50, 0, 100)).toBe(75);
  });
});

describe("stageTimeoutMs", () => {
  test("returns default 120000 for intent_classification with no env override", () => {
    expect(stageTimeoutMs("intent_classification")).toBe(120_000);
  });

  test("env override is clamped to stage max bound (600000 for intent_classification)", () => {
    process.env["VIDEO_INTENT_CLASSIFY_TIMEOUT_MS"] = "999999"; // above max 600_000
    expect(stageTimeoutMs("intent_classification")).toBe(600_000);
  });
});

describe("resolveVideoModelTag", () => {
  test("returns canonical qwen25 tag for planning stage by default", () => {
    const tag = resolveVideoModelTag({ prompt: "test" }, "planning");
    expect(tag).toBe("plan-qwen25-pro-q5km-prod");
  });

  test("returns LOW_RAM_VIDEO_MODEL when SWARMX_VIDEO_LOW_RAM_MODE=1", () => {
    process.env["SWARMX_VIDEO_LOW_RAM_MODE"] = "1";
    resetEnvForTesting();
    const tag = resolveVideoModelTag({ prompt: "test" }, "planning");
    expect(tag).toBe(LOW_RAM_VIDEO_MODEL);
  });
});

describe("videoModelTagsForRequest", () => {
  test("returns an array of 4 entries covering all text stages", () => {
    const tags = videoModelTagsForRequest({ prompt: "test" });
    expect(tags).toHaveLength(VIDEO_TEXT_STAGES.length);
    expect(tags.length).toBe(4);
  });

  test("all returned tags are non-empty strings", () => {
    const tags = videoModelTagsForRequest({ prompt: "test" });
    for (const tag of tags) {
      expect(typeof tag).toBe("string");
      expect(tag.length).toBeGreaterThan(0);
    }
  });
});
