/**
 * SSE plugin — `/api/events`
 *
 * Broadcasts SwarmXEvent JSON lines to all connected dashboard clients.
 * The server keeps an in-memory Set of active connections and flushes
 * pending events on every poll cycle.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import type { SwarmXEvent } from "../types/events.js";

// ── Subscriber registry ───────────────────────────────────────────────────────

const subscribers = new Set<FastifyReply>();
const STICKY_EVENT_TYPES: SwarmXEvent["type"][] = [
  "system:startup",
  "system:governor",
  "system:scs",
];
const stickyEvents = new Map<SwarmXEvent["type"], SwarmXEvent>();

function writeEvent(reply: FastifyReply, event: SwarmXEvent): void {
  reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
}

function rememberStickyEvent(event: SwarmXEvent): void {
  if (STICKY_EVENT_TYPES.includes(event.type)) {
    stickyEvents.set(event.type, event);
  }
}

function replayStickyEvents(reply: FastifyReply): void {
  for (const type of STICKY_EVENT_TYPES) {
    const event = stickyEvents.get(type);
    if (event) {
      writeEvent(reply, event);
    }
  }
}

/**
 * Emit a single event to every connected SSE client.
 * Non-blocking — skips write if the response has already closed.
 */
export function broadcastEvent(event: SwarmXEvent): void {
  rememberStickyEvent(event);
  for (const reply of subscribers) {
    try {
      writeEvent(reply, event);
    } catch {
      subscribers.delete(reply);
    }
  }
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export async function ssePlugin(server: FastifyInstance): Promise<void> {
  // [V6.1-FIX-07] Keep /api/events as canonical and preserve /api/sse as a
  // compatibility alias for older smoke tests, docs, and external clients.
  const streamHandler = async (req: FastifyRequest, reply: FastifyReply) => {
    reply.raw.setHeader("Content-Type", "text/event-stream");
    reply.raw.setHeader("Cache-Control", "no-cache, no-transform");
    reply.raw.setHeader("Connection", "keep-alive");
    reply.raw.setHeader("X-Accel-Buffering", "no"); // Disable nginx buffering
    reply.raw.flushHeaders();

    // Send an initial comment to confirm connection
    reply.raw.write(": connected\n\n");
    replayStickyEvents(reply);

    subscribers.add(reply);

    // Keep-alive heartbeat every 15 s
    const heartbeat = setInterval(() => {
      try {
        reply.raw.write(`: heartbeat ${Date.now()}\n\n`);
      } catch {
        clearInterval(heartbeat);
        subscribers.delete(reply);
      }
    }, 15_000);

    req.raw.on("close", () => {
      clearInterval(heartbeat);
      subscribers.delete(reply);
    });

    // Never resolve — the stream stays open until the client disconnects
    await new Promise<void>((resolve) => {
      req.raw.on("close", resolve);
    });
  };

  const streamSchema = {
    description: "Server-Sent Events stream for SwarmX real-time updates",
    response: { 200: { type: "string" } },
  };

  server.get(
    "/api/events",
    {
      schema: streamSchema,
    },
    streamHandler
  );

  server.get(
    "/api/sse",
    {
      schema: streamSchema,
    },
    streamHandler
  );
}
