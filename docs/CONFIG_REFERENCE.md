# Config reference

## Runtime

- `runtime.autonomous` — enables autonomous execution when allowed
- `runtime.review_required` — forces human review before risky actions
- `runtime.auto_apply` — allows low-risk evolution patches to be applied automatically
- `runtime.max_iterations` — upper bound on task refinement passes
- `runtime.checkpoint_every` — checkpoint cadence during execution

## Routing

- `routing.provider` — LLM backend selector
- `routing.model_fast` — lightweight routing / critique model
- `routing.model_code` — implementation-heavy model
- `routing.workflow_preference` — preferred workflow override
- `routing.framework_preference` — optional orchestration backends

## Evolution

- `evolution.proposal_only_by_default` — proposals are stored before application
- `evolution.auto_apply_low_risk` — only low-risk items may be auto-applied
- `evolution.budget.proposals_per_run` — number of proposals returned per evolution pass
- `evolution.budget.refinement_passes` — bounded evaluator passes

## Safety

- `safety.approval_required_for` — risk levels that must stay gated
- `safety.strict_review_targets` — target classes that require caution
- `safety.allow_destructive_actions` — should remain false in normal operation
