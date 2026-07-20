# Creative Factory Release Status

Date: 2026-07-20
Certification level: `CODE_VALIDATED` target in progress

## Implemented In This Baseline

- Server-only dashboard API proxy for `/api/*` requests.
- Removal of browser-visible video write token use.
- Durable local snapshots and append-only lifecycle journals for video jobs, series, and Creative Factory workflow runs.
- API startup hydration for durable registries.
- Shared Creative Factory contracts for execution modes, hardware profiles, capabilities, BrandKit, audience, platform capability, asset rights/lineage, render recipes, subtitles, quality/compliance reports, publish packages, analytics, experiments, and learning records.
- Executable Creative Factory workflow DAG definitions and checkpoint service.
- Series Engine quality gate false-success fix.
- Typed episode pre-production failure codes, including `QUALITY_GATE_FAILED`
  for mandatory creative/technical gate failures.
- Source-aware Creative Factory release invariant script wired into API regression and CI gates.
- Docker Compose Ollama defaults aligned with the verified CPU-safe startup profile.

## Validation Executed On 2026-07-20

- `pnpm --filter @swarmx/types typecheck` passed.
- `pnpm --filter @swarmx/api typecheck` passed.
- `pnpm --filter @swarmx/dashboard typecheck` passed.
- `pnpm --filter @swarmx/api test` passed: 156 tests.
- `pnpm --filter @swarmx/dashboard test` passed: 52 tests.
- `pnpm --filter @swarmx/api build` passed.
- `pnpm --filter @swarmx/dashboard build` passed.
- `pnpm --filter @swarmx/api run test:regression` passed outside the sandbox.
- `pnpm --filter @swarmx/api run test:video` passed outside the sandbox.
- `pnpm --filter @swarmx/api run test:factory` passed outside the sandbox.
- `pnpm --filter @swarmx/api run test:video:smoke` passed outside the sandbox and generated a 204,377-byte MP4.
- `.venv/bin/python -m pytest` passed: 236 tests.
- `.venv/bin/python -m ruff check tests/test_startup.py` passed.
- `git diff --check` passed.
- `command -v ffmpeg`, `command -v ffprobe`, and `command -v espeak-ng` passed.

## Required Before `LOCAL_PRODUCTION_VALIDATED`

- Run native API and dashboard servers.
- Execute constrained narrator-only golden path through the live API workflow.
- Verify live workflow output MP4 with FFprobe and generated manifest hash.
- Restart API/dashboard and verify job, series, and workflow state recovery from `SWARMX_HOME/state`.
- Confirm dashboard write actions work through the server proxy and fail closed when tokens are absent in production.

## Required Before `CONTAINER_VALIDATED`

- Install or provide Docker on the validation host.
- Sudo is currently non-interactive and password-gated, so automated Docker
  installation did not run.
- Run `docker compose config`.
- Build `Dockerfile.python`, `apps/swarmx-api/Dockerfile`, and `apps/swarmx-dashboard/Dockerfile`.
- Run Compose startup smoke and recovery checks.

## Required Before `PUBLISHING_VALIDATED`

- Configure platform credentials server-side only.
- Verify platform capability records.
- Obtain explicit approval for a draft/direct publishing attempt.
- Record remote processing state before claiming publishing success.
