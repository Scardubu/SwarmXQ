/**
 * Metrics route — `/api/metrics`
 * Spawns `python -m swarmx metrics --json` and returns the V5 observable signals.
 */
import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function metricsRouter(server: FastifyInstance): Promise<void> {
  server.get<{ Reply: Record<string, unknown> | { error: string; detail: string } }>(
    "/",
    async (_req, reply) => {
      const pythonExe = process.env["SWARMX_PYTHON"] ?? "python";
      const runtimeHome =
        process.env["SWARMX_HOME"] ??
        `${process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""}/.swarmx`;

      try {
        const { stdout } = await execFileAsync(
          pythonExe,
          ["-m", "swarmx", "metrics", "--home", runtimeHome],
          { timeout: 15_000 },
        );
        const metrics = JSON.parse(stdout) as Record<string, unknown>;
        return metrics;
      } catch (err) {
        server.log.error({ err }, "metrics subprocess failed");
        reply.code(503);
        return {
          error: "metrics_unavailable",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
}
