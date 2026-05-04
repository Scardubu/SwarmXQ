# delta-evolution

Capture the performance delta between the current and previous swarm configuration, score it against the fitness function, and generate the next evolution proposal — all in one bounded, auditable pass.

- Triggers: delta evolution, evolution delta, what improved, fitness delta, swarm improvement, evolve the swarm, self-improve, evolution proposal, capture delta
- Stack: generic
- Owner: system
- Weight: 5

## SwarmX Integration
- Policy check: `assess_action("evolution-delta", mission)` — MEDIUM risk; evolution proposals are controlled changes.
- Audit log: emit `DELTA_CAPTURED` / `EVOLUTION_PROPOSAL_GENERATED` with before/after snapshots and fitness scores.
- Memory: store every fitness delta permanently as a learning record — these are the swarm's institutional memory.
- Evolution hook: **this skill IS the evolution hook** — it both captures and generates proposals.
- Primitive refs: `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`, `{{evolution_proposal}}`, `{{delta}}`

## When to activate
- After any swarm run completes (success or failure).
- After a skill is added, modified, or removed.
- After a team configuration is changed.
- When `swarm-evolve.sh` is invoked.
- Periodically as a background hygiene pass (configured retention window).

## Execution protocol

### Phase 1 — Before/after snapshot
1. Retrieve the **current swarm state snapshot**: skill catalog version, agent roster version, active workflow list, last 5 mission outcomes.
2. Retrieve the **previous snapshot** from memory graph (last stored delta record).
3. Compute the **structural delta**: what changed between snapshots?
   - Skills: added / modified / removed
   - Agents: added / modified / removed
   - Workflows: added / modified / removed
   - Config: changed parameters

### Phase 2 — Fitness scoring
4. Score the current configuration against the **SwarmX fitness function**:

| Dimension | Metric | Weight |
|-----------|--------|--------|
| Task success rate | % missions completed without human escalation | 0.30 |
| Token efficiency | actual tokens / estimated budget (lower is better) | 0.20 |
| Evolution proposal quality | % proposals accepted by human review | 0.20 |
| Policy compliance | % runs with zero policy violations | 0.15 |
| Self-correction rate | % errors caught by critic-gate before emission | 0.15 |

5. Compute **composite fitness score** (0–1). Compare to previous score. Record delta: `Δfitness = current - previous`.

### Phase 3 — Root cause attribution
6. If `Δfitness > 0` (improvement): identify which change drove the improvement. Mark that change as **KEEPER**.
7. If `Δfitness < 0` (regression): identify which change drove the regression. Mark that change as **CANDIDATE FOR ROLLBACK**.
8. If `Δfitness ≈ 0` (neutral): identify which dimensions are stagnant and why.

### Phase 4 — Evolution proposal generation
9. Based on the delta analysis, generate up to **3 evolution proposals**:
   - Each proposal must address a specific fitness dimension.
   - Each proposal must be concrete: a specific skill change, agent change, config change, or workflow change.
   - Each proposal must have: hypothesis, expected fitness delta, risk level, rollback path.
10. Rank proposals by `(expected_delta × risk_inverse)`.
11. Store proposals in `evolution_proposals` via `core/evolution_engine.py`.

### Phase 5 — Learning record
12. Write a **memory-note** with:
    - Snapshot versions (before and after)
    - Fitness delta
    - KEEPER/ROLLBACK attributions
    - Evolution proposals generated
13. This record is the swarm's long-term learning signal — it accumulates over time to form institutional knowledge.

## Fitness heuristics
- **A swarm that escalates less is more capable.** Reduce human gate frequency as a primary signal.
- **A swarm that uses fewer tokens to achieve the same outcome is more efficient.** Token cost is a real constraint.
- **A skill that is never triggered is dead weight.** Flag zero-trigger skills for deprecation.
- **A proposal that is always rejected is misaligned.** Rejected proposals are negative training signal.

## Failure modes to avoid
- Generating proposals without evidence from the fitness delta — evolution theater, not evolution.
- Proposing structural changes after a single run — fitness signals need N ≥ 3 runs before they're meaningful.
- Keeping underperforming skills out of inertia — deprecation is a valid evolution action.
- Treating a neutral delta as success — stagnation is a slow regression.

## Output contract

```
## 🧬 Evolution Delta Report

**Snapshot:** <version before> → <version after>
**Structural delta:** <what changed>
**Fitness score:** <previous> → <current> (Δ = <+/->)

### Fitness Breakdown
| Dimension | Score | Δ | Attribution |
|-----------|-------|---|-------------|
| Task success rate | 0.87 | +0.04 | new critic-gate integration |
| ...

### Attribution
- KEEPER: <change that drove improvement>
- ROLLBACK CANDIDATE: <change that drove regression>

### Evolution Proposals

**Proposal 1** [ID: EVO-<ID>]
- Hypothesis: <what we think will improve fitness>
- Expected Δfitness: +<N>
- Change: <specific skill/agent/config modification>
- Risk: LOW | MEDIUM | HIGH
- Rollback: <how to undo>

### Memory Note Written: YES
```

## Policy considerations
- Evolution proposals that modify the policy engine itself are CRITICAL risk — require human review and a second-agent sign-off before apply.
- Rollback proposals for previously human-approved changes also require human approval to execute.
- The fitness record is append-only — past deltas cannot be deleted or modified.
