---
name: swarmxq-model-orchestrator
description: >
  Governs all model routing, acquisition, eviction, and RAM pressure management for the SwarmXQ
  APEX-17 r8 platform. Enforces the SINGLE-7B LOCK (only one 7B-class model inference-active at
  any time), canonical tag resolution via resolveCanonicalTag(), keep-alive policy per model class,
  16 GB dual-model residency profile, and pressure gating via readPressure() / getRamSnapshot().
  Covers the full 7-operator taxonomy: Relay, Pilot, Architect, Forge, Oracle, Auditor, Lab.
  Use this skill for ANY change to model-orchestrator.ts, video-runtime-config.ts, operator-map.ts,
  startup-enhanced.sh, or any code that calls acquireModel(), evictIncompatible(),
  resolveCanonicalTag(), or reads OLLAMA_MAX_LOADED_MODELS / OLLAMA_KEEP_ALIVE.
  Triggers: "SINGLE-7B", "model eviction", "evictIncompatible", "acquireModel",
  "ModelOrchestrator", "resolveCanonicalTag", "canonical tag", "legacy alias",
  "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_KEEP_ALIVE", "RAM pressure", "readPressure",
  "PRESSURE_CRITICAL", "availableMb", "getRamSnapshot", "startup-enhanced.sh", "Pilot router",
  "Architect model", "Oracle model", "Relay operator", "Auditor operator", "Lab operator",
  "model triad", "16 GB profile", "operator map", "shouldAutoEnableLowRamMode",
  "operator taxonomy", "APEX-17 r8". Always load swarmxq-video-pipeline-architect alongside
  this skill when model changes affect pipeline stage contracts. For startup sequence and
  Ollama CPU performance tuning, also load swarmxq-startup-ops-architect.
---

# SwarmXQ Model Orchestrator

Enforce SINGLE-7B inference safety, canonical tag resolution, and 16 GB RAM profile management.
Every model acquisition must go through `ModelOrchestrator`. Every external tag must be resolved
through `resolveCanonicalTag()`. Every 7B load must be preceded by `evictIncompatible()`.
Violations of these rules are Critical and must be fixed before any other work in a session.

**Companion skills**: `swarmxq-startup-ops-architect` owns the startup sequence, CPU performance
variables, and warmup health endpoint. Load it when `startup-enhanced.sh` or Ollama perf tuning
is in scope.

---

## APEX-17 r8 Full Operator Taxonomy

`MODEL_OPERATOR_MAP` in `packages/swarmx-types/src/operator-map.ts` and
`src/swarmx/operator_map.py` are the **dual sources of truth** — they must remain
semantically equivalent. Any change to one requires the corresponding change in the other.

### All 7 Operators

| Operator | Canonical tag | Primary role | Video pipeline role | RAM (~Q4/Q5/Q8) | is7B |
|---|---|---|---|---|---|
| **Relay** | `route-phi4-lite-q4km-prod` | Ultra-light routing, intent gating, safety classification | Pre-pipeline routing (not used in video stages directly) | ~2.5 GB | No |
| **Pilot** | `instruct-phi4-pro-q8-prod` | Fast generalist, intake, instruction following | intent_classification, caption generation | ~3 GB | No |
| **Pilot (lite)** | `instruct-phi4-lite-q4km-prod` | Low-RAM fallback for all text stages | Low-RAM fallback for all video text stages | ~2.2 GB | No |
| **Architect** | `plan-qwen25-pro-q5km-prod` | Planning, orchestration, multi-step generation | planning, scripting, storyboard_generation | ~5 GB | Yes |
| **Architect (deep)** | `plan-deepseekr1-pro-q5km-prod` | Deep planning when Qwen2.5 is under-performing | Deep planning fallback | ~5 GB | Yes |
| **Oracle** | `reason-deepseekr1-pro-q5km-prod` | Deep reasoning, diagnosis, scoring, evaluation | Virality scoring (post-pipeline, non-blocking) | ~5 GB | Yes |
| **Forge** | `code-qwen25-pro-q5km-prod` | Code generation, tool implementation | Not used in video pipeline; general agent code tasks | ~5 GB | Yes |
| **Auditor** | `critique-deepseekr1-pro-q5km-prod` | Critique, validation, safety review, red-team | Not used in video pipeline; agent quality gating | ~5 GB | Yes |
| **Lab** | `synth-qwen25-exp-q4km-dev` | Experimental / evolve / non-production | Evolver agent, skill synthesis, meta-evolution | ~4 GB | Yes |

