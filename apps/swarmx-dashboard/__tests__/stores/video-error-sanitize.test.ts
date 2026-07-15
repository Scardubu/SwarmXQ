/**
 * Regression tests for sanitizeApiError — ensures known API error codes are
 * mapped to operator-safe messages and that raw stack traces / internal paths
 * are never surfaced to users.
 */

import { describe, expect, it } from "vitest";

// sanitizeApiError and ApiError are exported for testing only.
import { sanitizeApiError, ApiError } from "@/stores/video";

describe("sanitizeApiError", () => {
  it("maps insufficient_ram_for_video to a calm memory guidance message", () => {
    const err = new ApiError(503, "Insufficient RAM", "insufficient_ram_for_video");
    const msg = sanitizeApiError(err);
    expect(msg).toContain("RAM");
    expect(msg).not.toContain("503");
    expect(msg).not.toContain("Insufficient RAM");
  });

  it("maps queue_full to a queue guidance message", () => {
    const err = new ApiError(503, "Queue is full", "queue_full");
    const msg = sanitizeApiError(err);
    expect(msg).toContain("queue");
    expect(msg).not.toContain("full");
  });

  it("maps ffmpeg_unavailable to an install instruction", () => {
    const err = new ApiError(503, "ffmpeg not found", "ffmpeg_unavailable");
    const msg = sanitizeApiError(err);
    expect(msg.toLowerCase()).toContain("ffmpeg");
    expect(msg).toContain("apt install");
  });

  it("maps ffprobe_unavailable to an install instruction", () => {
    const err = new ApiError(503, "ffprobe not found", "ffprobe_unavailable");
    const msg = sanitizeApiError(err);
    expect(msg.toLowerCase()).toContain("ffprobe");
    expect(msg).toContain("apt install");
  });

  it("maps espeak_unavailable to an install instruction", () => {
    const err = new ApiError(503, "espeak not found", "espeak_unavailable");
    const msg = sanitizeApiError(err);
    expect(msg).toContain("espeak-ng");
  });

  it("maps unauthorized to a token guidance message", () => {
    const err = new ApiError(401, "Unauthorized", "unauthorized");
    const msg = sanitizeApiError(err);
    expect(msg.toLowerCase()).toContain("token");
  });

  it("maps generic 503 to a service-unavailable message", () => {
    const err = new ApiError(503, "Service unavailable", "some_unknown_code");
    const msg = sanitizeApiError(err);
    expect(msg).toContain("temporarily unavailable");
  });

  it("never surfaces internal path strings from the error message", () => {
    const err = new ApiError(500, "API /api/video/jobs → 500: /home/scar/Documents/SwarmXQ/src/foo.ts:42", null);
    const msg = sanitizeApiError(err);
    expect(msg).not.toContain("/home");
    expect(msg).not.toContain(".ts:");
  });

  it("maps fetch TypeError to a connection message", () => {
    const err = new TypeError("Failed to fetch");
    const msg = sanitizeApiError(err);
    expect(msg).toContain("3001");
  });

  it("uses the fallback for unknown non-ApiError exceptions", () => {
    const msg = sanitizeApiError(new Error("something mysterious"), "Custom fallback");
    expect(msg).toBe("Custom fallback");
  });

  it("uses the default fallback when called with null", () => {
    const msg = sanitizeApiError(null);
    expect(msg).toContain("Check that the API");
  });
});
