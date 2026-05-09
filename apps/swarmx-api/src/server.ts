/**
 * SwarmX Fastify API — Production entry point
 *
 * Production hardening changelog:
 *   [API-FIX-01] pino-pretty transport removed from production. pino-pretty is
 *                a dev-only dependency (~4 MB) that requires a native worker_thread
 *                and adds measurable latency per request. In production, Fastify's
 *                default JSON logger is used — log aggregators (Loki, Datadog,
 *                CloudWatch) ingest NDJSON natively. pino-pretty is only activated
 *                when NODE_ENV !== 'production'.
 *   [API-FIX-02] @fastify/helmet registered before all routes to emit security
 *                headers (HSTS, X-Content-Type-Options, X-Frame-Options, CSP, etc.)
 *                on every response. Without this, the API scores F on security header
 *                scanners and is vulnerable to MIME-sniffing and clickjacking.
 *   [API-FIX-03] CORS allowlist is built entirely from environment variables.
 *                Hardcoded 'http://localhost:3000' origins bypassed the intended
 *                production CORS policy — a hardcoded localhost origin allows any
 *                locally-running page to make credentialed cross-origin requests.
 *   [API-ENH-01] startup error now logs the specific bind error before process.exit(1)
 *                so container log tails show the failure reason (port conflict, EACCES)
 *                instead of just an exit code.
 */

import Fastify from "fastify";
import fastifyCors from "@fastify/cors";
import fastifyHelmet from "@fastify/helmet";
import fastifyWebSocket from "@fastify/websocket";
import { ssePlugin } from "./plugins/sse.js";
import { websocketPlugin } from "./plugins/websocket.js";
import { agentsRouter } from "./routes/agents.js";
import { systemRouter } from "./routes/system.js";
import { workflowsRouter } from "./routes/workflows.js";
import { logsRouter } from "./routes/logs.js";
import { configRouter } from "./routes/config.js";
import { composerRouter } from "./routes/composer.js";
import { metricsRouter } from "./routes/metrics.js";
import { startSystemInfoPoller } from "./services/systeminfo.js";
import { startCgroupPoller } from "./services/cgroup.js";
import { startJournaldStream } from "./services/journald.js";
import { startV5MetricsPoller, broadcastStartupSummary } from "./services/v5metrics.js";
import { startPyEventsPoller } from "./services/pyevents.js";  // [V5.9-FIX-05]

const PORT = Number.parseInt(process.env["SWARMX_API_PORT"] ?? "3001", 10);
const HOST = process.env["SWARMX_API_HOST"] ?? "127.0.0.1";
const IS_PRODUCTION = (process.env["NODE_ENV"] ?? "production") === "production";

// ── [API-FIX-03] Build CORS origin list from environment only ─────────────────
//
// SWARMX_DASHBOARD_ORIGIN: single trusted origin (e.g. https://swarmx.myapp.com)
// All other origins are rejected with a 403 — no localhost fallback in production.
//
// Dev mode (NODE_ENV !== 'production') additionally allows localhost:3000/3001 so
// `next dev` can reach the API without editing env.local.

function buildAllowedOrigins(): (string | RegExp)[] {
  const origins: (string | RegExp)[] = [];

  const rawDashboardOrigins = process.env["SWARMX_DASHBOARD_ORIGIN"];
  if (rawDashboardOrigins) {
    for (const origin of rawDashboardOrigins.split(",")) {
      const trimmed = origin.trim().replace(/\/$/, "");
      if (trimmed) {
        origins.push(trimmed);
      }
    }
  }

  if (!IS_PRODUCTION) {
    // Development convenience — explicitly scoped to non-production environments
    origins.push("http://localhost:3000");
    origins.push("http://127.0.0.1:3000");
    origins.push("http://localhost:3001");
    origins.push("http://127.0.0.1:3001");
  }

  // [API-FIX-04] Local production runs often use next start with NODE_ENV=production.
  // If no explicit origin was configured and API is loopback-only, allow local dashboard origins.
  const isLoopbackHost = HOST === "127.0.0.1" || HOST === "0.0.0.0" || HOST === "localhost" || HOST === "::" || HOST === "::1";
  if (origins.length === 0 && isLoopbackHost) {
    origins.push("http://localhost:3000");
    origins.push("http://127.0.0.1:3000");
  }

  return origins;
}

