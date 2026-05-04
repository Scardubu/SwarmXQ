# mcp-tooling

Connect the swarm to external tools and context providers with least privilege and full auditability.

- Triggers: mcp, tool, server, integration, connector, external api, tool use, manifest
- Stack: devops, generic
- Owner: platform
- Weight: 4

## When to activate
- Adding a new external tool, API, or context provider to the swarm.
- Auditing an existing tool integration for security, scope creep, or drift.
- Designing the authorization model for an agent tool surface.

## Execution pattern

1. **Apply least privilege at registration.** Every tool integration must start with the minimum necessary permissions. Read-only unless mutation is required. Scoped to the smallest resource set that serves the use case. Revocable without disrupting other tools. Expand permissions only with explicit evidence that the minimum is insufficient.

2. **Write the manifest before writing the integration.** The manifest is the contract: tool name, description, input schema, output schema, error conditions, rate limits, and auth mechanism. A tool without a manifest is a black box inside a system that depends on predictable behavior.

3. **Audit the attack surface.** Every tool integration is a permanent addition to the trust boundary. Before registering: What data can this tool read? What data can it write or delete? What external systems can it call? What happens when it is misconfigured or compromised? If any of these answers is "I'm not sure" — resolve that before proceeding.

4. **Design explicit fallback behavior.** What happens when the tool is unavailable, returns an error, or returns malformed output? Agents that do not have defined fallback behavior for tool failures will surface unpredictable behavior under load. Every tool integration requires: error shape, fallback action, and timeout policy.

5. **Test with adversarial inputs.** Before the tool goes into production: test with malformed inputs, unexpected response shapes, rate limit responses, auth failures, and timeout conditions. The tool's behavior under failure conditions determines the system's resilience under failure conditions.

6. **Emit a manifest diff with every change.** Permission changes, schema changes, and scope expansions must produce a diff that can be reviewed before deployment. A tool change that cannot be code-reviewed is a security surface change that cannot be audited.

## Failure modes to avoid
- Granting broad permissions ("admin" or "write all") because it is easier to configure.
- Missing timeout policies (a tool that hangs blocks the agent indefinitely).
- Tools that succeed silently on error conditions instead of returning typed failures.

## Output contract
- Tool manifest: name, input/output schema, auth mechanism, rate limits, error conditions.
- Permission scope: what the tool can read, write, call, and what it explicitly cannot.
- Fallback behavior: error shape, timeout policy, fallback action for each failure mode.
- Manifest diff: what changed relative to the previous version (for reviews).
- Attack surface note: what access this tool adds to the trust boundary.

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
