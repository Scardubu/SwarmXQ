/**
 * pyevents — Python event journal bridge for SwarmX SSE stream.
 *
 * Polls $SWARMX_HOME/traces/journal.jsonl every POLL_INTERVAL_MS, tracks a
 * byte-offset cursor so only new events are read, maps Python EventKind
 * kind strings to typed SwarmXEvent payloads, and broadcasts via broadcastEvent.
 *
 * Design principles:
 *  [PYE-01] File-cursor approach: reads only the delta since last poll using
 *           byte offsets — no full-file re-read on every tick.
 *  [PYE-02] Fail-open: any I/O or parse error is logged at debug level and
 *           silently skipped; the bridge never crashes the API process.
 *  [PYE-03] Kind mapping is explicit (no dynamic dispatch) so TypeScript can
 *           type-check every event shape at compile time.
 *  [PYE-04] Unknown Python event kinds are forwarded as `log:entry` debug
 *           events so the dashboard always shows all activity.
 *
 * [V5.9-FIX-05] Initial implementation bridging EventKind constants added to
 * event_bus.py (WORKER_JOB_STARTED, MISSION_CREATED, RUN_STARTED, etc.) to
 * the expanded SwarmXEvent union in types/events.ts.
 */
import type { FastifyInstance } from "fastify";
import { open } from "node:fs/promises";
import { join } from "node:path";
import { broadcastEvent } from "../plugins/sse.js";
import type { SwarmXEvent } from "../types/events.js";

const POLL_INTERVAL_MS = Number.parseInt(
  process.env["SWARMX_PYEVENTS_POLL_MS"] ?? "2500",
  10,
);

const RUNTIME_HOME =
  process.env["SWARMX_HOME"] ??
  `${process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""}/.swarmx`;

const JOURNAL_PATH = join(RUNTIME_HOME, "traces", "journal.jsonl");

// ── Byte-cursor state ─────────────────────────────────────────────────────────

let _cursor = -1; // [V5.9-PERF-01] -1 means "prime to EOF on first successful read"

// ── Python kind → SwarmXEvent mapper ─────────────────────────────────────────

export interface RawJournalEvent {
  kind: string;
  created_at?: string;
  payload?: Record<string, unknown>;
}

function toTimestamp(raw: RawJournalEvent): string {
  return typeof raw.created_at === "string" ? raw.created_at : new Date().toISOString();
}

