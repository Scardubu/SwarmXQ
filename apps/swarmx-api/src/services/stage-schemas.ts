import { z } from "zod";
import type { VideoJobStage } from "../types/video.js";
import type { StageValidationEntry } from "../types/video.js";

export const PlanningResultSchema = z.object({
  plan: z.array(z.string().trim().min(3).max(240)).min(1).max(12),
});

export const ScriptingResultSchema = z.object({
  scriptText: z.string().trim().min(20).max(4000),
});

export const StoryboardResultSchema = z.object({
  frames: z.array(z.string().trim().min(3).max(240)).min(1).max(20),
});

export type PlanningResult = z.infer<typeof PlanningResultSchema>;
export type ScriptingResult = z.infer<typeof ScriptingResultSchema>;
export type StoryboardResult = z.infer<typeof StoryboardResultSchema>;

export type ValidatedStage = "planning" | "scripting" | "storyboard_generation";

export type StageResultFor<S extends ValidatedStage> =
  S extends "planning" ? PlanningResult :
  S extends "scripting" ? ScriptingResult :
  StoryboardResult;

export interface StageValidationOutcome<S extends ValidatedStage> {
  entry: StageValidationEntry;
  data: StageResultFor<S> | null;
}

const STAGE_SCHEMAS = {
  planning: PlanningResultSchema,
  scripting: ScriptingResultSchema,
  storyboard_generation: StoryboardResultSchema,
} as const;

export function validateStageResult<S extends ValidatedStage>(
  stage: S,
  candidate: unknown,
): StageValidationOutcome<S> {
  const schema = STAGE_SCHEMAS[stage];
  const parsed = schema.safeParse(candidate);
  if (parsed.success) {
    return {
      entry: { schemaVersion: 1, stage: stage as VideoJobStage, passed: true },
      data: parsed.data as StageResultFor<S>,
    };
  }
  const issues = parsed.error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
  return {
    entry: { schemaVersion: 1, stage: stage as VideoJobStage, passed: false, issues },
    data: null,
  };
}
