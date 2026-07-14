Testing and Verification Instructions
Test User Outcomes

Tests should describe behavior in domain language.

Prefer:

user can submit a valid job once
duplicate idempotency key returns the established job
unauthorized tenant cannot read another tenant’s artifact
failed renderer cannot produce completed status

Avoid tests coupled to private implementation details.

Browser Testing

Use Playwright for critical workflows.

Rules:

test through visible behavior;
use role, label, text, and stable test-contract locators;
avoid CSS and XPath selectors for normal interactions;
keep tests isolated;
seed deterministic data;
control time where needed;
mock only third parties outside the product’s control;
retain real internal integration when practical.

Capture traces, screenshots, or videos on failure where configured.

API Testing

Cover:

schemas;
status codes;
stable error codes;
authorization;
idempotency;
rate/resource limits;
timeout behavior;
malformed downstream responses;
terminal-state integrity.

For Fastify, prefer application injection for route-level tests and real adapters for focused integration tests.

Regression Rule

Every defect fix should add a test that:

fails against the previous behavior;
passes after the correction;
asserts the user-visible or contractual outcome.
Flake Prevention

Do not use arbitrary sleep() for synchronization.

Wait for:

observable state;
emitted event;
network response;
database record;
UI condition;
bounded polling with an explicit deadline.

Any test requiring retry to pass should be treated as a defect.