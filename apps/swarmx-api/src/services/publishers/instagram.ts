import type { PublishResult, VideoArtifacts } from "@swarmx/types/video-types";
import type { VideoJob } from "../../types/video.js";
import { BaseVideoPublisher } from "./base-publisher.js";
import { GenericVideoPublisher } from "./generic.js";

export class InstagramVideoPublisher extends BaseVideoPublisher {
  readonly platform = "reels" as const;

  protected readonly profile = {
    accountLabel: "Instagram Graph API",
    deliveryMode: "studio_export" as const,
    requiresApproval: true,
  };

  protected async createResult(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt?: string,
  ): Promise<PublishResult> {
    const token = process.env["SWARMX_INSTAGRAM_ACCESS_TOKEN"];
    const userId = process.env["SWARMX_INSTAGRAM_USER_ID"];

    if (!token || !userId) {
      const fallback = new GenericVideoPublisher();
      const genericResult = scheduledAt
        ? await fallback.schedule(job, artifacts, scheduledAt)
        : await fallback.publish(job, artifacts);

      return {
        ...genericResult,
        platform: this.platform,
        status: scheduledAt ? "scheduled" : "pending_review",
        requiresApproval: true,
        approvalState: "pending_review",
        deliveryMode: "studio_export",
        accountLabel: "Meta Reels Queue",
        failureReason: "Instagram Graph API access is not configured for reels publishing.",
      };
    }

    const platformUrl = scheduledAt
      ? `https://graph.facebook.com/${userId}/media_publish`
      : `https://graph.facebook.com/${userId}/media`;

    return this.buildResult(job, artifacts, scheduledAt ? "scheduled" : "pending_review", {
      ...(scheduledAt ? { scheduledAt } : {}),
      platformUrl,
      requiresApproval: true,
      approvalState: "pending_review",
    });
  }
}