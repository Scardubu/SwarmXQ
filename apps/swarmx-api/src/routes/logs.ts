import type { FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { SwarmXEvent } from "../types/events.js";
import { mapJournalEvent, type RawJournalEvent } from "../services/pyevents.js";

const LOG_DIR = process.env["SWARMX_LOG_DIR"] ?? "/var/log/swarmx";
const SWARMX_HOME =
  process.env["SWARMX_HOME"] ??
  path.join(process.env["HOME"] ?? process.env["USERPROFILE"] ?? "", ".swarmx");

// [V5.9-FIX-05] Max events returned from the journal endpoint to prevent
// large payload spikes. Overridable via SWARMX_EVENTS_LIMIT env var.
const EVENTS_LIMIT = Number.parseInt(
  process.env["SWARMX_EVENTS_LIMIT"] ?? "200",
  10,
);

export async function logsRouter(server: FastifyInstance): Promise<void> {
  // [V6.1-ENH-02] Expose a base route so manual probes of /api/logs return the
  // available log surfaces instead of a misleading 404.
  server.get("/", async () => ({
    endpoints: {
      files: "/api/logs/files",
      events: "/api/logs/events",
    },
    logDir: LOG_DIR,
    swarmHome: SWARMX_HOME,
  }));

  server.get("/files", async () => {
    try {
      const files = (await readdir(LOG_DIR)).filter((f) => f.endsWith(".log") || f.endsWith(".jsonl"));
      return files.map((f) => ({ name: f, path: path.join(LOG_DIR, f) }));
    } catch {
      return [];
    }
  });

  /**
   * GET /api/logs/events?limit=N
   *
    * [V5.9-FIX-05] Returns the last N Python journal events from
    * $SWARMX_HOME/traces/journal.jsonl, already mapped into SwarmXEvent shapes.
    * The dashboard uses this once on load to hydrate recent activity before the
    * live SSE stream begins delivering new events.
   *
   * Limit is capped at EVENTS_LIMIT (default 200) to prevent memory spikes.
   */
  server.get<{ Querystring: { limit?: string } }>("/events", async (req) => {
    const requested = Number.parseInt(req.query.limit ?? String(EVENTS_LIMIT), 10);
    const limit = Number.isFinite(requested) && requested > 0
      ? Math.min(requested, EVENTS_LIMIT)
      : EVENTS_LIMIT;

    const journalPath = path.join(SWARMX_HOME, "traces", "journal.jsonl");
    try {
      const raw = await readFile(journalPath, "utf8");
      const lines = raw
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-limit);

      const events = lines.flatMap((line): SwarmXEvent[] => {
        try {
          const mapped = mapJournalEvent(JSON.parse(line) as RawJournalEvent);
          return mapped ? [mapped] : [];
        } catch {
          return [];
        }
      });

      return { events, count: events.length };
    } catch {
      // Journal file not yet created — return empty result
      return { events: [], count: 0 };
    }
  });
}
