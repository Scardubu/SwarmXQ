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

export type RuntimeProfileId =
  | "constrained_cpu_8gb"
  | "standard_cpu_16gb"
  | "accelerated_optional";

export type LegacyCreativeFactoryProfile =
  | "constrained_cpu"
  | "standard_cpu";

export type CreativeFactoryProfile = RuntimeProfileId | LegacyCreativeFactoryProfile;

export type CertificationTier =
  | "RENDER_FAILED"
  | "TECHNICALLY_VALID"
  | "CREATIVE_REVIEW_REQUIRED"
  | "PRODUCTION_PACK_VALID"
  | "READY_TO_POST"
  | "PUBLISHED_VERIFIED";

export type RendererCapabilityTier =
  | "ffmpeg_text_smoke"
  | "ffmpeg_kinetic_text"
  | "ffmpeg_faceless_broll"
  | "ffmpeg_cinematic_explainer"
  | "optional_adapter";

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

export interface DurableRecordBase {
  id: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
  state: string;
  revision: number;
  parentLineage: string[];
  configurationSnapshot: Record<string, unknown>;
  source: "user" | "system" | "provider";
  idempotencyKey?: string;
}

export interface CapabilityRequirement {
  capability: string;
  requiredFor: CreativeFactoryExecutionMode[];
  state: CapabilityState;
  reason?: string;
  action?: string;
}

export interface Workspace extends DurableRecordBase {
  state: "active" | "archived";
  name: string;
}

