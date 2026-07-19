# V6.2.37–V6.2.38 Session Note — 2026-07-19

## Shipped

### V6.2.37 — fix(python): Agent idempotency + structlog %-format cleanup
- Commit `a56e900`: 4 files, 25 ins / 25 del
- learn_from_run() now pre-sets `"id": f"memory-{run_id}-{kind}"` before calling
  store_memory() — DB ON CONFLICT(id) DO UPDATE makes retried executor runs upsert
  rather than append duplicate memory rows
- evolver.py store_memory() calls for evolution-rejected, evolution-applied,
  evolution-iep-blocked, and evolution-delta also receive `"id": f"memory-{proposal.id}-{kind}"`
- 12 remaining %-format structlog calls in evolver.py, evolution_engine.py, and
  critique_pipeline.py converted to keyword-arg form

### V6.2.38 — feat(observability): Ollama CPU perf vars in env schema, health endpoint, boot log
- Commit `a4b7a2b`: 3 files, 26 ins
- Added OLLAMA_NUM_PARALLEL, OLLAMA_FLASH_ATTENTION, OLLAMA_KV_CACHE_TYPE,
  OLLAMA_NUM_THREADS to env.ts Zod schema (safe defaults; startup-enhanced.sh sets real values)
- Surfaced as `config.ollamaPerf` in GET /api/system/health response
- Logs full profile at boot via `server.log.info({numParallel, flashAttention, ...})`

## All medium impact items now closed
- ✅ V6.2.36: Python structlog migration (25 files)
- ✅ V6.2.37: Agent idempotency — stable memory IDs
- ✅ V6.2.31: WSL2 thread detection already shipped (grep -qi microsoft /proc/version)
- ✅ V6.2.38: Ollama perf vars in health endpoint + env.ts

## Quality gates
- tsc (API, dashboard): ✓ zero errors
- vitest dashboard: ✓ 52/52
- system-health regression: ✓ passed

## Remaining work
- All Autonomous Opportunity Discovery medium items are closed
- Remaining high-priority milestone: API unit tests for series routes (Priority 4 extension)
- Consider updating CLAUDE.md MILESTONE QUEUE section to reflect V6.2.38 state
