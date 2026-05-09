/**
 * Agent routes — `/api/agents`
 *
 * Reads live agent state from the in-memory agent registry,
 * which is populated by the Python orchestrator via HTTP PATCH callbacks.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { broadcastEvent } from "../plugins/sse.js";
import type { AgentState, AgentStatus } from "../types/events.js";

// ── In-memory agent registry ──────────────────────────────────────────────────
// The Python orchestrator PATCHes this registry as agents change state.
// The SSE poller then broadcasts the latest state to connected clients.

export const agentRegistry = new Map<string, AgentState>();

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
