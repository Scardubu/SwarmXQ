# AI Engineering Control System (Claude Code)
# SwarmXQ — Autonomous Multi-Agent AI Orchestration Platform
# Baseline: V6.2.49 · APEX-17 r8 · Hardware: 16 GB RAM (HP EliteBook 850 G3 · CPU-only · bare-metal Linux)
# Video Generator Principal Engineer Directive: V3.2.0
# Lagos precision. Global scale.
#
# CHANGELOG
# V3.2.0 (2026-07-23): IEP-ELITE meta-protocol for Claude Code; μ-GATE/BLOCK taxonomy; FREE TOOL INTEGRATION
#   REGISTRY (Kokoro-82M, Piper, whisper.cpp, Openverse); session-end protocol; INV-18 cert-tier
#   state-machine wiring constraint; V4 S2–S5 + doctor CLI + JSON-mode milestones; corrected release
#   gate counts (225 API tests, 14 dashboard routes); SAFE DEFAULTS updated with voice benchmark env vars
# V3.1.0 (V6.2.45): APEX-17 r8 operator migration; SYSTEM-PROMPT V3.0; INV-15/16/17 added
# V3.0.0 (V6.2.21): Original production control document

This repository is governed by a modular AI skill system located at:

```
.ai/skills/          ← 38-skill domain suite (34 generic + 4 SwarmXQ-platform)
.claude/commands/    ← Claude Code slash commands (/nexus, /audit, /video, /forge, /model-ops)
```

Orchestration is handled by **NEXUS** — every task routes through NEXUS before
any implementation begins. See the mandatory entry point section below.

> ⚠️ **Skill directory notice**: The `.ai/skills/` folder must contain ONLY the
> 38 skills listed in the registry below. Do not install `sabiscore-*` skills here —
> those belong to the SabiScore vertical repository, not SwarmXQ.

---

# IEP-ELITE META-PROTOCOL (Claude Code's Inner Loop)

**Before every action — including reading files, writing code, running commands, or
answering questions about the codebase — execute this silently:**

```
1. ORIENT   — What precisely is being asked? Which domain? Which invariants apply?
               Which files are directly relevant? What is the blast radius of this change?

2. LOAD     — Read `.serena/memories/MEMORY.md` to identify the current session baseline.
               Read the most recent `project_v*.md`. Grep affected files before acting.
               Never assume file contents — the repository is the source of truth.

3. PLAN     — Generate 2–3 candidate approaches. Score each by:
               (a) invariant compliance  (b) quality gate impact  (c) compute cost on 16 GB CPU-only

4. μ-GATE   — Check the BLOCK/ESCALATE/PROCEED table below. If ANY BLOCK condition fires,
               stop. State the condition. Ask before proceeding.

5. EXECUTE  — Implement the highest-scoring plan at production quality.
               TypeScript: strict mode, no `any`, no `console.*`, Zod-validated.
               Python: structlog only, asyncio + httpx, no blocking I/O.

6. REFLECT  — Before emitting output: would a senior engineer at 3 AM be comfortable
               merging this without review? If no → revise. Check:
               - Zero `console.*` in services/routes
               - All env reads through `loadEnv()`
               - All Ollama responses wrapped in `sanitizeReasoningOutput()`
               - All model tags through `resolveCanonicalTag()`
               - No V5 operator names

7. EMIT     — Deliver in the Skill Trace Block envelope (see below).
               Open every code response with NEXUS trace. State session plan before first code.
```

---

# BLOCK / ESCALATE / PROCEED TAXONOMY

| Condition | Action |
|---|---|
| Requested change modifies `RAM_CRITICAL_MB` or `MAX_CONCURRENT_JOBS` | **BLOCK** — these are protected constants. State invariant. Refuse. |
| Requested change adds `OLLAMA_NUM_PARALLEL > 1` | **BLOCK** — CPU cannot benefit. State INV-13. |
| Requested change bypasses `sanitizeReasoningOutput()` | **BLOCK** — DeepSeek think blocks would corrupt structured output. |
| Requested change adds a third promotion path that doesn't call `canPromoteTo()` | **BLOCK** — INV-15. State ceiling contract. |
| Requested change adds scripting fallback that doesn't throw `SCRIPT_SCHEMA_INVALID` | **BLOCK** — INV-16. No safe stub can reach production tier. |
| Committing without all quality gates passing | **BLOCK** — No gate may be bypassed. Document skip reason if offline. |
| Adding `console.*` to `src/services/` or `src/routes/` | **BLOCK** — zero tolerance. Use `log.*`. |
| Enabling `SWARMX_VIDEO_ALLOW_STUB_RENDER=1` in production env | **BLOCK** — never in production. |
| Secret or credential visible in structured log payload | **BLOCK** — rotate credential immediately, do not commit. |
| Requested change affects both `betting_intelligence.py` AND `core_engine.py` (SabiScore dual-engine rule) | **BLOCK** — SabiScore vertical only; not in this repository. |
| V5 operator names (`SENTINEL`, `CANVAS`, `LEDGER`, `PROPHET`, `EVOLVER`) appear in new code | **BLOCK** — replace with APEX-17 r8 names before proceeding. |
| Blast radius unclear (e.g., "refactor the orchestrator" without scope) | **ESCALATE** — define exact files + invariants in scope first. |
| Change requires new OTel spans not yet spec'd | **ESCALATE** — propose span shape before implementing. |
| New milestone introduces ADR-gated feature (e.g., Openverse adapter per V4 §22) | **ESCALATE** — write ADR before implementation. |
| New skill or agent required but not in registry | **ESCALATE** — use `elite-skill-forge` and update registry before using. |
| All BLOCK conditions clear, blast radius understood | **PROCEED** |

---

# PROJECT STACK (IMMUTABLE CONSTANTS)

## Repository Architecture

SwarmXQ is a **TypeScript-first monorepo** with a Python orchestration sidecar.
Never conflate the TypeScript API layer with the Python brain layer.

| Layer | Package / Path | Technology |
|---|---|---|
| **API** | `apps/swarmx-api` | Fastify 5, TypeScript ESM, Zod, BullMQ, Redis |
| **Dashboard** | `apps/swarmx-dashboard` | Next.js 16, React 19, Zustand, Radix UI, Framer Motion |
| **Shared Types** | `packages/swarmx-types` | TypeScript (source-of-truth contracts) |
| **Python Brain** | `src/swarmx/` | Python 3.11+, structlog, httpx, asyncio |
| **Monorepo** | root | Turborepo, pnpm workspaces |
| **Runtime / DB** | — | Ollama (local LLM), Redis 7+, BullMQ |
| **Observability** | — | OpenTelemetry, Pino-compatible NDJSON, structlog |

## Canonical Production Entrypoints

```
apps/swarmx-api/src/server.ts         ← Fastify API: video, agents, metrics, health
apps/swarmx-dashboard/app/            ← Next.js 16 App Router: video UI, dashboard
packages/swarmx-types/src/            ← Canonical TypeScript contracts (operator-map, video-types)
```

**`MODEL_OPERATOR_MAP`** in `packages/swarmx-types/src/operator-map.ts` is the
single source of truth for all model tags, operator names, RAM profiles, and alias
resolution. The Python mirror `src/swarmx/operator_map.py` must remain semantically
identical. Every service imports from there — never re-define model metadata locally.

---

# SWARMXQ CANONICAL PRODUCTION SHAPE

## apps/swarmx-api

The Fastify API is the ONLY authority for:
- Video job lifecycle (enqueue, start, cancel, resume, complete)
- Pressure monitoring and SINGLE-7B LOCK enforcement
- Model eviction and keep-alive policy decisions
- SSE event broadcasting for video progress
- BullMQ job persistence and retry scheduling
- Rate limiting (per-IP, per-token) and video write auth
- System health, metrics, and agent status

**Never call `process.env[…]` directly in services or routes** — all env access
goes through `src/lib/env.ts` (`loadEnv()`). `src/lib/logger.ts` is the ONLY
logging interface; `console.*` is prohibited in `src/services/` and `src/routes/`.

## apps/swarmx-dashboard

The dashboard is a **consumer of API state** via `GET /api/video/jobs/:id` and
SSE events. It MUST NOT:
- Derive video job state independently
- Call Ollama directly (all inference through the API)
- Store job history beyond what the API returns
- Implement its own progress calculation (use `overallProgress` from API)
- Hard-code cold-start ETA values (read from `/api/system/health` → `warmup.coldStartEtaSecs`)

On client disconnect + reconnect: always re-fetch full job state via the REST
endpoint before resubscribing to SSE — never assume the stream is resumable.

**Confirmed dashboard routes (14 as of V6.2.49):**
`/`, `(dashboard)/`, `(dashboard)/video`, `(dashboard)/video/[id]`,
`(dashboard)/series`, `(dashboard)/series/new`, `(dashboard)/series/[id]`,
`(dashboard)/series/[id]/episodes/[episodeNumber]`,
`(dashboard)/agents`, `(dashboard)/composer`, `(dashboard)/workflows`,
`(dashboard)/settings`, `(dashboard)/logs`, `(dashboard)/system`

## packages/swarmx-types

All type contracts (video types, operator map, event shapes) originate here.
- Never duplicate type definitions in `apps/swarmx-api/src/types/`
- The `VideoJob`, `VideoJobRequest`, `VideoJobStage`, `SwarmXEvent`, and
  `OperatorTraceEntry` types in `apps/swarmx-api/src/types/video.ts` are
  bridge adapters over canonical types — do not modify the canonical contracts
  without updating both layers.

---

# CORE EXECUTION RULE

