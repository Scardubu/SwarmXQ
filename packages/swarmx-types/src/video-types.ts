// ============================================================================
// SwarmX VIDEO-ALPHA Canonical Video Types
// Shared between API and dashboard. This file is the source of truth for
// video pipeline, virality, workflow, and publishing contracts.
// ============================================================================

export type VideoMode = "t2v" | "i2v" | "v2v" | "edit";

export type VideoTone =
  | "educational"
  | "urgent"
  | "warm"
  | "contrarian"
  | "cinematic"
  | "minimal"
  | "faceless_broll"
  | "kinetic_text";

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

export type CreativeFactoryExecutionMode =
  | "PLAN_ONLY"
  | "PRODUCTION_PACK"
  | "FULL_RENDER"
  | "PUBLISH_BUNDLE"
  | "PUBLISH_AND_LEARN";

export type CreativeFactoryProfile =
  | "constrained_cpu"
  | "standard_cpu"
  | "accelerated_optional";

export type EpisodeLifecycleState =
  | "DRAFT"
  | "PLAN_READY"
  | "PRODUCTION_PACK_READY"
  | "RENDERED"
  | "QC_FAILED"
  | "REVIEW_REQUIRED"
  | "READY_TO_POST"
  | "PUBLISHING"
  | "PUBLISHED"
  | "LEARNING_REVIEW";

export type CapabilityState = "available" | "degraded" | "unavailable";

export interface CapabilityRequirement {
  capability: string;
  requiredFor: CreativeFactoryExecutionMode[];
  state: CapabilityState;
  reason?: string;
  action?: string;
}

export interface BrandKit {
  id: string;
  schemaVersion: 1;
  name: string;
  voicePrinciples: string[];
  colorTokens: Record<string, string>;
  typographyTokens: Record<string, string>;
  visualMotifs: string[];
  forbiddenClaims: string[];
  createdAt: string;
  updatedAt: string;
}

export interface AudiencePersona {
  id: string;
  schemaVersion: 1;
  label: string;
  description: string;
  pains: string[];
  desiredOutcomes: string[];
  platformHabits: Partial<Record<VideoExportPlatform, string>>;
  languageLocale: string;
  createdAt: string;
  updatedAt: string;
}

export interface PlatformCapability {
  platform: VideoExportPlatform;
  specVersion: string;
  verifiedAt: string;
  maxDurationSeconds: number;
  aspectRatios: string[];
  supportedContainers: string[];
  supportsDraftUpload: boolean;
  supportsDirectPublish: boolean;
  requiresAiDisclosure: boolean;
  notes?: string[];
}

export type AssetSourceKind = "generated" | "imported" | "template" | "recorded";
export type AssetLicenseState = "approved" | "needs_review" | "rejected" | "unknown";

export interface AssetLicense {
  state: AssetLicenseState;
  sourceName?: string;
  sourceUrl?: string;
  allowedUses: string[];
  attribution?: string;
  expiresAt?: string;
}

export interface AssetLineage {
  sourceKind: AssetSourceKind;
  modelTag?: string;
  promptHash?: string;
  parentAssetIds: string[];
  generatedAt?: string;
}

export interface AssetRecord {
  id: string;
  schemaVersion: 1;
  path: string;
  mediaType: "image" | "video" | "audio" | "subtitle" | "document";
  sha256: string;
  license: AssetLicense;
  lineage: AssetLineage;
  createdAt: string;
  updatedAt: string;
}

export interface RenderRecipe {
  id: string;
  schemaVersion: 1;
  profile: CreativeFactoryProfile;
  widthPx: number;
  heightPx: number;
  fps: number;
  durationSeconds: number;
  audioCodec: "aac";
  videoCodec: "h264";
  templateId: string;
  assetIds: string[];
  createdAt: string;
}

export interface SubtitleTrack {
  id: string;
  schemaVersion: 1;
  locale: string;
  format: "srt" | "vtt";
  path: string;
  confidence: number;
  manualReviewState: "not_required" | "required" | "approved";
  safeZonePassed: boolean;
}

export interface QualityReport {
  id: string;
  schemaVersion: 1;
  passed: boolean;
  technicalPassed: boolean;
  creativePassed: boolean;
  accessibilityPassed: boolean;
  rightsPassed: boolean;
  compliancePassed: boolean;
  checks: Array<{ code: string; passed: boolean; message: string }>;
  createdAt: string;
}

export interface ComplianceReport {
  id: string;
  schemaVersion: 1;
  aiDisclosureRequired: boolean;
  aiDisclosureText?: string;
  rightsState: AssetLicenseState;
  contentSafetyState: "approved" | "needs_review" | "rejected";
  publishAllowed: boolean;
  blockers: string[];
  createdAt: string;
}

export interface PublishPackage {
  id: string;
  schemaVersion: 1;
  platform: VideoExportPlatform;
  lifecycleState: EpisodeLifecycleState;
  mediaPath: string;
  title: string;
  description: string;
  caption: CaptionDraft;
  thumbnailPath?: string;
  pinnedComment?: string;
  capability: PlatformCapability;
  complianceReportId: string;
  createdAt: string;
  updatedAt: string;
}

export interface PerformanceSnapshot {
  id: string;
  schemaVersion: 1;
  packageId: string;
  platform: VideoExportPlatform;
  observedAt: string;
  views?: number;
  likes?: number;
  shares?: number;
  comments?: number;
  completionRate?: number;
  averageWatchSeconds?: number;
}

export interface ExperimentRecord {
  id: string;
  schemaVersion: 1;
  name: string;
  hypothesis: string;
  variantPackageIds: string[];
  status: "draft" | "running" | "complete" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface LearningRecord {
  id: string;
  schemaVersion: 1;
  sourceExperimentId?: string;
  sourcePackageId?: string;
  recommendation: string;
  evidence: string;
  approvalState: "pending" | "approved" | "rejected";
  createdAt: string;
}

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
  stage: VideoJobStatus | VideoPipelineStage | string;
  operatorTag?: string;
  operator: string;
  startedAt?: string;
  completedAt?: string;
  latencyMs?: number;
  tokenCount?: number;
  success?: boolean;
  errorMsg?: string;
  // Compatibility bridge fields for existing API/dashboard consumers.
  modelTag?: string;
  timestamp?: string;
}

export interface VideoPerformanceMetrics {
  jobId: string;
  platform: VideoExportPlatform;
  publishedAt: string;
  viewCount?: number;
  completionRate?: number;
  shareCount?: number;
  likeCount?: number;
  viralityAtPublish: ViralitySignal;
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
  resumeFromStage?: VideoJobStatus;
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
