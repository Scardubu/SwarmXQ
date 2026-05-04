# skill-synthesis

Convert repeated successes and high-leverage patterns into reusable, triggerable skill capsules.

- Triggers: synthesize skill, promote pattern, recurring win, reusable, skill from run, extract skill, distill lesson
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Memory Curator or Skill Curator identifying a pattern that has appeared in 2+ runs.
- A single high-leverage pattern that would materially improve future runs if encoded.
- Evolver proposing a skill promotion as a low-risk improvement target.

## Execution pattern

1. **Apply the three-gate promotion filter.**
   - **Recurrence gate:** Has this pattern appeared in 2+ independent runs, or is it demonstrably high-leverage on first occurrence? Single-occurrence patterns are memory notes, not skills.
   - **Transfer gate:** Does the pattern generalize across repos, stacks, or agent types? Repo-specific heuristics belong in run memory, not the skill catalog.
   - **Compression gate:** Can the full skill fit in ≤20 lines with a clear trigger, execution pattern, and output contract? Patterns that require 50 lines to express are implementations, not skills.

2. **Write the skill structure.** Required fields:
   - `name`: lowercase, hyphenated, verb-noun or noun-modifier.
   - `triggers`: 3–6 short phrases that would reliably activate this skill in a routing context.
   - `stack`: which stacks this applies to (generic / backend / frontend / etc.).
   - `execution pattern`: 3–6 steps, each actionable and scoped.
   - `output contract`: exactly what this skill produces — structure, completeness criteria.

3. **Run the duplication check.** Before writing to the catalog, verify no existing skill covers this pattern. Overlapping skills degrade routing precision — the router cannot confidently select between two skills that cover the same trigger space.

4. **Assign weight.** Weight 5: high-frequency, cross-stack, proven. Weight 4: moderate frequency or narrower stack. Weight 3: experimental, single-stack, or low-evidence. Do not promote at weight 5 without recurrence evidence.

## Failure modes to avoid
- Promoting one-off wins as durable skills — this pollutes the catalog with low-reliability entries.
- Writing skills without explicit output contracts — a skill without an output contract cannot be evaluated.
- Adding skills without checking for overlap — catalog bloat degrades routing speed and accuracy.

## Output contract
- Skill candidate: complete skill file in canonical format.
- Promotion gate results: which gates passed and which were borderline.
- Overlap check: existing skill names that were considered and why this one is non-duplicative.
- Recommended weight: with justification.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite skill-shaping notes
- Encode reusable behavior as a compact triggerable primitive with a clear output contract.
- Prefer structure that supports routing, validation, and downstream composition.
- Remove redundancy, but preserve the smallest amount of context needed for reliable execution.
- Validate that the skill remains distinct from neighboring skills and does not duplicate responsibility.

## Promotion note
- Promote a pattern only after it proves recurrence, transferability, and compression into a clean skill capsule.
