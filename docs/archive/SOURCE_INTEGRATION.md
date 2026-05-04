# Source integration notes

SwarmX now intentionally absorbs a curated slice of the best agentic patterns from the repositories and framework docs you pointed to.

## High-leverage patterns imported

From the skills catalog:
- `skill-router` for choosing the right skill or workflow when the task is ambiguous.
- `skill-check`, `skill-developer`, `skill-improver`, and `skill-writer` for the skill lifecycle.
- `skill-sentinel` for governance over the skill ecosystem itself.
- `workflow-automation` for durable execution, retries, idempotency, and rollback discipline.
- `subagent-driven-development` for independent implementation slices with baton passing.
- `context7-auto-research` for version-sensitive research before coding against fast-moving libraries.
- `devcontainer-setup`, `claude-settings-audit`, and `varlock` for environment reproducibility and safety.
- `agentic-actions-auditor` for GitHub Actions and agent integration security.

From harness-style team design:
- producer-reviewer
- fan-out/fan-in
- expert pool
- hierarchical delegation
- skill lifecycle orchestration

From framework guidance:
- OpenAI Agents SDK for application-owned orchestration, tools, approvals, state, and sandboxed execution.
- LangGraph for durable execution, human-in-the-loop checkpoints, persistent state, and graph-shaped workflows.
- MCP for standardized tool interoperability.

## How SwarmX uses these ideas

The planner now routes objectives toward the smallest fitting execution shape instead of forcing every task through one generic pipeline. The council layer can fan out, delegate recursively, or collapse into a focused producer-reviewer loop. The skill curator can synthesize repeated wins into durable skills, while the evaluator and tournament judge retain the right to block low-evidence or risky changes.

## Operating rule of thumb

- Single-agent plus tools first.
- Multi-agent only when the task is genuinely multi-domain, parallelizable, or requires separate review authority.
- Human approval for destructive, security-sensitive, or release-impacting operations.
- Sandbox or isolated execution for experiments, tool installation, and high-variance actions.
