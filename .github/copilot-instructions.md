# SwarmX Copilot Instructions — v2026.5.20-apex17-r3
# Location: .github/copilot-instructions.md
# Hardware: HP EliteBook 850 G3 · 8 GB RAM · CPU-only · WSL2
# Maintainer: Scar (Oscar Ndugbu)
#
# Changelog vs V5.9:
#   [ARCH-01] 5-tier model topology replacing 6-role flat topology
#   [ARCH-02] phi4-router-lite-scar added as Tier 1 ultra-light router
#   [ARCH-03] model-orchestrator.ts / adaptive-timeout-config.ts / swarm-pressure-monitor.ts integrated
#   [ARCH-04] Timeout matrix replaces static AI_TIMEOUT=120s / ROUTER_TIMEOUT=45s
#   [ARCH-05] MAX_LOADED_MODELS corrected to 1 (not 2) on 8 GB hardware
#   [ARCH-06] Context windows reduced per arch review §4
#   [ARCH-07] Predict caps tightened per arch review §11
#   [ARCH-08] DeepSeek think-token sanitization made mandatory (§5)
#   [ARCH-09] Runtime profiles (lite/standard/deep/degraded) added (§6)
#   [ARCH-10] Composer tiered degradation (Tier 0–4) codified (§8)

---

## 1. What SwarmX Is

SwarmX is a local-first autonomous multi-agent cognitive platform running on
an 8 GB HP EliteBook 850 G3 (CPU-only, WSL2). It combines:

- **Fastify API** (port 3001) — REST/SSE bridge to Ollama
- **Next.js dashboard** (port 3000) — real-time swarm control panel
- **Ollama backend** — local LLM inference, strict sequential model loading
- **APEX-17 Evolution pipeline** — 4-phase self-improving swarm loop
- **Composer** — intelligent chat interface with tiered fallback

**Non-negotiable constraint:** Never load two 7B models simultaneously.
Total RAM budget = 8 GB. Any phi4 (4.1–4.4 GB) + any 7B (5.4 GB) = ~9.5 GB → OOM.

---

## 2. Model Topology (v2026.5.20-apex17-r3 — 5-tier)

| Tier | Tag | Base | RAM | Role |
|------|-----|------|-----|------|
| 1 | `phi4-router-lite-scar` | Phi-4-mini Q4_K_M | ~2.5 GB | Ultra-light intent classifier — routing decisions ONLY |
| 2 | `phi4-fast-scar`        | Phi-4-mini Q8_0   | ~4.27 GB| Session chat, fallback router, health μ-gate |
| 2 | `phi4-worker-scar`      | Phi-4-mini Q8_0   | ~4.4 GB | Fast tool execution, short JSON tasks |
| 3 | `qwen-worker-scar`      | Qwen2.5-7B Q5_K_M | ~5.4 GB | Code generation, complex tool chains |
| 3 | `qwen-supervisor-scar`  | Qwen2.5-7B Q5_K_M | ~5.4 GB | Multi-step planning, delegation |
| 4 | `deepseek-reasoner-scar`| DeepSeek-R1-7B Q5_K_M | ~5.4 GB | Deep reasoning, architecture analysis |
| 4 | `deepseek-critic-scar`  | DeepSeek-R1-7B Q5_K_M | ~5.4 GB | Adversarial audit, quality gate |
| 4 | `deepseek-supervisor-scar`| DeepSeek-R1-7B Q5_K_M | ~5.4 GB | Long-horizon planning (aiplan_deep only) |
| 5 | `phi4-evolve-scar`      | Phi-4-mini Q8_0   | ~4.4 GB | APEX-17 Phase 1: observe |
| 5 | `deepseek-evolve-scar`  | DeepSeek-R1-7B Q5_K_M | ~5.4 GB | APEX-17 Phase 2+4: critique/validate |
| 5 | `qwen-evolve-scar`      | Qwen2.5-7B Q5_K_M | ~5.4 GB | APEX-17 Phase 3: mutate |

### Routing rules (hard constraints)

```
intent classify / safety gate / degraded routing → phi4-router-lite-scar
status / health / short Q&A / fallback           → phi4-fast-scar
fast tool call / boolean / extract               → phi4-worker-scar
code / implementation / refactor                 → qwen-worker-scar
multi-step plan / delegation                     → qwen-supervisor-scar
deep analysis / math / architecture              → deepseek-reasoner-scar
adversarial audit / git diff / critique          → deepseek-critic-scar
long-horizon architecture planning               → deepseek-supervisor-scar
```

**Never** route two 7B models simultaneously. **Never** use a 7B for routing.
**Always** use the `-scar` suffix when referencing model tags in code.

### Context windows (post arch-review §4 reductions)

