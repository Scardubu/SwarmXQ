import type {
  OperatorTraceEntry,
  PublishResult,
  CertificationTier,
  MediaQualityReport,
  RendererCapabilityTier,
  VideoArtifacts,
  VideoError,
  VideoExportPlatform,
  VideoJobStatus as CanonicalVideoJobStatus,
  ViralitySignal,
  VoiceArtifact,
  VideoTone,
} from "@swarmx/types/video-types";
import type { SeriesEpisodeContext } from "@swarmx/types/series-types";

export type VideoJobStatus = CanonicalVideoJobStatus | "running" | "completed";

export const VIDEO_TERMINAL_STATUSES = [
  "done",
  "completed",
  "failed",
  "cancelled",
] as const;

export function isTerminalVideoStatus(status: VideoJobStatus): boolean {
  return VIDEO_TERMINAL_STATUSES.includes(status as (typeof VIDEO_TERMINAL_STATUSES)[number]);
}

export function isIsoTimestampNewerOrEqual(incoming: string, current: string): boolean {
  const incomingMs = Date.parse(incoming);
  const currentMs = Date.parse(current);
  if (Number.isNaN(incomingMs) || Number.isNaN(currentMs)) {
    return true;
  }
  return incomingMs >= currentMs;
}

export type VideoJobStage =
  | "intent_classification"
  | "planning"
  | "scripting"
  | "storyboard_generation"
  | "render_assembly"
  | "finalizing";

export const VIDEO_JOB_STAGE_ORDER: VideoJobStage[] = [
  "intent_classification",
  "planning",
  "scripting",
  "storyboard_generation",
  "render_assembly",
  "finalizing",
];

export const VIDEO_JOB_STAGE_LABELS: Record<VideoJobStage, string> = {
  intent_classification: "Intent Classification",
  planning: "Planning",
  scripting: "Scripting",
  storyboard_generation: "Storyboard Generation",
  render_assembly: "Render & Assembly",
  finalizing: "Finalizing",
};

export interface VideoJobRequest {
  prompt: string;
  platform?: VideoExportPlatform | "youtube_shorts";
  niche?: "motivational" | "finance" | "facts" | "true_crime" | "tech" | "other";
  targetDurationSeconds?: number;
  modelTier?: "fast" | "worker" | "supervisor" | "reasoner";
  audience?: string;
  tone?: VideoTone;
  style?: "faceless_broll" | "kinetic_text" | "storytime" | "tutorial" | "myth_busting";
  captionStyle?: "bold_center" | "lower_third" | "minimal";
  voice?: "default" | "calm" | "energetic" | "narrator";
  clientRequestId?: string;
  seriesId?: string;
  episodeNumber?: number;
  totalEpisodes?: number;
  seriesContext?: SeriesEpisodeContext;
}

export interface VideoStageProgress {
  stage: VideoJobStage;
  stageProgress: number;
  overallProgress: number;
  message?: string;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
}

export interface VideoOutputMetadata {
  relativePath: string;
  absolutePath: string;
  publicUrl: string;
  fileSizeBytes: number;
  durationSeconds: number;
  widthPx: number;
  heightPx: number;
  fps: number;
  format: "mp4" | "webm";
  checksum: string;
  generatedAt: string;
  scriptText?: string;
  storyboardFrames?: string[];
  modelsUsed: Partial<Record<VideoJobStage, string>>;
  rendererTier?: RendererCapabilityTier;
  certificationTier?: CertificationTier;
  voiceArtifact?: VoiceArtifact;
  mediaQualityReport?: MediaQualityReport;
  productionPackageDir?: string;
  renderManifestPath?: string;
  transcriptPath?: string;
  srtPath?: string;
  vttPath?: string;
  rightsManifestPath?: string;
  platformPackagePath?: string;
}

export interface VideoJobError {
  code: string;
  message: string;
  stage?: VideoJobStage;
  retryable: boolean;
  details?: Record<string, unknown>;
}

export interface VideoJob {
  id: string;
  status: VideoJobStatus;
  request: VideoJobRequest;
  stages: Partial<Record<VideoJobStage, VideoStageProgress>>;
  currentStage?: VideoJobStage;
  overallProgress: number;
  output?: VideoOutputMetadata;
  error?: VideoJobError;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  retryCount: number;
  resumeFromStage?: VideoJobStage;
  pressureTierAtStart?: "normal" | "high" | "critical";
  clientRequestId?: string;
  operatorTrace?: OperatorTraceEntry[];
  viralitySignal?: ViralitySignal;
  outputArtifacts?: VideoArtifacts;
  publishHistory?: PublishResult[];
  errorLog?: VideoError[];
}

type RawVideoStageProgress = Partial<VideoStageProgress> & {
  stage?: string;
};

type RawVideoOutputMetadata = Partial<VideoOutputMetadata> & {
  modelsUsed?: Partial<Record<string, string>>;
};

type RawVideoJob = Partial<Omit<VideoJob, "id" | "request" | "stages" | "output">> & {
  id: string;
  request?: Partial<VideoJobRequest>;
  stages?: Partial<Record<string, RawVideoStageProgress>>;
  output?: RawVideoOutputMetadata;
};