Before ANY action that involves understanding, modifying, or generating code:

1. Run the IEP-ELITE meta-protocol silently (see above)
2. Route through **NEXUS** for task classification and skill selection
3. Load ONLY the skills NEXUS selects — never blind-load all 38
4. Execute skills in NEXUS's dependency order
5. Resolve conflicts using the priority hierarchy below
6. Open every code response with a **Skill Trace Block**

```
┌─ NEXUS ─────────────────────────────────────────────────────┐
│ Task:      [one-line intent classification]                 │
│ Skills:    skill-a → skill-b → skill-c                      │
│ Order:     1. skill-a  2. skill-b  3. skill-c               │
│ Overrides: [conflict resolutions, or NONE]                  │
│ Risk:      [critical risks identified, or NONE]             │
│ Files:     [key files read before acting, or NONE]          │
│ μ-GATE:    [BLOCK / ESCALATE / PROCEED + reason]            │
└─────────────────────────────────────────────────────────────┘
```

---

# MANDATORY SKILL ENTRY POINT

All tasks MUST begin with:

👉 **NEXUS** (`/nexus` or read `NEXUS.md`)

NEXUS is the system orchestrator responsible for:
- Task intent classification (including SwarmXQ-domain intents)
- Skill selection from the 38-skill registry
- Dependency graph resolution and execution ordering
- Conflict resolution using the priority hierarchy

**No other skill may be invoked before NEXUS has run.**

> ⚠️ **Name disambiguation:**
>
> | Tool | Location | Purpose |
> |---|---|---|
> | NEXUS | `NEXUS.md` / `.claude/commands/nexus.md` | Routes tasks → selects skill graphs → orders execution |
> | `elite-skill-forge` | `.ai/skills/elite-skill-forge/` | Generates new SKILL.md files from domain descriptions |
> | `swarmxq-video-pipeline-architect` | `.ai/skills/swarmxq-video-pipeline-architect/` | SwarmXQ 6-stage pipeline contracts and invariants |
> | `swarmxq-model-orchestrator` | `.ai/skills/swarmxq-model-orchestrator/` | APEX-17 r8 model routing and SINGLE-7B LOCK enforcement |
> | `swarmxq-creative-director` | `.ai/skills/swarmxq-creative-director/` | Script quality, virality scoring, caption rules, TONE_RULES |
> | `swarmxq-startup-ops-architect` | `.ai/skills/swarmxq-startup-ops-architect/` | startup-enhanced.sh, Ollama CPU perf tuning, warmup health |

---

# SKILL PRIORITY HIERARCHY (CONFLICT RESOLUTION)

When skills produce conflicting recommendations, resolve in this order:

## 1. Security & Safety
→ `security-hardening-auditor`
→ `backend-systems-auditor`
→ `swarmxq-model-orchestrator` (RAM_CRITICAL_MB, MAX_CONCURRENT_JOBS are protected constants)

## 2. Correctness & Stability
→ `testing-strategy-architect`
→ `swarmxq-video-pipeline-architect` (pipeline stage contracts and invariants)
→ `typescript-config-surgeon`
→ `component-quality-gate`
→ `effect-ts-layer-architect`
→ `backend-domain-model-architect`
→ `api-contract-governance-architect`

## 3. Performance & Scalability
→ `swarmxq-model-orchestrator` (SINGLE-7B LOCK, keep-alive strategy, 16 GB profile)
→ `swarmxq-startup-ops-architect` (Ollama CPU perf vars, startup sequence)
→ `nextjs-performance-architect`
→ `edge-cache-architecture-architect`
→ `opentelemetry-observability-architect`
→ `real-time-systems-architect`
→ `bullmq-job-architect`

## 4. Architecture & Design
→ `swarmxq-video-pipeline-architect` (pipeline architecture)
→ `multi-agent-orchestration-architect` (agent routing, operator map)
→ `backend-domain-model-architect`
→ `api-contract-governance-architect`
→ `frontend-product-design-architect`
→ `accessibility-system-architect`
→ `data-visualization-architect`
→ `prisma-database-architect`
→ `bullmq-job-architect`

## 5. AI Engineering
→ `swarmxq-model-orchestrator` (canonical tag resolution, triad dispatch)
→ `prompt-engineering-architect`
→ `multi-agent-orchestration-architect`
→ `ai-feature-architect`

## 6. Creative Quality
→ `swarmxq-creative-director` (script quality, virality, caption, tone)
→ `swarmxq-video-pipeline-architect` (stage prompt wiring)
→ `prompt-engineering-architect` (rubric and system prompt refinement)

## 7. Real-Time & Streaming
→ `real-time-systems-architect` (SSE, video progress events, reconnection)
→ `bullmq-job-architect` (BullMQ persistence, worker separation)

## 8. UX / UI / Motion
→ `frontend-product-design-architect`
→ `accessibility-system-architect`
→ `motion-performance-architect`
→ `motion-interaction-architect`
→ `design-token-system-architect`
→ `component-quality-gate`
→ `data-visualization-architect`

## 9. Release / Productivity / Tooling
→ `swarmxq-ci-release-architect` (SwarmXQ-specific CI gates, quality checklist)
→ `release-incident-operations-architect`
→ `git-workflow-architect`
→ `vscode-cognitive-os`
→ `vscode-ai-agent-stack`

---

# SWARMXQ-SPECIFIC INTENT TYPES (for NEXUS classification)

NEXUS must recognize these SwarmXQ-domain intents in addition to the general taxonomy:

| Intent | Key Signals |
|---|---|
| **Video Generation Pipeline** | "video job", "video stage", "intent classification stage", "planning stage", "scripting stage", "storyboard", "render assembly", "finalizing stage", "video orchestrator", "stage progress", "overallProgress", "video:progress", "video:completed", "video:failed" |
| **Render Backend** | "ffmpeg", "comfyui", "LTX-Video", "render backend", "SWARMX_VIDEO_RENDER_BACKEND", "comfyRunWorkflow", "renderWithFfmpeg", "outputFilename", "totalFrames", "frame budget" |
| **Renderer Certification** | "renderer certification", "certification ceiling", "clampCertificationTier", "canPromoteTo", "CERT_TIER_CLAMPED_BY_RENDERER", "CertificationTier", "TECHNICALLY_VALID", "PUBLISHED_VERIFIED", "PRODUCTION_PACK_VALID", "READY_TO_POST", "PUBLISHING" |
| **Stage Schema Validation** | "stage schema", "validateStageResult", "StageValidationEntry", "stageValidationTrace", "SCRIPT_SCHEMA_INVALID", "PlanningResultSchema", "ScriptingResultSchema", "StoryboardResultSchema" |
| **Voice Provider** | "voice provider", "voice benchmark", "voice-benchmark.ts", "SWARMX_TTS_PROVIDER", "Kokoro", "Piper", "eSpeak", "neural_local", "neural_hosted", "synthetic_fallback", "selectVoiceProvider", "rankAvailableProviders", "SWARMX_VOICE_BENCHMARK_FILE", "SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS", "benchmarkAppliedProviderId", "KOKORO_VOICE_MAP", "RTF" |
| **Model Orchestration (SINGLE-7B)** | "SINGLE-7B LOCK", "model eviction", "evictIncompatible", "keep-alive", "OLLAMA_KEEP_ALIVE", "OLLAMA_MAX_LOADED_MODELS", "acquireModel", "ModelOrchestrator", "resolveCanonicalTag", "canonical tag", "legacy alias", "pressure level", "PRESSURE_CRITICAL", "RAM pressure", "readPressure" |
| **APEX-17 r8 Operators** | "Pilot", "Oracle", "Forge", "Architect", "Relay", "Auditor", "Lab", "operator map", "MODEL_OPERATOR_MAP", "resolveOperatorName", "operator trace", "model triad" |
| **Agent System** | "SwarmX agent", "agent catalog", "agent role", "skill curator", "memory curator", "workflow router", "strategist", "evaluator", "evolver", "producer", "risk sentinel", "tournament judge", "agent dispatch", "agent state" |
| **Creative Quality** | "[HOOK]", "[BODY]", "[RESOLUTION]", "[CTA]", "hook pattern", "HOOK_BLOCKLIST", "tone variant", "TONE_RULES", "virality score", "hookStrength", "completionProxy", "shareability", "seoScore", "ViralitySignal", "VIRALITY_SCORE_RUBRIC", "captionDraft", "CAPTION_RULES", "soundSuggestion", "storyboard scene", "comfyPrompt", "faceless_broll", "kinetic_text" |
| **Template Family** | "template family", "myth-vs-fact", "list/countdown", "mystery/reveal", "product-demo", "quote-to-insight", "chart/data", "motivational", "series recap", "V4 §S2", "8 templates" |
| **Preview Pipeline** | "preview pipeline", "proxy render", "partial scene", "PLAN_ONLY", "QUICK_DRAFT", "preview mode", "V4 §S3" |
| **Video Job Queue** | "BullMQ video", "job persistence", "SWARMX_VIDEO_USE_BULLMQ", "job registry", "video queue", "enqueue", "cancelJob", "resumeJob", "reprioritizeQueue", "clientRequestId idempotency", "SINGLE-VIDEO LOCK", "MAX_CONCURRENT_JOBS" |
| **SSE / Video Streaming** | "video:stream event", "video:progress event", "subscribeToJob", "SSE disconnect", "broadcast", "BroadcastFn", "makeVideoProgressEvent", "makeVideoCompletedEvent", "video reconnect" |
| **Pressure & RAM Management** | "swarm-pressure-monitor", "governor", "HIGH_PRESSURE_DELAY_MS", "MemAvailable", "procinfo", "RAM budget", "availableMb", "getRamSnapshot", "startup-enhanced.sh", "16 GB profile", "shouldAutoEnableLowRamMode" |
| **Startup Ops / Ollama Performance** | "startup-enhanced.sh", "Ollama warmup", "Pilot pre-warm", "zero-token probe", "OLLAMA_NUM_PARALLEL", "OLLAMA_FLASH_ATTENTION", "OLLAMA_KV_CACHE_TYPE", "OLLAMA_NUM_THREADS", "KV cache type", "flash attention", "num_ctx", "cold-start ETA", "warmup-status", "warmup flag", "FULL_PIPELINE_MIN_AVAILABLE_MB", "12 GB detection", "boot sequence", "model warmup" |
| **Doctor CLI** | "doctor CLI", "pnpm -F @swarmx/api exec tsx scripts/doctor.ts", "startup diagnostics", "system check", "environment validation" |
| **Ollama JSON-mode** | "JSON-mode", "structured output", "Ollama JSON", "json_mode", "format json", "CPU JSON-mode reliability", "PLAN_ONLY JSON" |
| **Reasoning Sanitization** | "reasoning sanitizer", "sanitizeReasoningOutput", "DeepSeek think blocks", "reasoning output", "<think>", "extractJson" |
| **Env Configuration** | "loadEnv", "env.ts schema", "Zod env", "SWARMX_VIDEO_*", "SWARMX_OLLAMA_*", "SWARMX_API_*", "fail-fast env", "env validation" |
| **Observability / Logging** | "structured logger", "log.ts", "Pino-compatible", "NDJSON", "console.* migration", "fatal log", "unhandledRejection", "uncaughtException" |
| **CI / Release Gates** | "GitHub Actions", "ci.yml", "quality gate", "pnpm cache", "regression script", "vitest", "tsc --noEmit", "next build", "release checklist", "deploy gate" |
| **Video QA Loop** | "whisper.cpp", "transcription", "script drift", "subtitle sync", "audio transcription", "video QA", "STT verification" |

