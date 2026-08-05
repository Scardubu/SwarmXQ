import { describe, expect, it } from "vitest";
import { formatSubmissionBlockReason } from "@/lib/video-runtime-messaging";

describe("video runtime messaging", () => {
  it("returns null when guidance is absent", () => {
    expect(formatSubmissionBlockReason(null)).toBeNull();
  });

  it("formats a concise actionable block reason", () => {
    const reason = formatSubmissionBlockReason({
      tone: "critical",
      title: "Full video pipeline blocked",
      detail: "Available RAM is below the full pipeline floor.",
      recoveryHint: "Free memory and retry when pressure is normal.",
      blocksSubmission: true,
    });

    expect(reason).toBe("Full video pipeline blocked. Free memory and retry when pressure is normal.");
  });
});