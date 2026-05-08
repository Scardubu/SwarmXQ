/**
 * Metrics route — `/api/metrics`
 * [V5.9-FIX-09] Stub endpoint — the `python -m swarmx metrics` CLI command
 * does not exist yet. Return 501 Not Implemented with placeholder metrics.
 * This prevents 503 errors and provides a graceful degradation path.
 */
import type { FastifyInstance } from "fastify";

export async function metricsRouter(server: FastifyInstance): Promise<void> {
  server.get<{ Reply: Record<string, unknown> }>(
    "/",
    async (_req, reply) => {
      // [V5.9-FIX-09] Placeholder metrics response while CLI command is in development
      reply.code(501);
      return {
        error: "not_implemented",
        message: "Metrics endpoint is not yet implemented. Use /api/system for system info.",
        placeholder: {
          cpuUsagePercent: 0,
          memoryUsageMb: 0,
          diskUsageMb: 0,
          activeAgents: 0,
          completedTasks: 0,
        },
      };
    },
  );
}