---

# FULL SKILL REGISTRY (38 SKILLS)

The suite consists of **38 unique skills** organized across 9 clusters.
`data-visualization-architect` is in Cluster 2 (UI concern) and Cluster 7 (real-time data).
Both appearances refer to the SAME skill file — no duplication exists on disk.

## Cluster 1 — Editor & Environment (6 skills)

| # | Skill | Domain |
|---|---|---|
| 1 | `vscode-cognitive-os` | settings.json, cognitive workspace setup, multi-root monorepo |
| 2 | `vscode-ai-agent-stack` | Claude Code + Copilot hybrid; Cline/Continue.dev; CLAUDE.md workflow |
| 3 | `vscode-monorepo-forge` | .code-workspace, Turborepo tasks.json, multi-root debug configs |
| 4 | `vscode-debug-profiler` | launch.json for Fastify/Node; CPU + memory profiling on constrained hardware |
| 5 | `typescript-config-surgeon` | tsconfig.json, ESLint flat config, path aliases, Zod schema strictness |
| 6 | `git-workflow-architect` | Conventional commits, husky, commitlint, GitHub Actions CI/CD |

## Cluster 2 — Frontend Design (8 skills)

| # | Skill | Domain |
|---|---|---|
| 7 | `design-token-system-architect` | Tone-aware palette tokens, dark mode, Tailwind v4, TONE_BACKGROUNDS/ACCENTS |
| 8 | `frontend-product-design-architect` | Dashboard IA, video job card hierarchy, conversion flow |
| 9 | `frontend-design-auditor` | Gestalt principles, WCAG AA, Swiss minimalism, Nothing OS aesthetics |
| 10 | `accessibility-system-architect` | WCAG 2.2 AA, ARIA live regions for video:progress, keyboard parity |
| 11 | `component-quality-gate` | Component a11y, CWV impact, Storybook, prop contract review |
| 12 | `motion-performance-architect` | Motion budget, compositor rules, prefers-reduced-motion for dashboard |
| 13 | `motion-interaction-architect` | Framer Motion progress animations, stage transition effects |
| 14 | `data-visualization-architect` | Virality gauge panels, progress charts, recharts dashboard |

## Cluster 3 — Backend Engineering (9 skills)

| # | Skill | Domain |
|---|---|---|
| 15 | `backend-domain-model-architect` | Video job as bounded context, stage state machine invariants |
| 16 | `effect-ts-layer-architect` | Effect-TS Layers (applicable if Effect-TS verticals are in scope) |
| 17 | `prisma-database-architect` | Schema design, migrations (applicable if Prisma used in future) |
| 18 | `bullmq-job-architect` | BullMQ Worker separation, DLQ, connection isolation, Redis fallback |
| 19 | `api-automation-architect` | Idempotency contracts, retry/backoff, Ollama circuit breaker |
| 20 | `api-contract-governance-architect` | `/api/video/*` OpenAPI shape, SSE event schema |
| 21 | `backend-systems-auditor` | Fastify production readiness, graceful shutdown, server.ts audit |
| 22 | `opentelemetry-observability-architect` | Stage span instrumentation, model acquisition metrics, OTLP |
| 23 | `edge-cache-architecture-architect` | Cache strategy for job list, system health, dashboard static |

## Cluster 4 — Application Layer (6 skills)

| # | Skill | Domain |
|---|---|---|
| 24 | `nextjs-performance-architect` | RSC vs client components for dashboard, bundle analysis, streaming |
| 25 | `security-hardening-auditor` | Video write auth, rate-limit buckets, CSP, prompt injection defense |
| 26 | `testing-strategy-architect` | Vitest (dashboard + API), regression scripts, smoke tests |
| 27 | `ai-feature-architect` | Ollama streaming integration, structured output, multi-model routing |
| 28 | `prompt-engineering-architect` | Stage prompts (hook, body, storyboard), virality rubric, agent prompts |
| 29 | `release-incident-operations-architect` | Quality gate sequencing, CI promotion, rollback triggers |

## Cluster 5 — Mobile & Meta (2 skills)

| # | Skill | Domain |
|---|---|---|
| 30 | `react-native-expo-architect` | Applicable if SwarmXQ mobile app is built |
| 31 | `elite-skill-forge` | Generates new SKILL.md files — NOT NEXUS, NOT an orchestrator |

## Cluster 6 — Vertical Intelligence (2 skills)

| # | Skill | Domain |
|---|---|---|
| 32 | `nigerian-fintech-compliance-architect` | TaxBridge vertical only — activate only for TaxBridge/FIRS/VAT work |
| 33 | `multi-agent-orchestration-architect` | APEX-17 r8 agent routing, operator taxonomy, IEP-ELITE protocol, agent council |

## Cluster 7 — Real-Time & Data (2 skills)

| # | Skill | Domain |
|---|---|---|
| 34 | `real-time-systems-architect` | SSE video:progress events, subscribeToJob, reconnection contract |
| 35 | `data-visualization-architect` | Virality score gauges, job queue depth — same file as Cluster 2 #14 |

## Cluster 8 — SwarmXQ Platform (4 skills — MUST exist at `.ai/skills/`)

| # | Skill | Domain |
|---|---|---|
| 35 | `swarmxq-video-pipeline-architect` | 6-stage pipeline contracts, render backend, stage invariants |
| 36 | `swarmxq-model-orchestrator` | SINGLE-7B LOCK, canonical tags, keep-alive, 16 GB profile, pressure |
| 37 | `swarmxq-creative-director` | Script quality gates, TONE_RULES, virality scoring, caption rules, storyboard |
| 38 | `swarmxq-startup-ops-architect` | startup-enhanced.sh, Ollama CPU perf vars, warmup health endpoint |

> **Unique skills on disk: 38.** `data-visualization-architect` appears in C2 and C7 but
> is a single file. Total `.ai/skills/` directories: exactly 38.

## Cluster 9 — SwarmXQ CI / Release (1 skill — new)

| # | Skill | Domain |
|---|---|---|
| 39 | `swarmxq-ci-release-architect` | GitHub Actions CI, quality gate sequencing, pnpm cache, release CHANGELOG |

> ⚠️ **These four SwarmXQ platform skills are NOT included in the generic `.ai/` skill zip.**
> They are provided separately and must be manually placed at:
> - `.ai/skills/swarmxq-video-pipeline-architect/SKILL.md`
> - `.ai/skills/swarmxq-model-orchestrator/SKILL.md`
> - `.ai/skills/swarmxq-creative-director/SKILL.md`
> - `.ai/skills/swarmxq-startup-ops-architect/SKILL.md`

> 🚫 **Skills to EXCLUDE from `.ai/skills/` in this repository:**
> - `sabiscore-betting-engine-auditor` — SabiScore vertical only
> - `sabiscore-provider-adapter-architect` — SabiScore vertical only

---

# MOTION SKILL DISAMBIGUATION

| Skill | Role |
|---|---|
| `motion-performance-architect` | **Strategy**: motion budget, compositor rules, anti-patterns, `prefers-reduced-motion` |
| `motion-interaction-architect` | **Implementation**: Framer Motion APIs, animation tokens, gesture code |

Always load `motion-performance-architect` first, then `motion-interaction-architect`.

---

# PROJECT CONSTRAINTS (NON-NEGOTIABLE)

## Universal Rules

