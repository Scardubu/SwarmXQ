import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { agentRegistry } from "./agents.js";
// Use built-in fetch (Node.js 18+ / TypeScript globalThis)

const chatSchema = z.object({
  sessionId: z.string().min(1).max(128),
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
  // [V5.9-FIX-06] Resolve Ollama endpoint from canonical env vars used across
  // SwarmX runtime components and normalize host-only values.
  const resolveOllamaBaseUrl = (): string => {
    const raw =
      process.env["SWARMX_OLLAMA_BASE_URL"] ??
      process.env["SWARMX_OLLAMA_URL"] ??
      process.env["OLLAMA_HOST"] ??
      "http://127.0.0.1:11434";
    const candidate = raw.trim();
    if (!candidate) return "http://127.0.0.1:11434";
    if (candidate.startsWith("http://") || candidate.startsWith("https://")) {
      return candidate.replace(/\/+$/, "");
    }
    return `http://${candidate.replace(/\/+$/, "")}`;
  };

  server.post(
    "/chat",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { message, context } = parsed.data;

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

      const runningCount = agents.filter((a) => a.status === "running").length;
      const errorCount = agents.filter(
        (a) => a.status === "error" || a.status === "fatal",
      ).length;

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

      const ollamaBase = resolveOllamaBaseUrl();
      const model =
        process.env["SWARMX_COMPOSER_MODEL"] ??
        process.env["SWARMX_MODEL_FAST"] ??
        "phi4-fast";
      const timeoutMs = Number.parseInt(
        process.env["SWARMX_COMPOSER_TIMEOUT_MS"] ?? "90000",
        10,
      );

      let responseText: string;
      try {
        const ollamaRes = await fetch(`${ollamaBase}/api/chat`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            stream: false,
            messages: [
              { role: "system", content: systemPrompt },
              { role: "user", content: message },
            ],
          }),
          signal: AbortSignal.timeout(Number.isFinite(timeoutMs) ? timeoutMs : 90_000),
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
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        server.log.warn({ err }, "Composer model call failed — using fleet summary fallback");
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
          `Configured model: ${model}`,
          `Set SWARMX_COMPOSER_MODEL (or SWARMX_MODEL_FAST) to a model available in your local Ollama registry.`,
        ]
          .filter((l) => l !== "")
          .join("\n");
      }

      return { message: responseText, agentId: "swarmx-composer" };
    }
  );
}
