# SwarmXQ API Engineering Instructions — V6.2.22
# Location: apps/swarmx-api/AGENTS.md
# Scope: Fastify 5 API — all code in apps/swarmx-api/src/

Inherits from root AGENTS.md. This file adds API-package-specific constraints.

---

## API ARCHITECTURE (Strict Layering)

```
src/routes/        ← thin: auth, schema validation, request/response mapping ONLY
src/services/      ← application logic, model calls, domain rules
src/lib/           ← shared utilities (logger.ts, env.ts — do not add new files lightly)
src/plugins/       ← Fastify plugins (sse.ts, websocket.ts)
src/types/         ← bridge adapters over packages/swarmx-types — do not duplicate contracts
```

**Routes own:** `requireVideoWriteAuth()`, Zod body/query validation, rate-limit bucket checks.
**Services own:** all Ollama calls, BullMQ operations, file I/O, virality scoring, caption generation.
**Routes must NEVER call Ollama or BullMQ directly.**

---

## FASTIFY-SPECIFIC PATTERNS

```typescript
// Plugin registration — always prefix-scoped
server.register(videoRoutes, { prefix: '/api/video' })

// Typed FastifyInstance — never 'any' on the server object
import type { FastifyInstance } from 'fastify'

// Import with .js extension (ESM)
import { log } from '../lib/logger.js'
import { env } from '../lib/env.js'

// Rate-limit buckets — always evicted via unref'd setInterval
const evictionTimer = setInterval(evictStaleBuckets, 2 * 60 * 60 * 1000)
evictionTimer.unref()   // ← always unref — never block process exit

// Graceful shutdown — SIGTERM/SIGINT handlers in server.ts; never add new uncaught handlers
// Global unhandledRejection and uncaughtException handlers already exist — do not add more
```

---

## ENV SCHEMA ADDITIONS

When adding a new environment variable, ALWAYS add to `src/lib/env.ts` Zod schema:

```typescript
const envSchema = z.object({
  // Existing vars...
  NEW_VAR: z.string().default('default_value'),
  // Risk annotation in JSDoc:
  // @risk silent-fail — wrong value degrades behaviour without error
  // @risk startup-crash — wrong value blocks API startup via loadEnv()
})
```

Never add `process.env['NEW_VAR']` directly to a service. Always go through `env.ts`.

---

## VIDEO PIPELINE PATTERNS

```typescript
// Correct stage fn signature — always sets modelsUsed inside, never in runStage()
async function stageScripting(
  ctx: VideoOrchestrationContext,
  signal: AbortSignal,
  broadcast: BroadcastFn
): Promise<void> {
  const canonicalTag = resolveCanonicalTag(resolveVideoModelTag('scripting', ctx.availableMb))
  ctx.modelsUsed['scripting'] = canonicalTag    // ← set HERE, immediately after resolve

  const controller = stageController('scripting')
  signal.addEventListener('abort', () => controller.abort(), { once: true })  // ← { once: true }

  const { timeoutMs, circuitOpen } = getAdaptiveCallConfig(canonicalTag, 'supervisor_planning')
  if (circuitOpen) throw new VideoError('SCRIPTING_FAILED', 'Circuit open')

  const raw = await withTimeout(callOllama(canonicalTag, { prompt, signal: controller.signal }), timeoutMs)
  const clean = sanitizeReasoningOutput(raw.text)   // ← always sanitize
  // parse clean, never raw
}

// Before FFmpeg render — evict all Ollama models
for (const [stage, tag] of Object.entries(ctx.modelsUsed)) {
  if (tag) await ModelOrchestrator.unloadModel(tag)
}
// Only then call FFmpeg via execFile(), never exec()
```

---

## BULLMQ PATTERNS (Priority 1 Milestone)

```typescript
// Worker and Queue must use SEPARATE ioredis connections
const queueConnection  = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })
const workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null })

// Never share connections between Queue and Worker roles
const videoQueue  = new Queue('video', { connection: queueConnection })
const videoWorker = new Worker('video', processor, { connection: workerConnection, concurrency: 1 })

// clientRequestId dedup — must be preserved when BullMQ is enabled
const jobId = clientRequestId  // use as BullMQ job ID for idempotency

// Redis fallback to in-memory — never crash on Redis unavailability
if (!redisAvailable) {
  log.warn({ reason: 'Redis unavailable' }, 'Falling back to in-memory video queue')
  // use in-memory queue implementation
}
```

---

## SSE PATTERNS

```typescript
// subscribeToJob returns AsyncIterable<SwarmXEvent>
// SSE plugin must handle client disconnect via return() on the iterable
for await (const event of subscribeToJob(jobId)) {
  if (clientDisconnected) break   // triggers return() → calls unsubscribe()
  yield sseFormat(event)
}

// On client reconnect — always re-fetch full job state via REST, never resume stream
// The in-memory registry is always authoritative; SSE is delivery-only
```
