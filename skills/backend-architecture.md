# backend-architecture

Strengthen service boundaries, domain modeling, API contracts, and data flow clarity.

- Triggers: service, api, domain, schema, queue, boundary, contract, coupling
- Stack: backend
- Owner: platform
- Weight: 5

## When to activate
- Designing or reviewing service interfaces, domain models, or inter-service data flow.
- Detecting accidental coupling, leaky abstractions, or missing invariant enforcement.
- Preparing an API surface for external consumers or downstream agents.

## Execution pattern

1. **Map the boundary surface first.** Enumerate every input the service accepts, every output it emits, and every external dependency it takes. Boundaries you cannot draw explicitly are not boundaries — they are future incidents.

2. **Enforce the domain model at the entry point.** Validation, coercion, and invariant checks belong at the service boundary, not scattered through the interior. An invalid state that enters the domain surfaces at the worst possible moment.

3. **Lock the API contract.** Every public interface requires: input schema (types, required fields, constraints), output schema (success + all failure shapes), idempotency behavior, and versioning strategy. An interface without a versioning strategy is already deprecated — it just has not been told yet.

4. **Audit coupling.** Classify every cross-service dependency: strong (service cannot function without it) vs. weak (service degrades gracefully). Strong dependencies need circuit breakers, retry budgets, and fallback states. Weak ones need observability only.

5. **Enforce explicit error contracts.** Every error path must be typed, named, and documented. Errors arriving as untyped exceptions at the caller are a contract violation. Errors swallowed silently are a future incident.

6. **Validate queue and event contracts.** For async interfaces: schema, ordering guarantees, deduplication strategy, and dead-letter handling are part of the contract. An event without a schema is a shared mutable global.

## Failure modes to avoid
- Adding an abstraction to fix a coupling problem caused by a previous abstraction.
- Treating error responses as less important than success responses in the contract.
- Designing for the happy path and treating edge cases as implementation details.

## Output contract
- Boundary map: inputs, outputs, and external dependencies classified by strength.
- API contract delta: what changed, what must remain stable, what is deprecated.
- Invariant list: domain rules that must hold at all entry points.
- Coupling audit: strong vs. weak dependencies with resilience requirements.

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
