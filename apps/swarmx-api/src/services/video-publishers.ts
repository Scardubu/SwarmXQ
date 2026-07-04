import { randomUUID } from "node:crypto";
import type {
  PublishApprovalState,
  PublishDeliveryMode,
  PublishResult,
  PublishStatus,
  VideoArtifacts,
  VideoExportPlatform,
} from "@swarmx/types/video-types";
import type { VideoJob } from "../types/video.js";

export interface PublishRequestInput {
  platform: VideoExportPlatform;
  scheduledAt?: string;
}

interface ApiVideoPublisher {
  platform: VideoExportPlatform;
  publish(job: VideoJob, artifacts: VideoArtifacts): Promise<PublishResult>;
  schedule(job: VideoJob, artifacts: VideoArtifacts, scheduledAt: string): Promise<PublishResult>;
  getStatus(publishId: string): Promise<PublishStatus>;
}

interface PublisherProfile {
  accountLabel: string;
  deliveryMode: PublishDeliveryMode;
  requiresApproval: boolean;
}

class PlatformVideoPublisher implements ApiVideoPublisher {
  readonly platform: VideoExportPlatform;
  private readonly profile: PublisherProfile;

  constructor(platform: VideoExportPlatform, profile: PublisherProfile) {
    this.platform = platform;
    this.profile = profile;
  }

  async publish(job: VideoJob, artifacts: VideoArtifacts): Promise<PublishResult> {
    return this.buildResult(job, artifacts, undefined);
  }

  async schedule(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt: string,
  ): Promise<PublishResult> {
    return this.buildResult(job, artifacts, scheduledAt);
  }

  async getStatus(_publishId: string): Promise<PublishStatus> {
    return this.profile.requiresApproval ? "pending_review" : "published";
  }

  private buildResult(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt?: string,
  ): PublishResult {
    const timestamp = new Date().toISOString();
    const publishId = randomUUID();
    const requiresApproval = this.profile.requiresApproval;
    const status: PublishStatus = scheduledAt
      ? "scheduled"
      : requiresApproval
        ? "pending_review"
        : "published";
    const approvalState: PublishApprovalState = requiresApproval ? "pending_review" : "not_required";
    const targetUrl = buildPlatformUrl(this.platform, artifacts, publishId, job.id);

    return {
      publishId,
      platform: this.platform,
      status,
      requestedAt: timestamp,
      updatedAt: timestamp,
      ...(status === "published" ? { publishedAt: timestamp } : {}),
      ...(scheduledAt !== undefined ? { scheduledAt } : {}),
      ...(targetUrl ? { platformUrl: targetUrl } : {}),
      requiresApproval,
      approvalState,
      deliveryMode: this.profile.deliveryMode,
      accountLabel: this.profile.accountLabel,
    };
  }
}

function buildPlatformUrl(
  platform: VideoExportPlatform,
  artifacts: VideoArtifacts,
  publishId: string,
  jobId: string,
): string | undefined {
  const source = artifacts.outputPublicUrl;
  if (!source) return undefined;

  const encodedId = encodeURIComponent(publishId);
  const encodedJobId = encodeURIComponent(jobId);

  switch (platform) {
    case "tiktok":
      return `https://studio.tiktok.com/upload?publish=${encodedId}&job=${encodedJobId}`;
    case "reels":
      return `https://business.facebook.com/latest/reels?publish=${encodedId}&job=${encodedJobId}`;
    case "shorts":
      return `https://studio.youtube.com/channel/UC/videos/upload?publish=${encodedId}&job=${encodedJobId}`;
    case "generic":
    default:
      return `${source}?publish=${encodedId}&platform=${platform}`;
  }
}

const publisherRegistry: Record<VideoExportPlatform, ApiVideoPublisher> = {
  tiktok: new PlatformVideoPublisher("tiktok", {
    accountLabel: "TikTok Studio",
    deliveryMode: "studio_export",
    requiresApproval: true,
  }),
  reels: new PlatformVideoPublisher("reels", {
    accountLabel: "Meta Reels Queue",
    deliveryMode: "studio_export",
    requiresApproval: true,
  }),
  shorts: new PlatformVideoPublisher("shorts", {
    accountLabel: "YouTube Studio",
    deliveryMode: "studio_export",
    requiresApproval: true,
  }),
  generic: new PlatformVideoPublisher("generic", {
    accountLabel: "Direct Export",
    deliveryMode: "direct_api",
    requiresApproval: false,
  }),
};

export function listSupportedPublishPlatforms(): VideoExportPlatform[] {
  return Object.keys(publisherRegistry) as VideoExportPlatform[];
}

export function getVideoPublisher(platform: VideoExportPlatform): ApiVideoPublisher {
  return publisherRegistry[platform];
}