> **Relay vs Pilot**: Relay (`route-phi4-lite`) handles binary routing decisions (classify / gate / reject)
> with minimal context. Pilot (`instruct-phi4-pro-q8`) handles open-ended generation (classify intent
> in the video pipeline, generate captions). Never swap them — Relay's Q4 quantisation loses nuance
> needed for caption generation; Pilot's Q8 is over-specified for simple binary routing.

> **Auditor and Lab**: These operators do not participate in the video pipeline. They are used
> by the Python agent brain (`src/swarmx/`) for quality gating and meta-evolution. They still
> obey the SINGLE-7B LOCK — never load concurrently with Architect/Oracle/Forge.

### Legacy Alias Resolution

Legacy tags from prior pipeline versions must NEVER enter the model registry or any log entry.
All externally-supplied tags pass through `resolveCanonicalTag()` first.

```typescript
// packages/swarmx-types/src/operator-map.ts
const LEGACY_ALIAS_MAP: Record<string, string> = {
  'phi4-fast':          'instruct-phi4-pro-q8-prod',
  'phi4-lite':          'instruct-phi4-lite-q4km-prod',
  'deepseek-reasoner':  'reason-deepseekr1-pro-q5km-prod',
  'qwen-worker':        'plan-qwen25-pro-q5km-prod',
  'qwen-coder':         'code-qwen25-pro-q5km-prod',
  'relay-router':       'route-phi4-lite-q4km-prod',    // r7 alias — now deprecated
  'scar-auditor':       'critique-deepseekr1-pro-q5km-prod',  // V5 alias
  'scar-lab':           'synth-qwen25-exp-q4km-dev',    // V5 alias
}

export function resolveCanonicalTag(tag: string): string {
  const resolved = LEGACY_ALIAS_MAP[tag] ?? tag
  if (!CANONICAL_TAGS.has(resolved)) {
    throw new Error(`Unknown model tag: "${tag}" (resolved to "${resolved}")`)
  }
  return resolved
}
```

---

## SINGLE-7B LOCK

**The most critical invariant in the entire platform.**

Only one 7B-class model may be inference-active simultaneously. CPU-only hardware has
exactly one inference thread regardless of how much RAM is available.

### On 16 GB Host

`OLLAMA_MAX_LOADED_MODELS=2` is permitted:
- Pilot router (~3 GB) may be **resident in RAM** (idle/warm)
- One 7B model (~5 GB) may be **actively inferencing**
- Total peak: ~8 GB — within 16 GB budget

This is **NOT** concurrent inference. One model warm-idle, the other runs.

```
✅ VALID 16 GB state:
  [Pilot: RESIDENT, IDLE]   [Architect: ACTIVE, INFERENCING]
  ~3 GB in RAM              ~5 GB in RAM
  Total: ~8 GB ← within budget

✗ INVALID — two active inferences (any combination):
  [Pilot: ACTIVE]   [Architect: ACTIVE]     ← never
  [Architect: ACTIVE] [Oracle: ACTIVE]      ← never
  [Auditor: ACTIVE] [Forge: ACTIVE]         ← never
```

### evictIncompatible() — Required Before Every 7B Load

```typescript
// ✅ CORRECT
async function acquireModel(
  operatorName: 'Architect' | 'Oracle' | 'Forge' | 'Auditor' | 'Lab',
  signal: AbortSignal
): Promise<string> {
  const tag = resolveCanonicalTag(MODEL_OPERATOR_MAP[operatorName].canonicalTag)
  await ModelOrchestrator.evictIncompatible(tag)   // ← always before 7B load
  await ollamaPull(tag, { signal })
  return tag
}

// ✗ WRONG — may load 2× 7B models simultaneously
async function acquireModel(operatorName: string): Promise<string> {
  const tag = MODEL_OPERATOR_MAP[operatorName].canonicalTag
  await ollamaPull(tag)
  return tag
}
```

---

