# SwarmXQ Copilot Instructions — V6.2.22-apex17-r8
# Location: .github/copilot-instructions.md
# Hardware: HP EliteBook 850 G3 · 16 GB RAM · CPU-only · WSL2 · 4 cores
# Maintainer: Scar (Oscar Ndugbu) · scardubu.dev
#
# Changelog vs V2026.5.20-apex17-r3:
#   [ARCH-01] Hardware upgraded: 8 GB → 16 GB RAM
#   [ARCH-02] Model topology: 5-tier/11-scar-tag → 9-operator APEX-17 r8 canonical map
#   [ARCH-03] All -scar suffix legacy tags replaced; MODEL_OPERATOR_MAP is sole source of truth
#   [ARCH-04] OLLAMA_MAX_LOADED_MODELS: 1 → 2 (safe on 16 GB with SINGLE-7B enforcement)
#   [ARCH-05] OLLAMA_NUM_THREADS=3 added (WSL2-optimised; reserves 1 core for hypervisor)
#   [ARCH-06] Video generation subsystem documented (6-stage pipeline, creative quality)
#   [ARCH-07] 38-skill system (.ai/skills/) integrated; domain-to-skill routing added
#   [ARCH-08] Claude Code commands (.claude/commands/) documented
#   [ARCH-09] startup-enhanced.sh warmup protocol and health endpoint added
#   [ARCH-10] SwarmXQ invariants (console.* zero-tolerance, resolveCanonicalTag) enforced

---

## 1. WHAT SWARMXQ IS

SwarmXQ is a **TypeScript-first local multi-agent AI orchestration platform** running on a
16 GB HP EliteBook 850 G3 (CPU-only, WSL2, 4 cores). It combines:

- **Fastify 5 API** (`apps/swarmx-api`, port 3001) — REST/SSE bridge to Ollama + video pipeline
- **Next.js 16 Dashboard** (`apps/swarmx-dashboard`, port 3000) — real-time swarm control panel
- **Ollama backend** — local LLM inference; strict SINGLE-7B LOCK at all times
- **Video generation subsystem** — 6-stage AI pipeline (intent → plan → script → storyboard → render → finalize)
- **APEX-17 r8 Evolution pipeline** — self-improving swarm loop (4 phases, 9 operators)
- **Python Brain** (`src/swarmx/`) — agent orchestration sidecar (structlog, asyncio, httpx)
- **38-skill Claude Code system** (`.ai/skills/`) — domain expertise layer for AI-assisted development

**Turborepo monorepo.** Package manager: `pnpm`. Never use `npm` or `yarn`.

```
root/
├── apps/swarmx-api/          ← Fastify 5 API (TypeScript ESM)
├── apps/swarmx-dashboard/    ← Next.js 16 / React 19 / Framer Motion
├── packages/swarmx-types/    ← Canonical contracts (operator-map, video types)
├── src/swarmx/               ← Python 3.11+ brain (agents, memory, workflows)
├── .ai/skills/               ← 38-skill domain expertise system
├── .claude/commands/         ← Claude Code slash commands
├── .github/                  ← CI, Copilot instructions
└── startup-enhanced.sh       ← 16 GB profile activation (run before API)
```

---

## 2. HARDWARE PROFILE (16 GB — UPDATED)

**Target host:** HP EliteBook 850 G3 · 16 GB RAM · CPU-only · 4 cores · WSL2

| Constant | Value | Protected? |
|---|---|---|
| `RAM_CRITICAL_MB` | 800 MB | **YES — never change** |
| `MAX_CONCURRENT_JOBS` | 1 | **YES — CPU inference is serial** |
| `FULL_PIPELINE_MIN_AVAILABLE_MB` | 6170 MB | No |
| `VIDEO_RAM_RESERVE_MB` | 800 MB | No |
| `OLLAMA_MAX_LOADED_MODELS` | **2** (16 GB) | No — was 1 on 8 GB; now 2 |
| `OLLAMA_NUM_THREADS` | 3 (WSL2) | No — never 4; hypervisor needs 1 core |

