# design-critique

Find friction in hierarchy, flow, motion, accessibility, and narrative clarity.

- Triggers: design, ux, ui, layout, visual, motion, a11y, hierarchy, critique, friction, experience
- Stack: frontend
- Owner: design
- Weight: 5

## When to activate
- Reviewing a UI before implementation begins or before a release gate.
- Diagnosing user-reported friction or conversion problems.
- Auditing a new component or pattern for swarm-wide design consistency.

## Execution pattern

1. **Establish the hierarchy first.** Before evaluating anything else: what is the single most important action on this surface? Is it visually dominant? If the user's eye lands somewhere else first, the hierarchy is broken. Fix hierarchy before fixing aesthetics.

2. **Audit the friction budget.** Count the number of steps, decisions, and interactions required to complete the primary task. Every unnecessary step costs conversion and trust. Flag any step that does not contribute to the user's goal as a candidate for removal or consolidation.

3. **Run the accessibility check.** Required: color contrast ratio ≥ 4.5:1 for body text (3:1 for large text), keyboard navigability for all interactive elements, focus indicators visible, motion respects `prefers-reduced-motion`, form fields have associated labels. These are not nice-to-haves — they are correctness criteria.

4. **Evaluate motion and state transitions.** Motion should communicate state change, not decorate it. Audit: Does every animation have a clear semantic meaning? Does animation duration match the weight of the action (micro-interactions: 100–200ms; page transitions: 200–400ms)? Are loading, empty, and error states handled with the same design quality as the success state?

5. **Assess narrative clarity.** Does the copy on this surface tell a coherent story? Is the user always clear about where they are, what just happened, and what they can do next? Ambiguous copy is a UX bug — it generates support load and erodes trust.

6. **Classify findings by severity.** Critical (blocks completion or creates accessibility failure) → must fix before ship. Meaningful (creates confusion or friction) → fix if possible. Cosmetic → do not block ship, track separately. Return only findings that change behavior or completion rates.

## Failure modes to avoid
- Critique that returns style opinions instead of behavioral findings.
- Ignoring empty, error, and loading states (they are experienced by users).
- Letting accessibility failures pass because the primary path works.

## Output contract
- Hierarchy verdict: is the primary action visually dominant? What must change?
- Friction findings: steps or interactions that can be removed or consolidated.
- Accessibility failures: specific violations with the element and the fix.
- Motion audit: animations that lack semantic meaning or violate `prefers-reduced-motion`.
- Severity-classified fix list: critical / meaningful / cosmetic with one-line fixes.

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
