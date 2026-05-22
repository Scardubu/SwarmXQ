/**
 * apps/swarmx-api/src/server.ts  (patch diff — apply to your existing server.ts)
 *
 * ADD the following imports and registration call to your existing server.ts.
 * This file shows the complete additions needed; do not replace your entire server.ts.
 *
 * ─── Step 1: Add imports ──────────────────────────────────────────────────────
 *
 *   import { videoRoutes } from "./routes/video.js";
 *
 * ─── Step 2: Register video routes after existing route registrations ─────────
 *
 *   await app.register(videoRoutes, { broadcast });
 *
 * ─── Step 3: Ensure SSE broadcaster includes video events ────────────────────
 *
 *   The broadcast function passed to videoRoutes must be the same one used
 *   by your existing SSE endpoint (typically /api/events).
 *   If your SSE broadcaster already accepts SwarmXEvent, no changes needed —
 *   video events conform to the same union.
 *
 * ─── Complete server.ts additions (minimal) ──────────────────────────────────
 */

// ── EXISTING server.ts content (abbreviated) ─────────────────────────────────

import Fastify from "fastify";
import cors from "@fastify/cors";
import { videoRoutes } from "./routes/video.js";        // ← ADD
import type { SwarmXEvent } from "./types/events.js";

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000",
});

// ── SSE broadcaster (existing pattern — keep yours, just ensure type is SwarmXEvent)

const sseClients = new Set<{
  write: (chunk: string) => void;
  close: () => void;
}>();

function broadcast(event: SwarmXEvent): void {
  const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(frame);
    } catch {
      sseClients.delete(client);
    }
  }
}

// ── SSE endpoint (existing) ────────────────────────────────────────────────────

app.get("/api/events", async (request, reply) => {
  reply.raw.setHeader("Content-Type", "text/event-stream");
  reply.raw.setHeader("Cache-Control", "no-cache");
  reply.raw.setHeader("Connection", "keep-alive");
  reply.raw.flushHeaders();

  const client = {
    write: (chunk: string) => reply.raw.write(chunk),
    close: () => reply.raw.end(),
  };
  sseClients.add(client);

  // Heartbeat every 25s
  const heartbeat = setInterval(() => {
    broadcast({
      type: "system:heartbeat",
      timestamp: new Date().toISOString(),
      payload: { uptime: process.uptime() },
    });
  }, 25_000);

  request.raw.on("close", () => {
    sseClients.delete(client);
    clearInterval(heartbeat);
  });

  // Don't resolve — keep connection alive
  await new Promise<void>((resolve) =>
    request.raw.on("close", resolve)
  );
});

// ── Video routes ──────────────────────────────────────────────────────────────
//  ↓ ADD THIS — register after your other route plugins
await app.register(videoRoutes, { broadcast });             // ← ADD

// ── Start ──────────────────────────────────────────────────────────────────────

await app.listen({
  port: parseInt(process.env.PORT ?? "7380", 10),
  host: "0.0.0.0",
});

export { app };