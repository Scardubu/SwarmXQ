/**
 * Metrics route — `/api/metrics`
 *
 * [V6.2-ENH-06] Upgraded from a 501 stub to a live OS-metrics snapshot using
 * the same systeminformation queries that power the telemetry poller. Returns
 * a compact JSON object suitable for dashboard sparklines, alerting, and
 * third-party monitoring integrations.
 *
 * The endpoint is intentionally read-only and does not depend on Ollama or
 * the Python orchestrator being available — it works as long as the API
 * process itself is running.
 */
import type { FastifyInstance } from "fastify";
import si from "systeminformation";
import { agentRegistry } from "./agents.js";

export async function metricsRouter(server: FastifyInstance): Promise<void> {
  server.get<{ Reply: Record<string, unknown> }>(
    "/",
    async (_req, reply) => {
      try {
        const [load, mem, disk] = await Promise.all([
          si.currentLoad(),
          si.mem(),
          si.disksIO().catch(() => null),
        ]);

        const totalMb = mem.total / (1024 * 1024);
        const usedMb  = mem.used  / (1024 * 1024);
        const availMb = mem.available / (1024 * 1024);

        const activeAgents = [...agentRegistry.values()].filter(
          (a) => a.status === "running" || a.status === "active",
        ).length;

        const errorAgents = [...agentRegistry.values()].filter(
          (a) => a.status === "error" || a.status === "fatal" || a.status === "failed",
        ).length;

        reply.header("Cache-Control", "no-store");
        return {
          timestamp: new Date().toISOString(),
          cpu: {
            loadPercent: +(load.currentLoad ?? 0).toFixed(2),
            coreCount: (load.cpus ?? []).length,
            load1m: load.avgLoad ?? 0,
          },
          memory: {
            totalMb:     +totalMb.toFixed(1),
            usedMb:      +usedMb.toFixed(1),
            availableMb: +availMb.toFixed(1),
            usedPercent: +(usedMb / totalMb * 100).toFixed(2),
          },
          disk: disk
            ? {
                readBytesPerSec:  disk.rIO_sec ?? 0,
                writeBytesPerSec: disk.wIO_sec ?? 0,
              }
            : null,
          agents: {
            total:  agentRegistry.size,
            active: activeAgents,
            errors: errorAgents,
          },
        };
      } catch (err) {
        server.log.error({ err }, "metrics snapshot failed");
        reply.code(500);
        return { error: "snapshot_failed", message: String(err) };
      }
    },
  );
}

