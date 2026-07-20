import { randomUUID } from "node:crypto";
import type {
  CapabilityRequirement,
  CreativeFactoryStage,
  CreativeFactoryExecutionMode,
  CreativeFactoryProfile,
  CreativeFactoryWorkflowRun,
  WorkflowCheckpoint,
  WorkflowStageDefinition,
  WorkflowStageStatus,
} from "@swarmx/types/video-types";
import { appendStateEvent, readSnapshot, writeSnapshot } from "./local-state-store.js";
import { normalizeRuntimeProfileId } from "./runtime-profiles.js";

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
    timeoutMs: timeoutFor(stage),
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

function timeoutFor(stage: CreativeFactoryStage): number {
  if (["ASSET_GENERATE_OR_IMPORT", "VOICE_GENERATE", "COMPOSE"].includes(stage)) {
    return 15 * 60 * 1000;
  }
  if (["PUBLISH_OR_EXPORT", "REMOTE_PROCESSING_VERIFY", "ANALYTICS_INGEST"].includes(stage)) {
    return 5 * 60 * 1000;
  }
  return 2 * 60 * 1000;
}

function persist(event: string, run: CreativeFactoryWorkflowRun): void {
  appendStateEvent("creative-workflow-runs", event, run);
  writeSnapshot("creative-workflow-runs", [...runs.values()]);
}

export function workflowDefinitions(): WorkflowStageDefinition[] {
  return STAGE_DEFINITIONS;
}

export function listWorkflowRuns(): CreativeFactoryWorkflowRun[] {
  hydrateWorkflowRunsFromDisk();
  return [...runs.values()].sort(
    (left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt),
  );
}

export function getWorkflowRun(id: string): CreativeFactoryWorkflowRun | undefined {
  hydrateWorkflowRunsFromDisk();
  return runs.get(id);
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
  const normalizedProfile = normalizeRuntimeProfileId(input.profile);
  const run: CreativeFactoryWorkflowRun = {
    id: randomUUID(),
    schemaVersion: 1,
    mode: input.mode,
    profile: normalizedProfile === "auto" ? "constrained_cpu_8gb" : normalizedProfile,
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
  const definition = STAGE_DEFINITIONS.find((item) => item.stage === checkpoint.stage);
  if (!definition) return undefined;
  const missingPrerequisite = definition.prerequisites.find(
    (stage) => run.checkpoints[stage]?.status !== "complete" && checkpoint.status === "complete",
  );
  if (missingPrerequisite) {
    const blocked: WorkflowCheckpoint = {
      stage: checkpoint.stage,
      status: "blocked",
      revision: checkpoint.revision,
      updatedAt: now(),
      errorCode: "PREREQUISITE_INCOMPLETE",
      errorMessage: `${missingPrerequisite} must complete before ${checkpoint.stage}`,
    };
    const updatedRun: CreativeFactoryWorkflowRun = {
      ...run,
      status: "blocked",
      checkpoints: { ...run.checkpoints, [checkpoint.stage]: blocked },
      updatedAt: now(),
    };
    runs.set(runId, updatedRun);
    persist("checkpoint_blocked", updatedRun);
    return updatedRun;
  }

  const terminalStage = lastRequiredStage(run.mode);
  const nextStatus = checkpoint.status === "failed"
    ? "failed"
    : checkpoint.status === "blocked"
      ? "blocked"
      : checkpoint.status === "complete" && checkpoint.stage === terminalStage
        ? "complete"
        : "running";
  const updated: CreativeFactoryWorkflowRun = {
    ...run,
    status: nextStatus,
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

function lastRequiredStage(mode: CreativeFactoryExecutionMode): CreativeFactoryStage {
  const required = STAGE_DEFINITIONS.filter((item) => item.requiredFor.includes(mode));
  return required[required.length - 1]?.stage ?? "LEARNING_UPDATE";
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