| Model | num_ctx | num_predict |
|-------|---------|-------------|
| phi4-router-lite-scar | 2048 | 96 |
| phi4-fast-scar | 2048 | 96 |
| phi4-worker-scar | 4096 | 512 |
| qwen-worker-scar | 6144 | 512 |
| qwen-supervisor-scar | 6144 | 640 |
| deepseek-reasoner-scar | 6144 | 1536 |
| deepseek-critic-scar | 8192 | 1024 |
| deepseek-supervisor-scar | 6144 | 1024 |
| evolve models | 6144 | 1024–1536 |

---

## 3. Runtime Services (apps/swarmx-api/src/services/)

| File | Purpose | Arch review § |
|------|---------|---------------|
| `model-orchestrator.ts` | Single-7B lock, adaptive keep-alive, predictive warmup, eviction control | §2 |
| `adaptive-timeout-config.ts` | Per-operation timeout matrix, circuit breaker, jittered retry, memory-aware ctx downgrade | §3 |
| `swarm-pressure-monitor.ts` | RAM/swap/zRAM metrics, topology recommendation (triad→duo→supervisor→rules), evolver constraints | §9 |
| `reasoning-sanitizer.ts` | Strip DeepSeek `<think>` blocks, repair JSON, normalize output | §5 |
| `ollama.ts` | Multi-endpoint failover, cached model discovery, health probes | existing |

### Integration contract

**Every call to an Ollama model** must go through all three:

```typescript
import { getAdaptiveCallConfig, withTimeout, recordSuccess, recordFailure }
  from "./adaptive-timeout-config.js";
import { setActiveModel, recordLatency, recordTokens }
  from "./swarm-pressure-monitor.js";
import { sanitizeReasoningOutput }
  from "./reasoning-sanitizer.js";

const { timeoutMs, overrides, circuitOpen } = getAdaptiveCallConfig(modelTag, opKey);
if (circuitOpen) { /* fallback */ }

const result = await withTimeout(callOllama(modelTag, { ...overrides }), timeoutMs, opKey);
const clean  = sanitizeReasoningOutput(result.text);   // always — even for phi4
recordSuccess(modelTag);
recordLatency(result.latencyMs);
```

**DeepSeek models**: ALWAYS pass output through `sanitizeReasoningOutput()` before:
- passing to another swarm agent
- returning to the API stream
- feeding into APEX-17 pipeline

---

## 4. Ollama Runtime Config (arch review §7)

```bash
# Normal mode (set in startup script / ~/.zshrc):
OLLAMA_NUM_PARALLEL=1
OLLAMA_MAX_LOADED_MODELS=1    # ← NOT 2 on 8 GB hardware
OLLAMA_KEEP_ALIVE=2m
OLLAMA_FLASH_ATTENTION=1
OLLAMA_KV_CACHE_TYPE=q8_0

# Adaptive keep-alive (managed by model-orchestrator.ts):
# idle        → 2m
# low RAM     → 20s
# swarm active→ 3m
# evolver     → 5m
# degraded    → 0s (immediate eviction)
```

---

## 5. Composer Tiered Degradation (arch review §8)

The Composer MUST resolve to the lowest viable tier before calling a model.

```
Tier 0 → Local rule engine (shell intents, health checks)   <100ms  — NO model
Tier 1 → phi4-router-lite-scar (intent classify only)       2-4s
Tier 2 → phi4-fast-scar (fallback routing, fast chat)       8-15s
Tier 3 → Specialist (qwen-worker/supervisor, deepseek-*)    35-120s
Tier 4 → Deep swarm (triad / evolver / multi-agent synth)   90-240s
```

**Circuit breaker:** 3 model failures within 90s → trip breaker → drop one tier.
**Under critical RAM pressure:** skip Tier 3/4, serve from Tier 0/1.

---

## 6. Adaptive Timeouts (arch review §3)

Replace all uses of `AI_TIMEOUT` / `ROUTER_TIMEOUT` with `getTimeout(opKey, pressure)`:

| Operation | Normal timeout | Critical timeout |
|-----------|---------------|-----------------|
| intent_classify | 3s | 1.5s |
| routing | 5s | 3s |
| fast_chat | 12s | 6s |
| tool_execution | 28s | 15s |
| supervisor_planning | 50s | 25s |
| deep_reasoning | 90s | 45s |
| critic_audit | 75s | 40s |
| evolver phases | 120s | 60s |

Streaming responses: use `createStreamGuard()` — never timeout an active token stream.

---

## 7. APEX-17 Evolution Pipeline

```
Phase 1 OBSERVE   → phi4-evolve-scar     (fitness snapshot, JSON output)
Phase 2 CRITIQUE  → deepseek-evolve-scar (adversarial critique of snapshot)
Phase 3 MUTATE    → qwen-evolve-scar     (single mutation proposal)
Phase 4 VALIDATE  → deepseek-evolve-scar (approve/reject mutation)
```

**Constraints from swarm-pressure-monitor.ts:**
- RAM < 2 GB free → reduce mutation breadth, reduce iterations, summarize traces
- RAM < 1 GB free → skip validate phase, max 1 mutation per run
- topology != full_triad → skip evolution entirely, return DEFERRED

