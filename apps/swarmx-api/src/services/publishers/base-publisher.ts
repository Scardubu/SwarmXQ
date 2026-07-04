import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type {
  PublishApprovalState,
  PublishDeliveryMode,
  PublishResult,
  PublishStatus,
  VideoArtifacts,
  VideoExportPlatform,
} from "@swarmx/types/video-types";
import type { VideoJob } from "../../types/video.js";

export interface PublisherProfile {
  accountLabel: string;
  deliveryMode: PublishDeliveryMode;
  requiresApproval: boolean;
}

export interface ApiVideoPublisher {
  platform: VideoExportPlatform;
  publish(job: VideoJob, artifacts: VideoArtifacts): Promise<PublishResult>;
  schedule(job: VideoJob, artifacts: VideoArtifacts, scheduledAt: string): Promise<PublishResult>;
  getStatus(publishId: string): Promise<PublishStatus>;
}

export abstract class BaseVideoPublisher implements ApiVideoPublisher {
  abstract readonly platform: VideoExportPlatform;
  protected abstract readonly profile: PublisherProfile;

  async publish(job: VideoJob, artifacts: VideoArtifacts): Promise<PublishResult> {
    return this.createResult(job, artifacts, undefined);
  }

  async schedule(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt: string,
  ): Promise<PublishResult> {
    return this.createResult(job, artifacts, scheduledAt);
  }

  async getStatus(_publishId: string): Promise<PublishStatus> {
    return this.profile.requiresApproval ? "pending_review" : "published";
  }

  protected requiresApproval(): boolean {
    return this.profile.requiresApproval;
  }

  protected buildResult(
    job: VideoJob,
    artifacts: VideoArtifacts,
    status: PublishStatus,
    options?: {
      scheduledAt?: string;
      platformUrl?: string;
      failureReason?: string;
      requiresApproval?: boolean;
      approvalState?: PublishApprovalState;
    },
  ): PublishResult {
    const timestamp = new Date().toISOString();
    const requiresApproval = options?.requiresApproval ?? this.profile.requiresApproval;
    const approvalState = options?.approvalState ?? (requiresApproval ? "pending_review" : "not_required");

    return {
      publishId: randomUUID(),
      platform: this.platform,
      status,
      requestedAt: timestamp,
      updatedAt: timestamp,
      ...(status === "published" ? { publishedAt: timestamp } : {}),
      ...(options?.scheduledAt !== undefined ? { scheduledAt: options.scheduledAt } : {}),
      ...(options?.platformUrl ? { platformUrl: options.platformUrl } : {}),
      ...(options?.failureReason ? { failureReason: options.failureReason } : {}),
      requiresApproval,
      approvalState,
      deliveryMode: this.profile.deliveryMode,
      accountLabel: this.profile.accountLabel,
    };
  }

  protected defaultPlatformUrl(
    artifacts: VideoArtifacts,
    publishId: string,
    jobId: string,
  ): string | undefined {
    const source = artifacts.outputPublicUrl;
    if (!source) {
      return undefined;
    }

    const encodedId = encodeURIComponent(publishId);
    const encodedJobId = encodeURIComponent(jobId);

    switch (this.platform) {
      case "tiktok":
        return `https://studio.tiktok.com/upload?publish=${encodedId}&job=${encodedJobId}`;
      case "reels":
        return `https://business.facebook.com/latest/reels?publish=${encodedId}&job=${encodedJobId}`;
      case "shorts":
        return `https://studio.youtube.com/channel/UC/videos/upload?publish=${encodedId}&job=${encodedJobId}`;
      case "generic":
      default:
        return `${source}?publish=${encodedId}&platform=${this.platform}`;
    }
  }

  protected async writeScheduleSidecar(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt: string,
  ): Promise<string | undefined> {
    const outputPath = artifacts.outputPath;
    if (!outputPath) {
      return undefined;
    }

    const exportDir = process.env["SWARMX_VIDEO_EXPORT_DIR"] ?? ".swarmx/video/exports";
    await mkdir(exportDir, { recursive: true });

    const sidecarPath = join(
      exportDir,
      `${job.id}_${this.platform}_${scheduledAt.replace(/[:]/g, "-")}.schedule.json`,
    );

    await writeFile(
      sidecarPath,
      JSON.stringify(
        {
          jobId: job.id,
          platform: this.platform,
          scheduledAt,
          outputPath,
          sourceFile: basename(outputPath),
          requiresApproval: this.profile.requiresApproval,
        },
        null,
        2,
      ),
      "utf8",
    );

    return sidecarPath;
  }

  protected abstract createResult(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt?: string,
  ): Promise<PublishResult>;
}