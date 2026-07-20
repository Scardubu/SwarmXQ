import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetEnvForTesting } from "../src/lib/env.js";
import {
  CREATIVE_FACTORY_STAGE_ORDER,
  _clearWorkflowRunsForTesting,
  checkpointWorkflowStage,
  createWorkflowRun,
  hydrateWorkflowRunsFromDisk,
  workflowDefinitions,
} from "../src/services/creative-factory-workflow.js";

let tempHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "swarmx-workflow-test-"));
  process.env["SWARMX_HOME"] = tempHome;
  resetEnvForTesting();
  _clearWorkflowRunsForTesting();
});

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = undefined;
  delete process.env["SWARMX_HOME"];
  resetEnvForTesting();
});

describe("creative factory workflow DAG", () => {
  test("defines the canonical directive stage order", () => {
    expect(CREATIVE_FACTORY_STAGE_ORDER[0]).toBe("INTAKE_VALIDATE");
    expect(CREATIVE_FACTORY_STAGE_ORDER.at(-1)).toBe("LEARNING_UPDATE");
    expect(CREATIVE_FACTORY_STAGE_ORDER).toHaveLength(29);
  });

  test("defines linear prerequisites and human approval stages", () => {
    const defs = workflowDefinitions();
    expect(defs.find((d) => d.stage === "SERIES_PLAN")?.prerequisites).toEqual(["CONCEPT_TOURNAMENT"]);
    expect(defs.find((d) => d.stage === "HUMAN_REVIEW")?.humanApprovalRequired).toBe(true);
    expect(defs.find((d) => d.stage === "PUBLISH_OR_EXPORT")?.retryable).toBe(false);
  });

  test("deduplicates non-terminal runs by idempotency key", () => {
    const first = createWorkflowRun({
      mode: "FULL_RENDER",
      profile: "constrained_cpu",
      idempotencyKey: "brief-001",
    });
    const second = createWorkflowRun({
      mode: "FULL_RENDER",
      profile: "constrained_cpu",
      idempotencyKey: "brief-001",
    });
    expect(second.id).toBe(first.id);
  });

  test("persists checkpoints and hydrates them after reset", () => {
    const run = createWorkflowRun({
      mode: "FULL_RENDER",
      profile: "standard_cpu",
      idempotencyKey: "brief-002",
    });
    checkpointWorkflowStage(run.id, {
      stage: "INTAKE_VALIDATE",
      status: "complete",
      revision: 1,
      outputRef: "brief.json",
    });

    _clearWorkflowRunsForTesting();
    const restored = hydrateWorkflowRunsFromDisk();
    expect(restored).toBe(1);

    const existing = createWorkflowRun({
      mode: "FULL_RENDER",
      profile: "standard_cpu",
      idempotencyKey: "brief-002",
    });
    expect(existing.id).toBe(run.id);
    expect(existing.checkpoints.INTAKE_VALIDATE?.outputRef).toBe("brief.json");
  });
});
