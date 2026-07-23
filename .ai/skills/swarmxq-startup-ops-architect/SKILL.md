---
name: swarmxq-startup-ops-architect
description: >
  Governs the SwarmXQ startup sequence, Ollama CPU performance tuning, RAM profile
  detection and switching, warmup health endpoint, and the startup-enhanced.sh script.
  Covers /proc/meminfo monitoring, OLLAMA_NUM_PARALLEL / OLLAMA_FLASH_ATTENTION /
  OLLAMA_KV_CACHE_TYPE / OLLAMA_NUM_THREADS environment variable configuration,
  predictive model warmup (zero-token probe), 8 GB vs 16 GB profile auto-detection,
  post-warmup RAM verification, and surfacing warmup status through /api/system/health.
  Use this skill for ANY change to startup-enhanced.sh, server.ts boot sequence,
  /api/system/health or /api/system/warmup-status endpoints, shouldAutoEnableLowRamMode(),
  or FULL_PIPELINE_MIN_AVAILABLE_MB threshold logic. Triggers: "startup-enhanced.sh",
  "Ollama warmup", "Pilot pre-warm", "zero-token probe", "OLLAMA_NUM_PARALLEL",
  "OLLAMA_FLASH_ATTENTION", "OLLAMA_KV_CACHE_TYPE", "OLLAMA_NUM_THREADS", "KV cache type",
  "flash attention", "num_ctx", "OLLAMA_MAX_LOADED_MODELS", "OLLAMA_KEEP_ALIVE global",
  "16 GB profile", "8 GB profile", "shouldAutoEnableLowRamMode", "cold-start ETA",
  "warmup-status", "warmup flag", "/proc/meminfo", "MemAvailable", "FULL_PIPELINE_MIN_AVAILABLE_MB",
  "12 GB detection", "startup sequence", "boot sequence", "pre-warm", "model warmup". Always
  load swarmxq-model-orchestrator alongside this skill — startup ops directly gates
  model acquisition behaviour for the entire pipeline.
---

# SwarmXQ Startup Ops Architect

The startup sequence determines every pipeline's performance characteristics before
the first job arrives. Getting Ollama's CPU performance variables wrong silently
degrades every job's throughput for the entire session. Getting the warmup sequence
wrong adds 2–4 minutes of cold-start latency to the first job. Getting the health
endpoint wrong means the dashboard shows a 140-second ETA when the host is actually
warm in 45 seconds.

This skill owns everything between `bash startup-enhanced.sh` and the first successful
pipeline job accepting a request.

---

## The Startup Sequence — Canonical Order

Execute in this exact order. Never skip a step. Never reorder.

```
1. Read /proc/meminfo → determine profile (8 GB vs 16 GB)
2. Set all Ollama CPU performance environment variables
3. If 16 GB profile: set OLLAMA_MAX_LOADED_MODELS=2
4. Start Ollama service (if not already running)
5. Pre-warm Pilot router with zero-token probe + 5m keep-alive (16 GB only)
6. Verify post-warmup RAM ≥ FULL_PIPELINE_MIN_AVAILABLE_MB
7. Log warmup status to structured log (log.info)
8. Write warmup-status flag readable by /api/system/health
9. Exit 0 (ready) or Exit 1 (overloaded)
```

---

## startup-enhanced.sh — Production Implementation

