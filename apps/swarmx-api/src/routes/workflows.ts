/**
 * Workflow routes — `/api/workflows`
 * Reads YAML workflow definitions from the workflows/ directory
 * and executes workflow runs via the canonical Python runtime bridge.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { appendFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { broadcastEvent } from "../plugins/sse.js";
import type { WorkflowEventData } from "../types/events.js";

const WORKFLOWS_DIR = process.env["SWARMX_WORKFLOWS_DIR"]
  ?? path.resolve(process.cwd(), "../../workflows");
const SWARMX_HOME = process.env["SWARMX_HOME"]
  ?? path.resolve(process.cwd(), "../../.swarmx");
const WORKFLOW_RUNS_FILE = path.join(SWARMX_HOME, "state", "workflow-runs.jsonl");
const PYTHON_API_BASE = process.env["SWARMX_PYTHON_API_URL"]
  ?? "http://swarmx-python:8787";
const DEFAULT_REPO = process.env["SWARMX_REPO_ROOT"]
  ?? process.cwd();

type WorkflowRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";

type WorkflowListStatus = "idle" | "queued" | "running" | "success" | "error" | "cancelled";

interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  idempotencyKey: string;
  correlationId: string;
  status: WorkflowRunStatus;
  repo: string;
  target: string;
  createdAt: string;
  updatedAt: string;
  input?: Record<string, unknown>;
  error?: string;
  result?: unknown;
}

// Simple YAML front-matter parser for name/description
function parseWorkflowMeta(yaml: string): { name: string; description?: string; steps?: unknown[] } {
  const nameMatch = yaml.match(/^name:\s*(.+)$/m);
  const descMatch = yaml.match(/^description:\s*(.+)$/m);
  const stepCount = (yaml.match(/^\s{2,4}-\s+id:/gm) ?? []).length;
  const description = descMatch?.[1]?.trim();
  return {
    name: nameMatch?.[1]?.trim() ?? "Unnamed Workflow",
    ...(description !== undefined && { description }),
    steps: Array.from({ length: stepCount }),
  };
}

const runSchema = z.object({
  idempotencyKey: z.string().min(1).max(256),
  repo: z.string().min(1).max(4096).optional(),
  target: z.string().min(1).max(4096).optional(),
  autonomous: z.boolean().optional(),
  reviewRequired: z.boolean().optional(),
  maxIterations: z.number().int().min(1).max(20).optional(),
  input: z.record(z.unknown()).optional(),
});

async function ensureRunStore(): Promise<void> {
  await mkdir(path.dirname(WORKFLOW_RUNS_FILE), { recursive: true });
}

async function appendRunRecord(record: WorkflowRunRecord): Promise<void> {
  await ensureRunStore();
  await appendFile(WORKFLOW_RUNS_FILE, `${JSON.stringify(record)}\n`, "utf8");
}

async function loadRunRecords(limit = 200): Promise<WorkflowRunRecord[]> {
  try {
    const raw = await readFile(WORKFLOW_RUNS_FILE, "utf8");
    const rows = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line: string) => {
        try {
          return JSON.parse(line) as WorkflowRunRecord;
        } catch {
          return null;
        }
      })
      .filter((row: WorkflowRunRecord | null): row is WorkflowRunRecord => row !== null);
    return rows.slice(-limit);
  } catch {
    return [];
  }
}

async function latestRunByIdempotency(
  workflowId: string,
  idempotencyKey: string
): Promise<WorkflowRunRecord | null> {
  const rows = await loadRunRecords(500);
  for (let i = rows.length - 1; i >= 0; i -= 1) {
    const row = rows[i];
    if (!row) continue;
    if (row.workflowId === workflowId && row.idempotencyKey === idempotencyKey) {
      return row;
    }
  }
  return null;
}

function makeTarget(workflowId: string, meta: { name: string; description?: string }, requested?: string): string {
  if (requested && requested.trim()) {
    return requested.trim();
  }
  const description = meta.description?.trim() ? ` (${meta.description.trim()})` : "";
  return `Execute workflow ${workflowId}: ${meta.name}${description}`;
}

function mapWorkflowListStatus(status?: WorkflowRunStatus): WorkflowListStatus {
  switch (status) {
    case "queued":
      return "queued";
    case "running":
      return "running";
    case "success":
      return "success";
    case "failed":
      return "error";
    case "cancelled":
      return "cancelled";
    default:
      return "idle";
  }
}

function resolveCorrelationId(request: FastifyRequest): string {
  const headerValue = request.headers["x-correlation-id"];
  if (typeof headerValue === "string") {
    const trimmed = headerValue.trim();
    if (trimmed) {
      return trimmed.slice(0, 128);
    }
  }
  return `wf-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function workflowEventData(
  run: WorkflowRunRecord,
  status: WorkflowEventData["status"],
  extras: Partial<Pick<WorkflowEventData, "name" | "exitCode" | "error">> = {}
): WorkflowEventData {
  return {
    id: run.runId,
    workflowId: run.workflowId,
    correlationId: run.correlationId,
    status,
    timestamp: run.updatedAt,
    ...extras,
  };
}

function postJson(
  urlString: string,
  body: Record<string, unknown>,
  timeoutMs = 600_000,
  headers: Record<string, string> = {}
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const payload = JSON.stringify(body);
    const req = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      {
        hostname: url.hostname,
        port: url.port || (url.protocol === "https:" ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
          ...headers,
        },
        timeout: timeoutMs,
      },
      (res: import("http").IncomingMessage) => {
        let data = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          data += chunk;
        });
        res.on("end", () => {
          if ((res.statusCode ?? 500) >= 400) {
            reject(new Error(`Python runtime HTTP ${res.statusCode}: ${data.slice(0, 300)}`));
            return;
          }
          try {
            resolve(data ? JSON.parse(data) : {});
          } catch {
            resolve({ raw: data });
          }
        });
      }
    );

    req.on("timeout", () => {
      req.destroy(new Error(`Python runtime timeout after ${timeoutMs}ms`));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function executeRun(
  server: FastifyInstance,
  run: WorkflowRunRecord,
  options: {
    autonomous: boolean;
    reviewRequired: boolean;
    maxIterations: number;
  }
): Promise<void> {
  const running: WorkflowRunRecord = {
    ...run,
    status: "running",
    updatedAt: new Date().toISOString(),
  };

  await appendRunRecord(running);
  broadcastEvent({
    type: "workflow:started",
    data: workflowEventData(running, "running", { name: running.workflowId }),
  });

  try {
    const result = await postJson(`${PYTHON_API_BASE.replace(/\/$/, "")}/api/run`, {
      repo: running.repo,
      target: running.target,
      run_id: running.runId,
      correlation_id: running.correlationId,
      autonomous: options.autonomous,
      review_required: options.reviewRequired,
      max_iterations: options.maxIterations,
    }, 600_000, { "x-correlation-id": running.correlationId });

    const success: WorkflowRunRecord = {
      ...running,
      status: "success",
      updatedAt: new Date().toISOString(),
      result,
    };
    await appendRunRecord(success);
    broadcastEvent({
      type: "workflow:completed",
      data: workflowEventData(success, "success", { exitCode: 0 }),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown workflow runtime error";
    const failed: WorkflowRunRecord = {
      ...running,
      status: "failed",
      updatedAt: new Date().toISOString(),
      error: message,
    };
    await appendRunRecord(failed);
    broadcastEvent({
      type: "workflow:failed",
      data: workflowEventData(failed, "failed", { error: message }),
    });
    server.log.error({ runId: failed.runId, workflowId: failed.workflowId, error: message }, "Workflow run failed");
  }
}

export async function workflowsRouter(server: FastifyInstance): Promise<void> {
  // List all workflows
  server.get("/", async (_req: FastifyRequest, reply: FastifyReply) => {
    try {
      const latestRuns = new Map<string, WorkflowRunRecord>();
      for (const run of await loadRunRecords(500)) {
        latestRuns.set(run.workflowId, run);
      }
      const files = (await readdir(WORKFLOWS_DIR)).filter((f: string) => f.endsWith(".yaml") || f.endsWith(".yml"));
      const workflows = await Promise.all(
        files.map(async (file: string) => {
          const id = file.replace(/\.ya?ml$/, "");
          const raw = await readFile(path.join(WORKFLOWS_DIR, file), "utf8");
          const meta = parseWorkflowMeta(raw);
          const latestRun = latestRuns.get(id);
          return {
            id,
            name: meta.name,
            description: meta.description,
            lastRun: latestRun?.updatedAt,
            lastRunId: latestRun?.runId,
            correlationId: latestRun?.correlationId,
            nodeCount: (meta.steps ?? []).length,
            agentCount: 0,
            status: mapWorkflowListStatus(latestRun?.status),
          };
        })
      );
      return workflows;
    } catch {
      return [];
    }
  });

  // Get single workflow definition
  server.get(
    "/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      // Sanitize to prevent path traversal
      const safeId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, "");
      const candidates = [
        path.join(WORKFLOWS_DIR, `${safeId}.yaml`),
        path.join(WORKFLOWS_DIR, `${safeId}.yml`),
      ];

      let rawYaml: string | null = null;
      for (const candidate of candidates) {
        try {
          rawYaml = await readFile(candidate, "utf8");
          break;
        } catch { /* try next */ }
      }

      if (!rawYaml) return reply.code(404).send({ error: "Workflow not found" });

      const meta = parseWorkflowMeta(rawYaml);
      return { id: safeId, ...meta, rawYaml };
    }
  );

  // Update workflow YAML
  server.put(
    "/:id",
    async (req: FastifyRequest<{ Params: { id: string }; Body: { yaml: string } }>, reply: FastifyReply) => {
      const safeId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, "");
      const { yaml } = req.body as { yaml: string };

      if (typeof yaml !== "string") return reply.code(400).send({ error: "yaml field required" });
      if (yaml.length > 512_000) return reply.code(413).send({ error: "YAML too large" });

      const filePath = path.join(WORKFLOWS_DIR, `${safeId}.yaml`);
      await writeFile(filePath, yaml, "utf8");
      return { updated: safeId };
    }
  );

  // Run a workflow
  server.post(
    "/:id/run",
    async (req: FastifyRequest<{ Params: { id: string }; Body: unknown }>, reply: FastifyReply) => {
      const correlationId = resolveCorrelationId(req);
      reply.header("x-correlation-id", correlationId);
      const parsed = runSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const safeId = path.basename(req.params.id).replace(/[^a-zA-Z0-9_-]/g, "");
      const candidates = [
        path.join(WORKFLOWS_DIR, `${safeId}.yaml`),
        path.join(WORKFLOWS_DIR, `${safeId}.yml`),
      ];

      let rawYaml: string | null = null;
      for (const candidate of candidates) {
        try {
          rawYaml = await readFile(candidate, "utf8");
          break;
        } catch {
          // continue
        }
      }
      if (!rawYaml) return reply.code(404).send({ error: "Workflow not found" });

      const idempotent = await latestRunByIdempotency(safeId, parsed.data.idempotencyKey);
      if (idempotent && idempotent.status !== "failed") {
        return reply.code(200).send({
          runId: idempotent.runId,
          workflowId: idempotent.workflowId,
          correlationId: idempotent.correlationId,
          status: idempotent.status,
          deduped: true,
        });
      }

      const meta = parseWorkflowMeta(rawYaml);
      const runId = `run-${safeId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const runRecord: WorkflowRunRecord = {
        runId,
        workflowId: safeId,
        idempotencyKey: parsed.data.idempotencyKey,
        correlationId,
        status: "queued",
        repo: parsed.data.repo ?? DEFAULT_REPO,
        target: makeTarget(safeId, meta, parsed.data.target),
        createdAt: now,
        updatedAt: now,
        // [V5.9-FIX-02] Preserve exact optional property typing by omitting undefined input.
        ...(parsed.data.input !== undefined ? { input: parsed.data.input } : {}),
      };
      await appendRunRecord(runRecord);

      void executeRun(server, runRecord, {
        autonomous: parsed.data.autonomous ?? true,
        reviewRequired: parsed.data.reviewRequired ?? false,
        maxIterations: parsed.data.maxIterations ?? 3,
      });

      return reply.code(202).send({
        runId,
        workflowId: safeId,
        correlationId,
        status: "queued",
        deduped: false,
      });
    }
  );

  // Get recent workflow run history
  server.get("/runs", async (req: FastifyRequest<{ Querystring: { limit?: string } }>) => {
    const limit = Math.max(1, Math.min(500, Number.parseInt(req.query.limit ?? "100", 10) || 100));
    const runs = await loadRunRecords(limit);
    return { runs };
  });

  // Get latest state for one workflow run id
  server.get("/runs/:runId", async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
    const runs = await loadRunRecords(500);
    for (let i = runs.length - 1; i >= 0; i -= 1) {
      const row = runs[i];
      if (!row) continue;
      if (row.runId === req.params.runId) {
        return row;
      }
    }
    return reply.code(404).send({ error: "Workflow run not found" });
  });

  // Cancel a workflow run (DELETE /api/workflows/runs/:runId)
  // Marks queued/running runs as cancelled. Already-terminal runs are a no-op.
  server.delete(
    "/runs/:runId",
    async (req: FastifyRequest<{ Params: { runId: string } }>, reply: FastifyReply) => {
      const correlationId = resolveCorrelationId(req);
      reply.header("x-correlation-id", correlationId);
      const { runId } = req.params;
      const runs = await loadRunRecords(500);
      let latest: WorkflowRunRecord | null = null;
      for (let i = runs.length - 1; i >= 0; i -= 1) {
        const row = runs[i];
        if (row && row.runId === runId) {
          latest = row;
          break;
        }
      }

      if (!latest) {
        return reply.code(404).send({ error: "Workflow run not found" });
      }

      // Already terminal — cancellation is a no-op
      if (latest.status === "success" || latest.status === "failed" || latest.status === "cancelled") {
        return reply.code(200).send({
          runId: latest.runId,
          workflowId: latest.workflowId,
          correlationId: latest.correlationId,
          status: latest.status,
          alreadyTerminal: true,
        });
      }

      // Append a cancelled record (append-only JSONL — never mutate existing rows)
      const cancelled: WorkflowRunRecord = {
        ...latest,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
        error: "Cancelled by operator request",
      };
      await appendRunRecord(cancelled);

      broadcastEvent({
        type: "workflow:cancelled",
        data: workflowEventData(cancelled, "cancelled", { error: "cancelled" }),
      });

      // Best-effort: attempt to notify the Python runtime to abort the run.
      // This is fire-and-forget — the cancel record is written regardless of
      // whether the Python runtime responds.
      void (async () => {
        try {
          await postJson(
            `${PYTHON_API_BASE.replace(/\/$/, "")}/api/cancel`,
            { run_id: runId, correlation_id: cancelled.correlationId },
            10_000,
            { "x-correlation-id": cancelled.correlationId },
          );
        } catch {
          // Python runtime abort notification failed — run may continue until
          // it times out or completes. The cancel record in JSONL is authoritative.
          server.log.warn(
            { runId, workflowId: latest!.workflowId },
            "Python runtime cancel notification failed — run marked cancelled in store",
          );
        }
      })();

      return reply.code(200).send({
        runId: cancelled.runId,
        workflowId: cancelled.workflowId,
        correlationId: cancelled.correlationId,
        status: "cancelled",
        alreadyTerminal: false,
      });
    }
  );
}
