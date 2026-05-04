# security-auditor

Full STRIDE + OWASP Top 10 structured security audit. Enumerate threats systematically,
prioritize by blast radius and exploitability, and produce a prioritized remediation plan.
Never audit with a checklist mindset — model the attacker.

- **Triggers:** security audit, owasp, stride, threat model full, pentest prep, security review, attack surface, vulnerability assessment, auth audit, injection risks, full security sweep, cve sweep
- **Stack:** security, devops
- **Owner:** security
- **Weight:** 5
- **Policy level:** high (audit findings may require immediate human gates for critical vulnerabilities)
- **SwarmX primitives:** `{{mission}}`, `{{context}}`, `{{memory_summary}}`, `{{policy_level}}`

---

## When to activate

- Pre-production security review for any new feature touching auth, payments, or user data.
- After a CVE disclosure affecting a dependency in the stack.
- Quarterly security posture review for production systems.
- Before any third-party security assessment or penetration test.
- When `security-hardening` has been applied and a second-pass validation is needed.
- As the mandatory gate in `release-governance` for high-risk releases.

---

## STRIDE threat enumeration

Enumerate threats systematically across all six STRIDE categories for each system component:

### S — Spoofing
```
threat: [Can an attacker impersonate a user, service, or component?]
attack_vectors:
  - Credential stuffing / brute force
  - Session token theft / replay
  - JWT algorithm confusion (none/HS256/RS256 confusion)
  - OAuth implicit flow token leakage
  - Service-to-service identity spoofing (missing mTLS)
assessment: [present | mitigated | absent — with evidence]
```

### T — Tampering
```
threat: [Can an attacker modify data, code, or configuration?]
attack_vectors:
  - SQL/NoSQL injection (unparameterized queries)
  - Mass assignment (binding over-posting)
  - CSRF (state-changing requests without token)
  - Supply chain tampering (unsigned dependencies)
  - Log injection
assessment: [present | mitigated | absent — with evidence]
```

### R — Repudiation
```
threat: [Can an attacker deny performing an action?]
attack_vectors:
  - Missing audit logs for sensitive operations
  - Log tampering (writable log destinations)
  - Unsigned financial or legal transactions
assessment: [present | mitigated | absent — with evidence]
```

### I — Information Disclosure
```
threat: [Can an attacker access data they should not see?]
attack_vectors:
  - Verbose error messages exposing stack traces / DB schemas
  - Insecure direct object reference (IDOR)
  - Unencrypted data at rest or in transit
  - Debug endpoints left enabled in production
  - Secrets in environment variables accessible to child processes
  - Path traversal
assessment: [present | mitigated | absent — with evidence]
```

### D — Denial of Service
```
threat: [Can an attacker exhaust resources or crash the system?]
attack_vectors:
  - Missing rate limiting on auth endpoints
  - Unbounded regex (ReDoS)
  - Large payload attacks (missing request size limits)
  - Resource exhaustion via repeated expensive operations
assessment: [present | mitigated | absent — with evidence]
```

### E — Elevation of Privilege
```
threat: [Can an attacker gain permissions beyond their entitlement?]
attack_vectors:
  - Broken access control (missing server-side enforcement)
  - Privilege escalation via parameter manipulation
  - JWT claim manipulation (if secret is weak or algorithm is confused)
  - SSRF (server-side request forgery to internal services)
  - Dependency with known privilege escalation CVE
assessment: [present | mitigated | absent — with evidence]
```

---

## OWASP Top 10 cross-check

After STRIDE enumeration, run a cross-check against the current OWASP Top 10:

```
owasp_checklist:
  A01_broken_access_control:     [status + evidence]
  A02_cryptographic_failures:    [status + evidence]
  A03_injection:                 [status + evidence]
  A04_insecure_design:           [status + evidence]
  A05_security_misconfiguration: [status + evidence]
  A06_vulnerable_components:     [status + CVE list from dependency scanner]
  A07_auth_failures:             [status + evidence]
  A08_software_data_integrity:   [status + evidence]
  A09_logging_monitoring:        [status + evidence]
  A10_ssrf:                      [status + evidence]
```

`status`: `PASS | FAIL | PARTIAL | NOT-APPLICABLE`

---

## Dependency CVE scan

```
dependency_scan:
  tool:           [npm audit | pip-audit | trivy | snyk — use all available]
  critical_cves:  [list — require immediate action]
  high_cves:      [list — require remediation timeline ≤ 7 days]
  medium_cves:    [list — require remediation timeline ≤ 30 days]
  summary:        [total count by severity]
```

Any `critical_cve` with a public exploit is a CRITICAL Fix Log entry → human gate required.

---

## Prioritized findings

```
finding:
  id:              [SEC-{n}]
  stride_category: [S | T | R | I | D | E]
  owasp_mapping:   [A0N]
  severity:        [CRITICAL | HIGH | MEDIUM | LOW | INFORMATIONAL]
  title:           [one-line description]
  location:        [file:line or service:endpoint or dependency]
  evidence:        [observable proof or CVE reference]
  attack_scenario: [how an attacker would exploit this, in 2-3 sentences]
  remediation:     [specific, actionable fix — not a general recommendation]
  effort:          [S | M | L]
  priority:        [immediate | 7-day | 30-day | backlog]
```

Sort findings: CRITICAL → HIGH → MEDIUM by priority.

---

## Policy integration

```
policy_check:
  audit: assess_action("audit", {{context}}, risk="high")
  findings: if CRITICAL count >= 1:
              human_gate = required
              auto_apply = blocked for any change in same system
              fix_log = append CRITICAL entries
  audit_log: emit stage="security-auditor" for each STRIDE category + OWASP check
  escalation: SEC-CRITICAL findings escalate to release-governance immediately
  credential_touch: if any finding involves credential exposure, invoke incident-command
```

---

## Failure modes to avoid

- **Checklist security**: Marking items as "PASS" without evidence-backed verification.
- **Surface-only audit**: Reviewing only the application layer without auditing infrastructure, dependencies, and deployment pipeline.
- **Fix before isolate**: Applying a security fix to a critical vulnerability without first confirming the exploit path is closed during the fix window.
- **Severity inflation**: Marking all findings as CRITICAL reduces urgency signal and causes prioritization failure.

---

## Output contract

```
security_audit:
  scope:            [system components audited]
  stride_findings:  [per-category assessment with evidence]
  owasp_checklist:  [full A01-A10 status]
  cve_scan:         [dependency vulnerability report]
  prioritized_findings: [SEC-{n} list, severity-sorted]
  fix_log_criticals: [CRITICAL entries emitted]
  remediation_plan: [sequenced by priority and effort]
  human_gates:      [immediate actions requiring operator approval]
  memory_candidate: [recurring vulnerability pattern to promote to skill]
```

---

## Integration notes

- This skill extends `security-hardening` with full STRIDE enumeration and OWASP cross-check.
- SEC-CRITICAL findings feed directly into `incident-command` if the system is in production.
- CVE findings feed `release-governance` as a blocker condition.
- The `remediation_plan` is the input to `refactor-safety` for applying the fixes.
- Run `grill-with-docs` on any third-party security library before assuming it mitigates a finding.
