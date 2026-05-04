# security-hardening

Threat model secrets, auth, and deployment boundaries.

- Triggers: auth, secret, payment, compliance, security, threat model, cve, permissions, injection, xss, csrf
- Stack: security, devops
- Owner: security
- Weight: 5

## When to activate
- Reviewing a new feature that touches authentication, secrets, payment, or user data.
- Preparing a service for production with external traffic.
- Auditing an existing service after a security incident or CVE disclosure.

## Execution pattern

1. **Enumerate the attack surface before writing a fix.** The threat model must answer: what is the trust boundary? What data flows across it? What are the trust assumptions at each boundary? What happens when each assumption is violated? A security fix that does not address the threat model addresses a symptom, not a vulnerability.

2. **Audit secret hygiene.** Secrets must: never appear in source code, logs, URLs, or error messages; be injected at runtime via secrets management (Vault, AWS Secrets Manager, environment injection with appropriate access controls); be rotated on a defined schedule; and be revocable without requiring a code deploy. Verify each of these properties before marking the audit complete.

3. **Validate auth boundaries.** For every protected resource: who is allowed to access it (authentication), what are they allowed to do (authorization), and how is this enforced (implementation)? The most common auth failure is enforcing authentication but not authorization — the user is logged in but can access resources that belong to other users.

4. **Apply input validation at every trust boundary.** All data from external sources (user input, API payloads, query parameters, file uploads, webhooks) must be validated against a schema before being processed. This is the primary defense against injection attacks (SQL injection, XSS, SSRF, command injection). Validation in the UI layer is not a substitute for validation at the server boundary.

5. **Audit dependencies for known CVEs.** Run the dependency scanner (npm audit, pip-audit, trivy, snyk) against the current dependency tree. Any critical or high-severity CVE requires a remediation timeline — not a "we'll handle it later." A known CVE in a production dependency is an open door that has a public lock-pick guide.

6. **Define the deployment security posture.** For each service in production: network ingress is restricted to what is necessary, service accounts have the minimum IAM permissions to operate, secrets are not in environment variables visible to all processes, and the deployment pipeline cannot be manipulated to inject malicious artifacts.

## Failure modes to avoid
- Fixing the symptom (the specific exploit) without fixing the vulnerability class (the missing validation).
- Relying on the UI layer for input validation and considering the server-side validation optional.
- Rotating secrets during an incident without revoking the compromised credential first (revoke then rotate — not rotate then revoke).

## Output contract
- Threat model: trust boundaries, data flows, and trust assumptions per boundary.
- Secret hygiene audit: storage, injection, rotation, and revocability assessment.
- Auth boundary map: authentication and authorization enforcement per protected resource.
- Input validation gaps: trust boundaries missing validation with the vulnerability class they expose.
- CVE findings: severity, affected component, and required remediation timeline.

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