**16 GB model residency budget:**

| Resident state | RAM | Safe? |
|---|---|---|
| Pilot alone (~3 GB) | ~3 GB | ✓ |
| Pilot + Architect (~5 GB) | ~8 GB | ✓ — target dual-resident |
| Pilot + Oracle | ~8 GB | ✓ — virality scoring only |
| Any two 7B models simultaneously | ~10 GB | ✗ — violates SINGLE-7B LOCK |

---

## 3. APEX-17 r8 OPERATOR REGISTRY (Authoritative)

**`MODEL_OPERATOR_MAP` in `packages/swarmx-types/src/operator-map.ts` is the
single source of truth.** Python mirror: `src/swarmx/operator_map.py` (must be
semantically identical). Never define model metadata anywhere else.

All external model tags MUST pass through `resolveCanonicalTag()` before entering
the registry, any log entry, or any API response.

| Operator | Canonical tag | RAM | is7B? | Primary role |
|---|---|---|---|---|
| **Relay** | `route-phi4-lite-q4km-prod` | ~2.5 GB | No | Intent gating, binary routing (not used in video stages) |
| **Pilot** | `instruct-phi4-pro-q8-prod` | ~3 GB | No | intent_classification stage, caption generation |
| **Pilot lite** | `instruct-phi4-lite-q4km-prod` | ~2.2 GB | No | Low-RAM fallback for all text stages |
| **Architect** | `plan-qwen25-pro-q5km-prod` | ~5 GB | Yes | planning, scripting, storyboard stages |
| **Architect deep** | `plan-deepseekr1-pro-q5km-prod` | ~5 GB | Yes | Deep planning fallback |
| **Oracle** | `reason-deepseekr1-pro-q5km-prod` | ~5 GB | Yes | Virality scoring (post-pipeline) |
| **Forge** | `code-qwen25-pro-q5km-prod` | ~5 GB | Yes | Agent code generation |
| **Auditor** | `critique-deepseekr1-pro-q5km-prod` | ~5 GB | Yes | Agent QA gating, adversarial critique |
| **Lab** | `synth-qwen25-exp-q4km-dev` | ~4 GB | Yes | Meta-evolution, skill synthesis (dev only) |

### Legacy alias mapping (READ: these tags must NEVER appear in new code)

| Old `-scar` tag (V5 — FORBIDDEN) | APEX-17 r8 replacement |
|---|---|
| `phi4-router-lite-scar` | `route-phi4-lite-q4km-prod` (Relay) |
| `phi4-fast-scar` | `instruct-phi4-pro-q8-prod` (Pilot) |
| `phi4-worker-scar` | `instruct-phi4-lite-q4km-prod` (Pilot lite) |
| `qwen-worker-scar` | `code-qwen25-pro-q5km-prod` (Forge) |
| `qwen-supervisor-scar` | `plan-qwen25-pro-q5km-prod` (Architect) |
| `deepseek-reasoner-scar` | `reason-deepseekr1-pro-q5km-prod` (Oracle) |
| `deepseek-critic-scar` | `critique-deepseekr1-pro-q5km-prod` (Auditor) |
| `deepseek-supervisor-scar` | `plan-deepseekr1-pro-q5km-prod` (Architect deep) |
| V5: `SENTINEL` / `CANVAS` / `LEDGER` / `PROPHET` / `EVOLVER` | Relay / Architect / Auditor / removed / Lab |

When Copilot suggests any V5 tag, reject it. Use `resolveCanonicalTag()` instead.

---

## 4. CRITICAL INVARIANTS (Never Violate in Generated Code)

These are hard constraints enforced by CI and regression scripts.
Any suggestion that violates them must be immediately revised.

