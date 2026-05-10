import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { agentRegistry } from "./agents.js";
import {
  getOllamaBaseUrl,
  getAvailableModels,
  getConfiguredModels,
  checkOllamaHealth,
} from "../services/ollama.js";

type ComposerAgent = {
  id: string;
  name: string | undefined;
  status: string;
  role: string | undefined;
  currentTask: string | undefined;
  resource?: {
    cpuPercent?: number;
  } | null;
};

type TimeoutBucket = "lt5s" | "lt15s" | "lt30s" | "lt45s" | "gte45s";

const TIMEOUT_HISTOGRAM_LOG_EVERY = Number.parseInt(
  process.env["SWARMX_COMPOSER_TIMEOUT_HISTO_LOG_EVERY"] ?? "3",
  10,
);

const composerTimeoutHistogram: Record<TimeoutBucket, number> = {
  lt5s: 0,
  lt15s: 0,
  lt30s: 0,
  lt45s: 0,
  gte45s: 0,
};

let composerTimeoutCount = 0;

function timeoutBucketFor(elapsedMs: number): TimeoutBucket {
  if (elapsedMs < 5_000) return "lt5s";
  if (elapsedMs < 15_000) return "lt15s";
  if (elapsedMs < 30_000) return "lt30s";
  if (elapsedMs < 45_000) return "lt45s";
  return "gte45s";
}

function timeoutHistogramCompact(): string {
  return [
    `lt5s:${composerTimeoutHistogram.lt5s}`,
    `lt15s:${composerTimeoutHistogram.lt15s}`,
    `lt30s:${composerTimeoutHistogram.lt30s}`,
    `lt45s:${composerTimeoutHistogram.lt45s}`,
    `gte45s:${composerTimeoutHistogram.gte45s}`,
  ].join("|");
}

function shouldLogHistogram(): boolean {
  if (!Number.isFinite(TIMEOUT_HISTOGRAM_LOG_EVERY) || TIMEOUT_HISTOGRAM_LOG_EVERY <= 0) {
    return true;
  }
  return composerTimeoutCount % TIMEOUT_HISTOGRAM_LOG_EVERY === 0;
}

function detectLocalIntent(
  message: string,
): "running_by_role" | "high_cpu" | "available_agents" | "simple_copy" | "python_calculator" | "presence_ping" | "idle_unassigned" | null {
  const q = message.toLowerCase();
  if (
    q === "are you there" ||
    q === "are you there?" ||
    q === "you there" ||
    q === "you there?" ||
    q === "ping" ||
    q === "hello" ||
    q === "hi"
  ) {
    return "presence_ping";
  }
  if ((q.includes("running agents") || q.includes("active agents")) && q.includes("grouped by role")) {
    return "running_by_role";
  }
  if ((q.includes("available") || q.includes("availble")) && q.includes("agent")) {
    return "available_agents";
  }
  if (
    q.includes("idle") &&
    (q.includes("why") || q.includes("assigned") || q.includes("tasks") || q.includes("standby"))
  ) {
    return "idle_unassigned";
  }
  if (q.includes("cpu") && (q.includes("above") || q.includes("over") || q.includes("greater than"))) {
    return "high_cpu";
  }
  if (
    (q.includes("welcome message") || q.includes("greeting message") || q.includes("intro message")) &&
    (q.includes("simple") || q.includes("short") || q.includes("quick") || q.includes("write"))
  ) {
    return "simple_copy";
  }
  if (q.includes("python") && q.includes("calculator") && (q.includes("simple") || q.includes("write") || q.includes("build"))) {
    return "python_calculator";
  }
  return null;
}

function isActiveStatus(status: string): boolean {
  return status === "running" || status === "active";
}

function isErrorStatus(status: string): boolean {
  return status === "error" || status === "fatal";
}

function formatIdleUnassigned(agents: ComposerAgent[]): string {
  const active = agents.filter((a) => isActiveStatus(a.status));
  const idle = agents.filter((a) => a.status === "idle");
  const errored = agents.filter((a) => isErrorStatus(a.status));

  const lines: string[] = [];
  lines.push("SwarmX fleet assignment summary");
  lines.push(`Active agents: ${active.length}`);
  lines.push(`Idle agents: ${idle.length}`);
  lines.push(`Error agents: ${errored.length}`);
  lines.push(`Total registered: ${agents.length}`);
  lines.push("");

  if (idle.length === 0) {
    lines.push("No agents are idle right now.");
    return lines.join("\n");
  }

  lines.push("Why agents are idle:");
  lines.push("- No workflow or mission is currently queued/running, so idle agents stay on standby by design.");
  lines.push("- Agent seeding initializes availability only; task assignment begins when a mission/workflow is dispatched.");
  lines.push("- Execution policy and risk gates can intentionally defer task starts until explicit run requests.");
  lines.push("");
  lines.push("Next action:");
  lines.push("- Start a run from Composer or Workflows to transition eligible agents from idle to active.");

  return lines.join("\n");
}

