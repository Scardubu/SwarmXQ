# prompt-ops

Shape system prompts, instruction hierarchies, and prompt hygiene for consistent, testable, drift-resistant outputs.

- Triggers: system prompt, instruction, prompt design, prompt hygiene, instruction hierarchy, reusable prompt, control prompt, prompt drift
- Stack: generic
- Owner: system
- Weight: 5

## When to activate
- Designing or auditing agent prompts or system instructions.
- Diagnosing inconsistent agent behavior across runs.
- Promoting a recurring prompt pattern into a reusable module.

## Execution pattern

1. **Audit the instruction layers.** Every effective prompt requires five layers. Identify which are present and which are missing:
   - **Policy layer:** what the agent must never do (safety, scope limits).
   - **Role layer:** what the agent is, what it is not, and what model of expertise it should apply.
   - **Task layer:** what to do in this specific invocation.
   - **Constraints layer:** scope, format, token budget, stop conditions.
   - **Output contract:** exactly what the caller expects — structure, completeness, format.
   Missing layers → add before auditing wording.

2. **Run the ambiguity scan.** For each instruction phrase, ask: what is the most common misread by an agent with no context? Rewrite any phrase with a high-probability misread. Ambiguity compounds: one unclear phrase in the role layer corrupts all downstream reasoning.

3. **Apply compression.** Remove instructions that duplicate other layers, state the obvious, or add no constraint. Every instruction is a cognitive load on the executing agent. Lean prompts produce more consistent outputs than verbose ones.

4. **Verify testability.** For each output contract item, confirm there is a detectable failure mode. If an output contract cannot be evaluated programmatically or by rubric, it is not a contract — it is a wish.

5. **Modularize recurring patterns.** If the same instruction block appears across 2+ prompts, extract it into a named module. Reference the module in subsequent prompts rather than copying the text.

## Failure modes to avoid
- Adding more instructions to fix behavior caused by ambiguous instructions — this creates instruction debt.
- Writing role layers that describe the ideal output instead of the agent's operating model.
- Treating verbose prompts as more "safe" or "complete" — they increase variance, not reliability.

## Output contract
- Audit result: which layers are present / missing.
- Ambiguity findings: list of phrases with high misread probability and suggested rewrites.
- Compressed prompt: the improved version, not a description of what to improve.
- Module candidates: any blocks suitable for extraction.

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
