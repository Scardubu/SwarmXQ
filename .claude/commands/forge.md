# /forge — SwarmXQ Skill Generation Command

Generates new, production-grade SKILL.md files from a domain description. Routes
exclusively to `elite-skill-forge` — the only skill that creates new skills.

**Use this command when:**
- A recurring workflow needs to be captured as a reusable Claude skill
- A new SwarmXQ subsystem emerges without an existing skill (e.g., a new render backend integration)
- You want to create a SwarmXQ-domain skill for a gap in the 38-skill registry

---

## Auto-loaded skill graph

```
Required (always):
  elite-skill-forge                  ← generates SKILL.md from domain description

Conditional:
  NEXUS.md                           ← to validate that the new skill fills a real gap
```

---

## SwarmXQ skill naming convention

New SwarmXQ platform skills follow this naming pattern:

```
swarmxq-<domain>-architect     ← for architectural/strategic skills
swarmxq-<domain>-director      ← for creative/quality-ownership skills
swarmxq-<domain>-auditor       ← for audit/invariant-enforcement skills
```

---

## Post-generation checklist

After `elite-skill-forge` produces a SKILL.md:

1. Verify the `name:` frontmatter matches the directory name
2. Verify the `description:` includes all trigger phrases that NEXUS needs
3. Add the skill to `CLAUDE.md` skill registry (update cluster count)
4. Add the skill to `NEXUS.md` routing table
5. Update the cluster count in both documents
6. If it's a SwarmXQ platform skill: add to NEXUS intent routing graphs

---

## Current skill gaps (as of V6.2.22)

| Gap | Candidate skill name | Priority |
|---|---|---|
| OpenTelemetry spans for video stage lifecycle | already covered by `opentelemetry-observability-architect` | N/A |
| BullMQ + video idempotency deep-dive | already covered by `bullmq-job-architect` | N/A |
| Platform publishing (TikTok, Instagram API) | `swarmxq-publisher-architect` | Low |
| ComfyUI LTX-Video workflow tuning | `swarmxq-comfyui-workflow-architect` | Medium — after Priority 5 |