```
①  SINGLE-7B LOCK: only one 7B-class model inference-active at any time.
   On 16 GB, OLLAMA_MAX_LOADED_MODELS=2 allows Pilot (3 GB) + 7B (5 GB) resident
   simultaneously — this is NOT concurrent inference. evictIncompatible() must
   be called before every 7B model load.

②  console.* ZERO TOLERANCE: grep -rn 'console\.' apps/swarmx-api/src/services
   apps/swarmx-api/src/routes → must return zero hits. Use log.* from
   apps/swarmx-api/src/lib/logger.ts exclusively.

③  resolveCanonicalTag() on every external tag: legacy aliases must never enter
   the model registry, logs, or API responses.

④  sanitizeReasoningOutput() on every Ollama response: call this before parsing
   intent JSON, script text, storyboard frames, or passing output to another agent.
   DeepSeek <think> blocks corrupt downstream parsing if not stripped.

⑤  All env reads via env.ts: never use process.env['VAR'] directly in services
   or routes. All vars go through src/lib/env.ts (Zod schema + loadEnv()).

⑥  RAM_CRITICAL_MB = 800 is protected: never alter this constant.

⑦  MAX_CONCURRENT_JOBS = 1 is protected: CPU inference is serial.

⑧  Video stage order is immutable:
   intent_classification → planning → scripting → storyboard_generation
   → render_assembly → finalizing
   Post-pipeline (non-blocking): stageViralityAndCaption()

⑨  modelsUsed[stage] set inside stage fn: set immediately after acquireModel()
   resolves inside the stage function — never in runStage().

⑩  AbortController per stage with { once: true } listeners — zero accumulation.

⑪  TONE_RULES must be exhaustive: all 8 tone variants must be present in
   video-orchestrator.ts: contrarian | urgent | educational | cinematic |
   warm | minimal | faceless_broll | kinetic_text

⑫  OLLAMA_NUM_PARALLEL=1 is invariant on CPU: more than 1 adds scheduling
   overhead with zero throughput gain — never suggest increasing this.
```

---

## 5. OLLAMA RUNTIME CONFIG (All vars required)

Set ALL of these before starting Ollama. Omitting any causes silent degradation.

```bash
# CPU performance (WSL2, 4-core, HP EliteBook 850 G3)
export OLLAMA_NUM_PARALLEL=1          # 1 inference thread on CPU — never increase
export OLLAMA_FLASH_ATTENTION=1       # fused attention: ~20% memory reduction (AVX2)
export OLLAMA_KV_CACHE_TYPE=q8_0     # int8 KV cache: ~30% savings vs f16; use q8_0 not q4_0
export OLLAMA_NUM_THREADS=3           # 3 of 4 cores; 1 reserved for WSL2 hypervisor

# Model residency (16 GB profile)
export OLLAMA_MAX_LOADED_MODELS=2     # Pilot + one 7B may be resident; NOT concurrent inference
export OLLAMA_KEEP_ALIVE=0            # global: evict after use
# Pilot-specific override set by startup-enhanced.sh:
# OLLAMA_KEEP_ALIVE=5m for instruct-phi4-pro-q8-prod only
```

**startup-enhanced.sh** (run before the API server — never skip on 16 GB host):
```bash
bash startup-enhanced.sh
# Reads /proc/meminfo → detects profile (8 GB vs 16 GB)
# Sets all Ollama CPU performance vars
# Pre-warms Pilot router with zero-token probe + 5m keep-alive
# Verifies post-warmup RAM ≥ FULL_PIPELINE_MIN_AVAILABLE_MB (6170 MB)
# Writes /tmp/swarmxq-warmup.json (read by /api/system/health)
# Exit 1 if host is overloaded before first job
```

**Cold-start ETA**: 140s (cold) → 45s (after startup-enhanced.sh). Dashboard reads
`/api/system/health` → `warmup.coldStartEtaSecs`. Never hard-code these values.

---

## 6. SERVICE INTEGRATION CONTRACT

Every call to Ollama MUST go through all three layers. No exceptions.