- No unnecessary rewrites — optimize incrementally unless the system is broken
- Preserve architecture unless an explicit rewrite is requested
- Avoid overengineering — add complexity only when it earns its maintenance cost
- Dashboard uses **React 19** (not 18 — do not apply React 18-era constraints)
- `maxTsServerMemory` must not exceed **6144** (half of 16 GB system RAM)
- All code changes must include a degradation path that works at 8 GB RAM via `shouldAutoEnableLowRamMode()`
- **Read affected files before writing any code.** Grep/cat before acting.

## Video Generation Pipeline (CRITICAL)

- **Stage order is immutable**: `intent_classification → planning → scripting → storyboard_generation → render_assembly → finalizing`
- **Post-pipeline** (non-blocking): `stageViralityAndCaption()` runs after finalizing
- **`modelsUsed[stage]`** must be set inside each stage function immediately after `acquireModel()` resolves — never re-derived in `runStage()`
- **AbortController per stage** via `stageController()` with `{ once: true }` listeners — zero listener accumulation
- **`sanitizeReasoningOutput()`** must wrap every Ollama response before parsing — DeepSeek `<think>` blocks must never reach script, storyboard, or intent JSON
- **Render backend**: FFmpeg unloads all Ollama models before starting — never skip `ModelOrchestrator.unloadModel()` loop
- **ComfyUI poll ceiling**: derived from `STAGE_TIMEOUT_MS["render_assembly"] / COMFY_POLL_INTERVAL_MS` — never an independent literal
- **Stage schema validation**: planning, scripting, storyboard validated via `validateStageResult()` in `stage-schemas.ts`; scripting failures throw `SCRIPT_SCHEMA_INVALID`; planning/storyboard fall to hard-coded defaults; all outcomes persisted in `job.stageValidationTrace`
- **Renderer certification ceiling**: all `certificationTier` assignments route through `clampCertificationTier()` in `renderer-certification.ts`; downstream promotions use `canPromoteTo()`

## Creative Quality Gates (CRITICAL — from swarmxq-creative-director)

- **`[HOOK]` section**: ≤ 18 words; no preamble; never starts with "In today's video…", "Welcome to…", "Hi everyone…", "Today we…", "I", "My", "This video", "Let's", "We're going to"; must pass `HOOK_BLOCKLIST` check
- **`[BODY]` section**: every sentence increases stakes; `[VISUAL: subject + motion + setting + mood + quality keywords]` required after visual moments; active voice only
- **`[RESOLUTION]` section**: 1–2 sentences maximum; actionable, not a summary; resolves hook tension
- **`[CTA]` section**: 5–8 words; specific to audience; never "like and subscribe" or generic imperatives
- **TONE_RULES completeness**: must contain ALL 8 variants: `contrarian`, `urgent`, `educational`, `cinematic`, `warm`, `minimal`, `faceless_broll`, `kinetic_text`. Missing variants must be added before any pipeline change ships.
- **Virality overall formula**: `hookStrength×0.35 + completionProxy×0.25 + shareability×0.25 + seoScore×0.15` — never alter the weights without updating `VIRALITY_SCORE_RUBRIC`
- **Caption `firstLine`**: ≤ 40 chars; no opener starting with "I", "My", "This", "We", "Our"
- **Caption hashtags**: 3–5 total; ≤ 1 trending; at least 1 niche; not `#fyp`, not `#viral`
- **Caption emojis**: ≤ 3 in full caption
- **`soundSuggestion`**: must not contain URLs or artist attribution — validated at generation time AND scoring time

## Model Orchestration (CRITICAL — SINGLE-7B LOCK)

- **Only one 7B-class model may be inference-active simultaneously** — CPU-only hardware has one inference thread regardless of RAM
- On 16 GB: `OLLAMA_MAX_LOADED_MODELS=2` is permitted — Pilot router (~3 GB) may be resident while a 7B model (~5 GB) runs. This is NOT concurrent inference
- `OLLAMA_KEEP_ALIVE=5m` for Pilot only; `OLLAMA_KEEP_ALIVE=0` for all 7B-class models after stage completion
- `ModelOrchestrator.evictIncompatible()` must be called before every 7B model load
- `RAM_CRITICAL_MB = 800` is a protected constant — never change it
- `MAX_CONCURRENT_JOBS = 1` is a protected constant — never change it (CPU inference is serial)
- All model tags must pass through `resolveCanonicalTag()` from `@swarmx/types/operator-map` before reaching the registry
- **Legacy aliases that must NEVER appear in production code**: `phi4-fast`, `deepseek-reasoner`, `qwen-worker`, `relay-router`, `scar-auditor`, `scar-lab`, `SENTINEL` (V5), `CANVAS` (V5), `LEDGER` (V5), `PROPHET` (V5), `EVOLVER` (V5)

## Fastify API

- **`console.*` is prohibited** in `src/services/` and `src/routes/` — use `log.*` from `src/lib/logger.ts`
- **All env reads** go through `src/lib/env.ts` (`loadEnv()`) — no ad-hoc `process.env[…]` for values with invariants
- **Rate-limit bucket eviction** via unref'd `setInterval(2h)` — never allow `captionScoreBuckets` or `jobSubmitBuckets` to grow unbounded
- **`requireVideoWriteAuth()`** must gate all `POST /api/video/*` mutation routes
- **Global error handlers** (`unhandledRejection` + `uncaughtException`) are wired in `server.ts` — never remove or weaken them
- **BullMQ Worker** must use a separate `ioredis` connection from the API Queue connection — never share connections between roles
- **Idempotency**: `clientRequestId` dedup in `video-queue.ts` must be respected when BullMQ is enabled

## Dashboard Frontend

- All API calls proxy through the Fastify API — zero direct Ollama or Redis calls from the browser
- SSE reconnection: re-fetch job state via REST before resubscribing — never assume stream resumability
- Tone-aware palette must derive from the canonical `TONE_BACKGROUNDS` / `TONE_ACCENTS` maps in `ffmpeg-video-renderer.ts`
- Cold-start ETA: read from `/api/system/health` → `warmup.coldStartEtaSecs`; **never hard-code 140 or 45**
- WCAG 2.2 AA is the accessibility floor — all interactive elements keyboard-navigable, ARIA live regions on `video:progress`
- Virality score panel: circular gauges; color-coded `< 0.4 → red`, `0.4–0.7 → amber`, `> 0.7 → green`; overall score prominent
- Error panel: `role="alert"`, error code in monospace, `errorCodeHint` prose, "Retry from Stage" + "Resubmit" always present

## Python Brain (`src/swarmx/`)

- **`structlog` is the ONLY logging interface** in the Python layer — never use `print()` or `logging.basicConfig()`
- All async I/O uses `asyncio` + `httpx.AsyncClient` — never use `requests` (blocking)
- Agent definitions live in `src/swarmx/agents/` — one file per agent role; never inline agent logic in orchestrator
- The operator taxonomy (`Relay`, `Pilot`, `Architect`, `Forge`, `Oracle`, `Auditor`, `Lab`) maps to the TypeScript `MODEL_OPERATOR_MAP` — keep them in sync; never use V5 operator names
- Agent state is **stateless between turns** — no in-memory state persistence across invocations; all state goes to Redis or the job record
- `src/swarmx/memory/` stores long-term knowledge — never read it inline in hot paths; use the memory curator agent pattern
- Python observability wires to the same OTLP collector as the TypeScript layer — same service name prefix (`swarmx.`)

## Agent System Constraints

- **30+ specialist agents** in the catalog — use `multi-agent-orchestration-architect` skill for all agent design work
- Agent prompts follow the IEP-ELITE 7-phase protocol (`ORIENT → LOAD → PLAN → μ-GATE → EXECUTE → REFLECT → EMIT`)
- **Tournament selection** for evolver outputs — the `tournament-judge` agent validates evolved agent versions before promotion; never promote without a tournament pass
- **Evolver agents** must write a memory note to `.serena/memories/` after every evolution cycle; never evolve silently
- The `Auditor` operator is reserved for critique/validation/red-team tasks; `Lab` is for meta-evolution/skill synthesis — never use them in the video pipeline
- Agent tool calls must be **idempotent** — the orchestrator may retry without side effects
- **Prompt injection defense**: all user-supplied content entering an agent prompt must be escaped or placed in a `<user_content>` block, never interpolated raw

## Credential Safety (ABSOLUTE)

- Zero secrets in source control — run Gitleaks in CI
- `SWARMX_VIDEO_API_TOKEN` must never appear in logs or traces — `base-publisher.ts` sanitization is the model
- Redact auth headers, OAuth tokens, and DSNs from all structured log payloads
- Any credential previously committed must be rotated immediately

---

# HARDWARE PROFILE

**Target host: HP EliteBook 850 G3 · 16 GB RAM · CPU-only · 4 cores · WSL2 (or bare-metal Linux)**

| Constant | Value | File | Protected? |
|---|---|---|---|
| `FULL_PIPELINE_MIN_AVAILABLE_MB` | 6170 MB | `video-runtime-config.ts` | No |
| `VIDEO_RAM_RESERVE_MB` | 800 MB | `video-runtime-config.ts` | No |
| `LOW_RAM_VIDEO_MODEL` | `"instruct-phi4-lite-q4km-prod"` | `video-runtime-config.ts` | No |
| `RAM_CRITICAL_MB` | 800 MB | `model-orchestrator.ts` | **YES** |
| `MAX_CONCURRENT_JOBS` | 1 | `video-queue.ts` | **YES** |
| `OLLAMA_MAX_LOADED_MODELS` | 2 (16 GB profile) | env / `startup-enhanced.sh` | No |

### 16 GB Model Residency Budget

