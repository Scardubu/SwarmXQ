// ============================================================================
// SwarmX VIDEO-ALPHA Canonical Video Types
// Shared between API and dashboard. This file is the source of truth for
// video pipeline, virality, workflow, and publishing contracts.
// ============================================================================

export type VideoMode = "t2v" | "i2v" | "v2v" | "edit";

export type VideoResolution =
  | "512x512"
  | "512x896"
  | "768x512"
  | "768x1344";

export type VideoQuantTier = "q4_k_m" | "q5_k_m" | "q8_0" | "fp16";

export type VideoExportPlatform = "tiktok" | "reels" | "shorts" | "generic";

export type VideoJobStatus =
  | "queued"
  | "classifying"
  | "scripting"
  | "staging"
  | "generating"
  | "interpolating"
  | "encoding"
  | "reviewing"
  | "publishing"
  | "done"
  // Compatibility bridge statuses still emitted/consumed by existing API/UI.
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export type VideoPipelineStage =
  | "classify"
  | "script"
  | "stage"
  | "generate"
  | "interpolate"
  | "encode"
  | "review"
  | "publish";

export type VideoDegradeMode =
  | "none"
  | "script_only"
  | "storyboard_only"
  | "render_deferred"
  | "intent_only";

export interface HashtagSet {
  broad: string[];
  niche: string[];
  trending: string[];
}

export interface CaptionDraft {
  firstLine: string;
  body: string;
  cta: string;
  hashtags: HashtagSet;
  soundSuggestion?: string;
}

export interface CaptionValidation {
  valid: boolean;
  violations: string[];
}

export interface ViralitySignal {
  hookStrength: number;
  completionProxy: number;
  shareability: number;
  seoScore: number;
  overall: number;
  scoredBy: string;
  recommendations: string[];
  captionDraft: CaptionDraft;
}

export interface OperatorTraceEntry {
  stage: VideoPipelineStage | string;
  operator: string;
  modelTag: string;
  latencyMs: number;
  tokenCount: number;
  timestamp: string;
}

export interface VideoError {
  code: string;
  message: string;
  retryable?: boolean;
  stage?: string;
  details?: Record<string, unknown>;
}

export interface VideoArtifacts {
  manifestPath?: string;
  outputPath?: string;
  outputPublicUrl?: string;
  thumbnailPath?: string;
  firstFramePath?: string;
  frameDirectory?: string;
  interpolatedFrameDirectory?: string;
  captionPath?: string;
  metadataPath?: string;
  exportPathByPlatform?: Partial<Record<VideoExportPlatform, string>>;
  publishHistory?: PublishResult[];
}

export interface VideoJob {
  id: string;
  mode: VideoMode;
  prompt: string;
  referenceImageUrl?: string;
  referenceVideoUrl?: string;
  resolution: VideoResolution;
  targetPlatform: VideoExportPlatform;
  durationSeconds: number;
  fps: number;
  quantTier: VideoQuantTier;
  status: VideoJobStatus;
  createdAt: string;
  updatedAt: string;
  operatorTrace: OperatorTraceEntry[];
  viralitySignal?: ViralitySignal;
  outputArtifacts?: VideoArtifacts;
  errorLog?: VideoError[];
}

export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
}

export interface FrameMath {
  totalFrames: number;
  batchSize: number;
  interpolationFactor: number;
  outputFps: number;
}

export interface ComfyWorkflow {
  version: string;
  modelTag: string;
  nodeGraph: Record<string, ComfyNode>;
  ramBudgetMb: number;
  frameMath: FrameMath;
}

export type PublishStatus =
  | "published"
  | "scheduled"
  | "pending_review"
  | "failed";

export type PublishApprovalState =
  | "not_required"
  | "pending_review"
  | "approved"
  | "rejected";

export type PublishDeliveryMode =
  | "direct_api"
  | "studio_export"
  | "manual_handoff";

export interface PublishResult {
  publishId: string;
  platform: VideoExportPlatform;
  status: PublishStatus;
  platformUrl?: string;
  scheduledAt?: string;
  publishedAt?: string;
  requestedAt: string;
  updatedAt: string;
  requiresApproval: boolean;
  approvalState: PublishApprovalState;
  deliveryMode?: PublishDeliveryMode;
  accountLabel?: string;
  failureReason?: string;
}

export interface VideoPublisher {
  platform: VideoExportPlatform;
  publish(job: VideoJob, artifacts: VideoArtifacts): Promise<PublishResult>;
  schedule(
    job: VideoJob,
    artifacts: VideoArtifacts,
    scheduledAt: string,
  ): Promise<PublishResult>;
  getStatus(publishId: string): Promise<PublishStatus>;
}

export interface VideoJobEventData {
  jobId: string;
  correlationId: string;
  status: VideoJobStatus;
  degradeMode: VideoDegradeMode;
  progress: number;
  timestamp: string;
  stage?: string;
  message?: string;
  error?: string;
  operatorTag?: string;
  estimatedRemainingSec?: number;
}

export interface VideoHealthEventData {
  timestamp: string;
  ollamaReachable: boolean;
  comfyuiReachable: boolean;
  pressureLevel: string;
  renderCapable: boolean;
}