```bash
#!/usr/bin/env bash
# startup-enhanced.sh — SwarmXQ 16 GB Profile Activation
# V6.2.22 · APEX-17 r8 · HP EliteBook 850 G3 · WSL2 · CPU-only
# Run ONCE before starting the API server. Never run mid-session.
set -euo pipefail

FULL_PIPELINE_MIN_MB=6170   # must match FULL_PIPELINE_MIN_AVAILABLE_MB in video-runtime-config.ts
TWELVE_GB_THRESHOLD=12288   # minimum MemAvailable to activate 16 GB profile
WARMUP_STATUS_FILE="${SWARMX_WARMUP_STATUS_FILE:-/tmp/swarmxq-warmup.json}"

# ── Step 1: Read MemAvailable ─────────────────────────────────────────────────
AVAIL_MB=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)
echo "[startup] RAM before warmup: ${AVAIL_MB} MB"

# ── Step 2: CPU performance vars (ALWAYS set — applies to both 8 GB and 16 GB) ──
# These must be set before Ollama loads any model. Not hot-reloadable.
export OLLAMA_NUM_PARALLEL=1          # CPU has 1 inference thread; > 1 adds scheduling waste
export OLLAMA_FLASH_ATTENTION=1       # Fused attention: ~20% memory reduction on AVX2 CPU
export OLLAMA_KV_CACHE_TYPE=q8_0     # int8 KV cache: ~30% memory savings vs f16
export OLLAMA_NUM_THREADS=3           # 3 of 4 cores; 1 reserved for WSL2 hypervisor + OS
echo "[startup] CPU performance vars: NUM_PARALLEL=1 FLASH_ATTENTION=1 KV_CACHE_TYPE=q8_0 NUM_THREADS=3"

# ── Step 3: Profile detection ─────────────────────────────────────────────────
if [ "${AVAIL_MB}" -lt "${TWELVE_GB_THRESHOLD}" ]; then
  echo "[startup] WARN: Only ${AVAIL_MB} MB available — activating 8 GB safe profile"
  export OLLAMA_MAX_LOADED_MODELS=1
  export OLLAMA_KEEP_ALIVE=0

  # Write warmup status (8 GB path — no pre-warm)
  cat > "${WARMUP_STATUS_FILE}" <<EOF
{
  "profile": "8gb",
  "pilotWarmed": false,
  "availableMbAtBoot": ${AVAIL_MB},
  "availableMbPostWarmup": ${AVAIL_MB},
  "coldStartEtaSecs": 140,
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  echo "[startup] 8 GB profile active. No pre-warm. Cold-start ETA: 140s."
  exit 0
fi

# ── 16 GB profile ─────────────────────────────────────────────────────────────
echo "[startup] 16 GB profile detected (${AVAIL_MB} MB available)"
export OLLAMA_MAX_LOADED_MODELS=2
export OLLAMA_KEEP_ALIVE=0            # global default: evict after use

# ── Step 4: Verify Ollama is running ─────────────────────────────────────────
if ! curl -sf "${OLLAMA_HOST:-http://localhost:11434}/api/tags" > /dev/null 2>&1; then
  echo "[startup] ERROR: Ollama not reachable at ${OLLAMA_HOST:-http://localhost:11434}"
  echo "[startup] Start Ollama first: ollama serve"
  exit 1
fi

# ── Step 5: Pre-warm Pilot router with 5m keep-alive ─────────────────────────
# Zero-token probe: sends a minimal prompt to force model load into RAM
# OLLAMA_KEEP_ALIVE=5m scoped to this call only — does not change the global default (0)
echo "[startup] Pre-warming Pilot router (instruct-phi4-pro-q8-prod) with 5m keep-alive..."
if ! OLLAMA_KEEP_ALIVE=5m ollama run instruct-phi4-pro-q8-prod "" 2>/dev/null; then
  echo "[startup] ERROR: Pilot warmup failed — model may not be pulled"
  echo "[startup] Run: ollama pull instruct-phi4-pro-q8-prod"
  exit 1
fi
echo "[startup] Pilot router warm (5m keep-alive active)"

# ── Step 6: Post-warmup RAM verification ─────────────────────────────────────
AVAIL_AFTER_MB=$(awk '/MemAvailable/ {printf "%d", $2/1024}' /proc/meminfo)
DELTA_MB=$(( AVAIL_MB - AVAIL_AFTER_MB ))
echo "[startup] RAM after warmup: ${AVAIL_AFTER_MB} MB (Pilot load: -${DELTA_MB} MB)"

if [ "${AVAIL_AFTER_MB}" -lt "${FULL_PIPELINE_MIN_MB}" ]; then
  echo "[startup] ERROR: Post-warmup RAM ${AVAIL_AFTER_MB} MB < ${FULL_PIPELINE_MIN_MB} MB required"
  echo "[startup] Host overloaded before first job. Kill background processes and retry."
  exit 1
fi

# ── Step 7/8: Write warmup-status file ───────────────────────────────────────
cat > "${WARMUP_STATUS_FILE}" <<EOF
{
  "profile": "16gb",
  "pilotWarmed": true,
  "availableMbAtBoot": ${AVAIL_MB},
  "availableMbPostWarmup": ${AVAIL_AFTER_MB},
  "pilotLoadDeltaMb": ${DELTA_MB},
  "coldStartEtaSecs": 45,
  "startedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF

echo "[startup] 16 GB profile active. Pilot warm. Post-warmup RAM: ${AVAIL_AFTER_MB} MB. Ready."
exit 0
```