| Resident models | Combined RAM | Within budget? |
|---|---|---|
| Pilot (`instruct-phi4-pro-q8-prod`) alone | ~3 GB | ✓ |
| Pilot + Architect (`plan-qwen25-pro-q5km-prod`) | ~8 GB | ✓ — target dual-resident state |
| Pilot + Oracle (`reason-deepseekr1-pro-q5km-prod`) | ~8 GB | ✓ — virality scoring only |
| Any two 7B-class models simultaneously | ~10 GB | ✗ — violates SINGLE-7B inference |
| All three text-stage models simultaneously | ~13 GB | ✗ — never load concurrently |
| Relay + Pilot | ~5.5 GB | ✓ — viable but Relay rarely needs to stay warm |

### Ollama CPU Performance Profile (CPU-only, 4-core, WSL2)

These variables are **required** for optimal CPU-only inference. Set in `startup-enhanced.sh`
and validated via `env.ts`. Wrong values cause silent throughput degradation — no error is thrown.

| Variable | Value | Rationale |
|---|---|---|
| `OLLAMA_NUM_PARALLEL` | `1` | CPU has one effective inference thread; parallelism > 1 adds scheduling overhead with zero throughput gain |
| `OLLAMA_MAX_LOADED_MODELS` | `2` (16 GB) / `1` (8 GB) | Dual-resident on 16 GB only |
| `OLLAMA_FLASH_ATTENTION` | `1` | Fused attention kernel: ~20% memory reduction on CPU AVX2; degrades gracefully on non-AVX2 |
| `OLLAMA_KV_CACHE_TYPE` | `q8_0` | int8 KV cache: ~30% memory savings vs f16, negligible quality loss; never use f16 on 16 GB |
| `OLLAMA_NUM_THREADS` | `3` (WSL2) / `4` (bare-metal) | Leave 1 core for OS + WSL2 hypervisor; detect via `grep -qi microsoft /proc/version` |
| `OLLAMA_KEEP_ALIVE` | `0` (global) / `5m` (Pilot only) | Global evict-after-run; Pilot override in startup-enhanced.sh |

> **Bare-metal detection**: `grep -qi microsoft /proc/version && THREADS=3 || THREADS=4`
> Bare-metal confirmed at V6.2.44 — use `OLLAMA_NUM_THREADS=4` when not under WSL2 hypervisor.

### APEX-17 r8 Full Operator Registry

`MODEL_OPERATOR_MAP` is the single source of truth. Both `operator-map.ts` (TypeScript) and
`operator_map.py` (Python) must remain semantically identical.

| Operator | Canonical tag | is7B? | Video role |
|---|---|---|---|
| **Relay** | `route-phi4-lite-q4km-prod` | No (~2.5 GB) | Pre-pipeline routing; not used in video stages directly |
| **Pilot** | `instruct-phi4-pro-q8-prod` | No (~3 GB) | intent_classification, caption generation |
| **Pilot lite** | `instruct-phi4-lite-q4km-prod` | No (~2.2 GB) | Low-RAM fallback for all text stages |
| **Architect** | `plan-qwen25-pro-q5km-prod` | Yes (~5 GB) | planning, scripting, storyboard |
| **Architect deep** | `plan-deepseekr1-pro-q5km-prod` | Yes (~5 GB) | Deep planning fallback |
| **Oracle** | `reason-deepseekr1-pro-q5km-prod` | Yes (~5 GB) | Virality scoring (post-pipeline) |
| **Forge** | `code-qwen25-pro-q5km-prod` | Yes (~5 GB) | Agent code generation (not video) |
| **Auditor** | `critique-deepseekr1-pro-q5km-prod` | Yes (~5 GB) | Agent QA gating, critique, red-team (not video) |
| **Lab** | `synth-qwen25-exp-q4km-dev` | Yes (~4 GB) | Meta-evolution, skill synthesis (dev only, not production) |

> **V5 → APEX-17 r8 operator name mapping** (never use V5 names in new code):
> `SENTINEL` → `Relay` · `FORGE` → `Forge` · `CANVAS` → `Architect` · `ORACLE` → `Oracle` ·
> `NEXUS` → removed · `LEDGER` → `Auditor` · `PROPHET` → removed · `EVOLVER` → `Lab`

---

# FREE TOOL INTEGRATION REGISTRY

All tools below are zero-cost, open-source, and confirmed runnable on CPU-only 16 GB hardware.
Install paths and usage patterns are canonical — do not deviate from them.

## Voice Generation (TTS)

### Tier 1: Neural Local — Kokoro-82M (PRIMARY)

```bash
# Install: kokoro-onnx (Python, Apache 2.0, ~82M params, CPU-optimized)
pip install kokoro-onnx soundfile
# Download voice models (pick one pack per locale)
python -c "from kokoro_onnx import Kokoro; k = Kokoro('kokoro-v0_19.onnx', 'voices.bin')"
# Recommended ONNX model: kokoro-v0_19.onnx (en_US)
# Voice IDs used in KOKORO_VOICE_MAP: af_sarah, am_michael, bm_george, bm_lewis, am_adam, af_nicole
```

**Characteristics**: RTF < 0.3 on 4-core CPU (faster than real-time), 24kHz output,
neutral accent, multiple speaker packs. Best neutral/warm/educational tones.

**Integration point**: `voice-providers.ts` → `KokoroProvider` → probe via `commandAvailable('kokoro', '--version')`.
Voice map: `KOKORO_VOICE_MAP` in `voice-providers.ts` (already implemented at V6.2.45+).

### Tier 1: Neural Local — Piper TTS (SECONDARY)

```bash
# Install
pip install piper-tts
# Download voice model (recommended for SwarmXQ)
python -m piper --download-dir ~/.local/share/piper/voices en_US-lessac-medium
# Alternative: en_US-libritts-high (higher quality, slower)
# Usage: echo "text" | piper --model en_US-lessac-medium --output_file out.wav
```

**Characteristics**: RTF ~0.5 on 4-core CPU, 22kHz, slight robotic quality vs Kokoro.
Best cinematic/narrator tones where deeper voice preferred.

**Integration**: warm benchmark run after Piper install to update `/tmp/swarmxq-voice-benchmark.json`.

### Tier 2: Synthetic Fallback — eSpeak-ng

```bash
sudo apt-get install espeak-ng
espeak-ng -v en-us -s 175 -w /tmp/out.wav "text"
```

**RTF**: < 0.05 (extremely fast). Quality: synthetic. Use ONLY as pipeline fallback — never production.

### Optional: Coqui XTTS-v2 (Voice Cloning, RAM-Intensive)

```bash
# RAM requirement: ~8 GB. Only viable on 16 GB host with Ollama fully evicted.
pip install TTS
# Do NOT run concurrently with any 7B model — evict all Ollama models first.
```

**Invariant**: Coqui XTTS-v2 MUST be treated as a 7B-class RAM consumer. `evictIncompatible()` before use.

## Video QA Loop — whisper.cpp (FREE STT)

whisper.cpp enables a feedback loop: transcribe generated MP4 audio, compare against original
script, detect word error rate, flag drift > threshold.

```bash
# Build (CPU-only, AVX2 optimized)
git clone https://github.com/ggerganov/whisper.cpp && cd whisper.cpp
make -j4 WHISPER_AVX2=1
# Download model (tiny.en: ~75 MB, fast enough for QA; base.en: ~148 MB, higher accuracy)
bash ./models/download-ggml-model.sh base.en
# Transcribe generated video
./whisper.cpp/build/bin/main -m models/ggml-base.en.bin -f output.wav --output-txt
```

**QA Integration pattern** (add to `video-regression-check.ts`):

```typescript
// After render_assembly completes, run STT and WER check
// if (WER > SWARMX_SCRIPT_DRIFT_THRESHOLD) → log.warn({ code: 'SCRIPT_DRIFT', wer })
// Do NOT block job completion — surface as stageValidationTrace entry
```

**RAM profile**: whisper.cpp `base.en` requires ~350 MB. Safe to run after FFmpeg evicts Ollama.
**Model selection**: `tiny.en` for speed (RTF ~3x), `base.en` for accuracy (RTF ~5x) on CPU.

## Asset Sources (Creative Commons / License-Safe)

### Openverse (V4 §S4 — ADR required before implementation)

```
API: https://api.openverse.org/v1/
Auth: Free API key — register at https://api.openverse.org/v1/auth_tokens/register/
Rate limit: 100 req/min (authenticated), 5 req/min (unauthenticated)
License filter: &license=cc0,by for commercial-safe CC0 and CC-BY
```

**⚠️ ADR required per V4 §22 before Openverse adapter ships (V4 §S4).**

### Freesound.org (CC Sound Effects)

```
API: https://freesound.org/apiv2/
Auth: Free API key at https://freesound.org/apiv2/apply/
License filter: ?license=Creative Commons 0
Usage: soundSuggestion ambient backing tracks and foley assets
```

### Pixabay Video API (CC0 B-roll)

```
API: https://pixabay.com/api/videos/?key=YOUR_KEY
Auth: Free API key at https://pixabay.com/api/docs/
License: All Pixabay content is CC0 — no attribution required
Usage: faceless_broll scenes where ComfyUI unavailable
```

**Integration guideline**: Openverse + Freesound + Pixabay assets must carry `AssetLicense`
metadata when stored in job artifacts — the `AssetLicense` type in `@swarmx/types/video-types`
is already structured for this. Never embed an asset without recording its license.

## Voice Benchmark — Running Against Real Providers

After installing Piper and Kokoro, run the actual benchmark to generate the first production
report. The next session's kickoff check will then surface the recommended provider.