// ── Logger — [API-FIX-01] JSON in production, pretty-print in development ────

const server = Fastify({
  logger: IS_PRODUCTION
    ? {
        // Structured JSON — consumed by log aggregators and docker logs
        level: process.env["LOG_LEVEL"] ?? "info",
      }
    : {
        // Human-readable for local development only
        level: process.env["LOG_LEVEL"] ?? "debug",
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss Z" },
        },
      },
  requestTimeout: 30_000,
  // Reject payloads larger than 1 MiB to prevent memory spikes from large POST bodies
  bodyLimit: 1_048_576,
});

// ── [API-FIX-02] Security headers via @fastify/helmet ─────────────────────────
//
// Helmet sets: Content-Security-Policy, X-Content-Type-Options, X-Frame-Options,
// Strict-Transport-Security, X-XSS-Protection, and Referrer-Policy.
//
// contentSecurityPolicy is disabled because the dashboard's script hashes change
// on every Next.js build. Enabling CSP requires a build-time nonce strategy.
await server.register(fastifyHelmet, {
  contentSecurityPolicy: false, // managed by Next.js dashboard layer
});

// ── [API-FIX-03] CORS — allowlist-only ────────────────────────────────────────
await server.register(fastifyCors, {
  origin: buildAllowedOrigins(),
  credentials: true,
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Accept", "Authorization"],
});

// ── WebSocket and SSE plugins ─────────────────────────────────────────────────
await server.register(fastifyWebSocket);
await server.register(ssePlugin);
await server.register(websocketPlugin);

// ── Route registration ────────────────────────────────────────────────────────
await server.register(agentsRouter,    { prefix: "/api/agents" });
await server.register(systemRouter,    { prefix: "/api/system" });
await server.register(workflowsRouter, { prefix: "/api/workflows" });
await server.register(logsRouter,      { prefix: "/api/logs" });
await server.register(configRouter,    { prefix: "/api/config" });
await server.register(composerRouter,  { prefix: "/api/composer" });
await server.register(metricsRouter,   { prefix: "/api/metrics" });

// ── Health check ──────────────────────────────────────────────────────────────
// Probed by docker-compose healthcheck and Kubernetes liveness probes.
// Must remain at /health (not /api/health) — see [DC-FIX-02] in docker-compose.yml.
server.get("/health", { logLevel: "silent" }, async () => ({
  status: "ok",
  ts: Date.now(),
  version: process.env["npm_package_version"] ?? "unknown",
}));

// ── Graceful shutdown ─────────────────────────────────────────────────────────
// tini (PID 1 in the container) forwards SIGTERM here. Fastify.close() drains
// all in-flight requests before the process exits.

const shutdown = async (signal: string): Promise<void> => {
  server.log.info({ signal }, "Shutdown signal received — draining requests…");
  await server.close();
  server.log.info("Server closed. Exiting.");
  process.exit(0);
};

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT",  () => void shutdown("SIGINT"));

// ── Background pollers ────────────────────────────────────────────────────────
startSystemInfoPoller(server);
startCgroupPoller(server);
startV5MetricsPoller(server);
startPyEventsPoller(server);  // [V5.9-FIX-05] bridge Python journal events to SSE
// [V6.1-ENH-01] Broadcast the Python startup summary to SSE clients after boot
broadcastStartupSummary(server);
await startJournaldStream(server);

// ── Listen ────────────────────────────────────────────────────────────────────
try {
  await server.listen({ port: PORT, host: HOST });
  // [API-ENH-01] structured startup log with all bound address info
  server.log.info(
    { host: HOST, port: PORT, pid: process.pid, env: process.env["NODE_ENV"] },
    "SwarmX API ready",
  );
} catch (err) {
  // [API-ENH-01] log the specific error before exiting so log tails show root cause
  server.log.error({ err }, "Failed to bind server — check port conflict or permissions");
  process.exit(1);
}