## Keep-Alive Policy

| Model class | OLLAMA_KEEP_ALIVE (16 GB) | OLLAMA_KEEP_ALIVE (8 GB) | Rationale |
|---|---|---|---|
| Relay (`route-phi4-lite-*`) | `0` | `0` | Binary routing; cold start is fast (~2s); not worth keeping warm |
| Pilot (`instruct-phi4-*-pro-*`) | `5m` | `0` | Used at pipeline start and post-pipeline for captions; worth keeping warm on 16 GB |
| Architect (`plan-qwen25-*`) | `0` | `0` | 5 GB idle between stages wastes budget |
| Oracle (`reason-deepseekr1-*`) | `0` | `0` | Post-pipeline only; evict after virality scoring completes |
| Forge (`code-qwen25-*`) | `0` | `0` | Not used in video pipeline; evict immediately |
| Auditor (`critique-deepseekr1-*`) | `0` | `0` | Agent QA only; evict immediately |
| Lab (`synth-qwen25-exp-*`) | `0` | `0` | Non-production; never keep warm in prod |

### Differentiating Keep-Alive per Model

```bash
# startup-enhanced.sh — Pilot override only
export OLLAMA_KEEP_ALIVE=0                  # global default: evict all after use
OLLAMA_KEEP_ALIVE=5m ollama run instruct-phi4-pro-q8-prod "" 2>/dev/null
# The 5m keep-alive is set on this specific run, not globally
```

**The Pilot's 5m keep-alive is broken by FFmpeg eviction.** The `render_assembly` stage
calls `ModelOrchestrator.unloadModel()` for all loaded models including Pilot. Pilot
re-warms on the next pipeline's `intent_classification` stage (~30s cold-start, down from
140s because weights were already cached to disk by the OS page cache).

---

## RAM Pressure System

### Pressure Levels

| Level | Condition (MemAvailable) | Action |
|---|---|---|
| `normal` | > HIGH_PRESSURE_THRESHOLD | Proceed immediately |
| `high` | ≤ HIGH_PRESSURE_THRESHOLD and > RAM_CRITICAL_MB | Backoff `HIGH_PRESSURE_DELAY_MS` (1 000–30 000 ms) then re-check |
| `critical` | ≤ RAM_CRITICAL_MB (800 MB) | Immediate `PRESSURE_CRITICAL` failure |

### Protected Constants (NEVER CHANGE)

```typescript
// model-orchestrator.ts
const RAM_CRITICAL_MB = 800     // ← PROTECTED. 800 MB is the minimum viable OS + API headroom.
                                //   Below this, the Linux OOM killer activates.

// video-queue.ts
const MAX_CONCURRENT_JOBS = 1   // ← PROTECTED. CPU inference is serial.
                                //   Increasing this degrades quality without throughput gain.
```

### getRamSnapshot() Implementation

```typescript
export async function getRamSnapshot(): Promise<RamSnapshot> {
  const meminfo = await fs.readFile('/proc/meminfo', 'utf-8')
  const match = meminfo.match(/MemAvailable:\s+(\d+)\s+kB/)
  if (!match) throw new Error('Cannot read /proc/meminfo MemAvailable')
  const availableMb = Math.floor(parseInt(match[1], 10) / 1024)
  return { availableMb, readAt: Date.now() }
}

export async function readPressure(): Promise<PressureLevel> {
  const { availableMb } = await getRamSnapshot()
  if (availableMb <= RAM_CRITICAL_MB) return 'critical'
  if (availableMb <= HIGH_PRESSURE_THRESHOLD_MB) return 'high'
  return 'normal'
}
```

---

## video-runtime-config.ts — RAM-Aware Model Resolution

