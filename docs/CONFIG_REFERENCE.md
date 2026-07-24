# Config reference

## Runtime

- `runtime.autonomous` — enables autonomous execution when allowed
- `runtime.review_required` — forces human review before risky actions
- `runtime.auto_apply` — allows low-risk evolution patches to be applied automatically
- `runtime.max_iterations` — upper bound on task refinement passes
- `runtime.checkpoint_every` — checkpoint cadence during execution

## Routing

- `routing.provider` — LLM backend selector
- `routing.model_fast` — lightweight routing / critique model
- `routing.model_code` — implementation-heavy model
- `routing.workflow_preference` — preferred workflow override
- `routing.framework_preference` — optional orchestration backends

## Ollama And Host Runtime Profiles

Set these before starting Ollama or the SwarmX stack. The startup script auto-detects `constrained_cpu_8gb` vs `standard_cpu_16gb` by total RAM, but you can pin the behavior explicitly. Legacy `8gb`, `16gb`, `constrained_cpu`, and `standard_cpu` values are accepted only as compatibility aliases.

| Variable | Default | Notes |
| --- | --- | --- |
| `SWARMX_HOST_PROFILE` | `auto` | Auto-detects `constrained_cpu_8gb` or `standard_cpu_16gb`; pin one explicitly when you need stable behavior across restarts. |
| `OLLAMA_MAX_LOADED_MODELS` | profile-managed | `1` on `constrained_cpu_8gb`; `2` only on `standard_cpu_16gb` when measured safe. Low free RAM forces constrained safeguards even on a 16 GB host. |
| `OLLAMA_NUM_PARALLEL` | `1` | One inference slot prevents duplicate heavyweight loads. |
| `OLLAMA_KEEP_ALIVE` | `0` | Global keep-alive stays off on CPU-only hosts; SwarmX still sends request-level `keep_alive` where safe. |
| `OLLAMA_FLASH_ATTENTION` | `0` | Conservative CPU default because Q8 Phi-4 flash-attention has shown host-specific instability. GPU operators may override after validation. |
| `OLLAMA_KV_CACHE_TYPE` | `f16` | Conservative CPU default paired with flash-attention off. |
| `SWARMX_MODEL_STARTUP_PREWARM` | profile-managed | Defaults `0` on `constrained_cpu_8gb`; standard prewarm is opt-in/profile-derived after measurement. |
| `SWARMX_MODEL_PREDICTIVE_PREWARM` | profile-managed | Defaults `0` on `constrained_cpu_8gb`; standard prewarm is opt-in/profile-derived after measurement. |
| `SWARMX_OLLAMA_URL` | `http://127.0.0.1:11434` | Canonical Ollama API URL for SwarmX. |
| `SWARMX_OLLAMA_PROBE_TIMEOUT_MS` | `5000` | General `/api/version` probe budget for startup and discovery paths. |
| `SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS` | `1500` | Liveness budget for `/api/system/health`; bounded to 250–10000 ms. When liveness fails, the route returns degraded health without model discovery. |
| `SWARMX_SYSTEM_HEALTH_MODEL_PROBE_TIMEOUT_MS` | `2500` | Readiness budget for model listing after liveness succeeds; bounded to 250–10000 ms. |

ZRAM is compressed swap capacity, not free physical RAM. Runtime pressure
decisions use physical `MemAvailable` and report ZRAM separately.

## Video