---

## /api/system/health — Warmup Flag Integration

The API's health endpoint must surface warmup status to the dashboard.
The dashboard uses this to adjust the cold-start ETA displayed to the user.

```typescript
// src/routes/system.ts
import { readFile } from 'node:fs/promises'

interface WarmupStatus {
  profile: '8gb' | '16gb'
  pilotWarmed: boolean
  availableMbAtBoot: number
  availableMbPostWarmup: number
  coldStartEtaSecs: number   // 45 (pre-warmed 16 GB) | 140 (cold 8 GB or no startup-enhanced)
  startedAt: string
}

async function readWarmupStatus(): Promise<WarmupStatus | null> {
  const statusFile = process.env['SWARMX_WARMUP_STATUS_FILE'] ?? '/tmp/swarmxq-warmup.json'
  try {
    const raw = await readFile(statusFile, 'utf-8')
    return JSON.parse(raw) as WarmupStatus
  } catch {
    // File absent = startup-enhanced.sh not run = cold start
    return null
  }
}

// In GET /api/system/health handler:
fastify.get('/api/system/health', async (request, reply) => {
  const warmup = await readWarmupStatus()
  const { availableMb } = await ModelOrchestrator.getRamSnapshot()

  return reply.send({
    status: 'ok',
    version: env.API_VERSION,
    warmup: warmup ?? {
      profile: 'unknown',
      pilotWarmed: false,
      coldStartEtaSecs: 140,    // conservative fallback when status file absent
    },
    ram: { availableMb },
    queue: {
      activeJobs: videoQueue.activeJobCount(),
      queueDepth: videoQueue.queueDepth(),
    },
  })
})
```

> **Dashboard cold-start ETA source of truth**: Always read from
> `/api/system/health` → `warmup.coldStartEtaSecs`. Never hard-code 140 or 45 in
> the dashboard component. When the API is unreachable on load, show "ETA: unknown"
> rather than a stale hard-coded number.

---

## Ollama CPU Performance Variables — Deep Reference

These four variables control the inference characteristics of every model in the pipeline.
**They must be set before Ollama starts any model load** — they are not hot-reloadable.

### OLLAMA_NUM_PARALLEL=1

- **What it controls**: Maximum number of concurrent inference requests Ollama will process
- **Why 1 on CPU-only**: CPU has a single effective inference thread. With `NUM_PARALLEL=2`,
  Ollama queues two requests and context-switches between them — this **halves** throughput
  with zero latency improvement for a serial pipeline
- **Never increase**: Even on 16 GB, `NUM_PARALLEL=1` is correct. More RAM does not create
  more inference threads on CPU
- **Validation**: `echo $OLLAMA_NUM_PARALLEL` must return `1` before running any pipeline

### OLLAMA_FLASH_ATTENTION=1

- **What it controls**: Enables fused multi-head attention kernel on CPUs with AVX2
- **Why enable**: Reduces attention memory footprint ~20% by eliminating intermediate
  `Q*K^T` and `softmax` allocations. On HP EliteBook 850 G3 (Skylake, AVX2 supported):
  verified safe. Degrades gracefully to standard attention on non-AVX2 CPUs
- **Memory impact at 4K context (Architect model)**: ~180 MB saved per inference run
- **Validation**: No direct env check available — infer from Ollama logs at startup

### OLLAMA_KV_CACHE_TYPE=q8_0

- **What it controls**: Quantisation of the KV (key-value) cache from float16 to int8
- **Why q8_0 not q4_0**: `q8_0` saves ~30% KV memory vs f16 with negligible quality loss.
  `q4_0` saves ~50% but degrades multi-step reasoning (scripting, storyboard) noticeably
  on CPU where precision matters more than on GPU
