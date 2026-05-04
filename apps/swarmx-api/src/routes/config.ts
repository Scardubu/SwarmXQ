import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";

// In-memory config store (loaded from env / config file at startup)
const config = {
  backend: {
    port: parseInt(process.env["SWARMX_API_PORT"] ?? "3001", 10),
    host: process.env["SWARMX_API_HOST"] ?? "127.0.0.1",
    sse: {
      flushIntervalMs: 100,
      keepAliveIntervalMs: 15_000,
    },
  },
  telemetry: {
    pollIntervalMs: parseInt(process.env["SWARMX_TELEMETRY_INTERVAL_MS"] ?? "2000", 10),
  },
  agents: {
    maxConcurrent: parseInt(process.env["SWARMX_MAX_AGENTS"] ?? "10", 10),
    defaultTimeout: parseInt(process.env["SWARMX_AGENT_TIMEOUT_MS"] ?? "300000", 10),
  },
  terminal: {
    maxSessions: parseInt(process.env["SWARMX_MAX_PTY_SESSIONS"] ?? "8", 10),
    sessionTimeoutMs: 3_600_000,
  },
  llm: {
    defaultModel: process.env["SWARMX_DEFAULT_MODEL"] ?? "gpt-4o-mini",
    maxTokens: 16_384,
  },
};

const configPatchSchema = z
  .object({
    backend: z.object({
      port: z.number().int().min(1024).max(65535),
      sse: z.object({ flushIntervalMs: z.number().int().min(50) }).partial(),
    }).partial().optional(),
    telemetry: z.object({ pollIntervalMs: z.number().int().min(500) }).partial().optional(),
    agents: z.object({
      maxConcurrent: z.number().int().min(1).max(100),
      defaultTimeout: z.number().int().min(1000),
    }).partial().optional(),
    terminal: z.object({ maxSessions: z.number().int().min(1).max(32) }).partial().optional(),
    llm: z.object({ defaultModel: z.string().max(128), maxTokens: z.number().int().min(256) }).partial().optional(),
  })
  .partial();

export async function configRouter(server: FastifyInstance): Promise<void> {
  server.get("/", async () => config);

  server.patch("/", async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = configPatchSchema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    // Deep merge
    const patch = parsed.data;
    if (patch.backend) Object.assign(config.backend, patch.backend);
    if (patch.telemetry) Object.assign(config.telemetry, patch.telemetry);
    if (patch.agents) Object.assign(config.agents, patch.agents);
    if (patch.terminal) Object.assign(config.terminal, patch.terminal);
    if (patch.llm) Object.assign(config.llm, patch.llm);

    return config;
  });
}
