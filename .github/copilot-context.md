# SwarmXQ Copilot Context — V6.2.22
# Location: .github/copilot-context.md
# Purpose: Quick-reference for Copilot Chat; loaded via @workspace or #file
# Usage: Reference in Copilot Chat with: @workspace #file:.github/copilot-context.md

---

## HOW TO USE THIS FILE IN COPILOT CHAT

```
# Load project context + specific skill:
@workspace #file:.github/copilot-context.md #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md

# Ask a domain-specific question with authoritative constraints loaded:
@workspace #file:.ai/skills/swarmxq-model-orchestrator/SKILL.md
How should I implement acquireModel() for the scripting stage?

# Cross-domain question (load multiple skills):
@workspace #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md #file:.ai/skills/swarmxq-creative-director/SKILL.md
How do I wire TONE_RULES into the scripting stage prompt?
```

---

## TASK → SKILL MAPPING (Quick Look-Up)

| Task | Load this skill | Load alongside |
|---|---|---|
| Video pipeline code | `swarmxq-video-pipeline-architect` | `swarmxq-model-orchestrator` + `swarmxq-creative-director` |
| Model tag, eviction, keep-alive | `swarmxq-model-orchestrator` | `swarmxq-startup-ops-architect` |
| Script quality, TONE_RULES, virality | `swarmxq-creative-director` | `swarmxq-video-pipeline-architect` |
| startup-enhanced.sh, Ollama perf | `swarmxq-startup-ops-architect` | `swarmxq-model-orchestrator` |
| GitHub Actions CI | `swarmxq-ci-release-architect` | `git-workflow-architect` |
| BullMQ, Worker separation | `bullmq-job-architect` | `backend-systems-auditor` |
| SSE events, subscribeToJob | `real-time-systems-architect` | `bullmq-job-architect` |
| env.ts Zod schema changes | `typescript-config-surgeon` | `backend-systems-auditor` |
| Dashboard React components | `component-quality-gate` | `frontend-product-design-architect` |
| Framer Motion, animations | `motion-performance-architect` | `motion-interaction-architect` |
| OpenTelemetry spans | `opentelemetry-observability-architect` | `backend-systems-auditor` |
| Accessibility, WCAG | `accessibility-system-architect` | `component-quality-gate` |
| Python brain (src/swarmx/) | `multi-agent-orchestration-architect` | `prompt-engineering-architect` |
| Security, rate limiting | `security-hardening-auditor` | `backend-systems-auditor` |
| Prisma schema | `prisma-database-architect` | — |
| Design tokens, palette | `design-token-system-architect` | — |
| New SKILL.md generation | `elite-skill-forge` | — |

---

## COPILOT CHAT PROMPT TEMPLATES

### Debug a service
```
@workspace #file:.github/copilot-instructions.md #file:apps/swarmx-api/src/services/[file].ts
The [function] is producing [symptom]. Walk through what could cause this given SwarmXQ's
SINGLE-7B LOCK and the adaptive-timeout-config circuit breaker.
```

### Add a new feature
```
@workspace #file:.github/copilot-instructions.md #file:NEXUS.md
I need to add [feature]. Which skills govern this domain and what invariants apply?
```

### Review generated code for invariants
```
@workspace #file:.github/copilot-instructions.md
Review this code for SwarmXQ invariants: console.* usage, resolveCanonicalTag() calls,
sanitizeReasoningOutput() coverage, env.ts schema compliance.
[paste code]
```

### Video pipeline stage addition
```
@workspace #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md
  #file:.ai/skills/swarmxq-model-orchestrator/SKILL.md
  #file:apps/swarmx-api/src/services/video-orchestrator.ts
Add a [stage] to the video pipeline. Must preserve stage order, modelsUsed recording
pattern, AbortController { once: true }, and sanitizeReasoningOutput() wrapping.
```

### Fix a model tag
```
@workspace #file:.ai/skills/swarmxq-model-orchestrator/SKILL.md
  #file:packages/swarmx-types/src/operator-map.ts
Replace all legacy -scar tags in this file with APEX-17 r8 canonical tags via
resolveCanonicalTag():
[paste file]
```

---

## INVARIANT QUICK-CHECK COMMANDS

Paste these in a terminal before committing:

```bash
# Zero console.* in services/routes
grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes

# No legacy -scar tags in TypeScript
grep -rn '\-scar' apps/swarmx-api/src/ packages/

# No V5 operator names
grep -rn 'SENTINEL\|CANVAS\|LEDGER\|PROPHET\|EVOLVER' apps/ packages/ src/

# resolveCanonicalTag called before tag enters registry
grep -rn 'MODEL_OPERATOR_MAP\[' apps/swarmx-api/src/services/ | grep -v 'resolveCanonicalTag'

# No hardcoded COMFY_POLL_MAX_ATTEMPTS
grep -rn 'COMFY_POLL_MAX_ATTEMPTS\s*=' apps/swarmx-api/src/ | grep -v 'Math.floor'

# TONE_RULES completeness (all 8 variants)
grep -A 40 'TONE_RULES' apps/swarmx-api/src/services/video-orchestrator.ts | \
  grep -E "contrarian|urgent|educational|cinematic|warm|minimal|faceless_broll|kinetic_text"

# Warmup status (are Ollama CPU perf vars set?)
echo "NUM_PARALLEL=${OLLAMA_NUM_PARALLEL:-UNSET} | FLASH=${OLLAMA_FLASH_ATTENTION:-UNSET} | KV=${OLLAMA_KV_CACHE_TYPE:-UNSET} | THREADS=${OLLAMA_NUM_THREADS:-UNSET}"
cat /tmp/swarmxq-warmup.json 2>/dev/null || echo "[COLD] startup-enhanced.sh not run"
```

---

## CRITICAL NUMBERS (Reference)

| Constant | Value | File |
|---|---|---|
| `RAM_CRITICAL_MB` | 800 | model-orchestrator.ts |
| `MAX_CONCURRENT_JOBS` | 1 | video-queue.ts |
| `FULL_PIPELINE_MIN_AVAILABLE_MB` | 6170 | video-runtime-config.ts |
| `OLLAMA_MAX_LOADED_MODELS` | 2 | env / startup-enhanced.sh |
| `OLLAMA_NUM_THREADS` | 3 (WSL2) | startup-enhanced.sh |
| Dashboard cold ETA (cold) | 140s | /api/system/health |
| Dashboard cold ETA (warm) | 45s | /api/system/health |
| Virality minimum to ship | 0.55 | virality-scorer.ts |
| Virality target | 0.70 | virality-scorer.ts |
| TikTok caption hard cap | 2200 chars | caption-generator.ts |
| [HOOK] max words | 18 | video-orchestrator.ts |
| [CTA] word range | 5–8 | video-orchestrator.ts |
| Tone variants required | 8 | video-orchestrator.ts |

---

## ACTIVE MILESTONE QUEUE

| Priority | Milestone | Status |
|---|---|---|
| 1 | BullMQ Default-On (`SWARMX_VIDEO_USE_BULLMQ=1`) | Pending |
| 2 | GitHub Actions CI (`.github/workflows/ci.yml`) | Pending |
| 3 | Env Schema Expansion (env.ts Zod migration) | Pending |
| 4 | First API Unit Tests (vitest in swarmx-api) | Pending |
| 5 | 16 GB Profile Config (startup-enhanced.sh) | Pending |
| 6 | TONE_RULES Completeness Audit | Pending |