```typescript
import { getAdaptiveCallConfig, withTimeout, recordSuccess, recordFailure }
  from "./adaptive-timeout-config.js";
import { setActiveModel, recordLatency, recordTokens }
  from "./swarm-pressure-monitor.js";
import { sanitizeReasoningOutput }
  from "./reasoning-sanitizer.js";
import { resolveCanonicalTag }
  from "@swarmx/types/operator-map";

// 1. Resolve tag — never use raw/legacy tags
const canonicalTag = resolveCanonicalTag(rawModelTag);

// 2. Check circuit breaker and get adaptive config
const { timeoutMs, overrides, circuitOpen } = getAdaptiveCallConfig(canonicalTag, opKey);
if (circuitOpen) { /* invoke fallback — never throw uncaught */ }

// 3. Call Ollama with timeout
const result = await withTimeout(
  callOllama(canonicalTag, { ...overrides }),
  timeoutMs,
  opKey
);

// 4. Sanitize ALWAYS — even for Pilot (Phi-4) models
const clean = sanitizeReasoningOutput(result.text);

// 5. Record metrics
recordSuccess(canonicalTag);
recordLatency(result.latencyMs);
```

**DeepSeek models**: `sanitizeReasoningOutput()` is non-negotiable before:
- passing output to another agent
- returning to the API stream
- feeding into the APEX-17 pipeline
- parsing as JSON (use `extractJson()` from reasoning-sanitizer, never `JSON.parse()` on raw output)

---

## 7. VIDEO GENERATION PIPELINE

The video subsystem is the primary production surface. Copilot suggestions touching
any file below must follow these contracts exactly.

### 6-Stage Pipeline (immutable order)

```
intent_classification → planning → scripting → storyboard_generation → render_assembly → finalizing
       [0–15%]            [15–30%]   [30–50%]         [50–75%]              [75–95%]         [95–100%]

Post-pipeline (non-blocking): stageViralityAndCaption()
```

### Stage → Operator mapping

| Stage | Operator | Canonical tag | Max tokens |
|---|---|---|---|
| `intent_classification` | Pilot | `instruct-phi4-pro-q8-prod` | 192 |
| `planning` | Architect | `plan-qwen25-pro-q5km-prod` | 512 |
| `scripting` | Architect | `plan-qwen25-pro-q5km-prod` | 1024 |
| `storyboard_generation` | Architect | `plan-qwen25-pro-q5km-prod` | 768 |
| `render_assembly` | System (no model) | — | — |
| `finalizing` | System (no model) | — | — |
| `stageViralityAndCaption` | Oracle | `reason-deepseekr1-pro-q5km-prod` | 512 |

### Video-specific code patterns

```typescript
// In every stage function — set modelsUsed INSIDE the stage fn, not in runStage()
ctx.modelsUsed[stage] = await acquireModel(operatorName)  // immediately after acquire

// AbortController — always { once: true } to prevent listener accumulation
const controller = stageController(stage)
signal.addEventListener('abort', handler, { once: true })

// Before FFmpeg render — evict all Ollama models (CPU cannot run inference + FFmpeg concurrently)
await ModelOrchestrator.unloadModel(ctx.modelsUsed['scripting'])
await ModelOrchestrator.unloadModel(ctx.modelsUsed['storyboard_generation'])

// ComfyUI poll ceiling — always derived, never hardcoded
const COMFY_POLL_MAX_ATTEMPTS = Math.floor(
  STAGE_TIMEOUT_MS['render_assembly'] / COMFY_POLL_INTERVAL_MS
)
```

### Script section quality (enforced in TONE_RULES and quality gate)

```
[HOOK]         ≤ 18 words; no preamble opener; passes HOOK_BLOCKLIST
[BODY]         each sentence increases stakes; [VISUAL: …] tags on visual moments
[RESOLUTION]   1–2 actionable sentences; not a summary
[CTA]          5–8 words; specific; not "like and subscribe"

Virality formula (never alter weights):
  overall = hookStrength×0.35 + completionProxy×0.25 + shareability×0.25 + seoScore×0.15
```

### Key video service files

