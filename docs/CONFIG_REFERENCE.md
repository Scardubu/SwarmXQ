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

## Ollama And Low-RAM Runtime

Set these before starting Ollama or the SwarmX stack on an 8 GB CPU-only host:

| Variable | Default | Notes |
| --- | --- | --- |
| `OLLAMA_MAX_LOADED_MODELS` | `1` | Required single-model residency. Do not raise this on the 8 GB profile. |
| `OLLAMA_NUM_PARALLEL` | `1` | One inference slot prevents duplicate heavyweight loads. |
| `OLLAMA_KEEP_ALIVE` | `0` | Global keep-alive disabled; SwarmX sends request-level `keep_alive`. |
| `SWARMX_MODEL_STARTUP_PREWARM` | `0` | Set `1` to explicitly prewarm Relay during API startup. |
| `SWARMX_MODEL_PREDICTIVE_PREWARM` | `0` | Set `1` to explicitly allow speculative specialist prewarm after routing. |
| `SWARMX_OLLAMA_URL` | `http://127.0.0.1:11434` | Canonical Ollama API URL for SwarmX. |
| `SWARMX_OLLAMA_PROBE_TIMEOUT_MS` | `5000` | General `/api/version` probe budget for startup and discovery paths. |
| `SWARMX_SYSTEM_HEALTH_PROBE_TIMEOUT_MS` | `1500` | Liveness budget for `/api/system/health`; bounded to 250–10000 ms. When liveness fails, the route returns degraded health without model discovery. |
| `SWARMX_SYSTEM_HEALTH_MODEL_PROBE_TIMEOUT_MS` | `2500` | Readiness budget for model listing after liveness succeeds; bounded to 250–10000 ms. |

ZRAM is compressed swap capacity, not free physical RAM. Runtime pressure
decisions use physical `MemAvailable` and report ZRAM separately.

## Video

| Variable | Default | Notes |
| --- | --- | --- |
| `SWARMX_VIDEO_ARTIFACT_DIR` | `.swarmx/video-output` | Job manifests and metadata. |
| `SWARMX_VIDEO_EXPORT_DIR` | `.swarmx/video-export` | Final rendered files. |
| `SWARMX_VIDEO_TEMP_DIR` | `.swarmx/video-temp` | Deterministic render scratch directory. |
| `SWARMX_VIDEO_FFMPEG_TIMEOUT_MS` | `120000` | Local render command timeout, bounded by code. |
| `SWARMX_VIDEO_FFPROBE_TIMEOUT_MS` | `30000` | Probe timeout for artifact validation. |
| `SWARMX_VIDEO_ALLOW_SILENT_AUDIO` | unset | Set `1` only to allow silent renders when `espeak-ng` is unavailable. |
| `SWARMX_VIDEO_API_TOKEN` | unset | Optional bearer/API-key token for video write routes. |

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
