# grill-me

Interrogate the mission, requirements, or plan with adversarial questions until alignment is confirmed or gaps are surfaced. The antidote to silent assumption.

- Triggers: grill me, interrogate requirements, challenge my plan, poke holes, find the gaps, what am I missing, alignment check, requirements audit, probe assumptions
- Stack: generic
- Owner: system
- Weight: 5

## SwarmX Integration
- Policy check: read-only analysis — no policy gate required.
- Audit log: emit `GRILL_SESSION_START` / `GRILL_ALIGNMENT_RESULT` with alignment score.
- Memory: store confirmed requirements and discovered gaps as memory-graph entries.
- Evolution hook: gaps discovered here become `type: clarification` evolution proposals.
- Primitive refs: `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`

## When to activate
- A mission, plan, or requirements document has been stated but not pressure-tested.
- An agent is about to begin a long execution and alignment has not been confirmed.
- Scope creep or requirement drift is suspected.
- Human says: "just build it" — without sufficient specification detail.

## Execution protocol

### Phase 1 — Deconstruct the objective
1. Restate the mission in your own words. One sentence. If you cannot, the mission is underspecified.
2. List every **explicit requirement** stated in the context.
3. List every **implicit assumption** you are making that was not stated. These are the risk surface.

### Phase 2 — Adversarial interrogation
4. For each implicit assumption, generate the **hardest question** that could break it:
   - *Who is the user? What do they actually need vs. what they said?*
   - *What does "done" look like? What is the acceptance criterion?*
   - *What is out of scope? What should NOT be built?*
   - *What happens when X fails? What is the fallback?*
   - *Is there an existing system or skill that already handles this?*
   - *What constraint makes this harder than it looks?*
   - *What would make this proposal wrong six months from now?*
5. Rank questions by how likely they are to **invalidate the current plan** if unanswered.

### Phase 3 — Surface and classify gaps
6. Classify each unanswered question as:
   - 🔴 **BLOCKING** — must be answered before work can begin; proceeding is high risk.
   - 🟡 **IMPORTANT** — should be answered early in execution; wrong assumption will cause rework.
   - 🟢 **OPTIONAL** — nice to know; work can proceed with a documented assumption.
7. Produce the **minimum set of clarifying questions** that, if answered, would unblock the plan. No padding.

### Phase 4 — Alignment check
8. If all BLOCKING gaps have answers: confirm alignment and proceed.
9. If BLOCKING gaps remain unanswered: **halt and surface them to the human**. Do not build against unresolved blockers.
10. Document all OPTIONAL assumptions explicitly in the plan so they are not invisible.

## Heuristics
- **The best question is the one that most efficiently collapses uncertainty.**
- **Stating an assumption explicitly is always better than hiding it in implementation.**
- **Scope that is not explicitly excluded will inevitably expand.**
- Do not grill the same thing twice. One adversarial pass per requirement.

## Failure modes to avoid
- Asking questions you already know the answer to — interrogation theater, not alignment.
- Generating 20 questions when 3 would do — interrogation overhead kills momentum.
- Treating OPTIONAL gaps as BLOCKING — not every uncertainty needs to be resolved before starting.
- Grilling instead of building when alignment is already sufficient.

## Output contract

```
## 🔥 Grill Report

**Mission restatement:** <one sentence>
**Explicit requirements:** <numbered list>
**Implicit assumptions:** <numbered list>

### Adversarial Questions

| # | Question | Targets assumption | Severity |
|---|----------|--------------------|----------|
| 1 | ... | "X will work because Y" | 🔴 BLOCKING |
| 2 | ... | "User wants Z" | 🟡 IMPORTANT |

### Alignment verdict
- BLOCKING gaps: <count> — [HALT: surface to human | PROCEED: all resolved]
- IMPORTANT gaps: <documented as assumptions>
- Recommended action: [begin work | clarify first | revise scope]
```

## Policy considerations
- Zero-write, zero-risk — no policy gate.
- BLOCKING gaps in CRITICAL missions (production deploys, auth, financial flows) must be resolved by a human, not assumed away by an agent.
