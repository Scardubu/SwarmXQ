import { afterEach, beforeEach, describe, expect, test } from "vitest";
import Fastify from "fastify";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetEnvForTesting } from "../src/lib/env.js";
import { creativeFactoryRoutes } from "../src/routes/creative-factory.js";
import { _clearWorkflowRunsForTesting } from "../src/services/creative-factory-workflow.js";
import { _clearCreativeFactoryRegistryForTesting } from "../src/services/creative-factory-registry.js";
import { _clearCreativeFactoryAnalyticsForTesting } from "../src/services/creative-factory-analytics.js";

let tempHome: string | undefined;

beforeEach(() => {
  tempHome = mkdtempSync(join(tmpdir(), "swarmx-factory-route-test-"));
  process.env["NODE_ENV"] = "test";
  process.env["SWARMX_HOME"] = tempHome;
  resetEnvForTesting();
  _clearWorkflowRunsForTesting();
  _clearCreativeFactoryRegistryForTesting();
  _clearCreativeFactoryAnalyticsForTesting();
});

afterEach(() => {
  if (tempHome) rmSync(tempHome, { recursive: true, force: true });
  tempHome = undefined;
  delete process.env["SWARMX_HOME"];
  delete process.env["NODE_ENV"];
  resetEnvForTesting();
});

async function makeServer() {
  const server = Fastify({ logger: false });
  await server.register(creativeFactoryRoutes, { prefix: "/api/video/factory" });
  return server;
}

describe("creative factory routes", () => {
  test("creates workflow runs idempotently", async () => {
    const server = await makeServer();
    const body = {
      mode: "FULL_RENDER",
      profile: "constrained_cpu",
      idempotencyKey: "brief-123",
    };

    const first = await server.inject({
      method: "POST",
      url: "/api/video/factory/runs",
      payload: body,
    });
    const second = await server.inject({
      method: "POST",
      url: "/api/video/factory/runs",
      payload: body,
    });

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json().id).toBe(first.json().id);
    expect(first.json().profile).toBe("constrained_cpu_8gb");
    await server.close();
  });

  test("blocks checkpoint completion when prerequisites are incomplete", async () => {
    const server = await makeServer();
    const create = await server.inject({
      method: "POST",
      url: "/api/video/factory/runs",
      payload: {
        mode: "FULL_RENDER",
        profile: "standard_cpu",
        idempotencyKey: "brief-456",
      },
    });
    const runId = create.json().id as string;

    const checkpoint = await server.inject({
      method: "POST",
      url: `/api/video/factory/runs/${runId}/checkpoints`,
      payload: {
        stage: "SERIES_PLAN",
        status: "complete",
        revision: 1,
        outputRef: "series-plan.json",
      },
    });

    expect(checkpoint.statusCode).toBe(200);
    expect(checkpoint.json().status).toBe("blocked");
    expect(checkpoint.json().checkpoints.SERIES_PLAN.errorCode).toBe("PREREQUISITE_INCOMPLETE");
    await server.close();
  });

  test("persists BrandKits through the route", async () => {
    const server = await makeServer();
    const create = await server.inject({
      method: "POST",
      url: "/api/video/factory/brand-kits",
      payload: {
        name: "Creator Lab",
        voicePrinciples: ["precise", "direct"],
        colorTokens: { background: "#050505", accent: "#39ff14" },
        typographyTokens: { heading: "Geist Sans" },
        visualMotifs: ["terminal grid"],
        forbiddenClaims: ["guaranteed virality"],
      },
    });
    const created = create.json();
    const read = await server.inject({
      method: "GET",
      url: `/api/video/factory/brand-kits/${created.id}`,
    });

    expect(create.statusCode).toBe(201);
    expect(read.statusCode).toBe(200);
    expect(read.json().name).toBe("Creator Lab");
    expect(read.json().forbiddenClaims).toContain("guaranteed virality");
    await server.close();
  });

  test("records observed analytics separately from predicted virality", async () => {
    const server = await makeServer();
    const create = await server.inject({
      method: "POST",
      url: "/api/video/factory/analytics/performance",
      payload: {
        packageId: "package-1",
        platform: "tiktok",
        views: 120,
        completionRate: 0.62,
      },
    });
    const snapshot = create.json();

    expect(create.statusCode).toBe(201);
    expect(snapshot.views).toBe(120);
    expect(snapshot.viralityAtPublish).toBeUndefined();
    expect(snapshot.predictedVirality).toBeUndefined();
    await server.close();
  });
});