export interface Project extends DurableRecordBase {
  state: "draft" | "active" | "archived";
  workspaceId: string;
  name: string;
  brandKitId?: string;
  audiencePersonaId?: string;
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
  revision?: number;
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
  revision?: number;
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

export interface VideoBlueprint {
  id: string;
  schemaVersion: 1;
  name: string;
  mode: CreativeFactoryExecutionMode;
  profile: CreativeFactoryProfile;
  platform: VideoExportPlatform;
  aspectRatio: "9:16" | "1:1" | "16:9";
  durationSeconds: number;
  templateId: string;
  captionStyle: "bold_center" | "lower_third" | "minimal";
  rendererTier?: RendererCapabilityTier;
  certificationEligible?: boolean;
  maxStaticIntervalSeconds?: number;
  minVisualEventsPerMinute?: number;
  safeZones?: {
    topPct: number;
    bottomPct: number;
    sidePct: number;
  };
  requiredAssetKinds?: AssetSourceKind[];
  audioProfileId?: string;
  requiredCapabilityIds: string[];
  createdAt: string;
  updatedAt: string;
}

export const CREATIVE_FACTORY_STAGE_ORDER = [
  "INTAKE_VALIDATE",
  "BRAND_AUDIENCE_RESOLVE",
  "PLATFORM_CAPABILITIES_RESOLVE",
  "TREND_RESEARCH",
  "CONCEPT_GENERATE",
  "CONCEPT_TOURNAMENT",
  "SERIES_PLAN",
  "SERIES_PLAN_VALIDATE",
  "EPISODE_SCRIPT",
  "EPISODE_SCRIPT_VALIDATE",
  "STORYBOARD",
  "ASSET_PLAN",
  "ASSET_GENERATE_OR_IMPORT",
  "ASSET_VALIDATE",
  "VOICE_GENERATE",
  "AUDIO_DESIGN",
  "COMPOSE",
  "SUBTITLE_ALIGN",
  "TECHNICAL_QC",
  "CREATIVE_QC",
  "CONTINUITY_QC",
  "COMPLIANCE_QC",
  "REVISION",
  "HUMAN_REVIEW",
  "PLATFORM_PACKAGE",
  "PUBLISH_OR_EXPORT",
  "REMOTE_PROCESSING_VERIFY",
  "ANALYTICS_INGEST",
  "LEARNING_UPDATE",
] as const;

export type CreativeFactoryStage = (typeof CREATIVE_FACTORY_STAGE_ORDER)[number];

export type WorkflowStageStatus =
  | "pending"
  | "running"
  | "checkpointed"
  | "complete"
  | "failed"
  | "skipped"
  | "blocked";

export interface WorkflowStageDefinition {
  stage: CreativeFactoryStage;
  requiredFor: CreativeFactoryExecutionMode[];
  prerequisites: CreativeFactoryStage[];
  retryable: boolean;
  timeoutMs: number;
  humanApprovalRequired: boolean;
}

export interface WorkflowCheckpoint {
  stage: CreativeFactoryStage;
  status: WorkflowStageStatus;
  revision: number;
  updatedAt: string;
  outputRef?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface CreativeFactoryWorkflowRun {
  id: string;
  schemaVersion: 1;
  mode: CreativeFactoryExecutionMode;
  profile: CreativeFactoryProfile;
  status: "queued" | "running" | "blocked" | "complete" | "failed" | "cancelled";
  idempotencyKey: string;
  capabilityRequirements: CapabilityRequirement[];
  checkpoints: Partial<Record<CreativeFactoryStage, WorkflowCheckpoint>>;
  createdAt: string;
  updatedAt: string;
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
  rendererTier?: RendererCapabilityTier;
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

export type VoiceQualityTier = "neural_local" | "synthetic_fallback" | "silent_fixture";
export type VoiceProviderState = "available" | "degraded" | "unavailable";

export interface VoiceCapability {
  providerId: string;
  state: VoiceProviderState;
  qualityTier: VoiceQualityTier;
  supportsStreaming: boolean;
  supportsCancellation: boolean;
  requiresExternalDownload: boolean;
  reason?: string;
  action?: string;
  probedAt: string;
}

export interface VoiceDescriptor {
  providerId: string;
  voiceId: string;
  displayName: string;
  locale: string;
  qualityTier: VoiceQualityTier;
  license: AssetLicense;
  consentRequired: boolean;
}

export interface VoiceSynthesisRequest {
  jobId: string;
  text: string;
  locale: string;
  voiceId: string;
  speakingRate?: number;
  sentencePauseMs?: number;
  requestedSampleRateHz: number;
}

export interface VoiceArtifact {
  providerId: string;
  providerVersion?: string;
  voiceId: string;
  displayName: string;
  locale: string;
  qualityTier: VoiceQualityTier;
  license: AssetLicense;
  consentRequired: boolean;
  consentState: "not_required" | "approved" | "missing";
  textHash: string;
  normalizedText: string;
  pronunciationDictionaryVersion: string;
  requestedSampleRateHz: number;
  actualSampleRateHz: number;
  channels: number;
  durationSeconds: number;
  peakDbfs?: number;
  integratedLufs?: number;
  outputPath: string;
  sha256: string;
  generationLatencyMs: number;
  peakRssMb?: number;
  fallbackReason?: string;
  lineage: AssetLineage;
}

export interface AudioProfile {
  id: string;
  sampleRateHz: number;
  channels: 1 | 2;
  targetIntegratedLufs: number;
  truePeakDbfsMax: number;
  speechCompression: "off" | "gentle";
}

export interface MediaDetectorFinding {
  detector: "ffprobe" | "ebur128" | "silencedetect" | "blackdetect" | "freezedetect" | "template";
  raw: string;
  interpretedStatus: "pass" | "review" | "fail";
  message: string;
}

export interface MediaQualityReport {
  id: string;
  schemaVersion: 1;
  certificationTier: CertificationTier;
  rendererTier: RendererCapabilityTier;
  templateId: string;
  technicalPassed: boolean;
  creativePassed: boolean;
  accessibilityPassed: boolean;
  audioPassed: boolean;
  rightsPassed: boolean;
  rawDetectorFindings: MediaDetectorFinding[];
  interpretedFindings: MediaDetectorFinding[];
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

export interface CreativeDNA {
  id: string;
  schemaVersion: 1;
  name: string;
  audiencePromise: string;
  coreEmotion: string;
  centralTension: string;
  noveltyMechanism: string;
  hookFamily: string;
  narrativeShape: string;
  visualGrammar: string;
  motionGrammar: string;
  soundSignature: string;
  captionPersonality: string;
  CTAStyle: string;
  loopMechanism: string;
  forbiddenCliches: string[];
  brandConstraints: string[];
  platformAdaptations: Partial<Record<VideoExportPlatform, string>>;
  createdAt: string;
  updatedAt: string;
}

export interface ConceptCandidate {
  id: string;
  title: string;
  premise: string;
  hookFamily: string;
  visualLanguage: string;
  emotionalArc: string;
  CTAStyle: string;
  feasibility: number;
  originality: number;
  confidence: number;
}

export interface ConceptTournament {
  id: string;
  schemaVersion: 1;
  creativeDnaId: string;
  candidates: ConceptCandidate[];
  winnerId: string;
  backupId: string;
  scoringVersion: string;
  rationale: string;
  diversityWarnings: string[];
  createdAt: string;
}

export interface VariantRecord {
  id: string;
  schemaVersion: 1;
  parentPackageId: string;
  changedVariable: "hook" | "first_frame" | "opening_motion" | "caption_first_line" | "cta" | "cover" | "duration" | "pacing" | "visual_metaphor" | "voice" | "music_intensity";
  hypothesis: string;
  targetMetric: string;
  lineage: string[];
  productionStatus: "draft" | "rendered" | "review_required" | "approved" | "blocked";
  publishingStatus: "not_requested" | "draft_handoff" | "published_verified" | "blocked";
  createdAt: string;
  updatedAt: string;
}

export interface CreativeAgentSpec {
  id: string;
  schemaVersion: 1;
  purpose: string;
  inputs: string[];
  outputs: string[];
  allowedTools: string[];
  forbiddenTools: string[];
  operatorPolicy: string;
  profileRequirements: RuntimeProfileId[];
  timeoutMs: number;
  retryPolicy: "none" | "bounded_once" | "bounded_twice";
  validation: string[];
  confidenceRequired: number;
  humanApprovalBoundary: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeBlackboardRecord {
  id: string;
  schemaVersion: 1;
  workflowRunId: string;
  agentId: string;
  artifactKind: string;
  artifactRef: string;
  evidenceRefs: string[];
  confidence: number;
  createdAt: string;
}

export interface ReadyToPostCertification {
  lifecycleState: EpisodeLifecycleState;
  certificationTier?: CertificationTier;
  passed: boolean;
  blockers: string[];
  certifiedAt: string;
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

export type ScriptQualityWarningCode =
  | "hook_blocklist"
  | "duration_bleed"
  | "visual_cue_bleed"
  | "word_count_bleed"
  | "rule_text_bleed";

export interface ScriptQualityWarning {
  code: ScriptQualityWarningCode;
  message: string;
  stage?: string;
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
  scriptQualityWarnings?: ScriptQualityWarning[];
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
