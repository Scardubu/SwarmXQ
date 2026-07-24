import { readFile } from "node:fs/promises";
import type { PublishResult, VideoArtifacts } from "@swarmx/types/video-types";
import type { VideoJob } from "../../types/video.js";
import { BaseVideoPublisher } from "./base-publisher.js";
import { GenericVideoPublisher } from "./generic.js";
import { loadEnv, readSecretEnv } from "../../lib/env.js";

const TIKTOK_API_BASE = "https://open.tiktokapis.com";
const POLL_ATTEMPTS = 12;
const POLL_DELAY_MS = 5_000;

interface TikTokUploadResponse {
  data?: {
    video_id?: string;
  };
  video_id?: string;
}

interface TikTokPublishInitResponse {
  data?: {
    publish_id?: string;
  };
  publish_id?: string;
}

interface TikTokPublishStatusResponse {
  data?: {
    status?: string;
    fail_reason?: string;
    public_url?: string;
  };
  status?: string;
  fail_reason?: string;
  public_url?: string;
}

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
    const token = readSecretEnv("SWARMX_TIKTOK_ACCESS_TOKEN");
    const approved = loadEnv().SWARMX_TIKTOK_API_APPROVED === "1";

    if (!token || !approved) {
      this.log("warn", "approval_required", {
        message: "TikTok Content API requires partner approval. See docs/TIKTOK_SETUP.md",
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
        accountLabel: "TikTok Studio",
        failureReason: "TikTok Content API requires partner approval. See docs/TIKTOK_SETUP.md",
      };
    }

    if (!artifacts.outputPath) {
      return this.buildResult(job, artifacts, "failed", {
        ...(scheduledAt ? { scheduledAt } : {}),
        failureReason: "Missing output artifact for TikTok upload",
        requiresApproval: true,
        approvalState: "approved",
      });
    }

    const videoId = await this.withRetry(async () => {
      const form = new FormData();
      const buffer = await readFile(artifacts.outputPath as string);
      form.append("video", new Blob([buffer], { type: "video/mp4" }), `${job.id}.mp4`);

      const response = await fetch(`${TIKTOK_API_BASE}/v2/video/upload/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
        },
        body: form,
      });

      if (!response.ok) {
        throw new Error(`TikTok upload failed with status ${response.status}`);
      }

      const payload = (await response.json()) as TikTokUploadResponse;
      const nextVideoId = payload.data?.video_id ?? payload.video_id;
      if (!nextVideoId) {
        throw new Error("TikTok upload response missing video_id");
      }
      return nextVideoId;
    });

    const publishId = await this.withRetry(async () => {
      const response = await fetch(`${TIKTOK_API_BASE}/v2/post/publish/video/init/`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          post_info: {
            title: job.request.prompt.slice(0, 150),
            privacy_level: "SELF_ONLY",
            ...(scheduledAt
              ? { scheduled_time: Math.floor(Date.parse(scheduledAt) / 1000) }
              : {}),
          },
          source_info: {
            source: "FILE_UPLOAD",
            video_id: videoId,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`TikTok publish init failed with status ${response.status}`);
      }

      const payload = (await response.json()) as TikTokPublishInitResponse;
      const nextPublishId = payload.data?.publish_id ?? payload.publish_id;
      if (!nextPublishId) {
        throw new Error("TikTok publish init response missing publish_id");
      }
      return nextPublishId;
    });

    if (scheduledAt) {
      const scheduledPlatformUrl = this.defaultPlatformUrl(artifacts, publishId, job.id);
      return {
        ...this.buildResult(job, artifacts, "scheduled", {
          scheduledAt,
          ...(scheduledPlatformUrl ? { platformUrl: scheduledPlatformUrl } : {}),
          requiresApproval: true,
          approvalState: "approved",
        }),
        publishId,
      };
    }

    const publishStatus = await this.withRetry(async () => {
      for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt += 1) {
        const response = await fetch(
          `${TIKTOK_API_BASE}/v2/post/publish/status/fetch/?publish_id=${encodeURIComponent(publishId)}`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
            },
          },
        );

        if (!response.ok) {
          throw new Error(`TikTok publish status failed with status ${response.status}`);
        }

        const payload = (await response.json()) as TikTokPublishStatusResponse;
        const status = (payload.data?.status ?? payload.status ?? "").toLowerCase();
        if (["publish_complete", "published", "success"].includes(status)) {
          return {
            status: "published" as const,
            platformUrl: payload.data?.public_url ?? payload.public_url,
          };
        }
        if (["failed", "publish_failed", "error"].includes(status)) {
          return {
            status: "failed" as const,
            failureReason: payload.data?.fail_reason ?? payload.fail_reason ?? "TikTok publish failed",
          };
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_DELAY_MS));
      }

      return {
        status: "pending_review" as const,
      };
    });

    const resolvedPlatformUrl =
      publishStatus.platformUrl ?? this.defaultPlatformUrl(artifacts, publishId, job.id);

    return {
      ...this.buildResult(job, artifacts, publishStatus.status, {
        ...(publishStatus.status === "failed" && publishStatus.failureReason
          ? { failureReason: publishStatus.failureReason }
          : {}),
        ...(resolvedPlatformUrl ? { platformUrl: resolvedPlatformUrl } : {}),
        requiresApproval: true,
        approvalState: "approved",
      }),
      publishId,
    };
  }
}
