/**
 * apps/swarmx-api/src/lib/tracer.ts
 * SwarmXQ OpenTelemetry tracer — zero-overhead when no SDK is registered.
 *
 * Uses the @opentelemetry/api facade. When no SDK provider is initialised
 * (the default on this CPU-only host), every span and attribute operation is a
 * no-op — no runtime cost, no new dependencies to start the server.
 *
 * To activate real telemetry:
 *   pnpm --filter @swarmx/api add @opentelemetry/sdk-node @opentelemetry/exporter-trace-otlp-http
 *   Set OTEL_EXPORTER_OTLP_ENDPOINT and call NodeSDK.start() before server.ts.
 */

import { trace } from "@opentelemetry/api";

export { SpanStatusCode, context, trace } from "@opentelemetry/api";

export const tracer = trace.getTracer("swarmx.video", "6.2.29");
