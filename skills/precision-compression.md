# precision-compression

Eliminate reasoning redundancy early. Keep only the highest-signal path. Never sacrifice correctness for brevity.

- Triggers: concise, compress, minimal, high-signal, tight, reduce, distill, simplify output, token budget
- Stack: generic
- Owner: system
- Weight: 4

## When to activate
- Any output that is longer than the decision it conveys.
- After latent-ensemble-selection or critic-gate resolves a question — the answer should be shorter than the deliberation.
- When producing memory notes, skill capsules, or summaries intended for cold retrieval.

## Execution pattern

1. **Identify the load-bearing sentences.** Read the draft output. For each sentence, ask: if this were removed, would the output change what the caller does? If no: remove it. Preamble, restated objectives, transition phrases, and confidence disclaimers that don't change the decision are all candidates for removal.

2. **Compress lists into their highest-signal items.** A 7-item list where 4 items are noise is not a concise list — it is a 4-item list with padding. Cut to the items that change behavior.

3. **Collapse nested reasoning.** If a conclusion requires 3 intermediate steps that do not add calibration for the caller, collapse them into the conclusion. Show the reasoning path only when the caller needs to validate it.

4. **Preserve semantic precision.** Compression that introduces ambiguity is not compression — it is corruption. Every word removed must not change the meaning of what remains. If a word is needed for correctness or clarity, it stays.

5. **Apply a final length check.** Ask: is this the shortest version that would produce the same action in the caller? If yes: done. If a shorter version exists that preserves the same decision signal: apply it.

## Failure modes to avoid
- Compressing by removing evidence that the caller needs to trust the output.
- Treating word count as a proxy for quality — a 3-word answer can be wrong, a 30-word answer can be precisely right.
- Collapsing reasoning that the downstream agent needs to validate its own behavior.

## Output contract
- Compressed output: shortest version that preserves full decision signal and correctness.
- Compression ratio: optional, only if requested.
- Preserved uncertainty: any residual ambiguity that could not be compressed without distortion must be surfaced, not deleted.

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
