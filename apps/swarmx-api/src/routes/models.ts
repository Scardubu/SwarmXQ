/**
 * apps/swarmx-api/src/routes/models.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * GET /api/models/status
 * Version : v2026.6.28-apex17-r8
 *
 * Returns the current resident-model snapshot from ModelOrchestrator for the
 * dashboard's Model Topology section (settings/page.tsx). Reconciles against
 * Ollama's own /api/ps via getResidentModels() on each request — guarantees
 * the dashboard never shows stale state from the in-process cache alone.
 *
 * Response shape:
 *   {
 *     residentModels: Array<{ tag, operator, is7B, estimatedRamMb }>;
 *     active7B:       string | null;   // canonical tag of the resident 7B model, if any
 *     ramAvailableMb: number;           // from /proc/meminfo MemAvailable
 *     mode:           string;           // "normal" | "low-ram" | "evolver" | "degraded"
 *   }
 *
 * If Ollama is unreachable (cold start), returns an empty residentModels array
 * rather than a 5xx, so the dashboard degrades gracefully.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import type { FastifyInstance } from "fastify";
import { getModelOrchestrator } from "../services/model-orchestrator.js";

export async function registerModelsRoutes(server: FastifyInstance): Promise<void> {
  server.get(
    "/api/models/status",
    {
      schema: {
        tags: ["models"],
        summary: "Resident model status — for settings/Model Topology dashboard section",
        response: {
          200: {
            type: "object",
            properties: {
              residentModels: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    tag:            { type: "string" },
                    operator:       { type: "string" },
                    is7B:           { type: "boolean" },
                    estimatedRamMb: { type: "number" },
                  },
                },
              },
              active7B:       { type: ["string", "null"] },
              ramAvailableMb: { type: "number" },
              mode:           { type: "string" },
            },
          },
        },
      },
    },
    async (_request, reply) => {
      const orchestrator = getModelOrchestrator();

      try {
        const residentModels = await orchestrator.getResidentModels();
        const snap = orchestrator.getRamSnapshot();

        return reply.code(200).send({
          residentModels,
          active7B:       snap.active7B,
          ramAvailableMb: snap.availableMb,
          mode:           snap.mode,
        });
      } catch (err) {
        server.log.warn({ err }, "models_status_ollama_unreachable");
        return reply.code(200).send({
          residentModels: [],
          active7B:       null,
          ramAvailableMb: 0,
          mode:           "degraded",
        });
      }
    },
  );
}