```
apps/swarmx-api/src/services/
├── video-orchestrator.ts     ← 6-stage pipeline execution; TONE_RULES; stage invariants
├── video-queue.ts            ← SINGLE-VIDEO LOCK; idempotency by clientRequestId; BullMQ
├── video-runtime-config.ts   ← RAM-aware model resolution; stage timeout matrix
├── video-auth.ts             ← requireVideoWriteAuth() — gates all POST /api/video/* routes
├── video-cleanup.ts          ← TTL-based artifact eviction; started at server boot
├── video-assets.ts           ← SHA-256 checksum on output artifacts
├── virality-scorer.ts        ← VIRALITY_SCORE_RUBRIC; Oracle scoring contract
├── caption-generator.ts      ← CAPTION_RULES; platform caps (TikTok 2200 chars)
├── ffmpeg-video-renderer.ts  ← TONE_BACKGROUNDS / TONE_ACCENTS; execFile() only, never exec()
├── comfyui-client.ts         ← LTX-Video workflow; poll ceiling from stage timeout
└── model-orchestrator.ts     ← SINGLE-7B LOCK; evictIncompatible(); keep-alive policy
```

---

## 8. RUNTIME SERVICES (Existing — Do Not Duplicate)

| File | Purpose |
|---|---|
| `model-orchestrator.ts` | Single-7B lock, keep-alive, predictive warmup, eviction |
| `adaptive-timeout-config.ts` | Per-operation timeout matrix, circuit breaker, jittered retry |
| `swarm-pressure-monitor.ts` | /proc/meminfo metrics, topology recommendation, evolver constraints |
| `reasoning-sanitizer.ts` | Strip DeepSeek `<think>` blocks, `extractJson()`, normalize output |
| `ollama.ts` | Multi-endpoint failover, cached model discovery, health probes |

### Adaptive timeout table (replace all static timeouts with `getTimeout(opKey, pressure)`)

| Operation | Normal | Critical RAM |
|---|---|---|
| `intent_classify` | 3s | 1.5s |
| `routing` | 5s | 3s |
| `fast_chat` | 12s | 6s |
| `tool_execution` | 28s | 15s |
| `supervisor_planning` | 50s | 25s |
| `deep_reasoning` | 90s | 45s |
| `critic_audit` | 75s | 40s |
| `evolver_phases` | 120s | 60s |

Streaming responses: use `createStreamGuard()` — never apply a hard timeout to an active token stream.

---

## 9. SKILL SYSTEM INTEGRATION (.ai/skills/)

The `.ai/skills/` directory contains **38 domain-expertise SKILL.md files** that define
architectural constraints, code patterns, and invariants for every subsystem.

**When Copilot Chat is helping with code in a specific domain, reference the relevant skill:**

```
# In Copilot Chat — use #file to pull authoritative constraints:
@workspace #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md
@workspace #file:.ai/skills/swarmxq-model-orchestrator/SKILL.md
@workspace #file:.ai/skills/swarmxq-creative-director/SKILL.md
@workspace #file:.ai/skills/swarmxq-startup-ops-architect/SKILL.md
@workspace #file:.ai/skills/swarmxq-ci-release-architect/SKILL.md
@workspace #file:CLAUDE.md    ← project-level constraints
@workspace #file:NEXUS.md     ← routing and skill selection logic
```

### Domain-to-skill routing (which skill file governs which code domain)

| Code area | Authoritative skill file |
|---|---|
| `video-orchestrator.ts` changes | `.ai/skills/swarmxq-video-pipeline-architect/SKILL.md` |
| `model-orchestrator.ts` changes | `.ai/skills/swarmxq-model-orchestrator/SKILL.md` |
| `TONE_RULES`, script quality, virality | `.ai/skills/swarmxq-creative-director/SKILL.md` |
| `startup-enhanced.sh`, Ollama perf vars | `.ai/skills/swarmxq-startup-ops-architect/SKILL.md` |
| `.github/workflows/ci.yml` | `.ai/skills/swarmxq-ci-release-architect/SKILL.md` |
| `video-queue.ts`, BullMQ | `.ai/skills/bullmq-job-architect/SKILL.md` |
| SSE events, `subscribeToJob` | `.ai/skills/real-time-systems-architect/SKILL.md` |
| `src/lib/env.ts` Zod schema | `.ai/skills/typescript-config-surgeon/SKILL.md` |
| Dashboard React components | `.ai/skills/component-quality-gate/SKILL.md` |
| Dashboard animations | `.ai/skills/motion-performance-architect/SKILL.md` |
| OpenTelemetry instrumentation | `.ai/skills/opentelemetry-observability-architect/SKILL.md` |
| Security, auth, rate limiting | `.ai/skills/security-hardening-auditor/SKILL.md` |
| `src/swarmx/` Python brain | `.ai/skills/multi-agent-orchestration-architect/SKILL.md` |