const VIDEO_JOB_STATUSES = new Set<VideoJobStatus>([
  "queued",
  "classifying",
  "scripting",
  "staging",
  "generating",
  "interpolating",
  "encoding",
  "reviewing",
  "publishing",
  "done",
  "running",
  "completed",
  "failed",
  "cancelled",
]);

function clampProgress(value: unknown): number {
  if (typeof value !== "number" || Number.isNaN(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(value)));
}

function isVideoJobStage(value: string): value is VideoJobStage {
  return value in VIDEO_JOB_STAGE_LABELS;
}

function normalizeStatus(status: unknown): VideoJobStatus {
  if (typeof status === "string" && VIDEO_JOB_STATUSES.has(status as VideoJobStatus)) {
    return status as VideoJobStatus;
  }
  return "queued";
}

function normalizeRequest(request: RawVideoJob["request"]): VideoJobRequest {
  return {
    prompt: request?.prompt ?? "",
    ...(request?.platform ? { platform: request.platform } : {}),
    ...(request?.niche ? { niche: request.niche } : {}),
    ...(request?.targetDurationSeconds !== undefined
      ? { targetDurationSeconds: request.targetDurationSeconds }
      : {}),
    ...(request?.modelTier ? { modelTier: request.modelTier } : {}),
    ...(request?.clientRequestId ? { clientRequestId: request.clientRequestId } : {}),
  };
}

function normalizeStageProgress(
  stage: VideoJobStage,
  progress: RawVideoStageProgress | undefined,
  overallProgress: number,
): VideoStageProgress {
  return {
    stage,
    stageProgress: clampProgress(progress?.stageProgress),
    overallProgress: clampProgress(progress?.overallProgress ?? overallProgress),
    ...(progress?.message ? { message: progress.message } : {}),
    ...(progress?.startedAt ? { startedAt: progress.startedAt } : {}),
    ...(progress?.completedAt ? { completedAt: progress.completedAt } : {}),
    ...(progress?.durationMs !== undefined ? { durationMs: progress.durationMs } : {}),
  };
}

function normalizeStages(
  rawStages: RawVideoJob["stages"],
  overallProgress: number,
): Partial<Record<VideoJobStage, VideoStageProgress>> {
  const next: Partial<Record<VideoJobStage, VideoStageProgress>> = {};

  for (const [stageKey, progress] of Object.entries(rawStages ?? {})) {
    if (!isVideoJobStage(stageKey)) {
      continue;
    }
    next[stageKey] = normalizeStageProgress(stageKey, progress, overallProgress);
  }

  return next;
}

function normalizeOutput(
  output: RawVideoOutputMetadata | undefined,
  updatedAt: string,
): VideoOutputMetadata | undefined {
  if (!output) {
    return undefined;
  }

  const modelsUsed: Partial<Record<VideoJobStage, string>> = {};
  for (const [stageKey, tag] of Object.entries(output.modelsUsed ?? {})) {
    if (isVideoJobStage(stageKey) && typeof tag === "string") {
      modelsUsed[stageKey] = tag;
    }
  }

  return {
    relativePath: output.relativePath ?? "",
    absolutePath: output.absolutePath ?? "",
    publicUrl: output.publicUrl ?? "",
    fileSizeBytes: output.fileSizeBytes ?? 0,
    durationSeconds: output.durationSeconds ?? 0,
    widthPx: output.widthPx ?? 0,
    heightPx: output.heightPx ?? 0,
    fps: output.fps ?? 0,
    format: output.format === "webm" ? "webm" : "mp4",
    checksum: output.checksum ?? "",
    generatedAt: output.generatedAt ?? updatedAt,
    modelsUsed,
    ...(output.scriptText ? { scriptText: output.scriptText } : {}),
    ...(output.storyboardFrames ? { storyboardFrames: output.storyboardFrames } : {}),
    ...(output.rendererTier ? { rendererTier: output.rendererTier } : {}),
    ...(output.certificationTier ? { certificationTier: output.certificationTier } : {}),
    ...(output.voiceArtifact ? { voiceArtifact: output.voiceArtifact } : {}),
    ...(output.mediaQualityReport ? { mediaQualityReport: output.mediaQualityReport } : {}),
    ...(output.productionPackageDir ? { productionPackageDir: output.productionPackageDir } : {}),
    ...(output.renderManifestPath ? { renderManifestPath: output.renderManifestPath } : {}),
    ...(output.transcriptPath ? { transcriptPath: output.transcriptPath } : {}),
    ...(output.srtPath ? { srtPath: output.srtPath } : {}),
    ...(output.vttPath ? { vttPath: output.vttPath } : {}),
    ...(output.rightsManifestPath ? { rightsManifestPath: output.rightsManifestPath } : {}),
    ...(output.platformPackagePath ? { platformPackagePath: output.platformPackagePath } : {}),
  };
}