```bash
# Set output path
export SWARMX_VOICE_BENCHMARK_FILE=/tmp/swarmxq-voice-benchmark.json
# Run benchmark (requires Kokoro + Piper installed; eSpeak always available)
pnpm --filter @swarmx/api exec tsx scripts/voice-benchmark.ts
# Verify output
cat /tmp/swarmxq-voice-benchmark.json | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'Recommended: {d[\"recommendedProviderId\"]} — {d[\"recommendationReason\"]}')"
```

---

# SAFE DEFAULTS (PRODUCTION FAIL-CLOSED)

```env
# API behaviour
NODE_ENV=production
LOG_LEVEL=info
SWARMX_VIDEO_USE_BULLMQ=0          # Priority 1: enable once Worker is tested
SWARMX_VIDEO_LOW_RAM_MODE=0        # auto-detected; force=1 on 8GB hosts
SWARMX_VIDEO_RENDER_BACKEND=auto   # auto: ComfyUI if available, else FFmpeg
SWARMX_VIDEO_ALLOW_STUB_RENDER=0   # never enable in production
SWARMX_VIDEO_ALLOW_UNSTRUCTURED_INTENT=0

# Rate limits
SWARMX_VIDEO_JOB_LIMIT_PER_HOUR=10
SWARMX_VIDEO_CAPTION_SCORE_LIMIT_PER_MIN=10
SWARMX_VIDEO_QUEUE_MAX_SIZE=20

# Model defaults (16 GB profile)
OLLAMA_MAX_LOADED_MODELS=2
OLLAMA_KEEP_ALIVE=0                # default; startup-enhanced.sh overrides for Pilot only
HIGH_PRESSURE_DELAY_MS=3000
OLLAMA_HOST=http://localhost:11434

# Ollama CPU performance (WSL2/bare-metal, 4-core, CPU-only) — set all before starting Ollama
OLLAMA_NUM_PARALLEL=1              # single inference thread on CPU — never increase
OLLAMA_FLASH_ATTENTION=1           # fused attention kernel: ~20% memory reduction on CPU AVX2
OLLAMA_KV_CACHE_TYPE=q8_0         # int8 KV cache: ~30% memory savings vs f16, negligible quality loss
OLLAMA_NUM_THREADS=3               # 3 of 4 cores; reserves 1 for WSL2 hypervisor + OS (use 4 on bare-metal)
OLLAMA_KEEP_ALIVE_PILOT_S=300      # 5 minutes; set by startup-enhanced.sh for Pilot only

# Cleanup
SWARMX_VIDEO_EXPORT_TTL_DAYS=7
SWARMX_VIDEO_CLEANUP_INTERVAL_MS=21600000

# Startup ops
SWARMX_WARMUP_STATUS_FILE=/tmp/swarmxq-warmup.json

# Voice provider benchmark
SWARMX_TTS_PROVIDER=auto           # auto: consults benchmark report; fallback to Kokoro→Piper→eSpeak
SWARMX_VOICE_BENCHMARK_FILE=/tmp/swarmxq-voice-benchmark.json
SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS=168  # 7 days; re-run when TTS providers change

# Script drift detection (optional, requires whisper.cpp)
SWARMX_SCRIPT_DRIFT_THRESHOLD=0.25        # WER threshold; warn above this, never block
SWARMX_WHISPER_MODEL_PATH=/opt/whisper/models/ggml-base.en.bin
```

---

# SESSION KICKOFF PROTOCOL

Execute these steps at the start of every session, before writing any code:

```bash
# 1. Confirm baseline
git log --oneline -5           # verify correct commit (expect HEAD near fb6cbe9 or later)
git status                     # must be clean working tree

# 2. Load prior context
cat .serena/memories/MEMORY.md          # session index — find the most recent project_v*.md
cat .serena/memories/project_v6249.md   # most recent session note as of V6.2.49

# 3. Environment check
awk '/MemAvailable/ {printf "MemAvailable: %d MB\n", $2/1024}' /proc/meminfo
cat /tmp/swarmxq-warmup.json 2>/dev/null || echo "[COLD] startup-enhanced.sh not run — ETA: 140s"
ollama ps 2>/dev/null || echo "[OFFLINE] Ollama not running"
redis-cli ping 2>/dev/null || echo "[OFFLINE] Redis not reachable"

# 4. Verify CPU performance vars (must be set before inference)
echo "OLLAMA_NUM_PARALLEL=${OLLAMA_NUM_PARALLEL:-UNSET}      (must be 1)"
echo "OLLAMA_FLASH_ATTENTION=${OLLAMA_FLASH_ATTENTION:-UNSET} (must be 1)"
echo "OLLAMA_KV_CACHE_TYPE=${OLLAMA_KV_CACHE_TYPE:-UNSET}    (must be q8_0)"
echo "OLLAMA_NUM_THREADS=${OLLAMA_NUM_THREADS:-UNSET}         (must be 3/WSL2 or 4/bare-metal)"

# 5. Voice benchmark freshness check
cat /tmp/swarmxq-voice-benchmark.json 2>/dev/null \
  | python3 -c "import json,sys,datetime; d=json.load(sys.stdin); age_h=(datetime.datetime.now()-datetime.datetime.fromisoformat(d['generatedAt'])).total_seconds()/3600; print(f'[VOICE BENCHMARK] recommended={d[\"recommendedProviderId\"]} age={age_h:.0f}h {\"[STALE]\" if age_h>168 else \"[FRESH\"]}')" \
  2>/dev/null || echo "[VOICE BENCHMARK] No report — run voice-benchmark.ts after installing Piper/Kokoro"

# 6. Invariant spot-check
grep -c 'console\.' apps/swarmx-api/src/services/*.ts apps/swarmx-api/src/routes/*.ts 2>/dev/null \
  | grep -v ':0' | head -5 && echo "❌ console.* violations found" || echo "✅ console.* clean"
```

Answer internally before proceeding:
- Which milestone from the Next Milestone Queue is next?
- Does the prior session note record any runtime pivots that change the plan?
- Is the environment online (Redis reachable? Ollama running? startup-enhanced.sh active?)? If offline, note which gates cannot run.
- Is the voice benchmark fresh (< 168h)? If stale, schedule re-run after first milestone.

**State the session plan explicitly in the first response. Do not write code until the plan is stated.**

---

# SESSION-END PROTOCOL

Execute these steps before closing any session where code was written:

```bash
# 1. Run all quality gates
pnpm -F swarmx-api tsc --noEmit
pnpm -F swarmx-types tsc --noEmit
pnpm -F swarmx-dashboard tsc --noEmit
pnpm -F swarmx-api vitest run              # must be ≥225 (as of V6.2.49)
pnpm -F swarmx-dashboard vitest run        # must be ≥52
npx tsx apps/swarmx-api/scripts/video-regression-check.ts
npx tsx apps/swarmx-api/scripts/system-health-regression.ts
npx tsx apps/swarmx-api/scripts/reasoning-sanitizer-regression.ts
npx tsx apps/swarmx-api/scripts/eviction-metric-regression.ts
npx tsx apps/swarmx-api/scripts/adaptive-timeout-regression.ts
pnpm -F swarmx-dashboard next build        # must produce ≥14 routes

# 2. Invariant checks
grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes
grep -rn 'process\.env\[' apps/swarmx-api/src/services apps/swarmx-api/src/routes
grep -n 'TONE_RULES' apps/swarmx-api/src/services/video-orchestrator.ts

# 3. Write session memory note
# File: .serena/memories/project_v<VERSION>.md
# Required sections: Shipped, Quality gate results, Host profile,
#                    Runtime pivots, New invariants discovered, TONE_RULES state, Remaining work

# 4. Update MEMORY.md index
echo "- project_v<VERSION>.md — $(date +%Y-%m-%d) — <one-sentence summary>" >> .serena/memories/MEMORY.md

# 5. Commit (only after all gates green)
git add -p   # stage only intentional changes
git commit -m "feat(video): <subject>"
```

**Never commit with failing gates. Document every skipped gate with reason in the session note.**

---

# OBSERVABILITY RULE

If any system-level change is made:
- Evaluate telemetry impact — does this require new spans or metrics?
- Validate performance implications — does this add latency to the hot path?
- Ensure no silent regressions — what breaks without a visible signal?

### SwarmXQ-specific telemetry requirements

- Video job lifecycle: enqueue → start → stage-by-stage progress → complete/fail — all stages metered
- Model acquisition latency per stage — tracked with `{stage, modelTag, durationMs}`
- RAM pressure events: HIGH/CRITICAL triggers, backoff delays, re-check results — logged at `warn`
- SSE connection count (active subscribers per job) — bounded and metered
- BullMQ queue depth and worker health — surfaced via `/api/metrics`
- Virality score distribution per tone — tracked at job completion
- Render backend selection (FFmpeg vs ComfyUI) and render duration — per-job
- Ollama CPU performance vars logged at boot — `log.info({ numParallel, flashAttention, kvCacheType, numThreads })`
- `CERT_TIER_CLAMPED_BY_RENDERER` warn events — any clamp is a signal for renderer capability gap
- Stage validation trace entries — persisted to `job.stageValidationTrace`; failures at `warn` level
- Voice benchmark application — `benchmarkAppliedProviderId` logged when benchmark changed selection order
- Script drift (when whisper.cpp enabled) — WER logged at job completion; `> SWARMX_SCRIPT_DRIFT_THRESHOLD` at `warn`

---

# RELEASE GATE

The following must all pass before any commit to `main`:

