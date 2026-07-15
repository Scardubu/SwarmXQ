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
import { getSwarmHealthSummary } from "../services/swarm-pressure-monitor.js";

const execFileAsync = promisify(execFile);

function getCanonicalModelTriad() {
  return [
    {
      role: "router",
      tag:
        process.env["SWARMX_MODEL_ULTRA_ROUTER"] ??
        process.env["SWARM_MODEL_ULTRA_ROUTER"] ??
        "route-phi4-lite-q4km-prod",
      gguf: "microsoft_Phi-4-mini-instruct-Q8_0.gguf",
    },
    {
      role: "reason",
      tag:
        process.env["SWARMX_MODEL_REASON"] ??
        process.env["SWARMX_MODEL_REASONER"] ??
        process.env["SWARM_MODEL_REASON"] ??
        "reason-deepseekr1-pro-q5km-prod",
      gguf: "DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf",
    },
    {
      role: "code",
      tag:
        process.env["SWARMX_MODEL_CODE"] ??
        process.env["SWARM_MODEL_CODE"] ??
        "code-qwen25-pro-q5km-prod",
      gguf: "Qwen2.5-7B-Instruct-Q5_K_M.gguf",
    },
  ] as const;
}

type ModelStatus = "ready" | "missing" | "error";

export interface ModelReadiness {
  role: string;
  tag: string;
  gguf: string;
  status: ModelStatus;
  error?: string;
}

const DEFAULT_SYSTEM_HEALTH_LIVENESS_TIMEOUT_MS = 1_500;
const DEFAULT_SYSTEM_HEALTH_MODEL_TIMEOUT_MS = 2_500;

function readBoundedTimeoutMs(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(10_000, Math.max(250, parsed));
}

export function getSystemHealthLivenessTimeoutMs(): number {
  return readBoundedTimeoutMs(
    process.env["SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS"],
    DEFAULT_SYSTEM_HEALTH_LIVENESS_TIMEOUT_MS,
  );
}

export function getSystemHealthModelTimeoutMs(): number {
  return readBoundedTimeoutMs(
    process.env["SWARMX_SYSTEM_HEALTH_MODEL_PROBE_TIMEOUT_MS"],
    DEFAULT_SYSTEM_HEALTH_MODEL_TIMEOUT_MS,
  );
}

export function unavailableModelReadiness(): ModelReadiness[] {
  return getCanonicalModelTriad().map((model) => ({
    ...model,
    status: "error" as ModelStatus,
    error: "Ollama unreachable",
  }));
}

async function probeOllamaModels(): Promise<ModelReadiness[]> {
  // [V6.1-FIX-13] Use centralized resilient service
  const results: ModelReadiness[] = [];
  const canonicalModelTriad = getCanonicalModelTriad();
  const listedTags = (await getAvailableModels()).map((t) => t.toLowerCase());
  if (listedTags.length === 0) {
    for (const m of canonicalModelTriad) {
      results.push({ role: m.role, tag: m.tag, gguf: m.gguf, status: "missing", error: "No installed models discovered" });
    }
    return results;
  }
  for (const m of canonicalModelTriad) {
    const found = listedTags.some(
      (t) => t === m.tag.toLowerCase() || t.startsWith(m.tag.toLowerCase() + ":"),
    );
    results.push({ role: m.role, tag: m.tag, gguf: m.gguf, status: found ? "ready" : "missing" });
  }
  return results;
}

async function probeModelsWithin(
  timeoutMs: number,
): Promise<ModelReadiness[]> {
  const timeoutResult = getCanonicalModelTriad().map((model) => ({
    ...model,
    status: "error" as ModelStatus,
    error: "model readiness probe timeout",
  }));

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      probeOllamaModels(),
      new Promise<ModelReadiness[]>((resolve) => {
        timeoutId = setTimeout(() => resolve(timeoutResult), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

export async function systemRouter(server: FastifyInstance): Promise<void> {
  // ── GET /api/system/health ──────────────────────────────────────────────────
  // [V5.9-ENH-01] Structured health check: Ollama liveness, model triad readiness,
  // memory headroom, and runtime config summary.
  // [V6.1-FIX-18] Uses fastHealthProbe() for liveness so /health never blocks on
  // the full multi-endpoint discovery cycle (which can exceed 10 s under pressure).
  server.get("/health", async (_req: FastifyRequest, reply: FastifyReply) => {
    const livenessTimeoutMs = getSystemHealthLivenessTimeoutMs();
    const modelProbeTimeoutMs = getSystemHealthModelTimeoutMs();

    // System health is polled by every active dashboard. First establish whether
    // Ollama is reachable, then only inspect installed models when it is. This
    // keeps a down Ollama daemon from triggering redundant `/api/tags` discovery
    // and preserves a bounded response time during degraded startup.
    const [ollamaHealth, mem] = await Promise.all([
      fastHealthProbe(livenessTimeoutMs),
      si.mem(),
    ]);
    const models = ollamaHealth.reachable
      ? await probeModelsWithin(modelProbeTimeoutMs)
      : unavailableModelReadiness();
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
    const swarm = getSwarmHealthSummary();

    // [V6.1-FIX-19] Always return HTTP 200 from /api/system/health.
    // HTTP 503 means the API SERVICE is unavailable — but the API is running fine.
    // When only Ollama is down, status="degraded" conveys the detail without
    // causing monitoring tools, uptime checkers, and load balancers to flip the
    // entire service to "down". 503 is reserved for unhandled fatal errors.
    return reply.code(200).send({
      status,
      ts: new Date().toISOString(),
      ollama: {
        url: ollamaUrl,
        reachable: ollamaReachable,
        latencyMs: ollamaHealth.latencyMs,
      },
      models,
      swarm,
      memory: memGb,
      ...(vramWarning ? { warnings: [vramWarning] } : {}),
      config: {
        healthProbeTimeoutMs: livenessTimeoutMs,
        healthModelProbeTimeoutMs: modelProbeTimeoutMs,
        modelRouter:
          process.env["SWARMX_MODEL_ULTRA_ROUTER"] ??
          process.env["SWARM_MODEL_ULTRA_ROUTER"] ??
          "route-phi4-lite-q4km-prod",
        // [V6.2-FIX-14] Keep health output aligned with the env precedence used
        // by the API routes/services so diagnostics reflect real runtime state.
        modelFast:
          process.env["SWARMX_MODEL_FAST"] ??
          process.env["SWARM_MODEL_FAST"] ??
          "instruct-phi4-pro-q8-prod",
        modelReason:
          process.env["SWARMX_MODEL_REASON"] ??
          process.env["SWARMX_MODEL_REASONER"] ??
          process.env["SWARM_MODEL_REASON"] ??
          "reason-deepseekr1-pro-q5km-prod",
        modelCode:
          process.env["SWARMX_MODEL_CODE"] ??
          process.env["SWARM_MODEL_CODE"] ??
          "code-qwen25-pro-q5km-prod",
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