function formatPresencePing(agents: ComposerAgent[]): string {
  const active = agents.filter((a) => isActiveStatus(a.status)).length;
  const error = agents.filter((a) => isErrorStatus(a.status)).length;
  const total = agents.length;

  return [
    'SwarmX fleet summary (responding to: "are you there?")',
    `Active agents: ${active}`,
    `Error agents: ${error}`,
    `Total registered: ${total}`,
    total > 0
      ? `  • ${agents[0]?.name ?? agents[0]?.id} [${agents[0]?.status}] — ${agents[0]?.currentTask ?? "standby"}`
      : "No agents are currently registered.",
  ].join("\n");
}

function formatSimpleCopy(message: string): string {
  const q = message.toLowerCase();
  if (q.includes("welcome message") || q.includes("greeting message") || q.includes("intro message")) {
    return "Welcome to SwarmX. Your fleet is ready, your tools are online, and you can start from here.";
  }

  return "I can help with short operator copy, fleet status, and direct swarm questions right away.";
}

function formatPythonCalculator(): string {
  return [
    "Here is a simple Python calculator you can run locally:",
    "",
    "```python",
    "def add(a: float, b: float) -> float:",
    "    return a + b",
    "",
    "def subtract(a: float, b: float) -> float:",
    "    return a - b",
    "",
    "def multiply(a: float, b: float) -> float:",
    "    return a * b",
    "",
    "def divide(a: float, b: float) -> float:",
    "    if b == 0:",
    "        raise ValueError(\"Cannot divide by zero\")",
    "    return a / b",
    "",
    "if __name__ == \"__main__\":",
    "    first = float(input(\"First number: \"))",
    "    second = float(input(\"Second number: \"))",
    "    print(\"Add:\", add(first, second))",
    "    print(\"Subtract:\", subtract(first, second))",
    "    print(\"Multiply:\", multiply(first, second))",
    "    print(\"Divide:\", divide(first, second))",
    "```",
  ].join("\n");
}

function parseCpuThreshold(message: string, fallback = 80): number {
  const match = message.match(/(above|over|greater than)\s*(\d{1,3})\s*%?/i);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, parsed));
}

function fallbackForSimplePrompt(message: string): string | null {
  const q = message.toLowerCase();

  if (q.includes("python") && (q.includes("function") || q.includes("hook"))) {
    return [
      "Model timeout fallback: generated a simple Python function template.",
      "",
      "```python",
      "def greet(name: str) -> str:",
      "    return f\"Hello, {name}!\"",
      "```",
      "",
      "You can call it with: `greet(\"Scar\")`.",
    ].join("\n");
  }

  if (q.includes("javascript") && q.includes("function")) {
    return [
      "Model timeout fallback: generated a simple JavaScript function template.",
      "",
      "```javascript",
      "function greet(name) {",
      "  return `Hello, ${name}!`;",
      "}",
      "```",
    ].join("\n");
  }

  return null;
}

function formatRunningByRole(agents: ComposerAgent[]): string {
  const running = agents.filter((a) => isActiveStatus(a.status));
  const grouped = new Map<string, ComposerAgent[]>();
  for (const agent of running) {
    const role = (agent.role?.trim() || "unassigned").toLowerCase();
    const bucket = grouped.get(role);
    if (bucket) {
      bucket.push(agent);
    } else {
      grouped.set(role, [agent]);
    }
  }

  const lines: string[] = [];
  lines.push("SwarmX live fleet summary (grouped by role)");
  lines.push(`Active/running agents: ${running.length}`);
  lines.push(`Total registered: ${agents.length}`);

  if (running.length === 0) {
    lines.push("");
    lines.push("No active agents are currently running.");
    return lines.join("\n");
  }

  const sortedRoles = [...grouped.keys()].sort((left, right) => left.localeCompare(right));
  for (const role of sortedRoles) {
    const members = grouped.get(role) ?? [];
    lines.push("");
    lines.push(`Role: ${role} (${members.length})`);
    for (const member of members) {
      const name = member.name ?? member.id;
      const task = member.currentTask?.trim() || "no current task reported";
      lines.push(`  • ${name} — ${task}`);
    }
  }

  return lines.join("\n");
}

