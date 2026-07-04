/**
 * journald streaming — `journalctl -f -o json` → SSE log:entry events
 *
 * Spawns a child process and reads JSON-formatted journal entries.
 * Each entry is broadcast as a `log:entry` SSE event.
 */
import type { FastifyInstance } from "fastify";
import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { broadcastEvent } from "../plugins/sse.js";
import type { LogLevel, SwarmXEvent } from "../types/events.js";

// journald priority → LogLevel
const PRIORITY_MAP: Record<string, LogLevel> = {
  "0": "emergency",
  "1": "alert",
  "2": "critical",
  "3": "error",
  "4": "warn",
  "5": "notice",
  "6": "info",
  "7": "debug",
};

interface JournaldEntry {
  __REALTIME_TIMESTAMP?: string;
  PRIORITY?: string;
  MESSAGE?: string;
  _SYSTEMD_UNIT?: string;
  SYSLOG_IDENTIFIER?: string;
  SWARMX_AGENT_ID?: string;
  SWARMX_TRACE_ID?: string;
}

type LogEntryData = Extract<SwarmXEvent, { type: "log:entry" }>[
  "data"
];

function parseJournaldEntry(line: string): LogEntryData | null {
  try {
    const raw = JSON.parse(line) as JournaldEntry;
    const tsUs = Number.parseInt(raw.__REALTIME_TIMESTAMP ?? "0", 10);
    const timestamp = tsUs > 0
      ? new Date(tsUs / 1000).toISOString()
      : new Date().toISOString();

    const message = Array.isArray(raw.MESSAGE)
      ? Buffer.from(raw.MESSAGE as unknown as number[]).toString("utf8")
      : (raw.MESSAGE ?? "");

    const unit = raw._SYSTEMD_UNIT ?? raw.SYSLOG_IDENTIFIER;
    const agentId = raw.SWARMX_AGENT_ID;
    const traceId = raw.SWARMX_TRACE_ID;

    return {
      timestamp,
      level: PRIORITY_MAP[raw.PRIORITY ?? "6"] ?? "info",
      message,
      ...(unit !== undefined && { unit }),
      ...(agentId !== undefined && { agentId }),
      ...(traceId !== undefined && { traceId }),
    };
  } catch {
    return null;
  }
}

let _journalProcess: ChildProcess | null = null;

export async function startJournaldStream(server: FastifyInstance): Promise<void> {
  // journalctl only available on Linux
  if (process.platform !== "linux") {
    server.log.warn("journald not available — skipping log stream (non-Linux host)");
    return;
  }

  const args = [
    "-f",          // Follow new entries
    "-o", "json",  // JSON output format
    "--no-pager",
    // Optionally filter by SwarmX units
    ...(process.env["SWARMX_JOURNAL_UNITS"]
      ? process.env["SWARMX_JOURNAL_UNITS"].split(",").flatMap((u) => ["-u", u.trim()])
      : []),
  ];

  let lineBuffer = "";

  const start = () => {
    const proc = spawn("journalctl", args, { stdio: ["ignore", "pipe", "pipe"] });
    _journalProcess = proc;

    proc.stdout.setEncoding("utf8");
    proc.stdout.on("data", (chunk: string) => {
      lineBuffer += chunk;
      const lines = lineBuffer.split("\n");
      lineBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = parseJournaldEntry(line);
        if (entry) {
          broadcastEvent({ type: "log:entry", data: entry });
        }
      }
    });

    proc.stderr.on("data", (chunk: string) => {
      server.log.debug({ chunk }, "journalctl stderr");
    });

    proc.on("exit", (code) => {
      server.log.warn({ code }, "journalctl exited — restarting in 2s");
      _journalProcess = null;
      setTimeout(start, 2000);
    });

    proc.on("error", (err) => {
      server.log.warn({ err }, "journalctl process error");
    });
  };

  start();

  server.addHook("onClose", async () => {
    _journalProcess?.kill("SIGTERM");
  });
}