```typescript
export function resolveVideoModelTag(availableMb: number, stage: VideoStage): string {
  if (stage === 'intent_classification') {
    return resolveCanonicalTag('instruct-phi4-pro-q8-prod')
  }

  if (availableMb < FULL_PIPELINE_MIN_AVAILABLE_MB) {
    log.warn({
      msg: 'Low RAM — switching to lite model for pipeline stage',
      availableMb, threshold: FULL_PIPELINE_MIN_AVAILABLE_MB, stage,
    })
    return resolveCanonicalTag(LOW_RAM_VIDEO_MODEL)  // instruct-phi4-lite-q4km-prod
  }

  const STAGE_MODEL_MAP: Partial<Record<VideoStage, string>> = {
    planning:              'plan-qwen25-pro-q5km-prod',
    scripting:             'plan-qwen25-pro-q5km-prod',
    storyboard_generation: 'plan-qwen25-pro-q5km-prod',
  }

  return resolveCanonicalTag(STAGE_MODEL_MAP[stage] ?? 'instruct-phi4-lite-q4km-prod')
}

export function shouldAutoEnableLowRamMode(availableMb: number): boolean {
  return availableMb < FULL_PIPELINE_MIN_AVAILABLE_MB
}
```

---

## 16 GB Model Residency Budget

| Resident models | Combined RAM | Within budget? | Notes |
|---|---|---|---|
| Pilot alone | ~3 GB | ✓ | Standard cold host state after startup-enhanced.sh |
| Pilot + Architect | ~8 GB | ✓ | **Target dual-resident state** — intent → planning transition |
| Pilot + Oracle | ~8 GB | ✓ | Acceptable during virality scoring only |
| Relay + Pilot | ~5.5 GB | ✓ | Viable but Relay is usually not needed in warm state |
| Architect + Oracle | ~10 GB | ✗ | Violates SINGLE-7B inference contract |
| Any two 7B models simultaneously | ~10 GB | ✗ | Violates SINGLE-7B — regardless of RAM |
| Pilot + Architect + Oracle | ~13 GB | ✗ | Never load all three concurrently |

---

## 16 GB Unlocked Capabilities

| Capability | Mechanism | Status |
|---|---|---|
| Dual-model residency (Pilot + 7B) | `OLLAMA_MAX_LOADED_MODELS=2` | Enable in `startup-enhanced.sh` |
| Pilot router keep-alive | `OLLAMA_KEEP_ALIVE=5m` for Pilot only | Enable in `startup-enhanced.sh` |
| Predictive model warmup | Pre-load Pilot at startup | Enable via `startup-enhanced.sh` |
| Higher ComfyUI frame budgets | `totalFrames` up to 96; `resolution=720p` | Unlock in `generateLTXWorkflow()` |
| BullMQ Worker co-location | API + Worker in same process without OOM risk | Unlocked — Priority 1 |
| Oracle virality keep-alive | `reason-deepseekr1-pro-q5km-prod` warm post-pipeline | Evaluate after P1 memory profile |

**Activation order**: `startup-enhanced.sh` → BullMQ Worker → higher ComfyUI defaults.
Do not activate Oracle keep-alive until BullMQ Worker memory profile is measured.

---

## 8 GB Degradation Path

All 16 GB capabilities must degrade gracefully on constrained hosts.

```typescript
export function buildRuntimeConfig(availableMb: number): VideoRuntimeConfig {
  const lowRam = shouldAutoEnableLowRamMode(availableMb)

  return {
    primaryModel:    lowRam ? LOW_RAM_VIDEO_MODEL : 'instruct-phi4-pro-q8-prod',
    maxLoadedModels: lowRam ? 1 : 2,
    pilotKeepAlive:  lowRam ? '0' : '5m',
    maxFrames:       lowRam ? 16 : 96,
    resolution:      lowRam ? '360p' : '720p',
    concurrency:     MAX_CONCURRENT_JOBS,   // always 1 — never changes
  }
}
```

When adding any 16 GB capability, always test:
1. `shouldAutoEnableLowRamMode()` returns `true` at simulated 7 000 MB
2. The feature degrades gracefully or is skipped entirely
3. The skip is logged at `warn`, not silently ignored

---

## Env Schema Requirements (Priority 3)

