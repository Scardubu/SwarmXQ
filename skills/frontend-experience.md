# frontend-experience

Improve onboarding, interaction clarity, content flow, and conversion paths.

- Triggers: ux, conversion, onboarding, cta, flow, friction, drop-off, engagement, clarity, cognitive load
- Stack: frontend
- Owner: design
- Weight: 4

## When to activate
- Diagnosing low conversion rates, high drop-off, or poor task completion.
- Auditing onboarding flows before launch or after a retention regression.
- Improving content hierarchy and call-to-action effectiveness.

## Execution pattern

1. **Measure the cognitive load.** Count the number of decisions the user must make before completing the primary task. More than 3 decisions without progress feedback is a friction signal. Each unnecessary decision is a drop-off risk.

2. **Audit the first 10 seconds.** What can the user understand about the product in 10 seconds without reading anything? If the answer is "not much" — the visual hierarchy and value proposition need to do more work. Lead with the outcome the user wants, not the features that produce it.

3. **Trace every CTA to its outcome.** Every call-to-action on the page must lead to exactly one clear outcome. Ambiguous CTAs ("Learn More" on a purchase page) generate hesitation. Each CTA should describe the action *and* the next state: "Start free trial — no credit card required."

4. **Evaluate empty, loading, and error states.** These are experienced by every first-time user. A beautiful happy-path UI with a blank loading state and a technical error message is an unfinished product. Each state requires: a clear message, a visual treatment, and a recovery action.

5. **Check the content flow.** Read the page content in order. Does it build from problem → solution → evidence → action? Or does it jump between concepts without a thread? Information architecture that follows a narrative arc outperforms information architecture that follows organizational convenience.

6. **Identify the highest-friction moment.** Every flow has a single highest-friction moment — the step where users hesitate longest or abandon most frequently. Fix that moment before optimizing anything else. Reducing friction at the bottleneck produces compounding improvement; reducing friction elsewhere produces marginal improvement.

## Failure modes to avoid
- Optimizing the happy-path flow while leaving empty and error states broken.
- CTAs that describe the feature ("View Dashboard") rather than the outcome ("See your results").
- Prioritizing above-the-fold aesthetic over below-the-fold completion rates.

## Output contract
- Cognitive load score: decision count per primary task, with friction points identified.
- First-impression audit: what communicates in 10 seconds without reading.
- CTA analysis: each CTA, its outcome, and whether it is clear or ambiguous.
- State inventory: which empty/loading/error states are missing or underdeveloped.
- Content flow verdict: narrative arc assessment with the weakest transition identified.

## Elite operating discipline
- Prefer the smallest useful action that still satisfies the objective.
- For non-trivial tasks, compare 2-3 internal variants, run one skeptical check, and keep the winner silently.
- Keep assumptions explicit, outputs directly usable, and failure signals short and concrete.
- Stop early when the requested boundary is satisfied; do not smuggle in unrelated improvements.

## Elite domain quality bar
- Protect the existing interface, user flow, and contract semantics.
- Optimize within the current architecture before proposing a redesign.
- Verify the change on the most relevant user-visible or system-level metric.
- Keep implementation and verification tightly coupled.