| Variable | Default | Notes |
| --- | --- | --- |
| `SWARMX_VIDEO_ARTIFACT_DIR` | `.swarmx/video/artifacts` | Job metadata, queue recovery data, and performance records. |
| `SWARMX_VIDEO_EXPORT_DIR` | `.swarmx/video/exports` | Final rendered files served by the API. Legacy `VIDEO_OUTPUT_DIR` is still accepted by the env schema. |
| `SWARMX_VIDEO_PUBLIC_URL_BASE` | `/api/video/files` | Public URL prefix embedded in final output metadata. Legacy `VIDEO_PUBLIC_URL_BASE` is still accepted by the env schema. |
| `SWARMX_VIDEO_TEMP_DIR` | `.swarmx/video/tmp` | Per-render FFmpeg workspaces, removed after each render. |
| `SWARMX_VIDEO_FFMPEG_TIMEOUT_MS` | `240000` | Local render command timeout, bounded to 30–900 seconds. |
| `SWARMX_VIDEO_FFPROBE_TIMEOUT_MS` | `15000` | Artifact validation timeout, bounded to 5–60 seconds. |
| `SWARMX_VIDEO_ALLOW_SILENT_AUDIO` | unset | Set `1` only for deliberate silent test renders when every configured VoiceProvider is unavailable; production runs fail instead of silently masking narration loss. |
| `SWARMX_TTS_PROVIDER` | `auto` | Server-side voice provider selection: `auto`, `kokoro`, `piper`, `espeak`, or `silent_fixture`. `silent_fixture` is for explicit tests only. |
| `SWARMX_TTS_URL` | `http://127.0.0.1:8888` | Kokoro TTS microservice URL. The provider is installed in the app; the host still must have the optional Python `tts` extra installed and the service running. |
| `SWARMX_TTS_PIPER_MODEL_PATH` | unset | Piper voice model path. Piper reports degraded/unavailable when the binary or model path is missing. |
| `SWARMX_AUDIO_TARGET_LUFS` | `-16` | Local mastering loudness target for rendered short-form narration packages. |
| `SWARMX_AUDIO_TRUE_PEAK_MAX_DBFS` | `-1.5` | Local mastering true-peak cap. |
| `SWARMX_VIDEO_ALLOW_UNSTRUCTURED_INTENT` | unset | Set `1` only to continue when intent classification is not valid structured output. |
| `SWARMX_VIDEO_LOW_RAM_MODE` | unset | Set `1` to force all video text stages through the 2.5 GB Pilot-lite profile; requires at least 3300 MB available RAM. |
| `SWARMX_VIDEO_API_TOKEN` | unset | Server-only bearer/API-key token for video and series write routes. Production writes fail closed when unset. Never expose through `NEXT_PUBLIC_*`. |
| `SWARMX_VIDEO_JOB_LIMIT_PER_HOUR` | `10` | Max video job submissions per connection per hour (sliding window). Returns 429 when exceeded. |
| `SWARMX_VIDEO_QUEUE_MAX_SIZE` | `20` | Max queued or running video jobs accepted by the local registry. |
| `SWARMX_VIDEO_QUEUE_NAME` | `swarmx-video` | BullMQ queue name when Redis-backed video jobs are enabled. |
| `SWARMX_VIDEO_MAX_RETRIES` | `1` | Retry count for retryable video job failures. Legacy `VIDEO_MAX_RETRIES` is still accepted by the env schema. |
| `SWARMX_VIDEO_JOB_TTL_MS` | `14400000` | Terminal job retention window before in-memory cleanup. Legacy `VIDEO_JOB_TTL_MS` is still accepted by the env schema. |
| `SWARMX_VIDEO_MAX_CONCURRENT_JOBS` | `1` | Configuration visibility for concurrency requests. The SINGLE-VIDEO LOCK still enforces one active video job on CPU-only hosts. Legacy `VIDEO_MAX_CONCURRENT_JOBS` is still accepted by the env schema. |
| `SWARMX_VIDEO_EXPORT_TTL_DAYS` | `7` | Days after which rendered exports and artifacts are eligible for cleanup. Minimum 1. |
| `SWARMX_VIDEO_CLEANUP_INTERVAL_MS` | `21600000` | How often the cleanup service scans for stale exports (ms). Minimum 60000. First run fires 30 s after startup. |

**Stage timeouts** — since V6.2.15 the defaults are CPU-safe (they cover both cold-load latency on GPU and warm 3.8B Q4_K_M inference on CPU), so most operators do not need to override anything. Bounds still allow tightening for latency-sensitive GPU hosts or raising for very slow CPUs.

| Variable | V6.2.15 default | Ceiling (max) | Floor (min) |
| --- | --- | --- | --- |
| `VIDEO_INTENT_CLASSIFY_TIMEOUT_MS` | `120000` | `600000` | `1000` |
| `VIDEO_PLANNING_TIMEOUT_MS` | `300000` | `900000` | `5000` |
| `VIDEO_SCRIPTING_TIMEOUT_MS` | `600000` | `1800000` | `10000` |
| `VIDEO_STORYBOARD_TIMEOUT_MS` | `600000` | `1200000` | `10000` |
| `VIDEO_RENDER_TIMEOUT_MS` | `1800000` | `7200000` | `30000` |
| `VIDEO_FINALIZING_TIMEOUT_MS` | `120000` | `600000` | `5000` |

**LOW_RAM_MODE auto-detection (V6.2.15)** — `SWARMX_VIDEO_LOW_RAM_MODE` is auto-enabled at API startup when `MemAvailable < 6170 MB` and the operator has not set an explicit value. Explicit `SWARMX_VIDEO_LOW_RAM_MODE=1` or `=0` always wins. When auto-enabled, the API also fires a fire-and-forget prewarm of `instruct-phi4-lite-q4km-prod` so the first user submission finds a warm model. A one-line startup log summarises the resolved mode: `{ lowRamMode, availableMb, videoModel }`.

For persistent per-host overrides, use `apps/swarmx-api/.env.local` (gitignored).

Required local binaries for production local renders:

```bash
command -v ffmpeg
command -v ffprobe
command -v espeak-ng
```

A job is not marked completed until the final artifact exists, is non-empty,
and passes FFprobe metadata validation.

## Evolution

- `evolution.proposal_only_by_default` — proposals are stored before application
- `evolution.auto_apply_low_risk` — only low-risk items may be auto-applied
- `evolution.budget.proposals_per_run` — number of proposals returned per evolution pass
- `evolution.budget.refinement_passes` — bounded evaluator passes

## Safety

- `safety.approval_required_for` — risk levels that must stay gated
- `safety.strict_review_targets` — target classes that require caution
- `safety.allow_destructive_actions` — should remain false in normal operation
