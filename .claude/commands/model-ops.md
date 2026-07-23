# /model-ops — SwarmXQ Model Orchestration Command

Deep-dive into APEX-17 r8 model routing, SINGLE-7B LOCK enforcement, RAM pressure
management, startup-enhanced.sh, and 16 GB profile activation. Loads the full model
orchestration skill graph and enters Principal Engineer mode for the model layer.

**Use this command for any task involving:**
- SINGLE-7B LOCK — eviction, keep-alive, dual-model residency
- Canonical tag resolution — `resolveCanonicalTag()`, `MODEL_OPERATOR_MAP`
- RAM pressure — `readPressure()`, `getRamSnapshot()`, `/proc/meminfo`
- Startup sequence — `startup-enhanced.sh`, Ollama CPU performance vars, pre-warmup
- 16 GB profile — `OLLAMA_MAX_LOADED_MODELS=2`, Pilot keep-alive, ComfyUI frame budget
- Operator taxonomy — all 7 operators (Relay, Pilot, Architect, Forge, Oracle, Auditor, Lab)
- `video-runtime-config.ts` — `resolveVideoModelTag()`, `shouldAutoEnableLowRamMode()`
- Env schema expansion for model/RAM vars

---

## Auto-loaded skill graph

```
Required (always):
  swarmxq-model-orchestrator         ← SINGLE-7B LOCK, operator map, keep-alive, RAM pressure
  swarmxq-startup-ops-architect      ← startup-enhanced.sh, Ollama CPU perf vars, warmup health

Conditional (loaded based on task signals):
  swarmxq-video-pipeline-architect   ← if model changes affect pipeline stage contracts
  typescript-config-surgeon          ← if env.ts Zod schema additions in scope
  backend-systems-auditor            ← if server.ts boot sequence or health endpoint in scope
  opentelemetry-observability-architect ← if model acquisition latency metrics in scope
  testing-strategy-architect         ← if regression tests for operator map / pressure in scope
```

---

## Session opening protocol

Before writing any code, verify:

```bash
# 1. Read the operator source of truth
cat packages/swarmx-types/src/operator-map.ts    # TypeScript canonical
cat src/swarmx/operator_map.py                   # Python mirror — must be semantically identical

# 2. Check model orchestrator for invariant state
cat apps/swarmx-api/src/services/model-orchestrator.ts

# 3. Verify Ollama performance vars (CRITICAL — must be set before inference)
echo "OLLAMA_NUM_PARALLEL=${OLLAMA_NUM_PARALLEL:-UNSET}"      # must be 1
echo "OLLAMA_FLASH_ATTENTION=${OLLAMA_FLASH_ATTENTION:-UNSET}" # must be 1
echo "OLLAMA_KV_CACHE_TYPE=${OLLAMA_KV_CACHE_TYPE:-UNSET}"    # must be q8_0
echo "OLLAMA_NUM_THREADS=${OLLAMA_NUM_THREADS:-UNSET}"         # must be 3 (WSL2)
echo "OLLAMA_MAX_LOADED_MODELS=${OLLAMA_MAX_LOADED_MODELS:-UNSET}" # must be 2 (16 GB)

# If any are UNSET, run startup-enhanced.sh first

# 4. Check available RAM
awk '/MemAvailable/ {printf "MemAvailable: %d MB\n", $2/1024}' /proc/meminfo

# 5. Check loaded models (skip if Ollama offline)
ollama ps 2>/dev/null || echo "[OFFLINE] Ollama not running"

# 6. Check warmup status
cat /tmp/swarmxq-warmup.json 2>/dev/null || echo "[COLD] startup-enhanced.sh not run"
```

Then answer:
1. Is `startup-enhanced.sh` active? (check warmup.json)
2. Is the 16 GB profile engaged? (`OLLAMA_MAX_LOADED_MODELS=2`?)
3. Is Pilot pre-warmed? (`pilotWarmed: true` in warmup.json)
4. Which milestone from the queue is this task tied to?

---

## APEX-17 r8 Operator Quick Reference

| Operator | Canonical tag | is7B | Video role |
|---|---|---|---|
| Relay | `route-phi4-lite-q4km-prod` | No | Pre-pipeline routing (not in video stages) |
| Pilot | `instruct-phi4-pro-q8-prod` | No | intent_classification, caption generation |
| Pilot lite | `instruct-phi4-lite-q4km-prod` | No | Low-RAM fallback (all text stages) |
| Architect | `plan-qwen25-pro-q5km-prod` | Yes | planning, scripting, storyboard |
| Architect deep | `plan-deepseekr1-pro-q5km-prod` | Yes | Deep planning fallback |
| Oracle | `reason-deepseekr1-pro-q5km-prod` | Yes | Virality scoring (post-pipeline) |
| Forge | `code-qwen25-pro-q5km-prod` | Yes | Agent code tasks (not video) |
| Auditor | `critique-deepseekr1-pro-q5km-prod` | Yes | Agent QA gating (not video) |
| Lab | `synth-qwen25-exp-q4km-dev` | Yes | Meta-evolution (not video, dev only) |

**Legacy aliases that must never appear in production code:**
`phi4-fast`, `deepseek-reasoner`, `qwen-worker`, `relay-router`, `scar-auditor`, `scar-lab`,
`SENTINEL` (V5), `CANVAS` (V5), `LEDGER` (V5), `PROPHET` (V5), `EVOLVER` (V5)

---

## SINGLE-7B LOCK invariants checklist

For every file touched involving model acquisition:

- [ ] `resolveCanonicalTag()` called before tag enters registry or log
- [ ] `evictIncompatible()` called before every 7B model load
- [ ] `RAM_CRITICAL_MB = 800` unchanged — grep to verify
- [ ] `MAX_CONCURRENT_JOBS = 1` unchanged — grep to verify
- [ ] `OLLAMA_NUM_PARALLEL = 1` — never increase on CPU-only host
- [ ] No two 7B models active simultaneously (including Auditor, Lab in agent layer)
- [ ] `OLLAMA_KEEP_ALIVE=0` for all 7B models; `5m` for Pilot on 16 GB only

---

## 16 GB profile invariants checklist

- [ ] `startup-enhanced.sh` runs before API server starts
- [ ] `OLLAMA_MAX_LOADED_MODELS=2` set by startup-enhanced.sh
- [ ] Pilot pre-warmed with `OLLAMA_KEEP_ALIVE=5m` zero-token probe
- [ ] Post-warmup RAM ≥ `FULL_PIPELINE_MIN_AVAILABLE_MB` (6170 MB)
- [ ] `/api/system/health` returns `warmup.coldStartEtaSecs = 45`
- [ ] Dashboard shows 45s ETA (not hard-coded 140s)
- [ ] `OLLAMA_FLASH_ATTENTION=1`, `OLLAMA_KV_CACHE_TYPE=q8_0`, `OLLAMA_NUM_THREADS=3` all set

---

## Output format

Every response opens with the Skill Trace Block, then:

1. **Files read** — exact files examined before acting
2. **Invariants verified** — SINGLE-7B LOCK status, RAM state, operator map parity
3. **Changes made** — surgical, justified
4. **Gate commands to run** — exact verification commands
5. **Risk notes** — what can regress and how to detect it
