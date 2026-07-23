import { describe, expect, test } from "vitest";
import type { RendererCapabilityTier } from "@swarmx/types/video-types";
import {
  canPromoteTo,
  clampCertificationTier,
  getRendererCertificationCeiling,
  transitionToBlocked,
  transitionToNeedsRevision,
  transitionToPublishFailed,
  transitionToPublishing,
} from "../src/services/renderer-certification.js";

describe("getRendererCertificationCeiling", () => {
  test("smoke renderer ceiling is TECHNICALLY_VALID", () => {
    expect(getRendererCertificationCeiling("ffmpeg_text_smoke")).toBe("TECHNICALLY_VALID");
  });

  test.each<RendererCapabilityTier>([
    "ffmpeg_kinetic_text",
    "ffmpeg_faceless_broll",
    "ffmpeg_cinematic_explainer",
  ])("production renderer %s ceiling is PUBLISHED_VERIFIED", (tier) => {
    expect(getRendererCertificationCeiling(tier)).toBe("PUBLISHED_VERIFIED");
  });

  test("optional_adapter ceiling is PRODUCTION_PACK_VALID", () => {
    expect(getRendererCertificationCeiling("optional_adapter")).toBe("PRODUCTION_PACK_VALID");
  });
});

describe("clampCertificationTier", () => {
  test("READY_TO_POST clamps to TECHNICALLY_VALID for smoke renderer", () => {
    expect(clampCertificationTier("READY_TO_POST", "ffmpeg_text_smoke")).toBe("TECHNICALLY_VALID");
  });

  test("PRODUCTION_PACK_VALID clamps to TECHNICALLY_VALID for smoke renderer", () => {
    expect(clampCertificationTier("PRODUCTION_PACK_VALID", "ffmpeg_text_smoke")).toBe("TECHNICALLY_VALID");
  });

  test("CREATIVE_REVIEW_REQUIRED clamps to TECHNICALLY_VALID for smoke renderer", () => {
    expect(clampCertificationTier("CREATIVE_REVIEW_REQUIRED", "ffmpeg_text_smoke")).toBe("TECHNICALLY_VALID");
  });

  test("TECHNICALLY_VALID stays TECHNICALLY_VALID for smoke renderer", () => {
    expect(clampCertificationTier("TECHNICALLY_VALID", "ffmpeg_text_smoke")).toBe("TECHNICALLY_VALID");
  });

  test("READY_TO_POST passes through for production kinetic_text renderer", () => {
    expect(clampCertificationTier("READY_TO_POST", "ffmpeg_kinetic_text")).toBe("READY_TO_POST");
  });

  test("PUBLISHED_VERIFIED passes through for cinematic renderer", () => {
    expect(clampCertificationTier("PUBLISHED_VERIFIED", "ffmpeg_cinematic_explainer")).toBe("PUBLISHED_VERIFIED");
  });

  test("READY_TO_POST clamps to PRODUCTION_PACK_VALID for optional_adapter", () => {
    expect(clampCertificationTier("READY_TO_POST", "optional_adapter")).toBe("PRODUCTION_PACK_VALID");
  });

  test("terminal side-branch tiers pass through unchanged even for smoke", () => {
    expect(clampCertificationTier("RENDER_FAILED", "ffmpeg_text_smoke")).toBe("RENDER_FAILED");
    expect(clampCertificationTier("BLOCKED", "ffmpeg_text_smoke")).toBe("BLOCKED");
    expect(clampCertificationTier("PUBLISH_FAILED", "ffmpeg_text_smoke")).toBe("PUBLISH_FAILED");
    expect(clampCertificationTier("NEEDS_REVISION", "ffmpeg_text_smoke")).toBe("NEEDS_REVISION");
  });
});