---

## 8. Code Conventions

### Model references
- Always use the full `-scar` tag: `phi4-router-lite-scar`, not `phi4-mini`.
- Read model tags from env vars (`SCAR_*` or `SWARMX_MODEL_*`), never hardcode.
- Config resolution order: env var → `configs/v6-overlay.yaml` → defaults.

### TypeScript (swarmx-api)
- Services live in `apps/swarmx-api/src/services/`
- Routes live in `apps/swarmx-api/src/routes/`
- Import with `.js` extension (ESM): `import { x } from "./service.js"`
- Use `FastifyInstance` typed server; register via `server.register(router, { prefix })`
- No `any` without explicit comment justifying it

### Error handling
- Model calls: always wrap in `withTimeout()` + catch → circuit breaker → fallback
- Never let Ollama failures crash the API — always degrade gracefully
- Log with `server.log.warn / .error` (structured pino, not `console.log`)

### Memory management
- Check `getSwarmPressure()` before loading any 7B model
- Call `recordEviction()` whenever Ollama evicts a model
- Never trigger a 7B load if `availableMb < 2000`

### DeepSeek output
- Pass ALL DeepSeek model output through `sanitizeReasoningOutput()` — no exceptions
- Extract JSON via `extractJson()` from reasoning-sanitizer — never `JSON.parse()` raw

### Stop sequences — all models must declare:
```
PARAMETER stop "<|im_end|>"
PARAMETER stop "<|end|>"
PARAMETER stop "</tool>"
PARAMETER stop "</response>"
PARAMETER stop "USER:"
PARAMETER stop "ASSISTANT:"
```

---

## 9. File Locations

```
apps/swarmx-api/src/
├── services/
│   ├── model-orchestrator.ts       § 2 — model lifecycle, eviction, warmup
│   ├── adaptive-timeout-config.ts  § 3 — timeout matrix, circuit breaker
│   ├── swarm-pressure-monitor.ts   § 9 — RAM/swarm metrics, topology
│   ├── reasoning-sanitizer.ts      § 5 — DeepSeek think-block sanitization
│   └── ollama.ts                        — endpoint discovery, health probes
├── routes/
│   └── composer.ts                      — Composer tiered degradation (§8)
└── server.ts                            — Fastify entry, plugin registration

~/Downloads/latest-modelfiles/           — all .modelfile sources
~/llm-local/gguf/                        — GGUF weight files
~/.local/share/scar/logs/                — AI command logs
```

---

## 10. Telemetry Targets (arch review §12)

Track per-model call:
- `cold_start_ms`, `warm_start_ms`, `tokens_per_sec`
- `timeout_rate`, `avg_predict_length`, `memory_mb_at_call`
- `load_failures`, `eviction_count`, `circuit_breaker_trips`

Expose on dashboard SSE events: `swarm:health`, `swarm:topology_change`, `model:evicted`.

---

## 11. Swarm Topology Under Pressure

The swarm automatically downgrades topology when resources are constrained:

```
full_triad      → router + specialist + critic  (normal, RAM > 2.5 GB free)
duo             → router + specialist           (pressure > 0.65 or queue > 5)
supervisor_only → supervisor handles all        (RAM < 1.4 GB free)
rule_engine     → no model; pure rules          (RAM < 0.8 GB or timeout_rate > 60%)
```

Topology changes are broadcast via SSE `swarm:topology_change` events.
The dashboard must handle all four states gracefully.

---

## 12. Quick Reference — Shell Aliases

```bash
ai            → phi4-fast-scar         (fast chat)
aicode        → qwen-worker-scar       (code generation)
aireason      → deepseek-reasoner-scar (deep reasoning)
aisupervise   → qwen-supervisor-scar   (planning)
aicritic      → deepseek-critic-scar   (adversarial audit)
swarm_triad   → ROUTER → REASONING → CRITIC (sequential)
swarm_evolve_run → full APEX-17 4-phase pipeline
triad_status  → show routing table + loaded models
ollama_status → full Ollama health + registry dump
airambudget   → RAM budget summary
```

---

## 13. What NOT To Do

- ❌ `OLLAMA_MAX_LOADED_MODELS=2` on 8 GB — causes OOM under load
- ❌ `ollama.run("qwen-supervisor")` while `deepseek-reasoner` is resident
- ❌ `JSON.parse(deepseekOutput)` — always use `extractJson()` from reasoning-sanitizer
- ❌ Static `AI_TIMEOUT=120` for routing — use `getTimeout("intent_classify", pressure)`
- ❌ `temperature=0.7` on phi4-router-lite-scar — must be 0.0 (deterministic routing)
- ❌ Hardcoding model tags — always read from `SCAR_*` env vars
- ❌ Loading two 7B models simultaneously — hard OOM on 8 GB
- ❌ Skipping `sanitizeReasoningOutput()` on DeepSeek output — corrupts downstream agents
