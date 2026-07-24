---
name: project_v6255
description: V6.2.55 session - M13 golden-path re-cert code prep, intent_classification timeout 240s, live-cert harness, improved v3 artifact regenerated, doctor 6/6 green
metadata:
  type: project
---

## Shipped - V6.2.55

### Code changes (M13 preparation)

**Files**
- `apps/swarmx-api/src/services/video-runtime-config.ts` — `intent_classification`
  default timeout raised from 120,000 ms to 240,000 ms. Cold Q8 Pilot load on
  CPU (30–60 s) plus inference (10–30 s) was leaving under 30 s of slack in
  the previous 120 s window — the exact margin where prior `m9-golden-path-*`
  attempts timed out. Bound ceiling (600 s) and env override
  `VIDEO_INTENT_CLASSIFY_TIMEOUT_MS` unchanged.
- `apps/swarmx-api/__tests__/video-runtime-config.test.ts` — updated assertion
  to reflect the new 240,000 ms default.
- `apps/swarmx-api/scripts/m13-live-cert.ts` — new HTTP-only certification
  harness. Submits a real `kinetic_text` video job through the running API,
  polls every 10 s until terminal (30-min timeout), then asserts:
    1. `stageValidationTrace.length >= 3`
    2. `Object.keys(modelsUsed).length >= 4`
    3. `certificationTier >= PRODUCTION_PACK_VALID` (rank check without
       importing renderer-certification)
    4. `renderPackage.qualityReport` present
    5. `/api/system/health` returns `voice.benchmark.recommendedProviderId`
       and `runtimeProfile.id` (checked pre- and post-completion)
  Writes `m13-cert-report.json` to `.swarmx/video/artifacts/m13/`. Exits 0 on
  full pass, 1 on any assertion failure. Env: `SWARMX_API_BASE_URL` (default
  `http://localhost:3000`), `SWARMX_VIDEO_API_TOKEN` (required).
- `apps/swarmx-api/package.json` — `"test:m13": "node --import tsx scripts/m13-live-cert.ts"`.

### Artifact regenerated

**File**
- `apps/swarmx-api/scripts/render-golden-path.ts` — re-run with the current
  layered background system.

The v3 golden render is now:
- Path: `.swarmx/video/artifacts/golden-path/exports/video_first-video-v3.mp4`
- Package: `.swarmx/video/artifacts/golden-path/packages/first-video-v3/`
- 720 × 1280 H.264 @ 30 fps, 18.00 s, 393.2 KB; AAC 48 kHz stereo
- Renderer tier: `ffmpeg_kinetic_text`
- Certification tier: `PRODUCTION_PACK_VALID`
- Voice provider: `kokoro`, quality tier `neural_local`
- Full production package: `render-manifest.json`, `rights-manifest.json`,
  `rights-provenance.json`, `quality-report.json`, `technical-creative-qc.json`,
  `template-lineage.json`, `voice-lineage.json`, `platform-manifest.json`,
  `platform-package.json`, `captions.srt`, `captions.vtt`, `narration.wav`,
  `transcript.txt`, `thumbnail.jpg`.

## Runtime Evidence

- Host: bare-metal Linux, 4 cores, 15 GiB RAM
- MemAvailable at doctor time: 6984 MB (above `FULL_PIPELINE_MIN_AVAILABLE_MB` = 6170)
- Redis: `PONG` outside sandbox
- Ollama: reachable at `127.0.0.1:11434`, 0 loaded models
- Kokoro HTTP: `status: ok` at `127.0.0.1:8888`, 6 voices
- Voice benchmark: fresh (0h old), recommended `kokoro` (RTF 0.83)
- Doctor CLI: all 6 checks pass (env, redis, ollama, ram, voice-binaries, voice-benchmark)

## Quality Gates

- `pnpm --filter @swarmx/api run typecheck` — passed
- `pnpm --filter @swarmx/types run typecheck` — passed
- `pnpm --filter @swarmx/dashboard run typecheck` — passed
- `env SWARMX_HOME=/tmp/swarmxq-api-test-home pnpm --filter @swarmx/api run test` — 338 passed (21 files)
- `pnpm --filter @swarmx/dashboard run test` — 52 passed (4 files)
- `env SWARMX_HOME=/tmp/swarmxq-regression-home pnpm --filter @swarmx/api run test:regression` — passed
- `pnpm --filter @swarmx/dashboard run build` — passed (14 routes)
- `pnpm --filter @swarmx/api exec tsx scripts/render-golden-path.ts` — passed, `PRODUCTION_PACK_VALID`
- `SWARMX_VOICE_BENCHMARK_FILE=/tmp/swarmxq-voice-benchmark.json pnpm --filter @swarmx/api exec tsx scripts/doctor.ts` — 6/6 checks pass
- `ffprobe -v quiet -show_streams .swarmx/video/artifacts/golden-path/exports/video_first-video-v3.mp4` — H.264 720×1280 30fps + AAC 48kHz stereo, 18.00 s
- `git diff --check` — passed
- `grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes` — zero hits

## Remaining Work — M13 completion

The M13 spec ("Golden-Path Re-Cert") requires **stageValidationTrace populated**
from a live orchestrator run. That still requires:

1. Start the API server: `pnpm --filter @swarmx/api dev` (needs `SWARMX_VIDEO_API_TOKEN`)
2. Ensure Ollama has bandwidth for a cold Pilot load (`instruct-phi4-pro-q8-prod`)
3. Run: `SWARMX_VIDEO_API_TOKEN=<token> pnpm --filter @swarmx/api run test:m13`
4. On pass: `m13-cert-report.json` at `.swarmx/video/artifacts/m13/` shows all
   assertions passing. Copy to session evidence and mark M13 closed.

The harness itself is production-ready. Live execution is a runtime action,
not a code change — deferred to the next session with the API server running.

## Next milestone queue

- **M13** — awaiting live run of `test:m13` with API server up
- **M14** — S2: Template Family Expansion (+8 templates)
- **M15** — Ollama JSON-mode Migration (benchmark first)
- **M16** — S3: Preview Pipeline (proxy renders)
- **M17** — S4: Openverse Adapter (ADR required first)