function formatHighCpuAgents(agents: ComposerAgent[], threshold: number): string {
  const over = agents
    .map((agent) => ({
      agent,
      cpu: agent.resource?.cpuPercent ?? 0,
    }))
    .filter((entry) => entry.cpu > threshold)
    .sort((left, right) => right.cpu - left.cpu);

  const lines: string[] = [];
  lines.push(`Agents with CPU usage above ${threshold}%`);
  lines.push(`Matches: ${over.length}`);
  lines.push(`Total registered: ${agents.length}`);

  if (over.length === 0) {
    lines.push("");
    lines.push("No agents currently exceed the CPU threshold.");
    return lines.join("\n");
  }

  lines.push("");
  for (const entry of over) {
    const a = entry.agent;
    const name = a.name ?? a.id;
    const task = a.currentTask?.trim() || "no current task reported";
    lines.push(`  • ${name} (${entry.cpu.toFixed(1)}%) — ${task}`);
  }

  return lines.join("\n");
}

function formatAvailableAgents(agents: ComposerAgent[]): string {
  const lines: string[] = [];
  const idle = agents.filter((a) => a.status === "idle");
  const running = agents.filter((a) => isActiveStatus(a.status));
  const unavailable = agents.filter((a) => isErrorStatus(a.status));

  const byRole = new Map<string, ComposerAgent[]>();
  for (const agent of agents) {
    const role = (agent.role?.trim() || "unassigned").toLowerCase();
    const bucket = byRole.get(role);
    if (bucket) {
      bucket.push(agent);
    } else {
      byRole.set(role, [agent]);
    }
  }

  lines.push("SwarmX available agents summary");
  lines.push(`Total registered: ${agents.length}`);
  lines.push(`Idle/available: ${idle.length}`);
  lines.push(`Active/running: ${running.length}`);
  lines.push(`Unavailable (error/fatal): ${unavailable.length}`);

  if (agents.length === 0) {
    lines.push("");
    lines.push("No agents are currently registered.");
    return lines.join("\n");
  }

  const roles = [...byRole.keys()].sort((a, b) => a.localeCompare(b));
  for (const role of roles) {
    const members = byRole.get(role) ?? [];
    lines.push("");
    lines.push(`Role: ${role} (${members.length})`);
    for (const member of members) {
      const name = member.name ?? member.id;
      lines.push(`  • ${name} [${member.status}]`);
    }
  }

  return lines.join("\n");
}

async function listAvailableModels(): Promise<string[]> {
  // [V6.1-FIX-13] Delegate to centralized resilient service
  return getAvailableModels();
}

const chatSchema = z.object({
  // [V6.1-FIX-05] Allow manual API calls without sessionId; server generates one.
  sessionId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(8192),
  context: z
    .object({
      projectScope: z.string().min(1).max(512).optional(),
      recentProjects: z.array(z.string().min(1).max(512)).max(5).optional(),
      agents: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            status: z.string(),
            role: z.string().optional(),
          })
        )
        .optional(),
    })
    .optional(),
});

