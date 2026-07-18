import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { loadEnv } from "../lib/env.js";

// In-memory config store (loaded from env / config file at startup)
const _env = loadEnv();
const config = {
  backend: {
    port: _env.SWARMX_API_PORT,
    host: _env.SWARMX_API_HOST,
    sse: {
      flushIntervalMs: 100,
      keepAliveIntervalMs: 15_000,
    },
  },
  telemetry: {
    pollIntervalMs: _env.SWARMX_TELEMETRY_INTERVAL_MS,
  },
  agents: {
    maxConcurrent: _env.SWARMX_MAX_AGENTS,
    defaultTimeout: _env.SWARMX_AGENT_TIMEOUT_MS,
  },
  terminal: {
    maxSessions: _env.SWARMX_MAX_PTY_SESSIONS,
    sessionTimeoutMs: 3_600_000,
  },
  llm: {
    defaultModel: _env.SWARMX_DEFAULT_MODEL,
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
