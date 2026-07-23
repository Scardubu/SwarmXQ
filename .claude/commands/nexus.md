# /nexus — SwarmXQ Task Orchestration Command

Routes every task through NEXUS — the 38-skill orchestration engine. Enters
Principal Engineer mode and produces a full Skill Trace Block before any code
is written.

**Use this command for:**
- Any task where you are unsure which skill graph applies
- Multi-domain tasks crossing pipeline, model, creative, and frontend concerns
- Architecture decisions requiring conflict resolution across the skill priority hierarchy
- Code review of unknown files (NEXUS identifies the domain from file paths / content)

---

## Auto-loaded skill graph

```
Required (always):
  NEXUS.md                           ← task classification, skill selection, ordering

Conditional (NEXUS selects these based on task signals):
  swarmxq-video-pipeline-architect   ← video stage, orchestrator, render backend
  swarmxq-model-orchestrator         ← SINGLE-7B LOCK, model tags, RAM pressure
  swarmxq-creative-director          ← script quality, virality, captions, TONE_RULES
  swarmxq-startup-ops-architect      ← startup-enhanced.sh, Ollama CPU perf, warmup
  swarmxq-ci-release-architect       ← CI gates, GitHub Actions, CHANGELOG
  [+ up to 33 additional domain skills from the registry]
```

---

## Output protocol

Every /nexus response begins with:

```
┌─ NEXUS ─────────────────────────────────────────────────────┐
│ Task:      [one-line intent classification]                 │
│ Skills:    skill-a → skill-b → skill-c                      │
│ Order:     1. skill-a  2. skill-b  3. skill-c               │
│ Overrides: [conflict resolutions applied, or NONE]          │
│ Risk:      [critical risks identified, or NONE]             │
│ Files:     [key files to read before acting, or NONE]       │
└─────────────────────────────────────────────────────────────┘
```

Then:
1. **Files read** — which files were examined before acting
2. **Invariants verified** — pipeline, model, creative, and startup invariants checked
3. **Skill outputs** — each skill's findings, in resolution order
4. **Implementation** — complete, production-ready, not scaffolded
5. **Risk notes** — what can regress and the exact command to detect it

---

## Quick routing reference (SwarmXQ domain)

| Signal in task | Primary skill routed |
|---|---|
| "video stage", "orchestrator", "render backend" | `swarmxq-video-pipeline-architect` |
| "SINGLE-7B", "acquireModel", "evictIncompatible" | `swarmxq-model-orchestrator` |
| "[HOOK]", "TONE_RULES", "virality", "caption" | `swarmxq-creative-director` |
| "startup-enhanced.sh", "OLLAMA_NUM_PARALLEL", "warmup" | `swarmxq-startup-ops-architect` |
| "GitHub Actions", "ci.yml", "CHANGELOG", "quality gate" | `swarmxq-ci-release-architect` |
| "BullMQ", "Worker", "Redis fallback" | `bullmq-job-architect` |
| "SSE", "subscribeToJob", "video:progress" | `real-time-systems-architect` |
| "agent", "evolver", "tournament", "IEP-ELITE" | `multi-agent-orchestration-architect` |
