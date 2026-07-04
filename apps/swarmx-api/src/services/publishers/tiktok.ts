import type { PublishResult, VideoArtifacts } from "@swarmx/types/video-types";
import type { VideoJob } from "../../types/video.js";
import { BaseVideoPublisher } from "./base-publisher.js";
import { GenericVideoPublisher } from "./generic.js";

export class TikTokVideoPublisher extends BaseVideoPublisher {
  readonly platform = "tiktok" as const;

  protected readonly profile = {
    accountLabel: "TikTok Content API",
    deliveryMode: "studio_export" as const,
    requiresApproval: true,
  };

  protected async createResult(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt?: string,
  ): Promise<PublishResult> {
    const token = process.env["SWARMX_TIKTOK_ACCESS_TOKEN"];
    const approved = process.env["SWARMX_TIKTOK_API_APPROVED"] === "1";

    if (!token || !approved) {
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
        accountLabel: "TikTok Studio",
        failureReason: "TikTok Content API requires partner approval. See docs/TIKTOK_SETUP.md",
      };
    }

    const platformUrl = scheduledAt
      ? "https://open.tiktokapis.com/v2/post/publish/video/init/"
      : "https://open.tiktokapis.com/v2/video/upload/";

    return this.buildResult(job, artifacts, scheduledAt ? "scheduled" : "pending_review", {
      ...(scheduledAt ? { scheduledAt } : {}),
      platformUrl,
      requiresApproval: true,
      approvalState: "pending_review",
    });
  }
}