```bash
pnpm -F swarmx-api tsc --noEmit           # zero type errors
pnpm -F swarmx-types tsc --noEmit         # zero type errors
pnpm -F swarmx-dashboard tsc --noEmit     # zero type errors

pnpm -F swarmx-dashboard vitest run       # ≥52 passing
pnpm -F swarmx-api vitest run             # ≥225 passing (V6.2.49 baseline; grows with V4 slices)

# API regression scripts (no Ollama/Redis needed)
npx tsx apps/swarmx-api/scripts/adaptive-timeout-regression.ts
npx tsx apps/swarmx-api/scripts/video-regression-check.ts
npx tsx apps/swarmx-api/scripts/eviction-metric-regression.ts
npx tsx apps/swarmx-api/scripts/system-health-regression.ts
npx tsx apps/swarmx-api/scripts/reasoning-sanitizer-regression.ts

pnpm -F swarmx-dashboard next build       # ≥14 routes, zero build errors
git diff --check                          # zero whitespace violations

# Invariant checks (must return zero hits)
grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes
grep -rn 'process\.env\[' apps/swarmx-api/src/services apps/swarmx-api/src/routes
# → ≤10 hits, all documented as intentional escape hatches in env.ts

# Creative quality invariant
grep -n 'TONE_RULES' apps/swarmx-api/src/services/video-orchestrator.ts
# → Must contain all 8 tone variants; add missing ones before committing

# Renderer certification invariant
grep -rn 'certificationTier\s*=' apps/swarmx-api/src/services \
  | grep -v 'clampCertificationTier\|canPromoteTo\|CERT_TIER_CLAMPED_BY_RENDERER'
# → Zero hits: all direct assignments must route through clampCertificationTier()

# Voice benchmark (optional; runs actual TTS — skip when providers offline)
pnpm --filter @swarmx/api exec tsx scripts/voice-benchmark.ts
# → Writes SWARMX_VOICE_BENCHMARK_FILE; re-run when TTS providers change
```

**No gate may be bypassed. No result may be fabricated. Skipped gates must be
documented with the reason (offline, missing binary, no Redis) in the session
memory note at `.serena/memories/project_v<VERSION>.md`.**

---

# GIT DISCIPLINE

```
feat(video): <subject>      # new capability in video pipeline
fix(video): <subject>       # bug correction
perf(video): <subject>      # performance improvement
refactor(video): <subject>  # internal restructure without behavior change
test(video): <subject>      # test coverage
feat(model): <subject>      # model routing / operator map changes
feat(startup): <subject>    # startup-enhanced.sh / warmup sequence
feat(creative): <subject>   # script quality / virality / caption changes
feat(voice): <subject>      # TTS provider, voice benchmark, Kokoro/Piper changes
feat(cert): <subject>       # renderer certification, tier ceiling, promotion path
feat(template): <subject>   # template family additions (V4 S2)
feat(preview): <subject>    # preview pipeline, proxy render, QUICK_DRAFT (V4 S3)
feat(assets): <subject>     # Openverse adapter, Freesound, Pixabay (V4 S4 — ADR first)
chore: <subject>            # build/config/tooling
docs: <subject>             # documentation only
ci: <subject>               # GitHub Actions / CI gate changes
```

Group logically. One commit per concern. Never commit:
- Generated build artifacts (`/.next/`, `/dist/`)
- Temporary test files
- `console.log` debug traces
- Commented-out code blocks
- Experimental branches committed to `main`

Push only after all quality gates pass.

---

# MILESTONE QUEUE (Execute in Priority Order)

| Priority | Milestone | Done When |
|---|---|---|
| ~~1~~ | ~~**BullMQ Default-On**~~ | ✅ V6.2.22+V6.2.40 |
| ~~2~~ | ~~**GitHub Actions CI**~~ | ✅ V6.2.40 |
| ~~3~~ | ~~**Env Schema Expansion**~~ | ✅ V6.2.38 — ≤10 process.env hits, all documented |
| ~~4~~ | ~~**First API Unit Tests**~~ | ✅ V6.2.39 — 225 tests at V6.2.49 |
| ~~5~~ | ~~**16 GB Profile Config**~~ | ✅ V6.2.44 — startup-enhanced.sh complete |
| ~~6~~ | ~~**TONE_RULES Completeness Audit**~~ | ✅ V6.2.23 — all 8 variants CI-gated |
| ~~7~~ | ~~**Smoke Renderer Certification Ceiling + Per-Stage Zod Validation**~~ | ✅ V6.2.49 |
| ~~8~~ | ~~**S1: Voice Benchmark**~~ | ✅ V6.2.49 — CLI + report reader + ranker + /api/system/health block |
| **9** | **S5: Golden-Path Re-Cert Under V6.2.49** | Clean clone → real MP4 → `/api/system/health` shows voice.benchmark; `stageValidationTrace` populated; cert tier reaches `PUBLISHED_VERIFIED` on kinetic/faceless render |
| **10** | **`doctor` CLI Command** | `pnpm -F @swarmx/api exec tsx scripts/doctor.ts` exits 0 on healthy host; exit 1 with structured error list on failure; checks: Redis ping, Ollama reachable, RAM headroom, Piper/Kokoro probe, voice benchmark freshness, warmup status |
| **11** | **S2: Template Family Expansion (+8 templates)** | myth-vs-fact, list/countdown, mystery/reveal, product-demo, quote-to-insight, chart/data, motivational, series-recap all wired as selectable `templateFamily` in `VideoJobRequest`; each has tone mapping + storyboard style hints |
| **12** | **Ollama JSON-mode Migration** | CPU JSON-mode reliability benchmark run first (< 5% parse failure rate required); if passes: `planning` and `storyboard_generation` stages migrated from regex extraction to `format: "json"` in Ollama request; regression scripts updated |
| **13** | **Cert-Tier State Machine Transition Wiring** | Explicit transition functions for `PUBLISHING`, `PUBLISH_FAILED`, `BLOCKED`, `NEEDS_REVISION` tiers (currently exist in type but no code transitions into/out of them); wired through `canPromoteTo()` contract |
| **14** | **S3: Preview Pipeline (Proxy Renders)** | `PLAN_ONLY` and `QUICK_DRAFT` modes skip full-resolution encode; proxy render at 360p using `ffmpeg_text_smoke` renderer; certification ceiling respected; `previewUrl` field in VideoJob |
| **15** | **S4: Openverse Adapter** | ADR written and approved first (per V4 §22); adapter searches CC0/CC-BY assets; `AssetLicense` metadata attached; rate-limit aware; whisper.cpp transcript used as search seed if available |
| **16** | **Voice Benchmark Real-Provider Run** | First actual benchmark with Piper + Kokoro installed; `/api/system/health` surfaces `voice.benchmark.recommendedProviderId`; confirm `/api/system/health` response shape correct; update session note |

---

# AUTONOMOUS OPPORTUNITY DISCOVERY

While executing any milestone, continuously scan for violations. Each tier has a clear action.

## Critical — Fix in the current session before committing anything else

- `console.*` in `src/services/` or `src/routes/` → migrate to `log.*` immediately
- Ollama response parsed without `sanitizeReasoningOutput()` → wrap it
- `ctx.modelsUsed[stage]` set in `runStage()` instead of inside stage fn → move it
- AbortController listener without `{ once: true }` → add the flag
- Legacy alias tags in any code path → replace with canonical
- `evictIncompatible()` not called before a 7B load → add the call
- `COMFY_POLL_MAX_ATTEMPTS` as a hardcoded literal → derive from stage timeout
- FFmpeg render without `ModelOrchestrator.unloadModel()` loop → add eviction
- `RAM_CRITICAL_MB` or `MAX_CONCURRENT_JOBS` changed from protected values → revert
- `[HOOK]` section > 18 words in any stage output → tighten the prompt constraint
- `TONE_RULES` missing a tone variant → add it before anything else ships
- V5 operator names (`SENTINEL`, `CANVAS`, etc.) in any code → replace with APEX-17 r8 names
- `OLLAMA_NUM_PARALLEL > 1` anywhere → reset to 1; CPU cannot benefit from parallelism
- `certificationTier` assigned directly without routing through `clampCertificationTier()` → fix immediately
- Third promotion path added without calling `canPromoteTo()` → BLOCK and fix
- `selectVoiceProvider()` bypasses benchmark report when `SWARMX_TTS_PROVIDER=auto` → fix
- `neural_local` rated below `synthetic_fallback` in any ranking logic → fix (RTF cannot override tier preference)
- `stageValidationTrace` not initialized as `[]` on new VideoJob creation → fix

## High Impact — Add to next session's milestone queue if found

- `video-cleanup.ts` cleanup interval not started at server boot
- `resumeJob()` not validating `fromStage` against artifact availability before re-queueing
- `stageViralityAndCaption()` result not persisted to BullMQ job data on completion
- `OLLAMA_MAX_LOADED_MODELS` still at 1 in production env (blocks 16 GB dual-resident path)
- Ollama perf vars not set before starting Ollama service
- ComfyUI `totalFrames` hard-floored at 16 when `availableMb` > 8 000 (Priority 5 unlocks)
- Missing OTel trace spans around `runOrchestration()` lifecycle
- `doctor.ts` script missing from `apps/swarmx-api/scripts/` (Milestone 10)
- Voice benchmark not re-run after Kokoro or Piper install/upgrade
- `AssetLicense` metadata absent from b-roll assets used in `faceless_broll` renders
- `SWARMX_SCRIPT_DRIFT_THRESHOLD` not wired into video-regression-check.ts
- Cert-tier state machine: `BLOCKED` and `NEEDS_REVISION` tiers entered via direct assignment, not transition function

## Medium Impact — Log in memory note; address opportunistically