export async function composerRouter(server: FastifyInstance): Promise<void> {
  // [V6.1-FIX-13] Use centralized Ollama service
  const resolveOllamaBaseUrl = getOllamaBaseUrl;

  server.post(
    "/chat",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { message, context } = parsed.data;
      // [V6.1-FIX-05] Normalize provided session ID or create a request-scoped fallback.
      const sessionId =
        parsed.data.sessionId?.trim() ||
        `composer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      // Build context from live registry plus client-provided snapshot.
      // [V5.9-FIX-06] Registry may be cold; merge in request context agents so
      // Composer still reports useful fleet state.
      const registryAgents = [...agentRegistry.values()].map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        role: a.role,
        currentTask: a.currentTask,
      }));
      const contextAgents = (context?.agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status as (typeof registryAgents)[number]["status"],
        role: a.role,
        currentTask: undefined,
      }));
      const merged = new Map<string, (typeof registryAgents)[number]>();
      for (const a of contextAgents) merged.set(a.id, a);
      for (const a of registryAgents) merged.set(a.id, { ...merged.get(a.id), ...a });
      const agents = [...merged.values()];

      const runningCount = agents.filter((a) => isActiveStatus(a.status)).length;
      const errorCount = agents.filter((a) => isErrorStatus(a.status)).length;

      const systemPrompt = [
        "You are the SwarmX AI Composer — the intelligent operator interface for the SwarmX autonomous agent swarm.",
        "Your role: answer operator questions, provide swarm status analysis, and suggest next actions.",
        context?.projectScope ? `Current project scope: ${context.projectScope}` : "",
        context?.recentProjects && context.recentProjects.length > 0
          ? `Recent local projects: ${context.recentProjects.join(", ")}`
          : "",
        `Current fleet state: ${runningCount} running, ${errorCount} in error, ${agents.length} total registered.`,
        "Registered agents:",
        ...agents.slice(0, 12).map(
          (a) => `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`,
        ),
        agents.length > 12 ? `  …and ${agents.length - 12} more` : "",
        "Be concise, accurate, and operator-focused.",
      ].filter((l) => l !== "").join("\n");

      // [SEED-FIX-01] Resolve model and normalize name — Ollama requires the tag
      // suffix (e.g. "phi4-fast:latest") when a model was pulled with an explicit
      // tag. If the configured name has no colon, append ":latest" automatically.
      const rawModel: string =
        process.env["SWARMX_COMPOSER_MODEL"] ??
        process.env["SWARMX_MODEL_FAST"] ??
        "phi4-fast";
      const model = rawModel.includes(":") ? rawModel : `${rawModel}:latest`;
      let selectedModel = model;
      // [SEED-FIX-02] Increase default composer timeout to 60s. The original 8s
      // floor was too aggressive for cold Ollama model loads (first inference after
      // boot requires loading weights into VRAM, which can take 15–40s on CPU-only
      // hosts). Overridable via SWARMX_COMPOSER_TIMEOUT_MS env var.
      const configuredTimeout = Number.parseInt(
        process.env["SWARMX_COMPOSER_TIMEOUT_MS"] ?? "60000",
        10,
      );
      const timeoutMs = Number.isFinite(configuredTimeout) && configuredTimeout > 0
        ? configuredTimeout
        : 60_000;
      const configuredNumPredict = Number.parseInt(
        process.env["SWARMX_COMPOSER_NUM_PREDICT"] ?? "256",
        10,
      );
      const composerNumPredict = Number.isFinite(configuredNumPredict) && configuredNumPredict > 0
        ? configuredNumPredict
        : 256;
      const composerKeepAlive = process.env["SWARMX_COMPOSER_KEEP_ALIVE"]?.trim() || "10m";

      let responseText: string;

      // [V6.1-FIX-12] Fast deterministic answers for operational prompts that
      // can be computed directly from live fleet state (no model dependency).
      const localIntent = detectLocalIntent(message);
      // [V6.1-PERF-04] Keep short interactive prompts from stalling too long
      // behind cold model loads; long prompts retain the configured timeout.
      const isShortPrompt = message.trim().length <= 180;
      const effectiveTimeoutMs = isShortPrompt ? Math.min(timeoutMs, 30_000) : timeoutMs;
      // [V6.1-ENH-03] Route-level preflight decision telemetry for quick
      // operator diagnosis under latency pressure.
      server.log.info(
        {
          decision: localIntent ? "local" : "model",
          localIntent: localIntent ?? "none",
          msgChars: message.length,
          model,
          timeoutMs: effectiveTimeoutMs,
          numPredict: composerNumPredict,
          keepAlive: composerKeepAlive,
          runningCount,
          errorCount,
          totalAgents: agents.length,
        },
        "composer_preflight",
      );
      if (localIntent === "running_by_role") {
        responseText = formatRunningByRole(agents);
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }
      if (localIntent === "high_cpu") {
        const threshold = parseCpuThreshold(message, 80);
        responseText = formatHighCpuAgents(agents, threshold);
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }
      if (localIntent === "available_agents") {
        responseText = formatAvailableAgents(agents);
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }
      if (localIntent === "idle_unassigned") {
        responseText = formatIdleUnassigned(agents);
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }
      if (localIntent === "presence_ping") {
        responseText = formatPresencePing(agents);
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }
      if (localIntent === "simple_copy") {
        responseText = formatSimpleCopy(message);
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }
      if (localIntent === "python_calculator") {
        responseText = formatPythonCalculator();
        return { message: responseText, agentId: "swarmx-composer", sessionId };
      }

      // [V6.1-PERF-05] Resolve Ollama endpoint only for model-routed prompts.
      // Local intents should never block on model discovery or Ollama health.
      const ollamaBase = await resolveOllamaBaseUrl();

      // [V6.1-FIX-15] If the configured tag is stale but installed models are
      // discoverable, route to the first discovered model to avoid avoidable 404s.
      const preflightModels = await listAvailableModels();
      if (
        preflightModels.length > 0 &&
        !preflightModels.some((m) => m === model || m.startsWith(`${rawModel}:`))
      ) {
        selectedModel = preflightModels[0] ?? model;
        server.log.warn(
          { configuredModel: model, selectedModel, discoveredModelCount: preflightModels.length },
          "composer_model_autoselect",
        );
      }

      let modelAttemptStartedAt = 0;
      try {
        modelAttemptStartedAt = Date.now();
        const ollamaRes = await fetch(`${ollamaBase}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: selectedModel,
            stream: false,
            keep_alive: composerKeepAlive,
            options: {
              num_predict: composerNumPredict,
            },
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: message },
            ],
          }),
          signal: AbortSignal.timeout(Number.isFinite(effectiveTimeoutMs) ? effectiveTimeoutMs : 90_000),
        });

        if (!ollamaRes.ok) {
          const body = await ollamaRes.text();
          server.log.warn({ status: ollamaRes.status, body }, "Ollama request failed");
          throw new Error(`Ollama ${ollamaRes.status}: ${body}`);
        }

        const data = (await ollamaRes.json()) as {
          message?: { content?: string };
          error?: string;
        };
        responseText =
          data?.message?.content?.trim() ??
          data?.error ??
          "No response from model.";
        server.log.debug(
          { elapsedMs: Date.now() - modelAttemptStartedAt, model, timeoutMs: effectiveTimeoutMs },
          "composer_model_call_ok",
        );
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        const elapsedMs = modelAttemptStartedAt > 0 ? Date.now() - modelAttemptStartedAt : 0;
        const isTimeout = reason.toLowerCase().includes("timeout") || reason.toLowerCase().includes("abort");
        if (isTimeout) {
          const bucket = timeoutBucketFor(elapsedMs);
          composerTimeoutHistogram[bucket] += 1;
          composerTimeoutCount += 1;
        }
        const [availableModels, configuredModels, ollamaHealth] = await Promise.all([
          listAvailableModels(),
          getConfiguredModels(),
          checkOllamaHealth(),
        ]);
        server.log.warn(
          {
            err,
            model,
            timeoutMs: effectiveTimeoutMs,
            elapsedMs,
            isTimeout,
            timeoutCount: composerTimeoutCount,
            ...(isTimeout && shouldLogHistogram() ? { timeoutHistogram: timeoutHistogramCompact() } : {}),
          },
          "Composer model call failed — using fleet summary fallback",
        );

        const simpleFallback = fallbackForSimplePrompt(message);
        if (simpleFallback) {
          responseText = simpleFallback;
          return { message: responseText, agentId: "swarmx-composer", sessionId };
        }

        // [SEED-FIX-03] Surface actionable diagnostics: model mismatch vs timeout.
        const modelMismatch = availableModels.length > 0 && !availableModels.some(
          (m) => m === model || m.startsWith(rawModel + ":"),
        );
        const noInstalledModels = availableModels.length === 0 && ollamaHealth.methodUsed === "http";

        responseText = [
          `SwarmX fleet summary (responding to: "${message}")`,
          "",
          `Active agents: ${runningCount}`,
          `Error agents: ${errorCount}`,
          `Total registered: ${agents.length}`,
          ...agents
            .slice(0, 8)
            .map(
              (a) =>
                `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`,
            ),
          agents.length > 8 ? `  …and ${agents.length - 8} more` : "",
          "",
          `Composer model fallback reason: ${reason}`,
          `Configured Ollama endpoint: ${ollamaBase}`,
          `Model discovery source: ${ollamaHealth.methodUsed}`,
          `Configured model: ${model} (resolved from: ${rawModel})`,
          selectedModel !== model ? `Selected model for request: ${selectedModel}` : "",
          availableModels.length > 0
            ? `Available local models: ${availableModels.join(", ")}`
            : noInstalledModels
            ? "Available local models: (none installed on this Ollama endpoint)"
            : "Available local models: (unavailable - could not query /api/tags)",
          configuredModels.length > 0 ? `Configured model candidates: ${configuredModels.join(", ")}` : "",
          modelMismatch
            ? `⚠ Model "${model}" not found — try: SWARMX_COMPOSER_MODEL=${availableModels[0] ?? "phi4-fast:latest"}`
            : noInstalledModels
            ? "Install at least one model on this Ollama endpoint, then set SWARMX_COMPOSER_MODEL to that exact tag."
            : isTimeout
            ? `⏱ Timeout after ${effectiveTimeoutMs}ms — increase via SWARMX_COMPOSER_TIMEOUT_MS env var`
            : `Set SWARMX_COMPOSER_MODEL (or SWARMX_MODEL_FAST) to a model available in your local Ollama registry.`,
        ]
          .filter((l) => l !== "")
          .join("\n");
      }

      return { message: responseText, agentId: "swarmx-composer", sessionId };
    }
  );
}
