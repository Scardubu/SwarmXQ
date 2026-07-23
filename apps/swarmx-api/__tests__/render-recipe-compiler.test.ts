import { describe, expect, it } from "vitest";
import {
  RenderRecipeCompilationError,
  compileSceneSpec,
} from "../src/services/render-recipe-compiler.js";
import type { SceneSpec } from "@swarmx/types/video-types";

const VALID_SHA256 = "a".repeat(64);

function makeScene(overrides: Partial<SceneSpec> = {}): SceneSpec {
  return {
    durationSec: 5,
    background: { type: "solid", value: "#000000" },
    assets: [],
    text: [{ text: "Hello world", style: "title", position: "top", colorToken: "primary" }],
    caption: null,
    motion: "static",
    transition: null,
    colorTreatment: null,
    audioEvents: [],
    safeZone: "tiktok_standard",
    ...overrides,
  };
}

describe("compileSceneSpec", () => {
  it("compiles a valid 3-scene spec without error", () => {
    const scenes = [
      makeScene({ durationSec: 3 }),
      makeScene({ durationSec: 5, motion: "ken_burns_slow" }),
      makeScene({ durationSec: 7, transition: "fade_black", colorTreatment: "warm" }),
    ];
    expect(() => compileSceneSpec(scenes, "ffmpeg_text_smoke")).not.toThrow();
  });

  it("schemaVersion is 1", () => {
    const result = compileSceneSpec([makeScene()], "ffmpeg_text_smoke");
    expect(result.schemaVersion).toBe(1);
  });

  it("totalDurationSec equals sum of scene durations", () => {
    const scenes = [
      makeScene({ durationSec: 4 }),
      makeScene({ durationSec: 6 }),
      makeScene({ durationSec: 10 }),
    ];
    const result = compileSceneSpec(scenes, "ffmpeg_kinetic_text");
    expect(result.totalDurationSec).toBe(20);
  });

  it("safeFilterTokens contains only enum-derived values, not free-text from SceneSpec", () => {
    const scene = makeScene({
      motion: "ken_burns_slow",
      transition: "dissolve",
      colorTreatment: "cool",
      text: [{ text: "inject[bad]filter;here", style: "body", position: "middle", colorToken: "accent" }],
    });
    const result = compileSceneSpec([scene], "ffmpeg_kinetic_text");
    for (const token of result.safeFilterTokens) {
      expect(token).not.toContain("inject");
      expect(token).not.toContain("bad");
      expect(token).not.toContain("here");
    }
  });

  it("rejects an asset with a non-SHA-256 hash", () => {
    const scene = makeScene({
      assets: [{ assetHash: "not-a-valid-sha256-hash", fit: "cover", opacity: 1 }],
    });
    expect(() => compileSceneSpec([scene], "ffmpeg_text_smoke")).toThrow(
      RenderRecipeCompilationError,
    );
    try {
      compileSceneSpec([scene], "ffmpeg_text_smoke");
    } catch (err) {
      expect((err as RenderRecipeCompilationError).code).toBe("RENDER_INVALID_ASSET_HASH");
    }
  });

  it("rejects background.value when type is asset_ref and value is not a valid SHA-256", () => {
    const scene = makeScene({
      background: { type: "asset_ref", value: "not-sha256" },
    });
    expect(() => compileSceneSpec([scene], "ffmpeg_text_smoke")).toThrow(
      RenderRecipeCompilationError,
    );
  });

  it("rejects text containing only FFmpeg filter metacharacters", () => {
    const scene = makeScene({
      text: [{ text: "[;,]{}()%", style: "title", position: "top", colorToken: "primary" }],
    });
    expect(() => compileSceneSpec([scene], "ffmpeg_text_smoke")).toThrow(
      RenderRecipeCompilationError,
    );
    try {
      compileSceneSpec([scene], "ffmpeg_text_smoke");
    } catch (err) {
      expect((err as RenderRecipeCompilationError).code).toBe("RENDER_TEXT_SANITIZATION_EMPTY");
    }
  });

  it("rejects srtPath containing shell-unsafe characters", () => {
    const scene = makeScene({
      caption: { srtPath: "/tmp/subs;evil|pipe$(cmd)", style: "default" },
    });
    expect(() => compileSceneSpec([scene], "ffmpeg_text_smoke")).toThrow(
      RenderRecipeCompilationError,
    );
    try {
      compileSceneSpec([scene], "ffmpeg_text_smoke");
    } catch (err) {
      expect((err as RenderRecipeCompilationError).code).toBe("RENDER_UNSAFE_SRT_PATH");
    }
  });

  it("throws RENDER_EMPTY_SCENE_LIST for an empty scenes array", () => {
    try {
      compileSceneSpec([], "ffmpeg_text_smoke");
      expect.fail("expected throw");
    } catch (err) {
      expect((err as RenderRecipeCompilationError).code).toBe("RENDER_EMPTY_SCENE_LIST");
    }
  });

  it("accepts a valid SHA-256 assetHash without throwing", () => {
    const scene = makeScene({
      assets: [{ assetHash: VALID_SHA256, fit: "contain", opacity: 0.8 }],
    });
    expect(() => compileSceneSpec([scene], "ffmpeg_text_smoke")).not.toThrow();
  });

  it("accepts a safe srtPath without throwing", () => {
    const scene = makeScene({
      caption: { srtPath: "/tmp/captions/video-001.srt", style: "kinetic" },
    });
    expect(() => compileSceneSpec([scene], "ffmpeg_text_smoke")).not.toThrow();
  });
});
