/**
 * System routes — `/api/system`
 * Exposes OS-level metrics, systemd unit listing, and structured health check.
 * [V5.9-ENH-01] Added /health endpoint: Ollama probe + model readiness + config summary.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import si from "systeminformation";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getAvailableModels, fastHealthProbe } from "../services/ollama.js";

const execFileAsync = promisify(execFile);

// Canonical model triad — aligned with configs/routing.yaml [V5.9-FIX-01]
const CANONICAL_MODEL_TRIAD = [
  { role: "router",  tag: "phi4-fast",         gguf: "microsoft_Phi-4-mini-instruct-Q8_0.gguf" },
  { role: "reason",  tag: "deepseek-reasoner",  gguf: "DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf" },
  { role: "code",    tag: "qwen-worker",         gguf: "Qwen2.5-7B-Instruct-Q5_K_M.gguf" },
] as const;

type ModelStatus = "ready" | "missing" | "error";

interface ModelReadiness {
  role: string;
  tag: string;
  gguf: string;
  status: ModelStatus;
  error?: string;
}

async function probeOllamaModels(): Promise<ModelReadiness[]> {
  // [V6.1-FIX-13] Use centralized resilient service
  const results: ModelReadiness[] = [];
  const listedTags = (await getAvailableModels()).map((t) => t.toLowerCase());
  if (listedTags.length === 0) {
    for (const m of CANONICAL_MODEL_TRIAD) {
      results.push({ role: m.role, tag: m.tag, gguf: m.gguf, status: "missing", error: "No installed models discovered" });
    }
    return results;
  }
  for (const m of CANONICAL_MODEL_TRIAD) {
    const found = listedTags.some(
      (t) => t === m.tag.toLowerCase() || t.startsWith(m.tag.toLowerCase() + ":"),
    );
    results.push({ role: m.role, tag: m.tag, gguf: m.gguf, status: found ? "ready" : "missing" });
  }
  return results;
}

export async function systemRouter(server: FastifyInstance): Promise<void> {
  // ── GET /api/system/health ──────────────────────────────────────────────────
  // [V5.9-ENH-01] Structured health check: Ollama liveness, model triad readiness,
  // memory headroom, and runtime config summary.
  // [V6.1-FIX-18] Uses fastHealthProbe() for liveness so /health never blocks on
  // the full multi-endpoint discovery cycle (which can exceed 10 s under pressure).
  server.get("/health", async (_req: FastifyRequest, reply: FastifyReply) => {
    const MODEL_PROBE_TIMEOUT_MS = 5_000;

    // Run fast liveness probe + system mem in parallel; cap model probe independently.
    const [ollamaHealth, mem, models] = await Promise.all([
      fastHealthProbe(),
      si.mem(),
      Promise.race([
        probeOllamaModels(),
        new Promise<ModelReadiness[]>((resolve) =>
          setTimeout(
            () => resolve(CANONICAL_MODEL_TRIAD.map((m) => ({ ...m, status: "error" as ModelStatus, error: "probe timeout" }))),
            MODEL_PROBE_TIMEOUT_MS,
          ),
        ),
      ]),
    ]);
    const ollamaUrl = ollamaHealth.endpoint;

    const allReady = models.every((m) => m.status === "ready");
    const ollamaReachable = ollamaHealth.reachable;

    const memGb = {
      totalGb: +(mem.total / 1024 ** 3).toFixed(2),
      usedGb: +(mem.used / 1024 ** 3).toFixed(2),
      availableGb: +(mem.available / 1024 ** 3).toFixed(2),
    };

    // Simple VRAM headroom heuristic: warn if available RAM < 6 GB
    const vramWarning = memGb.availableGb < 6
      ? `Low available memory (${memGb.availableGb.toFixed(1)} GB free) — model loading may fail`
      : null;

    const status = !ollamaReachable ? "degraded"
      : !allReady           ? "degraded"
      : vramWarning         ? "warning"
      : "ok";

    const responseCode = status === "ok" || status === "warning" ? 200 : 503;

    return reply.code(responseCode).send({
      status,
      ts: new Date().toISOString(),
      ollama: {
        url: ollamaUrl,
        reachable: ollamaReachable,
        latencyMs: ollamaHealth.latencyMs,
      },
      models,
      memory: memGb,
      ...(vramWarning ? { warnings: [vramWarning] } : {}),
      config: {
        modelFast:   process.env["SWARM_MODEL_FAST"]   ?? "phi4-fast",
        modelReason: process.env["SWARM_MODEL_REASON"] ?? "deepseek-reasoner",
        modelCode:   process.env["SWARM_MODEL_CODE"]   ?? "qwen-worker",
        apiPort:     Number.parseInt(process.env["SWARMX_API_PORT"] ?? "3001", 10),
      },
    });
  });

  // ── GET /api/system ─────────────────────────────────────────────────────────
  // Full system snapshot (on-demand)
  server.get("/", async () => {
    const [load, mem, disk, net, cpu] = await Promise.all([
      si.currentLoad(),
      si.mem(),
      si.disksIO(),
      si.networkStats(),
      si.cpu(),
    ]);
    return {
      cpu: {
        manufacturer: cpu.manufacturer,
        brand: cpu.brand,
        cores: cpu.cores,
        physicalCores: cpu.physicalCores,
        speed: cpu.speed,
        load1m: load.avgLoad ?? 0,
        perCore: (load.cpus ?? []).map((c) => Math.round(c.load)),
      },
      memory: {
        totalGb: mem.total / (1024 ** 3),
        usedGb: mem.used / (1024 ** 3),
        availableGb: mem.available / (1024 ** 3),
        swapTotalGb: mem.swaptotal / (1024 ** 3),
        swapUsedGb: mem.swapused / (1024 ** 3),
      },
      disk: {
        readBytesPerSec: disk?.rIO_sec ?? 0,
        writeBytesPerSec: disk?.wIO_sec ?? 0,
      },
      network: {
        rxBytesPerSec: (net ?? []).reduce((s, n) => s + (n.rx_sec ?? 0), 0),
        txBytesPerSec: (net ?? []).reduce((s, n) => s + (n.tx_sec ?? 0), 0),
      },
    };
  });

  // systemd unit list (Linux-only)
  server.get("/units", async (_req: FastifyRequest, reply: FastifyReply) => {
    if (process.platform !== "linux") {
      return reply.code(503).send({ error: "systemd not available on this platform" });
    }

    try {
      const { stdout } = await execFileAsync("systemctl", [
        "list-units",
        "--no-pager",
        "--output=json",
        "--all",
        ...(process.env["SWARMX_SYSTEMD_FILTER"] ? ["--unit", process.env["SWARMX_SYSTEMD_FILTER"]] : []),
      ]);

      interface SystemctlUnit {
        unit: string;
        load: string;
        active: string;
        sub: string;
        description: string;
      }

      const units = (JSON.parse(stdout) as SystemctlUnit[]).map((u) => ({
        name: u.unit,
        loadState: u.load,
        activeState: u.active,
        subState: u.sub,
        description: u.description,
      }));

      return units;
    } catch (err) {
      server.log.warn({ err }, "systemctl list-units failed");
      return reply.code(503).send({ error: "Failed to list systemd units" });
    }
  });
}
