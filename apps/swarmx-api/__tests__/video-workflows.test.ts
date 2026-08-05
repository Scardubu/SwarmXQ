import { describe, expect, test } from "vitest";
import { buildCreativeComfyPrompt } from "../src/services/video-workflows.js";

describe("buildCreativeComfyPrompt", () => {
  test("includes tone, niche, style, and first scene context", () => {
    const prompt = buildCreativeComfyPrompt({
      prompt: "Explain why deep work beats multitasking",
      tone: "contrarian",
      niche: "tech",
      style: "myth_busting",
      frame: "Motion: red reveal panel | Color: cold contrast",
    });

    expect(prompt).toContain("Explain why deep work beats multitasking");
    expect(prompt).toContain("tone:contrarian");
    expect(prompt).toContain("niche:tech");
    expect(prompt).toContain("style:myth_busting");
    expect(prompt).toContain("first_scene:Motion: red reveal panel");
  });
});
