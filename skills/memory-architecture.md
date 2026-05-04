# memory-architecture

Persist lessons and promote reusable experiences with signal-quality discipline.

- Triggers: memory, lesson, retain, recall, archive, pattern, durable, cold retrieval, knowledge base
- Stack: generic
- Owner: system
- Weight: 4

## When to activate
- Deciding whether a run outcome should be written to long-term memory.
- Designing the memory model for a new agent or swarm.
- Diagnosing retrieval failures caused by low-signal memory pollution.

## Execution pattern

1. **Apply the retention filter before writing.** Classify every candidate memory before writing it:
   - **Durable:** Affects multiple future runs across different contexts → write to long-term memory.
   - **Transient:** Relevant only to the current run's state → discard. Do not write transient state to long-term memory; it becomes noise that degrades future retrieval quality.
   - **Structural:** Recurring failure motif or routing correction → flag for skill promotion. Patterns that repeat across 2+ runs belong in skills, not memory notes.

2. **Write for cold retrieval.** Every memory note must be actionable when read by a future agent with no context from the current session. Test: would a reader who knows nothing about this run understand what to do differently? If the answer is no, rewrite before persisting.

3. **Compress to signal.** Memory note format: context (1 sentence, situational), lesson (1 sentence, prescriptive), retrieval cues (3–5 keywords). Notes longer than 5 lines are summaries, not memory notes. Summaries belong in the run artifact, not the memory layer.

4. **Run a duplication check before writing.** Before writing a new memory note: verify no existing note already captures this lesson. Duplicate notes degrade retrieval precision: the retriever returns multiple similar notes, forcing the consumer to reconcile them. Merge or update existing notes rather than creating duplicates.

5. **Apply a decay policy.** Memory notes have a useful lifetime. Lessons about specific library versions, deprecated APIs, or one-off constraints should carry an expiry signal. Notes without any time-sensitivity can be marked as durable. Stale-but-accurate notes are less harmful than stale-and-wrong notes — distinguish them.

6. **Promote recurring patterns to skills.** A lesson that has surfaced in 3+ runs is a skill candidate, not a memory note. Memory is for single-occurrence lessons; skills are for recurring patterns. Keeping recurring patterns in memory (instead of promoting them) increases retrieval latency and reduces reuse reliability.

## Failure modes to avoid
- Writing transient run state into long-term memory (degrades signal-to-noise over time).
- Notes that are only interpretable with the current session's context.
- Accumulating duplicates instead of updating or merging existing notes.

## Output contract
- Retention decision: durable / transient / structural with rationale.
- Memory note (if writing): context, lesson, retrieval cues — max 5 lines.
- Duplication check: existing note references that were considered.
- Promotion flag: if structural, the recurring pattern and skill promotion candidate.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite augmentation
- Preserve the original interface, workflow, and external behavior.
- Make the smallest change that fully satisfies the stated objective.
- Validate the result against the most likely downstream consumer.
- Return only the artifact or decision this skill is meant to produce.