- **Memory impact**: For Architect at 4K context: `f16` costs ~320 MB; `q8_0` costs ~220 MB.
  This 100 MB delta enables dual-model residency to fit more comfortably within 16 GB budget
- **Never use `f16`** on the 16 GB profile — it prevents safe dual-model residency
- **Validation**: `echo $OLLAMA_KV_CACHE_TYPE` must return `q8_0`

### OLLAMA_NUM_THREADS=3

- **What it controls**: Number of CPU threads Ollama allocates for matrix operations
- **Why 3 not 4**: WSL2 shares cores with the Windows host hypervisor. Using all 4 threads
  causes hypervisor preemption stalls that reduce throughput by ~15% compared to using 3.
  **On bare-metal Linux (not WSL2), use 4**
- **WSL2 detection**: The `startup-enhanced.sh` could detect WSL2 via `grep -qi microsoft /proc/version`
  and set `OLLAMA_NUM_THREADS=4` on bare metal. Implement this when the host migrates to bare metal
- **Validation**: `echo $OLLAMA_NUM_THREADS` must return `3` (WSL2) or `4` (bare metal)

---

## num_ctx per Model (Context Window Sizing)

Set `num_ctx` explicitly in Modelfile or API call. Defaults are model-dependent and often
either too large (wastes KV RAM) or too small (truncates reasoning chains).

| Model | Recommended num_ctx | KV RAM at q8_0 | Rationale |
|---|---|---|---|
| Pilot (`instruct-phi4-pro-q8-prod`) | 2048 | ~120 MB | Intent classification ≤192 tokens; 2K keeps full conversation history for context |
| Pilot lite (`instruct-phi4-lite-q4km-prod`) | 1024 | ~60 MB | Low-RAM path; 1K sufficient for simplified classification |
| Architect (`plan-qwen25-pro-q5km-prod`) | 4096 | ~240 MB | Scripting generates 1024 tokens; storyboard needs full script in context |
| Oracle (`reason-deepseekr1-pro-q5km-prod`) | 3072 | ~180 MB | Virality scoring with script + storyboard in context |
| Forge (`code-qwen25-pro-q5km-prod`) | 4096 | ~240 MB | Code generation benefits from full file context |
| Relay (`route-phi4-lite-q4km-prod`) | 512 | ~30 MB | Intent routing only; no long context needed |

> **`FULL_PIPELINE_MIN_AVAILABLE_MB = 6170` accounts for**: Architect at 4K ctx (~240 MB KV) +
> model weights (~5 GB) + Pilot resident (~3 GB) + OS/API overhead (800 MB reserve) = ~9 GB peak.
> The 6170 MB threshold is the post-Pilot-warmup floor — with Pilot resident (~3 GB loaded),
> 6170 MB remaining is enough for Architect to load and run safely.

---

## Speculative Decoding (Priority 6 — Future)

Not active in V6.2.22. Document for the next performance milestone.

Speculative decoding uses Pilot lite as a draft model to propose tokens verified by Architect
(target model). On CPU, this can yield 1.5–2× throughput for deterministic outputs
(scripting, storyboard) where the draft model's guesses are frequently correct.

**Implementation prerequisite**: Both Pilot and Pilot lite must be resident simultaneously
(possible only on 16 GB with `OLLAMA_MAX_LOADED_MODELS=2`, after Priority 5 is complete).

**Activation pattern** (do not implement until Priority 5 is shipped and measured):
```typescript
// Architect stage call — future speculative decoding hook
const response = await ollamaGenerate(architectTag, prompt, {
  signal,
  options: {
    num_ctx:    4096,
    // Future: speculativeDecoding: { draftModel: 'instruct-phi4-lite-q4km-prod' }
    // Not yet supported in Ollama v0.x — track https://github.com/ollama/ollama/issues
  }
})
```

---

## env.ts Zod Schema Additions (Priority 3)

These vars belong in the Zod schema. Add in Priority 3 milestone alongside other env expansion:

