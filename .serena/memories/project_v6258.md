---
name: project_v6258
description: V6.2.58 - backend fetch error classification, CPU admission gate, dashboard disclosure/readiness surfacing, bounded retry default widened to 2
metadata:
  type: project
---

# SwarmXQ Project Memory - V6.2.58

## Session Date

2026-07-28

## Shipped

### Backend reliability

- Added `apps/swarmx-api/src/services/backend-fetch-errors.ts` as the shared
  classification boundary for direct Ollama and ComfyUI network calls.
- Added `apps/swarmx-api/src/services/video-error-classification.ts` to keep
  retryable video codes limited to `TIMEOUT`, `OLLAMA_UNAVAILABLE`, and
  `COMFY_UNAVAILABLE`.
- Wrapped Ollama and ComfyUI `fetch()` calls before retry logic:
  connection-level Ollama failures classify as `OLLAMA_UNAVAILABLE`, ComfyUI
  connection failures classify as `COMFY_UNAVAILABLE`, explicit stage timeout
  aborts preserve `TIMEOUT`, and user/job aborts preserve
  `CANCELLED_BY_USER`.
- Follow-up audit fixed the Node/undici case where `fetch()` rejects with
  `signal.reason` directly instead of a `DOMException`. Timeout and cancellation
  reasons are now preserved whenever the signal is already aborted.
- Updated orchestration error normalization so unexpected programmer/protocol
  failures still surface as non-retryable `UNKNOWN` instead of being folded
  into transient retry behavior.

### Admission control

- Completed CPU pressure gating in dashboard runtime guidance. Submissions now
  block when `load1m / coreCount >= 0.85` using live `systemMetrics` when
  present.
- CPU telemetry absence remains non-blocking, matching the existing RAM gate's
  progressive guidance style.

### Dashboard UX

- Client-facing summary surfaces now use operator names/plain labels instead of
  raw canonical model tags.
- Follow-up audit removed the raw canonical token-ceiling tag from the
  TelemetryRail tooltip as well as the visible label.
- Video cards surface `certificationTier`, `certificationBlockers`, and
  virality component scores when available.
- Retry and error copy now distinguishes retryable classified backend failures
  from non-retryable `UNKNOWN` failures.

### Governance reconciliation

- Reconciled `CONFIG_REFERENCE.md` with the `SWARMX_VIDEO_MAX_RETRIES=2`
  implementation default.
- Reconciled startup/model tuning docs and `swarmxq-startup-ops-architect`
  skill guidance with the verified safe CPU defaults:
  `OLLAMA_FLASH_ATTENTION=0` and `OLLAMA_KV_CACHE_TYPE=f16`.

### Retry policy

- Changed `SWARMX_VIDEO_MAX_RETRIES` default from `1` to `2`.
- Regression coverage now asserts two automatic retries before terminal failure.

## Runtime Evidence

- Host evidence read during the session:
  - `/proc/meminfo`: `MemTotal: 16249884 kB`, `MemAvailable: 8504848 kB`
  - `/proc/loadavg`: `8.22 6.93 4.91 17/1194 2`
- On a 4-core host, current load ratio was above the new `0.85` CPU pressure
  floor, so the new CPU gate would block new full-pipeline submissions while
  leaving telemetry-unavailable states non-blocking.

## Quality Gates

- `pnpm --filter @swarmx/types typecheck` - passed
- `pnpm --filter @swarmx/api run typecheck` - passed
- `pnpm --filter @swarmx/api run test` - passed, 344 tests
- `pnpm --filter @swarmx/dashboard run typecheck` - passed
- `pnpm --filter @swarmx/dashboard run test` - passed, 58 tests
- `pnpm --filter @swarmx/dashboard run build` - passed after host/escalated
  rerun; the sandboxed build failed with Turbopack process/bind `EPERM`
- `pnpm --filter @swarmx/api exec tsx scripts/video-regression-check.ts` -
  passed
- `pnpm --filter @swarmx/api exec tsx scripts/reasoning-sanitizer-regression.ts`
  - passed
- `git diff --check` - passed
- `grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes`
  - zero hits
- Source-aware `-scar` scan excluding generated `.next`, `__pycache__`, and
  egg-info artifacts - zero hits
- Follow-up focused tests after the audit fixes:
  - `pnpm --filter @swarmx/api exec vitest run __tests__/backend-fetch-errors.test.ts`
    - passed, 5 tests
  - `pnpm --filter @swarmx/dashboard exec vitest run __tests__/lib/runtime-guidance.test.ts __tests__/lib/video-dashboard.test.ts`
    - passed

## Notes

- `operator-map.ts` taxonomy was not edited, so the Python mirror invariant was
  not triggered in this pass.
- The broad generated-artifact `-scar` grep can be polluted by dashboard
  `.next` output after a successful build. Use a source-aware scan for the
  invariant or remove generated artifacts before running the broad form.
- The full dead-letter dashboard view remains explicitly out of scope for this
  stabilization pass.
