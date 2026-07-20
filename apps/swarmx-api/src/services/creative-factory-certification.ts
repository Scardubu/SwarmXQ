import type {
  AssetRecord,
  CertificationTier,
  ComplianceReport,
  PublishPackage,
  QualityReport,
  ReadyToPostCertification,
  SubtitleTrack,
} from "@swarmx/types/video-types";
import type { VideoOutputMetadata } from "../types/video.js";

export interface ReadyToPostInput {
  output: VideoOutputMetadata | null | undefined;
  subtitleTracks: SubtitleTrack[];
  assets: AssetRecord[];
  qualityReport: QualityReport | null | undefined;
  complianceReport: ComplianceReport | null | undefined;
  publishPackages: PublishPackage[];
}

export function certifyProductionPack(input: Pick<ReadyToPostInput, "output"> & Partial<Pick<ReadyToPostInput, "subtitleTracks" | "assets" | "qualityReport">>): {
  certificationTier: CertificationTier;
  passed: boolean;
  blockers: string[];
} {
  const blockers: string[] = [];
  const output = input.output;
  if (!output) {
    return {
      certificationTier: "RENDER_FAILED",
      passed: false,
      blockers: ["Final media metadata is missing"],
    };
  }
  if (output.relativePath.startsWith("stub_")) blockers.push("Stub media cannot be production-pack valid");
  if (output.format !== "mp4") blockers.push(`Expected MP4 container, got ${output.format}`);
  if (!(output.durationSeconds > 0)) blockers.push("Media duration must be greater than zero");
  if (!(output.widthPx > 0 && output.heightPx > 0)) blockers.push("Media dimensions are invalid");
  if (!(output.fps > 0)) blockers.push("Media frame rate is invalid");
  if (!output.checksum) blockers.push("Stable media hash is missing");
  if (!output.productionPackageDir) blockers.push("Production package directory is missing");
  if (!output.renderManifestPath) blockers.push("Render manifest is missing");
  if (!output.transcriptPath) blockers.push("Transcript is missing");
  if (!output.srtPath || !output.vttPath) blockers.push("SRT and VTT captions are required");
  if (!output.rightsManifestPath) blockers.push("Rights and provenance manifest is missing");
  if (!output.platformPackagePath) blockers.push("Platform package metadata is missing");
  if (!output.voiceArtifact) blockers.push("Voice artifact lineage is missing");
  if (!output.mediaQualityReport) blockers.push("Media QC report is missing");
  if ((input.subtitleTracks ?? []).length === 0 && !output.srtPath && !output.vttPath) {
    blockers.push("At least one subtitle track is required");
  }
  if ((input.assets ?? []).length === 0 && !output.rightsManifestPath) {
    blockers.push("Asset lineage manifest is empty");
  }
  if (input.qualityReport && !input.qualityReport.passed) {
    blockers.push("Quality report did not pass");
  }

  if (blockers.length === 0) {
    return { certificationTier: "PRODUCTION_PACK_VALID", passed: true, blockers };
  }
  const technicalOnly = blockers.every((blocker) =>
    !blocker.includes("Media") &&
    !blocker.includes("Expected MP4") &&
    !blocker.includes("Stable media hash") &&
    !blocker.includes("Stub media")
  );
  return {
    certificationTier: technicalOnly ? "TECHNICALLY_VALID" : "CREATIVE_REVIEW_REQUIRED",
    passed: false,
    blockers,
  };
}

export function certifyReadyToPost(input: ReadyToPostInput): ReadyToPostCertification {
  const blockers: string[] = [];
  const output = input.output;

  if (!output) {
    blockers.push("Final media metadata is missing");
  } else {
    if (output.relativePath.startsWith("stub_")) blockers.push("Stub media cannot be READY_TO_POST");
    if (output.format !== "mp4") blockers.push(`Expected MP4 container, got ${output.format}`);
    if (!(output.durationSeconds > 0)) blockers.push("Media duration must be greater than zero");
    if (!(output.widthPx > 0 && output.heightPx > 0)) blockers.push("Media dimensions are invalid");
    if (!(output.fps > 0)) blockers.push("Media frame rate is invalid");
    if (!output.checksum) blockers.push("Stable media hash is missing");
  }

  if (input.subtitleTracks.length === 0) {
    blockers.push("At least one subtitle track is required");
  }
  for (const track of input.subtitleTracks) {
    if (!track.path) blockers.push(`Subtitle ${track.id} has no path`);
    if (!track.safeZonePassed) blockers.push(`Subtitle ${track.id} failed safe-zone validation`);
    if (track.manualReviewState === "required") blockers.push(`Subtitle ${track.id} requires manual review`);
    if (track.confidence < 0.8) blockers.push(`Subtitle ${track.id} confidence is below 0.80`);
  }

  if (input.assets.length === 0) {
    blockers.push("Asset lineage manifest is empty");
  }
  for (const asset of input.assets) {
    if (asset.license.state !== "approved") {
      blockers.push(`Asset ${asset.id} rights state is ${asset.license.state}`);
    }
    if (!asset.sha256) blockers.push(`Asset ${asset.id} hash is missing`);
  }

  if (!input.qualityReport) {
    blockers.push("Quality report is missing");
  } else if (!input.qualityReport.passed) {
    blockers.push("Quality report did not pass");
  }

  if (!input.complianceReport) {
    blockers.push("Compliance report is missing");
  } else {
    if (!input.complianceReport.publishAllowed) blockers.push("Compliance report blocks publishing");
    for (const blocker of input.complianceReport.blockers) {
      blockers.push(`Compliance blocker: ${blocker}`);
    }
  }

  if (input.publishPackages.length === 0) {
    blockers.push("At least one platform package is required");
  }
  for (const pack of input.publishPackages) {
    if (input.complianceReport && pack.complianceReportId !== input.complianceReport.id) {
      blockers.push(`Publish package ${pack.id} is linked to the wrong compliance report`);
    }
    if (!pack.title || !pack.description || !pack.caption.firstLine) {
      blockers.push(`Publish package ${pack.id} is missing required copy`);
    }
  }

  return {
    certificationTier: blockers.length === 0 ? "READY_TO_POST" : (output ? "CREATIVE_REVIEW_REQUIRED" : "RENDER_FAILED"),
    lifecycleState: blockers.length === 0 ? "READY_TO_POST" : "REVIEW_REQUIRED",
    passed: blockers.length === 0,
    blockers,
    certifiedAt: new Date().toISOString(),
  };
}