### Claude Code slash commands (`.claude/commands/`)

These commands pre-load the correct skill graph for complex tasks:

```bash
/nexus      ← routes any task through the 38-skill orchestration engine
/video      ← deep-dive: video pipeline + model orchestrator + creative director
/model-ops  ← deep-dive: SINGLE-7B LOCK + startup ops + RAM pressure
/forge      ← generate a new SKILL.md from a domain description
/audit      ← security + backend + invariant audit across the codebase
```

---

## 10. APEX-17 r8 EVOLUTION PIPELINE

```
Phase 1 OBSERVE   → Pilot (instruct-phi4-pro-q8-prod)       — fitness snapshot, JSON output
Phase 2 CRITIQUE  → Oracle (reason-deepseekr1-pro-q5km-prod) — adversarial critique
Phase 3 MUTATE    → Architect (plan-qwen25-pro-q5km-prod)    — single mutation proposal
Phase 4 VALIDATE  → Oracle (reason-deepseekr1-pro-q5km-prod) — approve/reject
```

**Constraints from swarm-pressure-monitor.ts (16 GB thresholds — updated from 8 GB):**
- MemAvailable < 2 GB → reduce mutation breadth, summarize traces
- MemAvailable < 1 GB → skip validate phase, 1 mutation max
- topology ≠ full_triad → skip evolution entirely, return DEFERRED

---

## 11. COMPOSER / SWARM TOPOLOGY DEGRADATION

```
Tier 0 → Local rule engine (shell intents, health checks)    < 100ms  — NO model
Tier 1 → Relay (route-phi4-lite-q4km-prod)                  2–4s    — intent classify only
Tier 2 → Pilot (instruct-phi4-pro-q8-prod)                  8–15s   — fallback routing, chat
Tier 3 → Specialist (Architect / Oracle / Forge)             35–120s
Tier 4 → Deep swarm (Auditor / Lab / multi-agent)            90–240s
```

```
full_triad      → Relay + Architect + Oracle   (RAM MemAvailable > 4 GB)
duo             → Relay + Architect            (pressure > 0.65 or queue > 5)
supervisor_only → Architect handles all        (MemAvailable < 2 GB)
rule_engine     → no model; pure rules         (MemAvailable < 800 MB or timeout_rate > 60%)
```

Topology changes broadcast via SSE `swarm:topology_change`. Dashboard handles all four states.

---

## 12. CODE CONVENTIONS

### TypeScript (apps/swarmx-api)

```typescript
// ✅ CORRECT — import with .js extension (ESM)
import { resolveCanonicalTag } from "@swarmx/types/operator-map"
import { log } from "../lib/logger.js"          // use log.* — never console.*
import { env } from "../lib/env.js"             // use env.VAR — never process.env['VAR']

// ✅ CORRECT — model tag resolution
const tag = resolveCanonicalTag(MODEL_OPERATOR_MAP["Architect"].canonicalTag)

// ❌ WRONG — legacy tag
const tag = "qwen-worker-scar"   // forbidden — resolves to nothing in APEX-17 r8

// ✅ CORRECT — Zod env schema (env.ts)
// Add new env vars to the Zod schema — never read process.env[] for validated vars

// ✅ CORRECT — no any without justification
const result: VideoJob = await getJob(id)   // typed — no 'as any' without comment

// Route structure: thin routes, logic in services
// services/ → application logic, domain rules, AI calls
// routes/   → auth, validation, protocol translation only
```

### Python (src/swarmx/)

