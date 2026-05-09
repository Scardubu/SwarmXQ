/**
 * Agent routes — `/api/agents`
 *
 * Reads live agent state from the in-memory agent registry,
 * which is populated by the Python orchestrator via HTTP PATCH callbacks.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { broadcastEvent } from "../plugins/sse.js";
import type { AgentState, AgentStatus } from "../types/events.js";

// ── In-memory agent registry ──────────────────────────────────────────────────
// The Python orchestrator PATCHes this registry as agents change state.
// The SSE poller then broadcasts the latest state to connected clients.

export const agentRegistry = new Map<string, AgentState>();

function parseCatalogAgents(raw: string): AgentState[] {
  const lines = raw.split(/\r?\n/);
  const agents: AgentState[] = [];

  let inAgentsSection = false;
  let currentName: string | undefined;
  let currentModel: string | undefined;

  for (const line of lines) {
    if (!inAgentsSection) {
      if (/^agents:\s*$/.test(line)) {
        inAgentsSection = true;
      }
      continue;
    }

    const nameMatch = line.match(/^\s*-\s*name:\s*([A-Za-z0-9_-]+)\s*$/);
    if (nameMatch) {
      if (currentName) {
        const seeded: AgentState = {
          id: currentName,
          name: currentName,
          role: currentName,
          status: "idle",
          currentTask: "standby",
        };
        if (currentModel) seeded.model = currentModel;
        agents.push(seeded);
      }
      currentName = nameMatch[1];
      currentModel = undefined;
      continue;
    }

    if (!currentName) continue;

    const modelMatch = line.match(/^\s*model:\s*([A-Za-z0-9._:-]+)\s*$/);
    if (modelMatch) {
      currentModel = modelMatch[1];
    }
  }

  if (currentName) {
    const seeded: AgentState = {
      id: currentName,
      name: currentName,
      role: currentName,
      status: "idle",
      currentTask: "standby",
    };
    if (currentModel) seeded.model = currentModel;
    agents.push(seeded);
  }

  return agents;
}

async function initializeAgentRegistryFromCatalog(server: FastifyInstance): Promise<void> {
  if (agentRegistry.size > 0) return;

  try {
    const repoRoot = process.env["SWARMX_REPO_ROOT"] ?? process.cwd();
    const catalogPath = path.join(repoRoot, "agents", "catalog.yaml");
    const raw = await readFile(catalogPath, "utf8");
    const catalogAgents = parseCatalogAgents(raw);

    for (const agent of catalogAgents) {
      agentRegistry.set(agent.id, agent);
      broadcastEvent({ type: "agent:update", data: agent });
    }

    server.log.info(
      { count: catalogAgents.length, catalogPath },
      "Agent registry seeded from catalog",
    );
  } catch (err) {
    server.log.warn({ err }, "Unable to seed agent registry from catalog");
  }
}

// ── Validation schemas ────────────────────────────────────────────────────────

const agentStatusValues: [AgentStatus, ...AgentStatus[]] = [
  "idle","queued","running","success","error","fatal","throttled","oom","killed","paused","reload",
];

const agentUpdateSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().max(256).optional(),
  role: z.string().max(256).optional(),
  model: z.string().max(128).optional(),
  status: z.enum(agentStatusValues).optional(),
  currentTask: z.string().max(1024).optional(),
  lastError: z.string().max(4096).optional(),
  startedAt: z.string().datetime().optional(),
  pid: z.number().int().positive().optional(),
  cgroupPath: z.string().max(256).optional(),
  resources: z.object({
    cpuPercent: z.number().min(0).max(100),
    memoryMb: z.number().min(0),
    cpuThrottledPercent: z.number().min(0).max(100).optional(),
    oomEvents: z.number().int().min(0).optional(),
    ioReadBytes: z.number().min(0).optional(),
    ioWriteBytes: z.number().min(0).optional(),
  }).optional(),
});

// ── Routes ────────────────────────────────────────────────────────────────────

export async function agentsRouter(server: FastifyInstance): Promise<void> {
  // [V6.1-FIX-14] Seed API-visible agents from catalog so the dashboard and
  // composer can report available/idle agents even before first runtime PATCH.
  await initializeAgentRegistryFromCatalog(server);

  // List all agents
  server.get("/", async () => ({
    agents: [...agentRegistry.values()],
    total: agentRegistry.size,
  }));

  // Get single agent
  server.get("/:id", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const agent = agentRegistry.get(req.params.id);
    if (!agent) return reply.code(404).send({ error: "Agent not found" });
    return agent;
  });

  // Register / update agent state (called by Python orchestrator)
  server.put(
    "/:id",
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
      reply: FastifyReply
    ) => {
      const parsed = agentUpdateSchema.safeParse({ ...(req.body as object), id: req.params.id });
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      const existing = agentRegistry.get(req.params.id);
      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const updated = { ...existing, ...parsed.data } as AgentState;
      agentRegistry.set(req.params.id, updated);

      broadcastEvent({ type: "agent:update", data: updated });

      return updated;
    }
  );

  // Patch partial agent state
  server.patch(
    "/:id",
    async (
      req: FastifyRequest<{ Params: { id: string }; Body: unknown }>,
      reply: FastifyReply
    ) => {
      const existing = agentRegistry.get(req.params.id);
      if (!existing) return reply.code(404).send({ error: "Agent not found" });

      const parsed = agentUpdateSchema.partial().safeParse(req.body);
      if (!parsed.success) {
        return reply.code(400).send({ error: parsed.error.flatten() });
      }

      // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
      const updated = { ...existing, ...parsed.data } as AgentState;
      agentRegistry.set(req.params.id, updated);
      broadcastEvent({ type: "agent:update", data: updated });

      return updated;
    }
  );

  // Remove agent
  server.delete(
    "/:id",
    async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      if (!agentRegistry.has(req.params.id)) {
        return reply.code(404).send({ error: "Agent not found" });
      }
      agentRegistry.delete(req.params.id);
      broadcastEvent({ type: "agent:remove", data: { id: req.params.id } });
      return { deleted: req.params.id };
    }
  );
}
