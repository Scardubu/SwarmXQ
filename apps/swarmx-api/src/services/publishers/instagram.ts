import type { PublishResult, VideoArtifacts } from "@swarmx/types/video-types";
import type { VideoJob } from "../../types/video.js";
import { BaseVideoPublisher } from "./base-publisher.js";
import { GenericVideoPublisher } from "./generic.js";
import { loadEnv, readSecretEnv } from "../../lib/env.js";

const INSTAGRAM_GRAPH_BASE = "https://graph.facebook.com/v23.0";

interface InstagramMediaResponse {
  id?: string;
}

interface InstagramPublishResponse {
  id?: string;
}

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
    const token = readSecretEnv("SWARMX_INSTAGRAM_ACCESS_TOKEN");
    const userId = loadEnv().SWARMX_INSTAGRAM_USER_ID;

    if (!token || !userId) {
      this.log("warn", "approval_required", {
        message: "Instagram Graph API access is not configured for reels publishing.",
      });
      const fallback = new GenericVideoPublisher();
      const genericResult = scheduledAt
        ? await fallback.schedule(job, artifacts, scheduledAt)
        : await fallback.publish(job, artifacts);

      return {
        ...genericResult,
        platform: this.platform,
        status: "pending_review",
        ...(scheduledAt ? { scheduledAt } : {}),
        requiresApproval: true,
        approvalState: "pending_review",
        deliveryMode: "studio_export",
        accountLabel: "Meta Reels Queue",
        failureReason: "Instagram Graph API access is not configured for reels publishing.",
      };
    }

    if (!artifacts.outputPublicUrl) {
      const fallback = new GenericVideoPublisher();
      const genericResult = scheduledAt
        ? await fallback.schedule(job, artifacts, scheduledAt)
        : await fallback.publish(job, artifacts);
      return {
        ...genericResult,
        platform: this.platform,
        status: "pending_review",
        ...(scheduledAt ? { scheduledAt } : {}),
        requiresApproval: true,
        approvalState: "pending_review",
        deliveryMode: "studio_export",
        accountLabel: "Meta Reels Queue",
        failureReason: "Instagram publishing requires a publicly reachable video URL.",
      };
    }

    const creationId = await this.withRetry(async () => {
      const response = await fetch(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(userId)}/media`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          media_type: "REELS",
          video_url: artifacts.outputPublicUrl,
          caption: job.request.prompt,
          access_token: token,
          ...(scheduledAt
            ? {
                published: false,
                scheduled_publish_time: Math.floor(Date.parse(scheduledAt) / 1000),
              }
            : {}),
        }),
      });

      if (!response.ok) {
        throw new Error(`Instagram media creation failed with status ${response.status}`);
      }

      const payload = (await response.json()) as InstagramMediaResponse;
      if (!payload.id) {
        throw new Error("Instagram media response missing id");
      }
      return payload.id;
    });

    const publishResponse = await this.withRetry(async () => {
      const response = await fetch(`${INSTAGRAM_GRAPH_BASE}/${encodeURIComponent(userId)}/media_publish`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          creation_id: creationId,
          access_token: token,
        }),
      });

      if (!response.ok) {
        throw new Error(`Instagram media publish failed with status ${response.status}`);
      }

      return (await response.json()) as InstagramPublishResponse;
    });

    return {
      ...this.buildResult(job, artifacts, scheduledAt ? "scheduled" : "published", {
        ...(scheduledAt ? { scheduledAt } : {}),
        platformUrl: `https://www.instagram.com/reel/${publishResponse.id ?? creationId}`,
        requiresApproval: true,
        approvalState: "approved",
      }),
      publishId: publishResponse.id ?? creationId,
    };
  }
}