```python
# ✅ CORRECT
import structlog
log = structlog.get_logger()     # structlog only — never print() or logging.basicConfig()

import httpx                     # async only — never requests (blocking)
async with httpx.AsyncClient() as client:
    response = await client.post(...)

# operator_map.py must mirror operator-map.ts exactly
# Never use V5 names: SENTINEL, CANVAS, LEDGER, PROPHET, EVOLVER
```

### Model references (all layers)

```
✅ Always use APEX-17 r8 canonical tags: route-phi4-lite-q4km-prod
✅ Read tags from MODEL_OPERATOR_MAP — never hardcode
✅ resolveCanonicalTag() before any tag enters logs, registry, or API response
❌ Never: phi4-fast-scar, qwen-worker-scar, deepseek-reasoner-scar, or any -scar tag
❌ Never: SENTINEL, CANVAS, LEDGER, PROPHET, EVOLVER (V5 operator names)
```

### Logging

```typescript
// Use only: log.debug | log.info | log.warn | log.error | log.fatal
// Source: apps/swarmx-api/src/lib/logger.ts (Pino-compatible NDJSON)
// Zero console.* anywhere in src/services/ or src/routes/
```

### Error handling

```typescript
// Model calls: always withTimeout() + catch → circuit breaker → fallback tier
// Never let Ollama failures crash the API — always degrade gracefully
// Video pipeline: fail with typed VideoErrorCode, never untyped exceptions
```

### Memory management (16 GB — updated thresholds)

```typescript
// Check getSwarmPressure() before any 7B load
// Call recordEviction() on every Ollama model eviction
// Never trigger a 7B load if availableMb < 1200   (was 2000 on 8 GB)
// evictIncompatible() before every 7B model load — no exceptions
```

---

## 13. FILE LOCATIONS

```
packages/swarmx-types/src/
├── operator-map.ts              ← MODEL_OPERATOR_MAP (single source of truth)
├── video-types.ts               ← VideoJob, VideoJobRequest, VideoJobStage
└── events.ts                    ← SwarmXEvent, VideoJobEventData

apps/swarmx-api/src/
├── lib/
│   ├── logger.ts                ← Pino-compatible NDJSON logger (use log.*)
│   └── env.ts                   ← Zod env schema (use env.VAR — never process.env[])
├── services/
│   ├── model-orchestrator.ts    ← SINGLE-7B LOCK, eviction, warmup
│   ├── adaptive-timeout-config.ts ← timeout matrix, circuit breaker
│   ├── swarm-pressure-monitor.ts ← /proc/meminfo, topology downgrade
│   ├── reasoning-sanitizer.ts   ← DeepSeek <think> strip, extractJson()
│   ├── ollama.ts                ← endpoint discovery, health probes
│   ├── video-orchestrator.ts    ← 6-stage pipeline, TONE_RULES, HOOK_BLOCKLIST
│   ├── video-queue.ts           ← SINGLE-VIDEO LOCK, BullMQ, clientRequestId
│   ├── video-runtime-config.ts  ← RAM-aware model resolution, stage timeouts
│   ├── virality-scorer.ts       ← ViralitySignal, VIRALITY_SCORE_RUBRIC
│   ├── caption-generator.ts     ← CAPTION_RULES, platform caps
│   ├── ffmpeg-video-renderer.ts ← TONE_BACKGROUNDS, TONE_ACCENTS, execFile()
│   └── comfyui-client.ts        ← LTX-Video, poll ceiling from stage timeout
├── routes/
│   ├── video.ts                 ← rate-limit eviction, requireVideoWriteAuth()
│   └── system.ts                ← /api/system/health (warmup flag, RAM, queue depth)
└── server.ts                    ← loadEnv(), global error handlers, graceful shutdown

.ai/skills/                      ← 38 domain SKILL.md files (authoritative for each domain)
.claude/commands/                ← /nexus /video /model-ops /forge /audit slash commands
startup-enhanced.sh              ← 16 GB profile activation; run before API server
```

---

## 14. QUALITY GATE (Run before every commit to main)

