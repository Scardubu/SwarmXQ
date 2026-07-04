import { copyFile, mkdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import type { PublishResult, VideoArtifacts } from "@swarmx/types/video-types";
import type { VideoJob } from "../../types/video.js";
import { BaseVideoPublisher } from "./base-publisher.js";

export class GenericVideoPublisher extends BaseVideoPublisher {
  readonly platform = "generic" as const;

  protected readonly profile = {
    accountLabel: "Direct Export",
    deliveryMode: "direct_api" as const,
    requiresApproval: false,
  };

  protected async createResult(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt?: string,
  ): Promise<PublishResult> {
    const outputPath = artifacts.outputPath;
    const exportDir = process.env["SWARMX_VIDEO_EXPORT_DIR"] ?? ".swarmx/video/exports";
    await mkdir(exportDir, { recursive: true });

    const fileExtension = outputPath ? extname(outputPath) || ".mp4" : ".mp4";
    const timestamp = new Date().toISOString().replace(/[:]/g, "-");
    const exportPath = join(exportDir, `${job.id}_${this.platform}_${timestamp}${fileExtension}`);

    if (scheduledAt) {
      await this.writeScheduleSidecar(job, artifacts, scheduledAt);
      return this.buildResult(job, artifacts, "scheduled", {
        scheduledAt,
        platformUrl: exportPath,
        requiresApproval: false,
        approvalState: "not_required",
      });
    }

    if (outputPath) {
      await copyFile(outputPath, exportPath);
    }

    return this.buildResult(job, artifacts, "published", {
      ...(outputPath ? { platformUrl: exportPath } : {}),
      ...(!outputPath && artifacts.outputPublicUrl ? { platformUrl: artifacts.outputPublicUrl } : {}),
      requiresApproval: false,
      approvalState: "not_required",
    });
  }
}