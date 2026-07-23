# /audit — SwarmXQ System Audit Command

Performs a comprehensive production-readiness audit of the SwarmXQ repository.
Classifies every component against verified ground truth and the critical invariants.

**Use this command for:**
- Pre-release production audits
- Post-milestone verification
- Onboarding to a new session (combined with `/nexus`)
- Identifying gaps before planning the next milestone

---

## Auto-loaded skill graph

```
Required:
  backend-systems-auditor             ← Fastify production readiness, graceful shutdown
  swarmxq-video-pipeline-architect    ← pipeline invariants, creative quality gates
  swarmxq-model-orchestrator          ← SINGLE-7B LOCK, canonical tags, RAM pressure
  security-hardening-auditor          ← auth, rate limits, secret handling, CSP

Conditional:
  testing-strategy-architect          ← if coverage gaps in scope
  opentelemetry-observability-architect ← if telemetry gaps in scope
  real-time-systems-architect         ← if SSE lifecycle in scope
  bullmq-job-architect                ← if BullMQ/Worker separation in scope
  typescript-config-surgeon           ← if env schema in scope
  api-contract-governance-architect   ← if API surface in scope
```

---

## Audit Protocol

### Phase 1 — Invariant Scan (run first, fix before anything else)

```bash
# 0. Ollama performance vars check (CRITICAL — must be set before first inference)
echo "OLLAMA_NUM_PARALLEL=${OLLAMA_NUM_PARALLEL:-UNSET}"      # must be 1
echo "OLLAMA_FLASH_ATTENTION=${OLLAMA_FLASH_ATTENTION:-UNSET}" # must be 1
echo "OLLAMA_KV_CACHE_TYPE=${OLLAMA_KV_CACHE_TYPE:-UNSET}"    # must be q8_0
echo "OLLAMA_NUM_THREADS=${OLLAMA_NUM_THREADS:-UNSET}"         # must be 3 (WSL2)
# If any are UNSET, run startup-enhanced.sh before proceeding

# 1. console.* violations (CRITICAL)
grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes

# 2. Legacy alias tags in production code (CRITICAL)
grep -rn 'phi4-fast\|deepseek-reasoner\|qwen-worker' apps/ packages/ src/

# 3. Direct process.env reads (HIGH)
grep -rn 'process\.env\[' apps/swarmx-api/src/services apps/swarmx-api/src/routes

# 4. Missing sanitizeReasoningOutput (CRITICAL)
grep -rn 'ollamaGenerate\|ollamaChatComplete' apps/swarmx-api/src/services/
# → every call site must be followed by sanitizeReasoningOutput()

# 5. AbortController without { once: true } (CRITICAL)
grep -rn 'addEventListener.*abort' apps/swarmx-api/src/services/
# → every 'abort' listener must include { once: true }

# 6. modelsUsed set outside stage fn (CRITICAL)
grep -rn 'modelsUsed\[' apps/swarmx-api/src/services/video-orchestrator.ts
# → must only appear inside stage handler functions, not in runStage()
```

### Phase 2 — Quality Gate Run

```bash
pnpm -F swarmx-api tsc --noEmit
pnpm -F swarmx-types tsc --noEmit
pnpm -F swarmx-dashboard tsc --noEmit
pnpm -F swarmx-dashboard vitest run       # ≥52 passing
pnpm -F swarmx-api vitest run             # 0+ until Priority 4; report actual count
npx tsx apps/swarmx-api/scripts/adaptive-timeout-regression.ts
npx tsx apps/swarmx-api/scripts/video-regression-check.ts
npx tsx apps/swarmx-api/scripts/eviction-metric-regression.ts
npx tsx apps/swarmx-api/scripts/system-health-regression.ts
npx tsx apps/swarmx-api/scripts/reasoning-sanitizer-regression.ts
pnpm -F swarmx-dashboard next build
git diff --check
```

### Phase 3 — Gap Classification

For each component found, classify as:

| Status | Meaning |
|---|---|
| `VERIFIED_COMPLETE` | Matches V6.2.21 ground truth; do not re-implement |
| `PRESENT_BUT_INCOMPLETE` | Exists but missing coverage; add to milestone queue |
| `CONFLICTING` | Contradicts invariants; fix in current session |
| `MISSING` | Referenced but not implemented; add to milestone queue |
| `OBSOLETE` | Superseded by verified implementation; remove |

### Phase 4 — Audit Report Structure

```markdown
## Repository Audit — V<VERSION> — <date>

### Architecture Assessment
- Video pipeline status (VOT-09 through VOT-13: verified?)
- Agent layer status
- TypeScript contract integrity

### Invariant Status
- [ ] SINGLE-7B LOCK enforced
- [ ] console.* zero hits in services/routes
- [ ] resolveCanonicalTag() at every external tag entry
- [ ] sanitizeReasoningOutput() on every Ollama response
- [ ] modelsUsed recorded inside stage fns
- [ ] AbortController { once: true } on all abort listeners
- [ ] RAM_CRITICAL_MB = 800 unchanged
- [ ] MAX_CONCURRENT_JOBS = 1 unchanged
- [ ] FFmpeg evicts all models before render

### Technical Debt Inventory (ranked by severity)
1. CRITICAL: [list]
2. HIGH: [list]
3. MEDIUM: [list]

### 16 GB Profile Readiness
- Dual-model residency: active / pending
- Pilot keep-alive: active / pending
- startup-enhanced.sh: written / pending
- ComfyUI frame budget: unlocked / pending

### Next Session Milestones
[ordered by impact × (1/complexity) × production value]
```

---

## Offline protocol

If Ollama or Redis are unavailable:
- Phases 1 and 2 (static analysis + tsc + vitest + regression scripts) can always run
- Note offline constraint explicitly in session memory note
- Do not fabricate results for gates that require live services
