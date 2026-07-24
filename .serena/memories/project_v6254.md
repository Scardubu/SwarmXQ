---
name: project_v6254
description: V6.2.54 session - M9 runtime readiness quick wins, schema-backed artifact config, canonical system-health diagnostics, improved kinetic golden render
metadata:
  type: project
---

## Shipped - V6.2.54

### Integration 1 - Canonical system-health model diagnostics

**Files**
- `apps/swarmx-api/src/routes/system.ts`
- `apps/swarmx-api/scripts/system-health-regression.ts`

`/api/system/health` now reports canonical model tags in both the `models[]`
readiness triad and the `config` block. Legacy aliases such as `phi4-fast`,
`deepseek-reasoner`, and `qwen-worker` are resolved before reaching diagnostics.

### Integration 2 - Schema-backed artifact storage config

**Files**
- `apps/swarmx-api/src/lib/env.ts`
- `apps/swarmx-api/src/services/video-assets.ts`
- `apps/swarmx-api/scripts/video-regression-check.ts`
- `docs/CONFIG_REFERENCE.md`
- `docs/VIDEO-GENERATION.md`
- `docs/CHANGELOG.md`

Video artifact exports, artifact records, FFprobe timeout, and public URL base
now resolve through `loadEnv()` instead of service-level `process.env` constants.
Added canonical `SWARMX_VIDEO_PUBLIC_URL_BASE`, while preserving legacy
`VIDEO_PUBLIC_URL_BASE` and `VIDEO_OUTPUT_DIR` aliases through the env schema.

### Integration 3 - Video auth import-order hardening

**Files**
- `apps/swarmx-api/src/services/video-auth.ts`
- `apps/swarmx-api/scripts/video-regression-check.ts`

`SWARMX_VIDEO_API_TOKEN` remains an intentional direct secret escape hatch, but it
is now read at auth-check time instead of being cached at module import. Production
still fails closed when the token is absent.

### Integration 4 - Improved first golden video

**File**
- `apps/swarmx-api/scripts/render-golden-path.ts`

The golden render fixture now uses a structured `[HOOK] / [BODY] / [RESOLUTION] /
[CTA]` script and the `ffmpeg_kinetic_text` tier. The first frame now opens on:

`Motivation loses by Wednesday. A visible system keeps going.`

## Generated Artifact

- MP4: `.swarmx/video/artifacts/golden-path/exports/video_first-video-v2.mp4`
- Package: `.swarmx/video/artifacts/golden-path/packages/first-video-v2/`
- Summary: `.swarmx/video/artifacts/golden-path/golden-path-summary.json`
- Renderer tier: `ffmpeg_kinetic_text`
- Certification tier: `PRODUCTION_PACK_VALID`
- Voice provider: `kokoro`
- Voice quality tier: `neural_local`
- FFprobe: H.264 video, 720x1280, 30 fps, 18.0 s; AAC audio, 48 kHz stereo, 18.0 s
- Size: 390504 bytes
- Checksum: `5882d05138436041184b7050107c6722208c2efac68b5c28f6a9c401a2aac60e`

## Runtime Evidence

- Host: bare-metal Linux, 4 cores, 15 GiB RAM, MemAvailable about 6.5 GiB
- Redis: `PONG` outside sandbox
- Ollama: reachable at `127.0.0.1:11434`, 0 loaded models during doctor
- Kokoro: healthy at `127.0.0.1:8888`, 6 voices
- `/api/system/health`: `status: ok`, canonical config model tags, Kokoro recommended
- Doctor: all checks passed, voice benchmark fresh and recommends Kokoro

## Quality Gates

- `pnpm --filter @swarmx/api run typecheck` - passed
- `pnpm --filter @swarmx/types run typecheck` - passed
- `pnpm --filter @swarmx/dashboard run typecheck` - passed
- `env SWARMX_HOME=/tmp/swarmxq-api-test-home pnpm --filter @swarmx/api run test` - 338 passed
- `pnpm --filter @swarmx/dashboard run test` - 52 passed
- `env SWARMX_HOME=/tmp/swarmxq-regression-home pnpm --filter @swarmx/api run test:video` - passed; sandbox Redis socket emitted EPERM but script exited 0
- `env SWARMX_HOME=/tmp/swarmxq-regression-home pnpm --filter @swarmx/api run test:regression` - passed
- `pnpm --filter @swarmx/api run build` - passed
- `pnpm --filter @swarmx/dashboard run build` - passed outside sandbox after Turbopack EPERM in sandbox
- `pnpm --filter @swarmx/api exec tsx scripts/doctor.ts` - passed outside sandbox
- `pnpm --filter @swarmx/api exec tsx scripts/render-golden-path.ts` - passed
- `ffprobe -v quiet -print_format json -show_streams .swarmx/video/artifacts/golden-path/exports/video_first-video-v2.mp4` - passed
- `git diff --check` - passed
- `grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes` - zero hits
- `rg -n "const HOOK_BLOCKLIST" apps/swarmx-api/src` - single source at `src/lib/creative-quality.ts`

## Remaining Work

Full live six-stage API M9 re-certification is still not complete. Existing
`/api/video/jobs` state shows prior `m9-golden-path-*` attempts failed in
`intent_classification` from Ollama runner failure, timeout, or fetch failure.
The deterministic production-renderer artifact is valid, but it does not populate
`modelsUsed` or `stageValidationTrace` because it bypasses the live LLM stages.

Next runtime attempt should either:

1. restart/recover Ollama and submit a fresh timestamped `kinetic_text` job when
   MemAvailable is comfortably above 6170 MB, or
2. run a low-RAM full-pipeline attempt explicitly marked as constrained quality.
