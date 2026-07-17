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
import { log as sharedLog } from "../../lib/logger.js";

export interface PublisherProfile {
  accountLabel: string;
  deliveryMode: PublishDeliveryMode;
  requiresApproval: boolean;
}

type LogLevel = "info" | "warn" | "error";

export interface PlatformPublisher {
  platform: VideoExportPlatform;
  publish(job: VideoJob, artifacts: VideoArtifacts): Promise<PublishResult>;
  schedule(job: VideoJob, artifacts: VideoArtifacts, scheduledAt: string): Promise<PublishResult>;
  getStatus(publishId: string): Promise<PublishStatus>;
}

export abstract class BaseVideoPublisher implements PlatformPublisher {
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

  protected async withRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
    let attempt = 0;
    let lastError: unknown;

    while (attempt < retries) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        attempt += 1;
        if (attempt >= retries) {
          break;
        }

        const delayMs = 500 * 2 ** (attempt - 1);
        this.log("warn", "publisher_retry", {
          platform: this.platform,
          attempt,
          retries,
          delayMs,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  protected log(level: LogLevel, msg: string, ctx: Record<string, unknown> = {}): void {
    const sanitized = Object.fromEntries(
      Object.entries(ctx).filter(([key]) => !/token|secret|authorization/i.test(key)),
    );

    const bindings = { publisher: this.platform, ...sanitized };
    switch (level) {
      case "error":
        sharedLog.error(bindings, msg);
        break;
      case "warn":
        sharedLog.warn(bindings, msg);
        break;
      case "info":
      default:
        sharedLog.info(bindings, msg);
        break;
    }
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