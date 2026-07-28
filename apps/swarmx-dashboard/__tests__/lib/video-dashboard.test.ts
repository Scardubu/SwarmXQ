import { describe, expect, it } from "vitest";
import { errorCodeHint, normalizeVideoJob } from "@/lib/video-dashboard";

describe("video dashboard normalization", () => {
  it("preserves certification blockers from completed job output", () => {
    const job = normalizeVideoJob({
      id: "job-1",
      status: "completed",
      request: { prompt: "Make a product video" },
      createdAt: "2026-07-28T00:00:00.000Z",
      updatedAt: "2026-07-28T00:00:01.000Z",
      output: {
        relativePath: "video.mp4",
        absolutePath: "/tmp/video.mp4",
        publicUrl: "/api/video/files/video.mp4",
        fileSizeBytes: 1024,
        durationSeconds: 12,
        widthPx: 720,
        heightPx: 1280,
        fps: 30,
        format: "mp4",
        checksum: "sha256",
        generatedAt: "2026-07-28T00:00:01.000Z",
        modelsUsed: {},
        certificationTier: "TECHNICALLY_VALID",
        certificationBlockers: ["Rights and provenance manifest is missing"],
      },
    });

    expect(job.output?.certificationTier).toBe("TECHNICALLY_VALID");
    expect(job.output?.certificationBlockers).toEqual(["Rights and provenance manifest is missing"]);
  });

  it("surfaces classified backend hints and does not present UNKNOWN as retryable", () => {
    expect(errorCodeHint("COMFY_UNAVAILABLE")).toContain("ComfyUI is not reachable");
    expect(errorCodeHint("UNKNOWN")).toContain("Retry is disabled");
  });
});
