import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { agentRegistry } from "./agents.js";
// Use built-in fetch (Node.js 18+ / TypeScript globalThis)

const chatSchema = z.object({
  sessionId: z.string().min(1).max(128),
  message: z.string().min(1).max(8192),
  context: z
    .object({
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
  server.post(
    "/chat",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { message, context } = parsed.data;

      // Build context from live registry
      const agents = [...agentRegistry.values()].map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        role: a.role,
        currentTask: a.currentTask,
      }));

      const runningCount = agents.filter((a) => a.status === "running").length;
      const errorCount = agents.filter(
        (a) => a.status === "error" || a.status === "fatal",
      ).length;

      const systemPrompt = [
        "You are the SwarmX AI Composer — the intelligent operator interface for the SwarmX autonomous agent swarm.",
        "Your role: answer operator questions, provide swarm status analysis, and suggest next actions.",
        `Current fleet state: ${runningCount} running, ${errorCount} in error, ${agents.length} total registered.`,
        "Registered agents:",
        ...agents.slice(0, 12).map(
          (a) => `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`,
        ),
        agents.length > 12 ? `  …and ${agents.length - 12} more` : "",
        "Be concise, accurate, and operator-focused.",
      ].filter((l) => l !== "").join("\n");

      const ollamaBase =
        process.env["SWARMX_OLLAMA_BASE_URL"] ?? "http://localhost:11434";
      const model = process.env["SWARMX_COMPOSER_MODEL"] ?? "phi4-mini";

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
          signal: AbortSignal.timeout(30_000),
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
        server.log.warn({ err }, "Ollama unavailable — using fleet summary fallback");
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
          `Ollama unreachable — set SWARMX_OLLAMA_BASE_URL to enable AI responses.`,
        ]
          .filter((l) => l !== "")
          .join("\n");
      }

      return { message: responseText, agentId: "swarmx-composer" };
    }
  );
}
