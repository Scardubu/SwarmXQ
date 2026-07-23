# /video — SwarmXQ Video Pipeline Command

Deep-dive into the SwarmXQ 6-stage video generation pipeline. Loads the full
video pipeline skill graph and enters Principal Engineer mode for the video subsystem.

**Use this command for any task involving:**
- Video stage contracts, orchestrator logic, or stage invariants
- Script quality ([HOOK]/[BODY]/[RESOLUTION]/[CTA]), TONE_RULES, HOOK_BLOCKLIST
- FFmpeg or ComfyUI render backend
- Virality scoring or caption generation
- BullMQ video job persistence or queue state machine
- SSE progress events and reconnection handling
- `faceless_broll` or `kinetic_text` tone variants
- Storyboard scene count validation and comfyPrompt quality

---

## Auto-loaded skill graph

```
Required (always):
  swarmxq-video-pipeline-architect   ← stage contracts, render backend, pipeline invariants
  swarmxq-model-orchestrator         ← model acquisition, SINGLE-7B LOCK, RAM pressure
  swarmxq-creative-director          ← script quality, virality rubric, tone system, caption rules

Conditional (loaded based on task signals):
  swarmxq-startup-ops-architect      ← if startup sequence or Ollama CPU vars in scope
  real-time-systems-architect        ← if SSE / video:progress events in scope
  bullmq-job-architect               ← if BullMQ / job persistence in scope
  prompt-engineering-architect       ← if script / storyboard prompts need deep improvement
  testing-strategy-architect         ← if regression scripts or unit tests in scope
  backend-systems-auditor            ← if production readiness of orchestrator in scope
  opentelemetry-observability-architect ← if stage span instrumentation in scope
```

---

## Session opening protocol

Before writing any code, answer these:

```bash
# Read the full orchestrator — never assume state
cat apps/swarmx-api/src/services/video-orchestrator.ts
cat apps/swarmx-api/src/services/video-queue.ts
cat apps/swarmx-api/src/services/video-runtime-config.ts

# Check creative quality constants
grep -n 'TONE_RULES\|HOOK_BLOCKLIST\|CAPTION_RULES\|VIRALITY_SCORE_RUBRIC' \
  apps/swarmx-api/src/services/video-orchestrator.ts \
  apps/swarmx-api/src/services/virality-scorer.ts \
  apps/swarmx-api/src/services/caption-generator.ts

# Check RAM headroom
awk '/MemAvailable/ {printf "MemAvailable: %d MB\n", $2/1024}' /proc/meminfo

# Check Ollama CPU performance vars (skip gracefully if Ollama is offline)
echo "OLLAMA_NUM_PARALLEL=${OLLAMA_NUM_PARALLEL:-UNSET} (must be 1)"
echo "OLLAMA_FLASH_ATTENTION=${OLLAMA_FLASH_ATTENTION:-UNSET} (must be 1)"
echo "OLLAMA_KV_CACHE_TYPE=${OLLAMA_KV_CACHE_TYPE:-UNSET} (must be q8_0)"
ollama ps 2>/dev/null || echo "[OFFLINE] Ollama not running — regression scripts can still run"

# Check warmup status
cat /tmp/swarmxq-warmup.json 2>/dev/null || echo "[COLD] startup-enhanced.sh not run — ETA: 140s"
```

Then answer:
1. What is the current state of the video orchestrator? (VOT-09 through VOT-13 verified?)
2. Is BullMQ enabled (`SWARMX_VIDEO_USE_BULLMQ=1`)?
3. Does `TONE_RULES` cover all variants in `VideoJobRequest.tone` union? (check for `faceless_broll`, `kinetic_text`)
4. Which milestone from the queue is this task tied to?
5. Are all 5 regression scripts currently passing?

---

## Pipeline quick reference

```
intent_classification → planning → scripting → storyboard_generation → render_assembly → finalizing
       [0–15%]            [15–30%]   [30–50%]         [50–75%]              [75–95%]         [95–100%]

Post-pipeline (non-blocking): stageViralityAndCaption()
```

**Stage invariants checklist** (verify for every file touched):
- [ ] `ctx.modelsUsed[stage]` set inside stage fn immediately after `acquireModel()`
- [ ] `AbortController` via `stageController()` with `{ once: true }` listeners
- [ ] Every Ollama response wrapped in `sanitizeReasoningOutput()` before parsing
- [ ] `COMFY_POLL_MAX_ATTEMPTS` derived from `STAGE_TIMEOUT_MS["render_assembly"]`, not hardcoded
- [ ] `ModelOrchestrator.unloadModel()` loop called before every FFmpeg render
- [ ] `console.*` → zero hits in `src/services/` and `src/routes/`

---

## Creative quality quick reference

| Section | Rule |
|---|---|
| `[HOOK]` | ≤18 words; no preamble; opens with tension, stakes, or surprising claim; checked against `HOOK_BLOCKLIST` |
| `[BODY]` | Each sentence increases stakes; `[VISUAL: subject + motion + setting + mood]` after visual moments |
| `[RESOLUTION]` | 1–2 actionable sentences; never a summary |
| `[CTA]` | 5–8 words; specific; not "like and subscribe" |

**TONE_RULES completeness** — `TONE_RULES` in `video-orchestrator.ts` must contain ALL of:
`contrarian`, `urgent`, `educational`, `cinematic`, `warm`, `minimal`, `faceless_broll`, `kinetic_text`

Virality formula: `hookStrength×0.35 + completionProxy×0.25 + shareability×0.25 + seoScore×0.15`

Caption rules: `firstLine` ≤40 chars; no I/My/This/We/Our opener; 3–5 hashtags; ≤3 emojis;
`soundSuggestion` no URLs or artist attribution.

---

## Storyboard quick reference

| Length | Duration | Min scenes | Max scenes |
|---|---|---|---|
| `short` | ≤45 s | 5 | 7 |
| `medium` | 46–120 s | 6 | 10 |
| `long` | 121–600 s | 11 | 18 |

Scene line format: `[Scene N] <visual description> | <motion descriptor> | <pacing note>`
`comfyPrompt` must include: resolution (`720p`/`480p`), aspect (`9:16`/`16:9`), style keyword, specific subject.

---

## Output format

Every response opens with the Skill Trace Block, then:

1. **Files read** — exact files examined before acting
2. **Invariants verified** — which pipeline and creative invariants were checked
3. **Changes made** — surgical, justified, line-by-line rationale
4. **Gate commands to run** — exact commands to verify this change
5. **Risk notes** — what can regress and how to detect it
