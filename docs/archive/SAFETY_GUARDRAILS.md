# Safety Guardrails

## High-risk categories

- auth and identity,
- secrets and credentials,
- payment and billing,
- deployment and infrastructure,
- destructive data operations,
- incident recovery,
- security-sensitive configuration.

## System behavior

- Block or gate risky tasks.
- Record blocked work explicitly.
- Grade every stage when tracing is enabled.
- Store run artifacts when persistence is enabled.
- Use proposals before self-modification.

## Review habits

- Verify with tests when available.
- Review diffs before applying changes.
- Preserve checkpoints for runs that matter.
- Favor small, reversible changes.
