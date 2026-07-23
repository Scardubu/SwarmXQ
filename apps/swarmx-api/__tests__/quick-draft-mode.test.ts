import { describe, test, expect } from "vitest";
import {
  createWorkflowRun,
  workflowDefinitions,
  _clearWorkflowRunsForTesting,
} from "../src/services/creative-factory-workflow.js";
import {
  getModeCertificationCeiling,
  getRendererCertificationCeiling,
} from "../src/services/renderer-certification.js";

describe("QUICK_DRAFT execution mode", () => {
  test("workflow schema accepts QUICK_DRAFT", () => {
    _clearWorkflowRunsForTesting();
    const run = createWorkflowRun({
      mode: "QUICK_DRAFT",
      profile: "constrained_cpu",
      idempotencyKey: "quick-draft-test-001",
    });
    expect(run.mode).toBe("QUICK_DRAFT");
    expect(run.profile).toBe("constrained_cpu_8gb");
    _clearWorkflowRunsForTesting();
  });

  test("QUICK_DRAFT is required for early stages, excluded past ASSET_PLAN", () => {
    const defs = workflowDefinitions();
    const scriptStage = defs.find((d) => d.stage === "EPISODE_SCRIPT");
    const assetPlan = defs.find((d) => d.stage === "ASSET_PLAN");
    const compose = defs.find((d) => d.stage === "COMPOSE");
    const publish = defs.find((d) => d.stage === "PUBLISH_OR_EXPORT");

    expect(scriptStage?.requiredFor).toContain("QUICK_DRAFT");
    expect(assetPlan?.requiredFor).toContain("QUICK_DRAFT");
    expect(compose?.requiredFor).not.toContain("QUICK_DRAFT");
    expect(publish?.requiredFor).not.toContain("QUICK_DRAFT");
  });

  test("QUICK_DRAFT certification ceiling is TECHNICALLY_VALID", () => {
    expect(getModeCertificationCeiling("QUICK_DRAFT")).toBe("TECHNICALLY_VALID");
    // Even against the strongest renderer, mode ceiling is intended to be
    // composed by callers (e.g., min-rank of mode + renderer). Verify the
    // renderer ceiling itself is unchanged.
    expect(getRendererCertificationCeiling("ffmpeg_kinetic_text")).toBe("PUBLISHED_VERIFIED");
  });
});
