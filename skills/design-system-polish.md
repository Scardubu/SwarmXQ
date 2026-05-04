# design-system-polish

Sharpen spacing, token consistency, component coherence, and accessibility defaults.

- Triggers: tokens, spacing, theme, components, design system, consistency, polish, dark mode, visual debt
- Stack: frontend
- Owner: design
- Weight: 5

## When to activate
- Preparing a component or surface for design-system promotion.
- Reducing visual debt accumulated across multiple implementation cycles.
- Enforcing token consistency before a major release.

## Execution pattern

1. **Audit token usage.** Every color, spacing value, font size, radius, and shadow must reference a design token — not a hard-coded value. Hard-coded values create design drift: the next change breaks visual consistency silently. Find every hard-coded value and replace with the canonical token.

2. **Enforce spacing coherence.** Spacing must follow the system scale (4pt grid, 8pt grid, or the defined scale). Arbitrary pixel values indicate either a missing token or a design decision that was not captured in the system. Add the token or escalate the decision.

3. **Verify component variants are complete.** Every component must have: default, hover, focus, active, disabled, and error states. A component with missing states will be implemented inconsistently when developers encounter those states in the wild.

4. **Check dark mode parity.** Every token must have a dark-mode value. Surfaces that look correct in light mode but use hard-coded colors will break in dark mode. Test each component in both color schemes before declaring it complete.

5. **Validate accessibility defaults.** Confirm: interactive elements have visible focus rings, color contrast meets WCAG AA for all text sizes, touch targets are ≥ 44×44px, and icon-only buttons have accessible labels. These defaults belong in the system, not in individual implementations.

6. **Document the component contract.** Every promoted component needs: props with types and defaults, usage example, anti-pattern warning, and the token it depends on. A component without documentation will be used incorrectly and create the debt you just eliminated.

## Failure modes to avoid
- Promoting a component to the system before all states are implemented.
- Treating dark mode as an optional layer rather than a first-class constraint.
- Documenting props but not anti-patterns (anti-patterns are the most common misuse vector).

## Output contract
- Token audit: list of hard-coded values with their canonical token replacements.
- State coverage: which components are missing which states.
- Dark mode gaps: tokens without dark-mode values and recommended values.
- Accessibility findings: violations with severity and fix.
- Documentation delta: what was added or updated in the component contract.

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