```typescript
const envSchema = z.object({
  // Model orchestration
  OLLAMA_MAX_LOADED_MODELS:    z.coerce.number().int().min(1).max(3).default(1),
  OLLAMA_KEEP_ALIVE_PILOT_S:   z.coerce.number().int().min(0).default(0),
  OLLAMA_HOST:                 z.string().url().default('http://localhost:11434'),

  // RAM thresholds
  FULL_PIPELINE_MIN_AVAILABLE_MB: z.coerce.number().int().default(6170),
  HIGH_PRESSURE_DELAY_MS:         z.coerce.number().int().min(1000).max(30000).default(3000),

  // Ollama CPU performance (see swarmxq-startup-ops-architect for deep reference)
  OLLAMA_NUM_PARALLEL:    z.coerce.number().int().min(1).max(1).default(1),
  OLLAMA_FLASH_ATTENTION: z.coerce.number().int().min(0).max(1).default(1),
  OLLAMA_KV_CACHE_TYPE:   z.enum(['f16', 'q8_0', 'q4_0']).default('q8_0'),
  OLLAMA_NUM_THREADS:     z.coerce.number().int().min(1).max(8).default(3),
})
```

---

## Python Layer Operator Taxonomy Sync

The Python brain (`src/swarmx/operator_map.py`) uses the same 7 operator names.
The `SENTINEL`, `CANVAS`, `LEDGER`, `PROPHET` names referenced in early V5 docs
are **deprecated** — they were replaced by `Relay`, `Forge`, `Auditor`, `Lab` in
the APEX-17 r8 taxonomy. Never introduce deprecated operator names into new code.

| Python name | TypeScript equivalent | Deprecates |
|---|---|---|
| `Relay` | `Relay` | `SENTINEL` (V5) |
| `Pilot` | `Pilot` | `INTAKE` (V5) |
| `Architect` | `Architect` | `PLANNER` (V5) |
| `Forge` | `Forge` | `CANVAS` (V5) |
| `Oracle` | `Oracle` | `PROPHET` (V5) |
| `Auditor` | `Auditor` | `LEDGER` (V5) |
| `Lab` | `Lab` | `EVOLVER` (V5) |

---

## Telemetry Requirements

Every model acquisition must emit a structured metric:

```typescript
// After acquireModel() resolves inside each stage fn
log.info({
  msg:        'model acquired',
  stage,
  modelTag,
  operator:   MODEL_OPERATOR_MAP[modelTag].operator,
  durationMs: Date.now() - acquireStartMs,
  availableMb: (await getRamSnapshot()).availableMb,
})
```

RAM pressure events at `warn`:
```typescript
log.warn({
  msg:        'RAM pressure event',
  level:      pressureLevel,
  availableMb,
  delayMs:    HIGH_PRESSURE_DELAY_MS,
  stage,
  modelTag,
})
```

---

## Autonomous Scanning — Model Orchestration Violations

### Critical (fix before committing anything else)
- `resolveModelTag()` bypassing `resolveCanonicalTag()` → fix the call site
- Legacy alias (`phi4-fast`, `deepseek-reasoner`, `qwen-worker`, `relay-router`, `scar-auditor`, `scar-lab`) hard-coded in production → replace with canonical tag
- `evictIncompatible()` not called before a 7B load → add the call
- `RAM_CRITICAL_MB` changed from 800 → revert immediately
- `MAX_CONCURRENT_JOBS` changed from 1 → revert immediately
- Model metadata defined locally (not imported from `@swarmx/types/operator-map`) → centralize
- `OLLAMA_NUM_PARALLEL` > 1 anywhere → revert to 1

### High Impact (add to next session queue if found)
- `OLLAMA_NUM_PARALLEL`, `OLLAMA_FLASH_ATTENTION`, `OLLAMA_KV_CACHE_TYPE`, `OLLAMA_NUM_THREADS` not set before Ollama starts → add to `startup-enhanced.sh` + env schema (P3/P5)
- `OLLAMA_MAX_LOADED_MODELS` still at 1 in production env → P5
- `OLLAMA_KEEP_ALIVE` not differentiated between Pilot and 7B → P5
- `startup-enhanced.sh` 16 GB logic not yet activated → P5
- `Auditor` or `Lab` operator tags not present in TypeScript `MODEL_OPERATOR_MAP` → add for Python/TS parity
- Model acquisition latency not emitted as structured log → add telemetry

### Medium Impact (log to memory note)
- Oracle virality model evicted before score is written to BullMQ job data
- `availableMb` not included in stage progress logs
- `resolveCanonicalTag()` not validated in integration tests
- Python `operator_map.py` version string (`v2026.5.25-apex17-r7-final`) behind TypeScript version