export function mapJournalEvent(raw: RawJournalEvent): SwarmXEvent | null {
  const p = raw.payload ?? {};
  const ts = toTimestamp(raw);

  switch (raw.kind) {
    // ── Run lifecycle ───────────────────────────────────────────────────────
    case "run.started":
      return {
        type: "run:started",
        data: {
          jobId: String(p["job_id"] ?? ""),
          repo: String(p["repo"] ?? ""),
          target: String(p["target"] ?? ""),
          timestamp: ts,
        },
      };

    case "run.completed":
      return {
        type: "run:completed",
        data: {
          jobId: String(p["job_id"] ?? ""),
          runId: String(p["run_id"] ?? ""),
          status: (["success", "partial", "failed", "error"].includes(String(p["status"]))
            ? p["status"]
            : "error") as "success" | "partial" | "failed" | "error",
          timestamp: ts,
        },
      };

    // ── Mission lifecycle ───────────────────────────────────────────────────
    case "mission.created":
      return {
        type: "mission:created",
        data: {
          missionId: String(p["mission_id"] ?? ""),
          repo: String(p["repo"] ?? ""),
          target: String(p["target"] ?? ""),
          timestamp: ts,
        },
      };

    // ── Task lifecycle ──────────────────────────────────────────────────────
    case "task.start":
      return {
        type: "task:start",
        data: {
          goal: String(p["goal"] ?? ""),
          timestamp: ts,
          ...(typeof p["step_index"] === "number" ? { stepIndex: p["step_index"] } : {}),
          ...(typeof p["run_id"] === "string" ? { runId: p["run_id"] } : {}),
        },
      };

    case "task.complete":
      return {
        type: "task:complete",
        data: {
          goal: String(p["goal"] ?? ""),
          timestamp: ts,
          ...(typeof p["step_index"] === "number" ? { stepIndex: p["step_index"] } : {}),
          ...(typeof p["run_id"] === "string" ? { runId: p["run_id"] } : {}),
        },
      };

    case "task.failed":
      return {
        type: "task:failed",
        data: {
          goal: String(p["goal"] ?? ""),
          timestamp: ts,
          ...(typeof p["step_index"] === "number" ? { stepIndex: p["step_index"] } : {}),
          ...(typeof p["run_id"] === "string" ? { runId: p["run_id"] } : {}),
        },
      };

    // ── Evolution lifecycle ─────────────────────────────────────────────────
    case "evolution.started":
      return {
        type: "evolution:started",
        data: {
          jobId: String(p["job_id"] ?? ""),
          timestamp: ts,
          ...(typeof p["repo"] === "string" ? { repo: p["repo"] } : {}),
        },
      };

    case "evolution.completed":
      return {
        type: "evolution:completed",
        data: {
          jobId: String(p["job_id"] ?? ""),
          timestamp: ts,
          ...(typeof p["proposal_count"] === "number" ? { proposalCount: p["proposal_count"] } : {}),
        },
      };

    // ── Worker job lifecycle ────────────────────────────────────────────────
    case "worker.job_started":
      return {
        type: "worker:job_started",
        data: {
          jobId: String(p["job_id"] ?? ""),
          timestamp: ts,
          ...(typeof p["kind"] === "string" ? { kind: p["kind"] } : {}),
          ...(typeof p["repo"] === "string" ? { repo: p["repo"] } : {}),
          ...(typeof p["target"] === "string" ? { target: p["target"] } : {}),
        },
      };

    case "worker.job_done":
      return {
        type: "worker:job_done",
        data: {
          jobId: String(p["job_id"] ?? ""),
          timestamp: ts,
        },
      };

    case "worker.job_error":
      return {
        type: "worker:job_error",
        data: {
          jobId: String(p["job_id"] ?? ""),
          timestamp: ts,
          ...(typeof p["error"] === "string" ? { error: p["error"] } : {}),
        },
      };

    // ── Fallback: forward as debug log entry ────────────────────────────────
    default:
      // [PYE-04] Unknown kinds are surfaced as debug log entries rather than
      // being silently dropped, so the dashboard always shows all activity.
      return {
        type: "log:entry",
        data: {
          timestamp: ts,
          level: "debug",
          message: `[pyevents] kind=${raw.kind} ${JSON.stringify(p).slice(0, 200)}`,
        },
      };
  }
}

// ── Polling tick ───────────────────────────────────────────────────────────────

async function tick(log: FastifyInstance["log"]): Promise<void> {
  let fh: Awaited<ReturnType<typeof open>> | null = null;
  try {
    fh = await open(JOURNAL_PATH, "r");
    const stat = await fh.stat();

    // [V5.9-PERF-01] On first successful open, prime to the current EOF so the
    // live poller only broadcasts new events. Historical hydration happens via
    // GET /api/logs/events and should not be replayed over SSE on every API boot.
    if (_cursor < 0) {
      _cursor = stat.size;
      return;
    }

    // If the file shrank (rotation / truncation), reset cursor to beginning
    if (stat.size < _cursor) {
      _cursor = 0;
    }

    // Nothing new
    if (stat.size === _cursor) {
      return;
    }

    // [PYE-01] Read only the delta since last cursor
    const delta = stat.size - _cursor;
    const buf = Buffer.alloc(delta);
    const { bytesRead } = await fh.read(buf, 0, delta, _cursor);
    _cursor += bytesRead;

    const text = buf.subarray(0, bytesRead).toString("utf8");
    const lines = text.split(/\r?\n/).filter(Boolean);

    for (const line of lines) {
      try {
        const raw = JSON.parse(line) as RawJournalEvent;
        const event = mapJournalEvent(raw);
        if (event) {
          broadcastEvent(event);
        }
      } catch {
        // Malformed line — skip silently [PYE-02]
      }
    }
  } catch (err) {
    // File not found (journal not yet created) or read error — log at debug [PYE-02]
    log.debug({ err }, "pyevents poll skipped");
  } finally {
    if (fh) {
      await fh.close().catch(() => {});
    }
  }
}

// ── Public start function ─────────────────────────────────────────────────────

export function startPyEventsPoller(server: FastifyInstance): void {
  const handle = setInterval(() => {
    tick(server.log).catch(() => {});
  }, POLL_INTERVAL_MS);

  server.addHook("onClose", async () => {
    clearInterval(handle);
  });

  // Initial poll after short delay so the journal file has time to appear
  setTimeout(() => {
    tick(server.log).catch(() => {});
  }, 3_000);

  server.log.info(
    { journalPath: JOURNAL_PATH, intervalMs: POLL_INTERVAL_MS },
    "Python event bridge started",
  );
}
