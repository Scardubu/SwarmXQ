import { describe, expect, test } from "vitest";
import { certifyReadyToPost } from "../src/services/creative-factory-certification.js";
import type { VideoOutputMetadata } from "../src/types/video.js";
import type {
  AssetRecord,
  ComplianceReport,
  PublishPackage,
  QualityReport,
  SubtitleTrack,
} from "@swarmx/types/video-types";

const timestamp = new Date().toISOString();

const output: VideoOutputMetadata = {
  relativePath: "episode.mp4",
  absolutePath: "/tmp/episode.mp4",
  publicUrl: "/api/video/files/episode.mp4",
  fileSizeBytes: 123456,
  durationSeconds: 30,
  widthPx: 1080,
  heightPx: 1920,
  fps: 30,
  format: "mp4",
  checksum: "abc123",
  generatedAt: timestamp,
  modelsUsed: {},
};

const subtitle: SubtitleTrack = {
  id: "subtitle-1",
  schemaVersion: 1,
  locale: "en-US",
  format: "srt",
  path: "/tmp/episode.srt",
  confidence: 0.95,
  manualReviewState: "approved",
  safeZonePassed: true,
};

const asset: AssetRecord = {
  id: "asset-1",
  schemaVersion: 1,
  path: "/tmp/asset.png",
  mediaType: "image",
  sha256: "def456",
  license: {
    state: "approved",
    allowedUses: ["short-form-video"],
  },
  lineage: {
    sourceKind: "template",
    parentAssetIds: [],
  },
  createdAt: timestamp,
  updatedAt: timestamp,
};

const qualityReport: QualityReport = {
  id: "quality-1",
  schemaVersion: 1,
  passed: true,
  technicalPassed: true,
  creativePassed: true,
  accessibilityPassed: true,
  rightsPassed: true,
  compliancePassed: true,
  checks: [],
  createdAt: timestamp,
};

const complianceReport: ComplianceReport = {
  id: "compliance-1",
  schemaVersion: 1,
  aiDisclosureRequired: true,
  aiDisclosureText: "AI-assisted production",
  rightsState: "approved",
  contentSafetyState: "approved",
  publishAllowed: true,
  blockers: [],
  createdAt: timestamp,
};

const publishPackage: PublishPackage = {
  id: "package-1",
  schemaVersion: 1,
  platform: "tiktok",
  lifecycleState: "REVIEW_REQUIRED",
  mediaPath: "/tmp/episode.mp4",
  title: "Focus Breaks Here",
  description: "A short-form package ready for review.",
  caption: {
    firstLine: "Focus breaks here",
    body: "A practical attention reset.",
    cta: "Send this before deep work",
    hashtags: { broad: ["#focus"], niche: ["#deepwork"], trending: [] },
  },
  capability: {
    platform: "tiktok",
    specVersion: "manual-export-baseline-2026-07-20",
    verifiedAt: "2026-07-20",
    maxDurationSeconds: 60,
    aspectRatios: ["9:16"],
    supportedContainers: ["mp4"],
    supportsDraftUpload: false,
    supportsDirectPublish: false,
    requiresAiDisclosure: true,
  },
  complianceReportId: "compliance-1",
  createdAt: timestamp,
  updatedAt: timestamp,
};

describe("certifyReadyToPost", () => {
  test("certifies a complete production bundle", () => {
    const result = certifyReadyToPost({
      output,
      subtitleTracks: [subtitle],
      assets: [asset],
      qualityReport,
      complianceReport,
      publishPackages: [publishPackage],
    });

    expect(result.passed).toBe(true);
    expect(result.lifecycleState).toBe("READY_TO_POST");
    expect(result.blockers).toEqual([]);
  });

  test("rejects stub media and unresolved rights", () => {
    const result = certifyReadyToPost({
      output: { ...output, relativePath: "stub_episode.mp4" },
      subtitleTracks: [subtitle],
      assets: [{ ...asset, license: { ...asset.license, state: "needs_review" } }],
      qualityReport,
      complianceReport,
      publishPackages: [publishPackage],
    });

    expect(result.passed).toBe(false);
    expect(result.lifecycleState).toBe("REVIEW_REQUIRED");
    expect(result.blockers).toContain("Stub media cannot be READY_TO_POST");
    expect(result.blockers).toContain("Asset asset-1 rights state is needs_review");
  });
});
