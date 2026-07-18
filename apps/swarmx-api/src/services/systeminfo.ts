/**
 * systeminformation poller — samples CPU/mem/disk/network every 2s
 * and broadcasts SystemMetricsSnapshot events via SSE.
 */
import type { FastifyInstance } from "fastify";
import si from "systeminformation";
import { broadcastEvent } from "../plugins/sse.js";
import type { SystemMetricsSnapshot } from "../types/events.js";
import { loadEnv } from "../lib/env.js";

// WAT = UTC+1. We use explicit ISO string with offset.
function watNow(): string {
  return new Date(Date.now() + 3_600_000).toISOString().replace("Z", "+01:00");
}

let _prevNetRx = 0;
let _prevNetTx = 0;
let _prevDiskRead = 0;
let _prevDiskWrite = 0;
let _lastTick = 0;

export function startSystemInfoPoller(server: FastifyInstance): void {
  const INTERVAL_MS = loadEnv().SWARMX_TELEMETRY_INTERVAL_MS;

  const tick = async () => {
    const now = Date.now();
    const dt = _lastTick > 0 ? (now - _lastTick) / 1000 : INTERVAL_MS / 1000;
    _lastTick = now;

    try {
      const [load, mem, disk, net] = await Promise.all([
        si.currentLoad(),
        si.mem(),
        si.disksIO(),
        si.networkStats(),
      ]);

      // Per-core %
      const perCore = (load.cpus ?? []).map((c) => Math.round(c.load));

      // Network delta bytes/s
      const totalRx = (net ?? []).reduce((s, n) => s + (n.rx_bytes ?? 0), 0);
      const totalTx = (net ?? []).reduce((s, n) => s + (n.tx_bytes ?? 0), 0);
      const rxPerSec = Math.max(0, (totalRx - _prevNetRx) / dt);
      const txPerSec = Math.max(0, (totalTx - _prevNetTx) / dt);
      _prevNetRx = totalRx;
      _prevNetTx = totalTx;

      // Disk delta bytes/s
      const diskRead = disk?.rIO_sec ?? 0;
      const diskWrite = disk?.wIO_sec ?? 0;
      const diskReadPerSec = Math.max(0, (diskRead - _prevDiskRead) / dt);
      const diskWritePerSec = Math.max(0, (diskWrite - _prevDiskWrite) / dt);
      _prevDiskRead = diskRead;
      _prevDiskWrite = diskWrite;

      // swarmx.slice memory from cgroup (best-effort)
      let swarmxSliceMb = 0;
      try {
        const { readFileSync } = await import("node:fs");
        const raw = readFileSync("/sys/fs/cgroup/swarmx.slice/memory.current", "utf8");
        swarmxSliceMb = parseInt(raw.trim(), 10) / (1024 * 1024);
      } catch { /* Not available on non-Linux / no slice */ }

      const snapshot: SystemMetricsSnapshot = {
        timestamp: watNow(),
        cpu: {
          load1m: load.avgLoad ?? 0,
          load5m: load.avgLoad ?? 0,
          load15m: load.avgLoad ?? 0,
          coreCount: perCore.length,
          perCore,
          perCorePercent: perCore,
        },
        memory: {
          totalMb: mem.total / (1024 * 1024),
          usedMb: mem.used / (1024 * 1024),
          availableMb: mem.available / (1024 * 1024),
          swarmxSliceMb,
          // [V6.2-FIX-18] Satisfy required swarmxSliceLimitMb field in SystemMetricsSnapshot type.
          swarmxSliceLimitMb: null,
        },
        disk: {
          readBytesPerSec: diskReadPerSec,
          writeBytesPerSec: diskWritePerSec,
          utilizationPercent: 0, // enriched elsewhere if needed
        },
        network: {
          rxBytesPerSec: rxPerSec,
          txBytesPerSec: txPerSec,
        },
      };

      broadcastEvent({ type: "system:metrics", data: snapshot });
    } catch (err) {
      server.log.warn({ err }, "systeminformation poll failed");
    }
  };

  const intervalId = setInterval(tick, INTERVAL_MS);

  // Run immediately
  tick().catch((err) => server.log.warn({ err }, "Initial systeminformation poll failed"));

  server.addHook("onClose", async () => clearInterval(intervalId));
}
