# research-acceleration

Gather sources, distill patterns, and convert findings into action.

- Triggers: research, analysis, paper, compare, source, literature, benchmark, survey, state of the art
- Stack: generic
- Owner: research
- Weight: 3

## When to activate
- Evaluating a new library, framework, architecture pattern, or approach before committing.
- Synthesizing multiple sources into a single engineering recommendation.
- Converting academic or technical literature into implementation guidance.

## Execution pattern

1. **Rank sources by evidence quality before reading.** Tier 1: peer-reviewed papers, official documentation, production case studies with measured outcomes. Tier 2: well-attributed engineering blog posts, conference talks with speaker credentials. Tier 3: community discussions, unattributed comparisons. Weight findings by source tier. A benchmark from a vendor's marketing blog is not the same quality of evidence as an independent benchmark with reproducible methodology.

2. **Separate facts from inferences.** When synthesizing: label each finding explicitly as established (measured, reproducible), inferred (reasonable conclusion from available evidence but not directly measured), or claimed (asserted without supporting evidence). Mix all three categories into a single recommendation without labeling and you produce a confident-sounding guess.

3. **Apply the transfer test before recommending.** Does the evidence apply to your context? Check: same scale? same traffic pattern? same team size? same latency requirements? A recommendation that is correct for a 100-person company at 10M requests/day may not be correct for a 5-person startup at 10K requests/day. State the transfer conditions explicitly.

4. **Find the counter-evidence.** Before completing research: actively search for cases where the recommended approach failed, was abandoned, or had unexpected downsides. Counter-evidence is not a reason to reverse a recommendation — it is a reason to make the recommendation's conditions explicit.

5. **Convert findings to action.** Research output is complete when it answers: "Given this evidence, what is the specific next step?" A summary that ends with "it depends" without specifying what it depends on and how to evaluate those factors is incomplete research. Push to a concrete conditional recommendation: "If X, choose A. If Y, choose B."

6. **Cite sources as the audit trail.** Every claim that could be challenged requires a citation. Citations are not decorative — they are the mechanism by which the recommendation can be updated when the evidence changes.

## Failure modes to avoid
- Treating all sources as equivalent regardless of evidence quality.
- Completing research without a concrete conditional recommendation.
- Omitting counter-evidence (produces overconfident recommendations that fail under conditions the research did not surface).

## Output contract
- Evidence tier map: sources ranked by quality with brief quality rationale.
- Findings: facts, inferences, and claims — labeled by type.
- Transfer conditions: the context assumptions under which this evidence applies.
- Counter-evidence: cases where the recommended approach failed or was insufficient.
- Conditional recommendation: "If X, do A. If Y, do B" — concrete and actionable.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite domain guardrails
- Preserve least-privilege, contract stability, and auditability.
- Validate inputs, assumptions, and side effects against the intended boundary.
- Prefer traceable sources, explicit configuration, and deterministic outcomes.
- Block or narrow the change when it increases attack surface, ambiguity, or hidden coupling.