```typescript
// src/lib/env.ts — startup-ops additions
const envSchema = z.object({
  // Ollama CPU performance (startup-ops responsibility)
  OLLAMA_NUM_PARALLEL:         z.coerce.number().int().min(1).max(1).default(1),
  OLLAMA_FLASH_ATTENTION:      z.coerce.number().int().min(0).max(1).default(1),
  OLLAMA_KV_CACHE_TYPE:        z.enum(['f16', 'q8_0', 'q4_0']).default('q8_0'),
  OLLAMA_NUM_THREADS:          z.coerce.number().int().min(1).max(8).default(3),

  // Dual-model residency
  OLLAMA_MAX_LOADED_MODELS:    z.coerce.number().int().min(1).max(3).default(1),
  OLLAMA_KEEP_ALIVE_PILOT_S:   z.coerce.number().int().min(0).default(0),

  // RAM thresholds
  FULL_PIPELINE_MIN_AVAILABLE_MB: z.coerce.number().int().default(6170),
  HIGH_PRESSURE_DELAY_MS:         z.coerce.number().int().min(1000).max(30000).default(3000),

  // Warmup status
  SWARMX_WARMUP_STATUS_FILE:   z.string().default('/tmp/swarmxq-warmup.json'),
})
```

**Risk level annotations** (add as JSDoc to each env schema field):
- `OLLAMA_NUM_PARALLEL`: silent-fail (wrong value silently reduces throughput)
- `OLLAMA_FLASH_ATTENTION`: silent-fail (missing value adds memory overhead)
- `OLLAMA_KV_CACHE_TYPE`: silent-fail (wrong value bloats KV cache)
- `OLLAMA_NUM_THREADS`: silent-fail (wrong value causes hypervisor contention)
- `FULL_PIPELINE_MIN_AVAILABLE_MB`: startup-crash-adjacent (used to block job acceptance)
- `SWARMX_WARMUP_STATUS_FILE`: silent-fail (missing file → conservative ETA in dashboard)

---

## Dashboard Integration — Cold-Start ETA

The dashboard's `VideoJobCard` and `StageProgressIndicator` components must read
warmup state from the API, not from hard-coded values.

```typescript
// apps/swarmx-dashboard/lib/api.ts
export async function fetchSystemHealth(): Promise<SystemHealth> {
  const res = await fetch('/api/system/health')
  if (!res.ok) return { warmup: { coldStartEtaSecs: 140, pilotWarmed: false } }
  return res.json()
}

// Component usage
const { warmup } = useSystemHealth()  // polling hook; refreshes every 30s
const etaSecs = warmup?.coldStartEtaSecs ?? 140

// ETA display logic:
// - Job queued + no active jobs + elapsed < etaSecs → show countdown from etaSecs
// - Elapsed > etaSecs but job not started → show "Warmup exceeded typical range"
// - Job started (stage !== 'queued') → switch to stage-specific progress bar
```

---

## Autonomous Scanning — Startup Ops Violations

### Critical (fix before committing anything else)
- `OLLAMA_NUM_PARALLEL` not set before Ollama starts (or set > 1) → add to startup-enhanced.sh
- `OLLAMA_KV_CACHE_TYPE` not set or set to `f16` on 16 GB host → switch to `q8_0`
- `startup-enhanced.sh` does not exit 1 when post-warmup RAM < `FULL_PIPELINE_MIN_AVAILABLE_MB`
- `/api/system/health` not reading warmup status file → add `readWarmupStatus()` call
- Dashboard cold-start ETA hard-coded as 140 s regardless of warmup state → read from API

### High Impact (add to next session queue if found)
- `OLLAMA_NUM_THREADS` not set (defaults to all cores on WSL2, causing hypervisor contention)
- Warmup status file not written when startup-enhanced.sh is not run (API needs graceful null handling)
- `SWARMX_WARMUP_STATUS_FILE` path not in `env.ts` schema (ad-hoc `process.env` read)
- `startup-enhanced.sh` not running `/api/system/health` smoke test after startup

### Medium Impact (log to memory note)
- No structured log entry at API boot with RAM headroom + warmup state summary
- `coldStartEtaSecs` not dynamically updated as Pilot warms between pipeline runs
- WSL2 vs bare-metal thread count not auto-detected (`OLLAMA_NUM_THREADS` hard-coded)
