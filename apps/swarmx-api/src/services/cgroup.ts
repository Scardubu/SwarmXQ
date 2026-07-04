/**
 * cgroup v2 poller — walks /sys/fs/cgroup/swarmx.slice/
 * and broadcasts CgroupScopeMetrics events per scope every 2s.
 */
import type { FastifyInstance } from "fastify";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { broadcastEvent } from "../plugins/sse.js";
import type { CgroupScopeMetrics } from "../types/events.js";

const CGROUP_ROOT = process.env["SWARMX_CGROUP_ROOT"] ?? "/sys/fs/cgroup/swarmx.slice";
const INTERVAL_MS = parseInt(process.env["SWARMX_CGROUP_INTERVAL_MS"] ?? "2000", 10);

async function readCgroupFile(scopePath: string, filename: string): Promise<string> {
  return readFile(path.join(scopePath, filename), "utf8");
}

async function parseCpuStat(scopePath: string): Promise<{ usageUs: number; throttledUs: number }> {
  const raw = await readCgroupFile(scopePath, "cpu.stat");
  const lines = raw.trim().split("\n");
  let usageUs = 0;
  let throttledUs = 0;
  for (const line of lines) {
    const [key, val] = line.split(" ");
    if (key === "usage_usec") usageUs = parseInt(val ?? "0", 10);
    if (key === "throttled_usec") throttledUs = parseInt(val ?? "0", 10);
  }
  return { usageUs, throttledUs };
}

// Per-scope previous CPU ticks for delta calculation
const _prevCpuTicks = new Map<string, { usageUs: number; throttledUs: number; ts: number }>();

export function startCgroupPoller(server: FastifyInstance): void {
  const tick = async () => {
    try {
      const entries = await readdir(CGROUP_ROOT, { withFileTypes: true });
      const scopeDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name);

      await Promise.all(
        scopeDirs.map(async (scope) => {
          const scopePath = path.join(CGROUP_ROOT, scope);
          try {
            const now = Date.now();

            // Memory current
            const memRaw = await readCgroupFile(scopePath, "memory.current");
            const memBytes = parseInt(memRaw.trim(), 10);

            // OOM events
            let oomEvents = 0;
            try {
              const oomRaw = await readCgroupFile(scopePath, "memory.events");
              for (const line of oomRaw.split("\n")) {
                if (line.startsWith("oom ")) oomEvents = parseInt(line.split(" ")[1] ?? "0", 10);
              }
            } catch { /* no memory.events */ }

            // CPU stat delta
            let cpuPercent = 0;
            let throttledPct = 0;
            try {
              const cpu = await parseCpuStat(scopePath);
              const prev = _prevCpuTicks.get(scopePath);
              if (prev) {
                const dtMs = now - prev.ts;
                const dtUs = dtMs * 1000; // 1 CPU at 100% = 1,000,000 usec/s
                const usageDelta = cpu.usageUs - prev.usageUs;
                const throttledDelta = cpu.throttledUs - prev.throttledUs;
                cpuPercent = dtUs > 0 ? Math.min(100, (usageDelta / dtUs) * 100) : 0;
                throttledPct = (usageDelta + throttledDelta) > 0
                  ? (throttledDelta / (usageDelta + throttledDelta)) * 100
                  : 0;
              }
              _prevCpuTicks.set(scopePath, { ...cpu, ts: now });
            } catch { /* no cpu.stat */ }

            const metrics: CgroupScopeMetrics = {
              agentId: scope,
              path: scopePath,
              cpuUsagePercent: cpuPercent,
              cpuPercent,
              cpuThrottledPercent: throttledPct,
              memoryCurrentMb: isNaN(memBytes) ? 0 : memBytes / (1024 * 1024),
              memCurrentMb: isNaN(memBytes) ? 0 : memBytes / (1024 * 1024),
              memHighMb: null,
              memMaxMb: null,
              cpuThrottledPct: throttledPct,
              oomKillCount: oomEvents,
              oomEvents,
              ioReadBytes: 0,
              ioWriteBytes: 0,
            };

            broadcastEvent({ type: "cgroup:metrics", data: metrics });

            // Fire OOM alert event if non-zero
            if (oomEvents > 0) {
              broadcastEvent({
                type: "system:oom",
                data: { agentId: scope, cgroupPath: scopePath, count: oomEvents },
              });
            }
          } catch {
            // Scope may have been removed mid-poll — skip silently
          }
        })
      );
    } catch {
      // CGROUP_ROOT may not exist on non-Linux — log once then stop trying
    }
  };

  const intervalId = setInterval(tick, INTERVAL_MS);
  server.addHook("onClose", async () => clearInterval(intervalId));
}