describe("canPromoteTo", () => {
  test("smoke renderer refuses promotion beyond TECHNICALLY_VALID", () => {
    expect(canPromoteTo("TECHNICALLY_VALID", "CREATIVE_REVIEW_REQUIRED", "ffmpeg_text_smoke")).toBe(false);
    expect(canPromoteTo("TECHNICALLY_VALID", "PRODUCTION_PACK_VALID", "ffmpeg_text_smoke")).toBe(false);
    expect(canPromoteTo("TECHNICALLY_VALID", "READY_TO_POST", "ffmpeg_text_smoke")).toBe(false);
  });

  test("kinetic_text renderer allows normal promotion path", () => {
    expect(canPromoteTo("TECHNICALLY_VALID", "CREATIVE_REVIEW_REQUIRED", "ffmpeg_kinetic_text")).toBe(true);
    expect(canPromoteTo("PRODUCTION_PACK_VALID", "READY_TO_POST", "ffmpeg_kinetic_text")).toBe(true);
    expect(canPromoteTo("READY_TO_POST", "PUBLISHING", "ffmpeg_kinetic_text")).toBe(true);
    expect(canPromoteTo("PUBLISHING", "PUBLISHED_VERIFIED", "ffmpeg_kinetic_text")).toBe(true);
  });

  test("cinematic_explainer renderer allows full publish path", () => {
    expect(canPromoteTo("READY_TO_POST", "PUBLISHING", "ffmpeg_cinematic_explainer")).toBe(true);
    expect(canPromoteTo("PUBLISHING", "PUBLISHED_VERIFIED", "ffmpeg_cinematic_explainer")).toBe(true);
  });

  test("optional_adapter refuses promotion past PRODUCTION_PACK_VALID", () => {
    expect(canPromoteTo("PRODUCTION_PACK_VALID", "READY_TO_POST", "optional_adapter")).toBe(false);
    expect(canPromoteTo("READY_TO_POST", "PUBLISHING", "optional_adapter")).toBe(false);
  });

  test("non-promotions (same tier or downward) return false", () => {
    expect(canPromoteTo("READY_TO_POST", "READY_TO_POST", "ffmpeg_kinetic_text")).toBe(false);
    expect(canPromoteTo("READY_TO_POST", "TECHNICALLY_VALID", "ffmpeg_kinetic_text")).toBe(false);
  });

  test("terminal tiers cannot be promoted from or to via success chain", () => {
    expect(canPromoteTo("RENDER_FAILED", "TECHNICALLY_VALID", "ffmpeg_kinetic_text")).toBe(false);
    expect(canPromoteTo("READY_TO_POST", "BLOCKED", "ffmpeg_kinetic_text")).toBe(false);
  });
});

describe("INV-18 transitions", () => {
  describe("transitionToPublishing", () => {
    test("accepts from READY_TO_POST", () => {
      expect(transitionToPublishing("READY_TO_POST")).toEqual({ ok: true });
    });

    test("rejects from lower tier", () => {
      const result = transitionToPublishing("PRODUCTION_PACK_VALID");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/READY_TO_POST/);
    });

    test("rejects from PUBLISHING (no self-promotion)", () => {
      expect(transitionToPublishing("PUBLISHING").ok).toBe(false);
    });
  });

  describe("transitionToPublishFailed", () => {
    test("accepts from PUBLISHING", () => {
      expect(transitionToPublishFailed("PUBLISHING")).toEqual({ ok: true });
    });

    test("rejects from READY_TO_POST", () => {
      const result = transitionToPublishFailed("READY_TO_POST");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/PUBLISHING/);
    });
  });

  describe("transitionToBlocked", () => {
    test("accepts from active pipeline tier with reason", () => {
      expect(transitionToBlocked("PRODUCTION_PACK_VALID", "rights unresolved")).toEqual({ ok: true });
      expect(transitionToBlocked("READY_TO_POST", "compliance hold")).toEqual({ ok: true });
    });

    test("rejects when reason is empty", () => {
      const result = transitionToBlocked("READY_TO_POST", "   ");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/reason is required/);
    });

    test("rejects from terminal PUBLISHED_VERIFIED", () => {
      expect(transitionToBlocked("PUBLISHED_VERIFIED", "late audit").ok).toBe(false);
    });

    test("rejects from RENDER_FAILED", () => {
      expect(transitionToBlocked("RENDER_FAILED", "unable to reprocess").ok).toBe(false);
    });
  });

  describe("transitionToNeedsRevision", () => {
    test("accepts from CREATIVE_REVIEW_REQUIRED with failedDomain", () => {
      expect(transitionToNeedsRevision("CREATIVE_REVIEW_REQUIRED", "CREATIVE_QUALITY")).toEqual({ ok: true });
    });

    test("accepts from READY_TO_POST when a QC domain fails late", () => {
      expect(transitionToNeedsRevision("READY_TO_POST", "AUDIO_COHERENCE")).toEqual({ ok: true });
    });

    test("rejects from TECHNICALLY_VALID (below review threshold)", () => {
      const result = transitionToNeedsRevision("TECHNICALLY_VALID", "CREATIVE_QUALITY");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toMatch(/CREATIVE_REVIEW_REQUIRED/);
    });

    test("rejects when failedDomain is empty", () => {
      expect(transitionToNeedsRevision("READY_TO_POST", "").ok).toBe(false);
    });
  });

  test("clampCertificationTier preserves lateral tier pass-through contract", () => {
    // These four lateral tiers must remain untouched by clamp — they are not
    // part of the success chain and clamping them is meaningless.
    expect(clampCertificationTier("BLOCKED", "ffmpeg_kinetic_text")).toBe("BLOCKED");
    expect(clampCertificationTier("PUBLISH_FAILED", "ffmpeg_text_smoke")).toBe("PUBLISH_FAILED");
    expect(clampCertificationTier("NEEDS_REVISION", "ffmpeg_faceless_broll")).toBe("NEEDS_REVISION");
    expect(clampCertificationTier("RENDER_FAILED", "ffmpeg_cinematic_explainer")).toBe("RENDER_FAILED");
  });
});