function deriveOverallProgress(
  raw: RawVideoJob,
  status: VideoJobStatus,
  normalizedStages: Partial<Record<VideoJobStage, VideoStageProgress>>,
): number {
  if (raw.overallProgress !== undefined) {
    return clampProgress(raw.overallProgress);
  }
  if (status === "done" || status === "completed") {
    return 100;
  }

  const stageValues = Object.values(normalizedStages).map((entry) => entry?.stageProgress ?? 0);
  if (stageValues.length === 0) {
    return 0;
  }
  return Math.max(...stageValues);
}

function normalizeCurrentStage(currentStage: unknown): VideoJobStage | undefined {
  if (typeof currentStage === "string" && isVideoJobStage(currentStage)) {
    return currentStage;
  }
  return undefined;
}

function normalizeError(error: RawVideoJob["error"]): VideoJobError | undefined {
  if (!error) {
    return undefined;
  }

  return {
    code: error.code ?? "UNKNOWN",
    message: error.message ?? "Unknown video job error",
    retryable: error.retryable ?? false,
    ...(error.stage ? { stage: error.stage } : {}),
    ...(error.details ? { details: error.details } : {}),
  };
}

export function normalizeVideoJob(raw: RawVideoJob): VideoJob {
  const status = normalizeStatus(raw.status);
  const provisionalProgress = clampProgress(raw.overallProgress);
  const stages = normalizeStages(raw.stages, provisionalProgress);
  const overallProgress = deriveOverallProgress(raw, status, stages);
  const updatedAt = raw.updatedAt ?? raw.createdAt ?? new Date().toISOString();
  const publishHistory = raw.publishHistory ?? raw.outputArtifacts?.publishHistory;
  const currentStage = normalizeCurrentStage(raw.currentStage);
  const output = normalizeOutput(raw.output, updatedAt);
  const error = normalizeError(raw.error);

  return {
    id: raw.id,
    status,
    request: normalizeRequest(raw.request),
    stages,
    overallProgress,
    createdAt: raw.createdAt ?? updatedAt,
    updatedAt,
    retryCount: raw.retryCount ?? 0,
    ...(currentStage ? { currentStage } : {}),
    ...(output ? { output } : {}),
    ...(error ? { error } : {}),
    ...(raw.startedAt ? { startedAt: raw.startedAt } : {}),
    ...(raw.completedAt ? { completedAt: raw.completedAt } : {}),
    ...(raw.resumeFromStage ? { resumeFromStage: raw.resumeFromStage } : {}),
    ...(raw.pressureTierAtStart ? { pressureTierAtStart: raw.pressureTierAtStart } : {}),
    ...(raw.clientRequestId ? { clientRequestId: raw.clientRequestId } : {}),
    ...(raw.operatorTrace ? { operatorTrace: raw.operatorTrace } : {}),
    ...(raw.viralitySignal ? { viralitySignal: raw.viralitySignal } : {}),
    ...(raw.outputArtifacts ? { outputArtifacts: raw.outputArtifacts } : {}),
    ...(publishHistory ? { publishHistory } : {}),
    ...(raw.errorLog ? { errorLog: raw.errorLog } : {}),
  };
}

export function normalizeVideoJobs(rawJobs: RawVideoJob[]): VideoJob[] {
  return rawJobs.map((job) => normalizeVideoJob(job));
}

export function getVideoPublishPlatform(job: Pick<VideoJob, "request">): VideoExportPlatform {
  return job.request.platform === "youtube_shorts"
    ? "shorts"
    : job.request.platform ?? "generic";
}

export function errorCodeHint(code: string): string {
  switch (code) {
    case "RENDER_FAILED":             return "Render assembly stage failed. Check ffmpeg logs.";
    case "TIMEOUT":                   return "Pipeline exceeded the allowed time limit.";
    case "OLLAMA_UNAVAILABLE":        return "Ollama is not reachable. Ensure it is running on port 11434.";
    case "SCRIPTING_FAILED":          return "Script generation failed. Check Ollama model availability.";
    case "STORYBOARD_FAILED":         return "Storyboard generation failed. Check model state.";
    case "FFMPEG_UNAVAILABLE":        return "ffmpeg not found. Install with: sudo apt install ffmpeg";
    case "FFPROBE_UNAVAILABLE":       return "ffprobe not found. Install with: sudo apt install ffmpeg";
    case "ESPEAK_UNAVAILABLE":        return "espeak-ng not found. Install with: sudo apt install espeak-ng";
    case "ARTIFACT_MISSING":
    case "ARTIFACT_EMPTY":
    case "ARTIFACT_INVALID":          return "A required output file is missing or corrupt. Resubmit the job.";
    case "FRAME_BUDGET_EXCEEDED":     return "Frame count exceeded the per-job budget. Reduce target duration.";
    case "PRESSURE_CRITICAL":         return "System memory was critically low at failure time. Free RAM and retry.";
    case "INTENT_VALIDATION_FAILED":  return "Prompt could not be classified. Try rephrasing it.";
    case "CANCELLED_BY_USER":         return "Job was cancelled before completion.";
    default:                          return "An unexpected error stopped the pipeline. Check operator trace.";
  }
}
