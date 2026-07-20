import { randomUUID } from "node:crypto";
import type {
  CapabilityRequirement,
  CreativeFactoryExecutionMode,
  CreativeFactoryProfile,
} from "@swarmx/types/video-types";
import { appendStateEvent, readSnapshot, writeSnapshot } from "./local-state-store.js";

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
export type WorkflowStageStatus = "pending" | "running" | "checkpointed" | "complete" | "failed" | "skipped";

export interface WorkflowStageDefinition {
  stage: CreativeFactoryStage;
  requiredFor: CreativeFactoryExecutionMode[];
  prerequisites: CreativeFactoryStage[];
  retryable: boolean;
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

const STAGE_DEFINITIONS: WorkflowStageDefinition[] = CREATIVE_FACTORY_STAGE_ORDER.map((stage, index) => {
  const prerequisites = index === 0 ? [] : [CREATIVE_FACTORY_STAGE_ORDER[index - 1]!];
  const publishOnly = [
    "PUBLISH_OR_EXPORT",
    "REMOTE_PROCESSING_VERIFY",
    "ANALYTICS_INGEST",
    "LEARNING_UPDATE",
  ].includes(stage);
  return {
    stage,
    requiredFor: requiredModesFor(stage),
    prerequisites,
    retryable: stage !== "PUBLISH_OR_EXPORT" && stage !== "REMOTE_PROCESSING_VERIFY",
    humanApprovalRequired: stage === "HUMAN_REVIEW" || publishOnly,
  };
});

const runs = new Map<string, CreativeFactoryWorkflowRun>();
let hydrated = false;

function now(): string {
  return new Date().toISOString();
}

function requiredModesFor(stage: CreativeFactoryStage): CreativeFactoryExecutionMode[] {
  const index = CREATIVE_FACTORY_STAGE_ORDER.indexOf(stage);
  if (index <= CREATIVE_FACTORY_STAGE_ORDER.indexOf("EPISODE_SCRIPT_VALIDATE")) {
    return ["PLAN_ONLY", "PRODUCTION_PACK", "FULL_RENDER", "PUBLISH_BUNDLE", "PUBLISH_AND_LEARN"];
  }
  if (index <= CREATIVE_FACTORY_STAGE_ORDER.indexOf("ASSET_PLAN")) {
    return ["PRODUCTION_PACK", "FULL_RENDER", "PUBLISH_BUNDLE", "PUBLISH_AND_LEARN"];
  }
  if (index <= CREATIVE_FACTORY_STAGE_ORDER.indexOf("HUMAN_REVIEW")) {
    return ["FULL_RENDER", "PUBLISH_BUNDLE", "PUBLISH_AND_LEARN"];
  }
  if (index <= CREATIVE_FACTORY_STAGE_ORDER.indexOf("PUBLISH_OR_EXPORT")) {
    return ["PUBLISH_BUNDLE", "PUBLISH_AND_LEARN"];
  }
  return ["PUBLISH_AND_LEARN"];
}

function persist(event: string, run: CreativeFactoryWorkflowRun): void {
  appendStateEvent("creative-workflow-runs", event, run);
  writeSnapshot("creative-workflow-runs", [...runs.values()]);
}

export function workflowDefinitions(): WorkflowStageDefinition[] {
  return STAGE_DEFINITIONS;
}

export function createWorkflowRun(input: {
  mode: CreativeFactoryExecutionMode;
  profile: CreativeFactoryProfile;
  idempotencyKey: string;
  capabilityRequirements?: CapabilityRequirement[];
}): CreativeFactoryWorkflowRun {
  hydrateWorkflowRunsFromDisk();
  const existing = [...runs.values()].find(
    (run) => run.idempotencyKey === input.idempotencyKey && !["complete", "failed", "cancelled"].includes(run.status),
  );
  if (existing) return existing;

  const createdAt = now();
  const run: CreativeFactoryWorkflowRun = {
    id: randomUUID(),
    schemaVersion: 1,
    mode: input.mode,
    profile: input.profile,
    status: "queued",
    idempotencyKey: input.idempotencyKey,
    capabilityRequirements: input.capabilityRequirements ?? [],
    checkpoints: {},
    createdAt,
    updatedAt: createdAt,
  };
  runs.set(run.id, run);
  persist("create", run);
  return run;
}

export function checkpointWorkflowStage(
  runId: string,
  checkpoint: Omit<WorkflowCheckpoint, "updatedAt">,
): CreativeFactoryWorkflowRun | undefined {
  hydrateWorkflowRunsFromDisk();
  const run = runs.get(runId);
  if (!run) return undefined;
  const updated: CreativeFactoryWorkflowRun = {
    ...run,
    status: checkpoint.status === "failed" ? "failed" : checkpoint.status === "complete" ? "running" : run.status,
    checkpoints: {
      ...run.checkpoints,
      [checkpoint.stage]: { ...checkpoint, updatedAt: now() },
    },
    updatedAt: now(),
  };
  runs.set(runId, updated);
  persist("checkpoint", updated);
  return updated;
}

export function hydrateWorkflowRunsFromDisk(): number {
  if (hydrated) return runs.size;
  for (const run of readSnapshot<CreativeFactoryWorkflowRun>("creative-workflow-runs")) {
    if (!run?.id || run.schemaVersion !== 1 || !run.idempotencyKey) continue;
    runs.set(run.id, run);
  }
  hydrated = true;
  return runs.size;
}

export function _clearWorkflowRunsForTesting(): void {
  runs.clear();
  hydrated = false;
}
