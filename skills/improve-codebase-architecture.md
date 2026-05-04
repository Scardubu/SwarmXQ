# improve-codebase-architecture

Identify the highest-leverage architectural improvements in a codebase and produce ranked, actionable proposals — not rewrites.

- Triggers: improve architecture, architecture review, codebase health, refactor architecture, tech debt, structural improvement, boundary violations, coupling, cohesion
- Stack: generic
- Owner: engineering
- Weight: 5

## SwarmX Integration
- Policy check: `assess_action("architecture-review", target)` — typically MEDIUM risk.
- Audit log: emit `ARCH_REVIEW_START` / `ARCH_REVIEW_PROPOSALS` with proposal IDs.
- Memory: store confirmed architectural patterns and anti-patterns as memory-graph entries.
- Evolution hook: all HIGH/TRANSFORMATIVE proposals become `evolution_proposals` for the evolution loop.
- Primitive refs: `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`, `{{evolution_proposal}}`

## When to activate
- Mission includes "architecture", "structure", "coupling", "refactor", or "tech debt".
- Codebase has grown and boundaries have drifted from original intent.
- Performance, testability, or onboarding is degrading due to structural issues.
- Pre-release or pre-migration architecture health check is needed.

## Execution protocol

### Phase 1 — Structural survey
1. Map the **module/service/domain boundary graph**: what calls what, who owns what.
2. Identify **coupling hotspots**: modules with the most inbound/outbound dependencies.
3. Identify **cohesion gaps**: modules that do multiple unrelated things.
4. Note **boundary violations**: where implementation leaks across domain lines.
5. Flag **absent abstractions**: repeated patterns that have no name or reusable form.

### Phase 2 — Risk-ranked proposal generation
6. Generate architectural improvement proposals. For each:
   - **Title**: one-line description
   - **Type**: Decouple | Extract | Consolidate | Rename | Delete | Add abstraction
   - **Why**: what problem does this solve? (evidence from survey)
   - **How**: minimum viable change path
   - **Impact**: HIGH (unlocks major capabilities) | MEDIUM (reduces friction) | LOW (cleanup)
   - **Risk**: LOW | MEDIUM | HIGH
   - **Dependency**: does this block or require another proposal?
7. Rank proposals by `(Impact × Risk_inverse)` — highest-leverage, lowest-risk first.
8. **Cap at 7 proposals per run**. More is noise. Quality over coverage.

### Phase 3 — Vertical slice validation
9. For the top 2 proposals, trace a **vertical slice** through the proposed change:
   - Which files change?
   - Which tests must be updated?
   - What downstream systems are affected?
   - What is the rollback path?
10. If the vertical slice reveals hidden complexity, re-rank accordingly.

### Phase 4 — Handoff
11. Emit proposals to evolution loop (`evolution_proposals`).
12. Top-ranked LOW-risk proposals: may auto-apply with rollback checkpoint if `auto_apply` enabled.
13. MEDIUM/HIGH risk proposals: queue for human review.

## Heuristics
- **Zoom out before zooming in**: understand the whole graph before proposing local changes.
- **Name the problem before proposing the solution**: unnamed problems get unnamed fixes.
- **Prefer extraction over deletion**: removing a concept usually just hides it.
- **One proposal, one concern**: proposals that do multiple things hide complexity.

## Failure modes to avoid
- Proposing a total rewrite as an "improvement" — rewrites are separate missions.
- Generating more proposals than can be acted on in one planning cycle.
- Reviewing code style instead of structure — this skill is about boundaries, not formatting.

## Output contract

```
## 🏗️ Architecture Improvement Report

### Structural Survey Summary
- Coupling hotspots: <list>
- Cohesion gaps: <list>
- Boundary violations: <list>
- Absent abstractions: <list>

### Ranked Proposals

| # | Title | Type | Impact | Risk | Dependency |
|---|-------|------|--------|------|------------|
| 1 | ... | ... | HIGH | LOW | None |

### Vertical Slice (Top 2)
**Proposal 1:** <file delta, test impact, rollback path>
**Proposal 2:** <file delta, test impact, rollback path>

### Evolution Loop Output
- Proposals submitted: <IDs>
- Auto-apply candidates: <list>
- Human gate required: <list>
```

## Policy considerations
- Survey phase is read-only — no policy gate.
- Proposals touching public API contracts, auth boundaries, or data schemas are HIGH risk.
- Never auto-apply proposals that change module export interfaces or database schemas.