- ~~`print()` or `logging.basicConfig()` in `src/swarmx/` Python layer~~ ✅ V6.2.36
- ~~Agent tool calls lacking idempotency~~ ✅ V6.2.37
- ~~WSL2 vs bare-metal thread count not auto-detected~~ ✅ V6.2.31
- ~~Ollama perf vars not in `/api/system/health`~~ ✅ V6.2.38
- ~~`/api/system/health` not reading warmup status file~~ ✅ V6.2.26
- Voice benchmark CLI skipped this session — schedule for session where Piper is installed
- `SWARMX_WHISPER_MODEL_PATH` env var not yet in env.ts schema — add when whisper.cpp integration begins

---

# VERIFIED GROUND TRUTH (V6.2.49 — 2026-07-23)

Repository code overrides all prior documentation. Grep/read before acting.

## Confirmed working (do not re-implement)

| Component | Notes |
|---|---|
| Zero-dep logger (`src/lib/logger.ts`) | Pino-compatible NDJSON; `log.{debug,info,warn,error,fatal}`; drop-in swap interface |
| Env fail-fast (`src/lib/env.ts`) | Zod schema for ~80 vars including SWARMX_VOICE_BENCHMARK_FILE; `loadEnv()` wired in `server.ts` |
| Global error handlers (`server.ts`) | `unhandledRejection` + `uncaughtException` → structured fatal log + exit(1) |
| Rate-limit eviction (`src/routes/video.ts`) | Unref'd `setInterval(2h)` evicts stale `captionScoreBuckets` + `jobSubmitBuckets` |
| Video orchestrator r8 (`video-orchestrator.ts`) | VOT-09 through VOT-13 correctness pass + INV-16 stage schema validation |
| Video queue SINGLE-VIDEO LOCK | `MAX_CONCURRENT_JOBS=1` enforced; idempotency by `clientRequestId`; 4h TTL cleanup |
| Stage schema validation | `stage-schemas.ts` validates planning/scripting/storyboard; `SCRIPT_SCHEMA_INVALID` on scripting failure |
| Renderer certification ceiling | `renderer-certification.ts` clamps all tier assignments; `ffmpeg_text_smoke → TECHNICALLY_VALID` |
| Voice benchmark infrastructure | `voice-benchmark.ts` CLI + `voice-benchmark-report.ts` reader + `selectVoiceProvider()` report integration + `/api/system/health` `voice.benchmark` block |
| TONE_RULES all 8 variants | CI grep gate confirms all 8 present: `contrarian`, `urgent`, `educational`, `cinematic`, `warm`, `minimal`, `faceless_broll`, `kinetic_text` |
| API tests | 225 passing (as of V6.2.49) across 12+ test files |
| Dashboard build | 14 routes, zero build errors |
| APEX-17 r8 operator map | Both `operator-map.ts` and `operator_map.py` semantically identical; V5 names eliminated |

## Confirmed incomplete (next milestone queue items)

| Gap | Action | Priority |
|---|---|---|
| ~~BullMQ disabled by default~~ | ✅ V6.2.22+V6.2.40 | done |
| ~~Zero CI~~ | ✅ V6.2.40 | done |
| ~~`process.env[…]` scattered in services~~ | ✅ V6.2.38 — 6 escape hatches remain (≤10) | done |
| ~~Zero API unit tests~~ | ✅ V6.2.49 — 225 tests | done |
| ~~`startup-enhanced.sh` not wired for 16 GB~~ | ✅ V6.2.44 | done |
| ~~TONE_RULES completeness unverified~~ | ✅ V6.2.23 | done |
| Voice benchmark real-provider run | Deferred — Piper not installed this session | Milestone 16 |
| `doctor.ts` CLI | Not started | Milestone 10 |
| V4 S2 template expansion | Not started | Milestone 11 |
| Ollama JSON-mode migration | Seed — benchmark required first | Milestone 12 |
| Cert-tier state machine transitions | Seed — `PUBLISHING`/`PUBLISH_FAILED`/`BLOCKED`/`NEEDS_REVISION` have no explicit transition functions | Milestone 13 |
| V4 S3 preview pipeline | Not started | Milestone 14 |
| V4 S4 Openverse adapter | Not started — ADR required | Milestone 15 |
| V4 S5 golden-path re-cert | Not started | Milestone 9 (next) |

---

# CRITICAL INVARIANTS (NON-NEGOTIABLE — NEVER VIOLATE)

1. **SINGLE-7B LOCK**: Only one 7B-class model inference-active simultaneously. On 16 GB: `OLLAMA_MAX_LOADED_MODELS=2` allows Pilot resident + 7B active — NOT two inferences. `evictIncompatible()` before every 7B load.

2. **Dual-timeout coordination**: `COMFY_POLL_MAX_ATTEMPTS = Math.floor(STAGE_TIMEOUT_MS["render_assembly"] / COMFY_POLL_INTERVAL_MS)`. Never an independent literal.

3. **`modelsUsed[stage]` in stage fn**: Set immediately after `acquireModel()` inside the stage function. Never re-derived in `runStage()`.

4. **`sanitizeReasoningOutput()` on every Ollama response**: DeepSeek `<think>` blocks must never reach intent JSON, script text, or storyboard frames.

5. **`console.*` zero tolerance**: `grep -rn 'console\.' apps/swarmx-api/src/{services,routes}` → zero hits, always.

6. **`resolveCanonicalTag()` on every external tag**: Legacy aliases must never enter the registry or any log entry.

7. **`RAM_CRITICAL_MB = 800` is protected**: Below this → `PRESSURE_CRITICAL` failure. Do not change.

8. **`MAX_CONCURRENT_JOBS = 1` is protected**: CPU inference is serial. Increasing this degrades output quality without throughput gain.

9. **16 GB changes must degrade at 8 GB**: `shouldAutoEnableLowRamMode()` is the contract boundary. Test both paths when modifying RAM-sensitive code.

10. **FFmpeg evicts Ollama before render**: `ModelOrchestrator.unloadModel()` loop must run before every FFmpeg render — never skip it.

11. **Read before acting**: Grep and cat affected files before writing any code. Never act on assumptions — the repository is the source of truth.

12. **TONE_RULES must be exhaustive**: Every `VideoJobRequest.tone` variant must have a corresponding entry in `TONE_RULES`. Missing entries produce degraded output silently.

13. **`OLLAMA_NUM_PARALLEL=1` is invariant on CPU**: This is not configurable — CPU has one inference thread. Any value > 1 silently degrades throughput without error.

14. **startup-enhanced.sh must exit 1 on overload**: If post-warmup RAM < `FULL_PIPELINE_MIN_AVAILABLE_MB`, exit 1 immediately. Never allow the API to start on an overloaded host.

15. **Smoke renderer certification ceiling**: `ffmpeg_text_smoke` cannot certify above `TECHNICALLY_VALID`. Every `certificationTier` assignment routes through `clampCertificationTier()` in `apps/swarmx-api/src/services/renderer-certification.ts`. Downstream promotions must use `canPromoteTo()`. Any new promotion site must be added to the sites list in `creative-factory-certification.ts` comments.

16. **Per-stage schema validation for planning/scripting/storyboard**: Planning, scripting, and storyboard results are validated against Zod schemas in `apps/swarmx-api/src/services/stage-schemas.ts` before being persisted. Failures on planning and storyboard fall through to hard-coded safe defaults and are recorded in `job.stageValidationTrace`. Failure on scripting throws `SCRIPT_SCHEMA_INVALID` — there is no safe scripted default that can reach a production tier.

17. **Voice provider selection is benchmark-informed**: When `SWARMX_TTS_PROVIDER=auto`, `selectVoiceProvider()` consults the JSON benchmark report at `SWARMX_VOICE_BENCHMARK_FILE` (default `/tmp/swarmxq-voice-benchmark.json`) to rank providers before probing. The report is generated by `apps/swarmx-api/scripts/voice-benchmark.ts` and expires after `SWARMX_VOICE_BENCHMARK_MAX_AGE_HOURS` (default 168 h). Without a fresh report the current default order (Kokoro → Piper → eSpeak) is preserved. The `neural_local` tier is always preferred over `synthetic_fallback` regardless of RTF — eSpeak may have lower RTF but is not a production voice. Kokoro voice selection uses `KOKORO_VOICE_MAP` keyed by tone.

18. **Cert-tier state machine transitions must be explicit**: The `PUBLISHING`, `PUBLISH_FAILED`, `BLOCKED`, and `NEEDS_REVISION` tiers exist in `CertificationTier` but no explicit transition function currently moves jobs into or out of them. Before any feature writes directly to these tiers, a transition function must exist that calls `canPromoteTo()`. Until Milestone 13 ships, these tiers are **write-protected** — do not use them in new code without implementing the transition function first.

---

# MEMORY NOTES PROTOCOL

After each session, write `/.serena/memories/project_v<VERSION>.md` containing:
- **Shipped** — commits, release version, files changed count
- **Quality gate results** — which passed, which were skipped and why; include exact test counts
- **Host profile** — RAM at session start; `startup-enhanced.sh` active?; Ollama online?; Ollama CPU perf vars set?; bare-metal or WSL2?
- **Runtime pivots** — what changed from the plan and why
- **New invariants discovered** — anything to add to this document
- **TONE_RULES state** — which tone variants confirmed present; any gaps found
- **Voice benchmark state** — fresh / stale / not yet run; recommended provider if known
- **Remaining work** — next session's starting point; which milestone is next

Update `/.serena/memories/MEMORY.md` index: `project_v<VERSION>.md — <date> — <one-sentence summary>`.
