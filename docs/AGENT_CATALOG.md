# Agent catalog

This catalog describes human-facing agent roles. Runtime model identity still
comes from `packages/swarmx-types/src/operator-map.ts` and the Python mirror in
`src/swarmx/operator_map.py`; do not assign raw model tags here. Agent
implementations should request an operator role such as Relay, Pilot,
Architect, Forge, Oracle, Auditor, or Lab and let the orchestrator resolve the
canonical tag.

## Core runtime roles

- **strategist** — clarifies the goal, splits work, and enforces stop conditions
- **evaluator** — grades outputs and validates readiness
- **memory-curator** — persists lessons and reusable patterns
- **evolver** — proposes bounded improvements to the swarm itself
- **prompt-architect** — tightens instructions and prompt hygiene

## Domain roles

- **design-critic** — pushes layout, hierarchy, and accessibility quality
- **frontend-architect** — improves UI structure and implementation coherence
- **backend-engineer** — handles APIs, services, contracts, and correctness
- **performance-optimizer** — removes latency and waste
- **qa-evaluator** — stabilizes tests and regressions
- **release-manager** — gates releases and prepares rollout evidence
- **security-reviewer** — threat-models risky paths and enforces approvals
- **mcp-toolsmith** — integrates external tools under least privilege
- **research-analyst** — converts sources into action
- **benchmark-analyst** — runs comparisons and scores variants
- **incident-commander** — contains outages and preserves postmortem evidence

## Internal behavior

All agents now share the same internal competition, critic, confidence-gating, and compression protocol while preserving their existing interfaces.

## Runtime constraints

- The orchestrator owns routing. Agents do not route themselves or select
  unvalidated model tags.
- Tool access is allowlisted per role; no agent receives wildcard tool access.
- Local CPU inference is serial. `OLLAMA_NUM_PARALLEL` remains `1`, and
  `OLLAMA_MAX_LOADED_MODELS=2` on 16 GB means dual residency only, not
  concurrent inference.
- Prompt-injection defenses treat user content as hostile input. User text goes
  in user turns or validated payload fields, never into system prompts.
- Agent failures must report stable error codes, retryability, and the operator
  role involved so the dashboard can attribute the fault to the correct layer.
