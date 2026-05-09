/**
 * V5 metrics poller — periodically calls `python -m swarmx metrics`
 * and broadcasts the Swarm Coherence Score (SCS) and runtime governor
 * snapshot (pressure level, concurrency, token ceilings) via SSE.
 *
 * WAT (UTC+1) timestamps are used per Nigerian fintech compliance requirements.
 */
import type { FastifyInstance } from "fastify";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import { broadcastEvent } from "../plugins/sse.js";
import type { RuntimeGovernorSnapshot, StartupSummary } from "../types/events.js";

const execFileAsync = promisify(execFile);

function watNow(): string {
  return new Date(Date.now() + 3_600_000).toISOString().replace("Z", "+01:00");
}

interface V5MetricsPayload {
  scs_history?: number[];
  coherence_score?: number;
  tier?: string;
  event_counts?: Record<string, number>;
  error_rate?: number;
  retry_rate?: number;
  memory_entries?: number;
  governor_snapshot?: RuntimeGovernorSnapshot;
}

function parseMetricsPayload(rawStdout: string): V5MetricsPayload | null {
  const trimmed = rawStdout.trim();
  if (!trimmed) {
    return null;
  }

  // [V6.1-FIX-10] CLI startup logs may be emitted before the JSON payload.
  // Parse from the first JSON object delimiter instead of assuming clean stdout.
  const jsonStart = trimmed.indexOf("{");
  if (jsonStart < 0) {
    return null;
  }

  const candidate = trimmed.slice(jsonStart);
  return JSON.parse(candidate) as V5MetricsPayload;
}

function buildPythonPath(repoRoot: string): string {
  const segments = [
    join(repoRoot, "src"),
    repoRoot,
    process.env["PYTHONPATH"] ?? "",
  ].filter((value) => value.length > 0);

  return segments.join(delimiter);
}

export function startV5MetricsPoller(server: FastifyInstance): void {
  const INTERVAL_MS = Number.parseInt(
    process.env["SWARMX_V5_POLL_INTERVAL_MS"] ?? "15000",
    10
  );
  // [V6.1-FIX-03] Prefer python3, fallback to python, then SWARMX_PYTHON env var
  const pythonExe = process.env["SWARMX_PYTHON"] ?? "python3";
  const repoRoot = resolve(process.env["SWARMX_REPO_ROOT"] ?? process.cwd());
  const runtimeHome =
    process.env["SWARMX_HOME"] ??
    `${process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""}/.swarmx`;
  const pythonEnv = {
    ...process.env,
    PYTHONPATH: buildPythonPath(repoRoot),
  };

  const tick = async (): Promise<void> => {
    // ── SCS metrics ─────────────────────────────────────────────────────────
    try {
      const { stdout } = await execFileAsync(
        pythonExe,
        ["-m", "swarmx", "metrics", "--home", runtimeHome, "--format", "json"],
        {
          timeout: 12_000,
          cwd: repoRoot,
          env: pythonEnv,
        }
      );

      const payload = parseMetricsPayload(stdout);
      if (payload) {

        const history: number[] = Array.isArray(payload.scs_history)
          ? payload.scs_history.map(Number)
          : [];

        const last = history.at(-1) ?? 0;
        const score: number =
          typeof payload.coherence_score === "number"
            ? payload.coherence_score
            : last;

        broadcastEvent({
          type: "system:scs",
          data: {
            score: Math.min(1, Math.max(0, score)),
            history: history.slice(-20),
            timestamp: watNow(),
          },
        });

        if (payload.governor_snapshot) {
          broadcastEvent({
            type: "system:governor",
            data: payload.governor_snapshot,
          });
        }
      }
    } catch (err) {
      server.log.debug({ err }, "V5 metrics poll skipped");
    }
  };

  const handle = setInterval(() => {
    tick().catch(() => {
      // Intentionally swallow — error already logged inside tick()
    });
  }, INTERVAL_MS);

  server.addHook("onClose", async () => {
    clearInterval(handle);
  });

  // Initial poll after short delay to let server finish boot
  setTimeout(() => {
    tick().catch(() => {});
  }, 5_000);

  server.log.info(
    { intervalMs: INTERVAL_MS, pythonExe, repoRoot, runtimeHome },
    "V5 metrics poller started"
  );
}

// ── Startup summary broadcast (V6.1-ENH-01) ──────────────────────────────────

/**
 * Read the startup_summary.json written by the Python startup autopilot and
 * broadcast it as a "system:startup" SSE event. Called once after server boot.
 * Fail-open — any error is logged and silently ignored.
 */
export function broadcastStartupSummary(server: FastifyInstance): void {
  const runtimeHome =
    process.env["SWARMX_HOME"] ??
    `${process.env["HOME"] ?? process.env["USERPROFILE"] ?? ""}/.swarmx`;

  const summaryPath = join(runtimeHome, "state", "startup_summary.json");

  try {
    const raw = readFileSync(summaryPath, "utf-8");
    const summary = JSON.parse(raw) as StartupSummary;
    broadcastEvent({ type: "system:startup", data: summary });
    server.log.info(
      { status: summary.status, pressureLevel: summary.pressureLevel, durationMs: summary.durationMs },
      "Startup summary broadcast"
    );
  } catch (err) {
    // startup_summary.json may not exist on first boot — this is expected
    server.log.debug({ err }, "Startup summary not available (skipping broadcast)");
  }
}