```bash
pnpm -F swarmx-api tsc --noEmit           # zero type errors
pnpm -F swarmx-types tsc --noEmit
pnpm -F swarmx-dashboard tsc --noEmit
pnpm -F swarmx-dashboard vitest run       # ≥52 passing
pnpm -F swarmx-api vitest run             # grows from Priority 4

npx tsx apps/swarmx-api/scripts/adaptive-timeout-regression.ts
npx tsx apps/swarmx-api/scripts/video-regression-check.ts
npx tsx apps/swarmx-api/scripts/eviction-metric-regression.ts
npx tsx apps/swarmx-api/scripts/system-health-regression.ts
npx tsx apps/swarmx-api/scripts/reasoning-sanitizer-regression.ts

pnpm -F swarmx-dashboard next build
git diff --check

# Invariant checks — both must return zero / ≤10 hits
grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes
grep -rn 'process\.env\[' apps/swarmx-api/src/services apps/swarmx-api/src/routes
```

---

## 15. WHAT NOT TO DO (Updated)

```
❌ OLLAMA_MAX_LOADED_MODELS=1 on 16 GB — this was correct on 8 GB only; use 2 on 16 GB
❌ OLLAMA_NUM_THREADS=4 on WSL2 — WSL2 needs 1 core for hypervisor; use 3
❌ Any -scar model tag (phi4-fast-scar, qwen-worker-scar, etc.) — use APEX-17 r8 canonical tags
❌ V5 operator names (SENTINEL, CANVAS, LEDGER, PROPHET, EVOLVER) — use r8 names
❌ console.log anywhere in src/services/ or src/routes/ — use log.* only
❌ process.env['VAR'] in services or routes — use env.ts Zod schema
❌ JSON.parse(deepseekOutput) — always use extractJson() from reasoning-sanitizer
❌ Static AI_TIMEOUT=120 — use getTimeout(opKey, pressure) from adaptive-timeout-config
❌ temperature=0.7 on Relay (route-phi4-lite-*) — must be 0.0 (deterministic routing)
❌ Two 7B models simultaneously — hard constraint on both 8 GB and 16 GB
❌ exec() for FFmpeg/espeak — always execFile() with timeout and maxBuffer caps
❌ Skipping sanitizeReasoningOutput() on any Ollama response — not just DeepSeek
❌ Hardcoding cold-start ETA (140/45) in dashboard — read from /api/system/health
❌ COMFY_POLL_MAX_ATTEMPTS as a literal — derive from STAGE_TIMEOUT_MS / COMFY_POLL_INTERVAL_MS
❌ Bypassing requireVideoWriteAuth() on POST /api/video/* routes
❌ pnpm install / npm install during offline sessions — use only existing packages
❌ Any of the 8 release gates skipped without documenting the reason in .serena/memories/
```

---

## 16. TELEMETRY TARGETS (per model call)

Track: `cold_start_ms`, `warm_start_ms`, `tokens_per_sec`, `timeout_rate`,
`avg_predict_length`, `memory_mb_at_call`, `load_failures`, `eviction_count`,
`circuit_breaker_trips`, `render_backend_selected`, `virality_score_overall`

SSE events: `swarm:health`, `swarm:topology_change`, `model:evicted`,
`video:progress`, `video:completed`, `video:failed`, `video:stream`

---

## 17. SHELL ALIASES (Updated for APEX-17 r8)

```bash
# Updated model aliases — use canonical tags
ai            → Pilot (instruct-phi4-pro-q8-prod)     # fast chat
aicode        → Forge (code-qwen25-pro-q5km-prod)      # code generation
aireason      → Oracle (reason-deepseekr1-pro-q5km-prod) # deep reasoning
aisupervise   → Architect (plan-qwen25-pro-q5km-prod)  # planning
aicritic      → Auditor (critique-deepseekr1-pro-q5km-prod) # adversarial audit
swarm_triad   → Relay → Architect → Oracle (sequential)
swarm_evolve_run → full APEX-17 r8 4-phase pipeline
triad_status  → show routing table + loaded models
ollama_status → full Ollama health + registry dump
airambudget   → RAM budget summary (/proc/meminfo + ollama ps)
swarm_startup → bash startup-enhanced.sh (run before API)
```
