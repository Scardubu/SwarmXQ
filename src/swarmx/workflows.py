from __future__ import annotations

from pathlib import Path
from typing import Any

from .utils import load_yaml

DEFAULT_WORKFLOWS: dict[str, dict[str, Any]] = {
    "autonomous-pipeline": {
        "family": "general",
        "description": "Full-stack autonomous acceleration with planning, execution, validation, and memory capture.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Clarify the target, constraints, and success criteria."},
            {"name": "map", "owner": "strategist", "risk": "low", "purpose": "Map the repo surface area and likely stack signals."},
            {"name": "design", "owner": "backend-engineer", "risk": "medium", "purpose": "Propose the smallest high-leverage implementation plan."},
            {"name": "implement", "owner": "backend-engineer", "risk": "medium", "purpose": "Apply bounded improvements with stack-aware routing."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Validate the result and identify regressions."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Capture durable lessons and reusable patterns."},
        ],
    },
    "frontend-elite": {
        "family": "frontend",
        "description": "Elite frontend upgrade loop for UX clarity, motion, and design-system coherence.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the user-facing goal and the product surface."},
            {"name": "design-critique", "owner": "design-critic", "risk": "low", "purpose": "Find hierarchy, accessibility, and layout issues."},
            {"name": "frontend-architecture", "owner": "frontend-architect", "risk": "medium", "purpose": "Improve component structure, composition, and state flow."},
            {"name": "polish", "owner": "frontend-architect", "risk": "medium", "purpose": "Refine tokens, spacing, transitions, and micro-interactions."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Validate against the brief and catch regressions."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the design wins and reusable heuristics."},
        ],
    },
    "backend-elite": {
        "family": "backend",
        "description": "Backend hardening and acceleration loop focused on correctness and throughput.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Frame the backend objective and risk surface."},
            {"name": "architecture", "owner": "backend-engineer", "risk": "low", "purpose": "Map service boundaries, contracts, and dependencies."},
            {"name": "optimize", "owner": "performance-optimizer", "risk": "medium", "purpose": "Reduce latency, memory, and waste on hot paths."},
            {"name": "implement", "owner": "backend-engineer", "risk": "medium", "purpose": "Apply the minimal structural improvement."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Confirm correctness, resilience, and test coverage."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Capture the pattern for future use."},
        ],
    },
    "design-sprint": {
        "family": "frontend",
        "description": "Iterative product design sprint with critique and polish.",
        "risk": "low",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Capture the brief and constraints."},
            {"name": "wireframe", "owner": "design-critic", "risk": "low", "purpose": "Sketch the interaction path and information architecture."},
            {"name": "layout-review", "owner": "design-critic", "risk": "low", "purpose": "Challenge hierarchy, spacing, and accessibility."},
            {"name": "polish", "owner": "frontend-architect", "risk": "medium", "purpose": "Raise visual quality and component coherence."},
            {"name": "review", "owner": "evaluator", "risk": "low", "purpose": "Validate that the design still matches the brief."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store repeatable design patterns."},
        ],
    },
    "test-fix-loop": {
        "family": "quality",
        "description": "Iterative test stabilization and regression hardening.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Scope the failure and the current signal."},
            {"name": "reproduce", "owner": "qa-evaluator", "risk": "low", "purpose": "Make the failure deterministic."},
            {"name": "diagnose", "owner": "qa-evaluator", "risk": "medium", "purpose": "Find the root cause and the smallest fix."},
            {"name": "repair", "owner": "backend-engineer", "risk": "medium", "purpose": "Fix the implementation or test harness."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Rerun and confirm stability."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Record the flake pattern and prevention strategy."},
        ],
    },
    "release-guarded": {
        "family": "devops",
        "description": "Safe release preparation and rollout guardrails.",
        "risk": "high",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Clarify the release goal and the blast radius."},
            {"name": "package", "owner": "release-manager", "risk": "high", "purpose": "Assemble artifacts and manifest evidence."},
            {"name": "verify", "owner": "evaluator", "risk": "medium", "purpose": "Confirm checksums, tests, and trace completeness."},
            {"name": "review", "owner": "release-manager", "risk": "high", "purpose": "Perform go/no-go with a human gate if needed."},
            {"name": "release-notes", "owner": "memory-curator", "risk": "low", "purpose": "Write release notes and rollback notes."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store release lessons and gaps."},
        ],
    },
    "research-boost": {
        "family": "research",
        "description": "Research, synthesis, and evidence conversion loop.",
        "risk": "low",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the research question and decision criteria."},
            {"name": "collect", "owner": "research-analyst", "risk": "low", "purpose": "Gather primary sources and supporting material."},
            {"name": "synthesize", "owner": "research-analyst", "risk": "low", "purpose": "Distill evidence into a decision memo."},
            {"name": "implement", "owner": "backend-engineer", "risk": "medium", "purpose": "Translate the findings into code or config."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Check that the implementation matches the evidence."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the useful conclusions."},
        ],
    },
    "evolution-tournament": {
        "family": "meta",
        "description": "Propose, score, compare, and promote low-risk upgrades.",
        "risk": "low",
        "stages": [
            {"name": "observe", "owner": "evaluator", "risk": "low", "purpose": "Collect run evidence and the current baseline."},
            {"name": "propose", "owner": "evolver", "risk": "low", "purpose": "Generate bounded change proposals."},
            {"name": "score", "owner": "evaluator", "risk": "low", "purpose": "Score proposals for risk and leverage."},
            {"name": "select", "owner": "strategist", "risk": "low", "purpose": "Choose the best candidate under budget constraints."},
            {"name": "apply", "owner": "evolver", "risk": "medium", "purpose": "Apply only low-risk improvements with evidence."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the outcome and selection logic."},
        ],
    },
    "performance-tuning": {
        "family": "performance",
        "description": "Perf budget, bottleneck, and optimization loop.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the performance objective and baseline."},
            {"name": "profile", "owner": "performance-optimizer", "risk": "low", "purpose": "Measure the bottleneck and actual cost."},
            {"name": "identify", "owner": "performance-optimizer", "risk": "low", "purpose": "Find the dominant waste source."},
            {"name": "optimize", "owner": "backend-engineer", "risk": "medium", "purpose": "Apply the smallest targeted improvement."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Check the before/after effect and regressions."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the optimization pattern."},
        ],
    },
    "prompt-ops": {
        "family": "meta",
        "description": "Prompt architecture, instruction hierarchy, and control-loop refinement.",
        "risk": "low",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "State the prompt problem and the desired behavior."},
            {"name": "draft", "owner": "prompt-architect", "risk": "low", "purpose": "Write the strongest prompt structure and constraints."},
            {"name": "grade", "owner": "benchmark-analyst", "risk": "low", "purpose": "Evaluate the prompt against a rubric and examples."},
            {"name": "refine", "owner": "prompt-architect", "risk": "low", "purpose": "Tighten wording, ordering, and guardrails."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Confirm the prompt produces the intended outcome."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Capture the reusable prompt pattern."},
        ],
    },
    "benchmark-loop": {
        "family": "quality",
        "description": "Repeatable benchmark, eval, and comparison loop for code or prompts.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the benchmark goal and baseline."},
            {"name": "benchmark", "owner": "benchmark-analyst", "risk": "low", "purpose": "Run or design the benchmark harness."},
            {"name": "grade", "owner": "benchmark-analyst", "risk": "low", "purpose": "Score variants using the evaluation rubric."},
            {"name": "optimize", "owner": "backend-engineer", "risk": "medium", "purpose": "Apply the smallest improvement that wins on the benchmark."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Re-run to confirm the improvement is real."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the benchmark lesson and threshold."},
        ],
    },
    "incident-response": {
        "family": "operations",
        "description": "Stabilize incidents with containment, diagnosis, and recovery.",
        "risk": "high",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Capture the incident scope and customer impact."},
            {"name": "contain", "owner": "release-manager", "risk": "high", "purpose": "Limit blast radius and stop the bleeding."},
            {"name": "diagnose", "owner": "evaluator", "risk": "medium", "purpose": "Identify the failure mode and current evidence."},
            {"name": "mitigate", "owner": "backend-engineer", "risk": "high", "purpose": "Apply a minimal stabilizing change."},
            {"name": "verify", "owner": "qa-evaluator", "risk": "medium", "purpose": "Confirm recovery and watch for regressions."},
            {"name": "postmortem", "owner": "memory-curator", "risk": "low", "purpose": "Record what happened and how to prevent recurrence."},
        ],
    },
    "architecture-review": {
        "family": "architecture",
        "description": "Deep system design critique and implementation plan.",
        "risk": "medium",
        "stages": [
            {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "State the architecture question clearly."},
            {"name": "map", "owner": "backend-engineer", "risk": "low", "purpose": "Map boundaries, dependencies, and critical paths."},
            {"name": "critique", "owner": "design-critic", "risk": "low", "purpose": "Pressure-test structure, clarity, and usability."},
            {"name": "recommend", "owner": "backend-engineer", "risk": "medium", "purpose": "Write the implementation direction and tradeoffs."},
            {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Check the proposal against objectives and constraints."},
            {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Record durable architecture lessons."},
        ],
    },
"producer-reviewer": {
    "family": "quality",
    "description": "Producer-reviewer loop for fast implementation with a strict review gate.",
    "risk": "medium",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the scope, expected outcome, and stop condition."},
        {"name": "produce", "owner": "producer", "risk": "medium", "purpose": "Implement the smallest safe change slice."},
        {"name": "review", "owner": "reviewer", "risk": "medium", "purpose": "Challenge the change for correctness, safety, and completeness."},
        {"name": "revise", "owner": "producer", "risk": "medium", "purpose": "Apply the review findings without expanding scope."},
        {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Confirm the final state against acceptance criteria."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the review lesson and reusable pattern."},
    ],
},
"fan-out-fan-in": {
    "family": "meta",
    "description": "Parallel specialist execution with evidence merge and convergence.",
    "risk": "medium",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the objective and identify independent branches."},
        {"name": "decompose", "owner": "subagent-coordinator", "risk": "low", "purpose": "Split the problem into parallel subproblems."},
        {"name": "fan-out", "owner": "expert-pool", "risk": "low", "purpose": "Assign the right specialists to each branch."},
        {"name": "fan-in", "owner": "subagent-coordinator", "risk": "low", "purpose": "Merge results, resolve conflicts, and synthesize evidence."},
        {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Check the merged result for consistency and regressions."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Record the decomposition pattern for reuse."},
    ],
},
"hierarchical-delegation": {
    "family": "meta",
    "description": "Recursive delegation from supervisor to specialists and back.",
    "risk": "medium",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Frame the goal and the supervision boundary."},
        {"name": "architect", "owner": "chief-architect", "risk": "low", "purpose": "Define the team topology and decision lanes."},
        {"name": "delegate", "owner": "subagent-coordinator", "risk": "low", "purpose": "Send scoped work to specialists with clear contracts."},
        {"name": "synthesize", "owner": "subagent-coordinator", "risk": "low", "purpose": "Merge specialist outputs into a coherent plan."},
        {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Validate the synthesis and surface gaps."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Persist the delegation pattern."},
    ],
},
"expert-pool": {
    "family": "meta",
    "description": "Selective expert invocation for mixed-domain objectives.",
    "risk": "low",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Clarify the objective and the domains involved."},
        {"name": "select-experts", "owner": "expert-pool", "risk": "low", "purpose": "Choose the minimum useful expert set."},
        {"name": "consult", "owner": "expert-pool", "risk": "low", "purpose": "Ask each expert only what they are uniquely qualified to answer."},
        {"name": "combine", "owner": "subagent-coordinator", "risk": "low", "purpose": "Merge the expert responses without duplication."},
        {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Check the combined answer for coverage and gaps."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the specialist selection heuristic."},
    ],
},
"skill-lifecycle": {
    "family": "meta",
    "description": "Inspect, create, validate, and publish reusable skills.",
    "risk": "low",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the recurring problem to codify."},
        {"name": "inspect", "owner": "skill-sentinel", "risk": "low", "purpose": "Find current gaps, duplicates, and drift in the catalog."},
        {"name": "synthesize", "owner": "skill-developer", "risk": "low", "purpose": "Draft the new or improved skill."},
        {"name": "validate", "owner": "skill-check", "risk": "low", "purpose": "Run structural and semantic checks."},
        {"name": "publish", "owner": "skill-librarian", "risk": "low", "purpose": "Promote the skill into the reusable library."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the catalog lesson and trigger pattern."},
    ],
},
"repo-bootstrap": {
    "family": "devops",
    "description": "Bootstrap a repository with secure, reproducible, agent-friendly setup.",
    "risk": "medium",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Identify the repo type and bootstrap goals."},
        {"name": "audit-settings", "owner": "environment-governor", "risk": "low", "purpose": "Audit permissions, settings, and environment assumptions."},
        {"name": "prepare-env", "owner": "environment-governor", "risk": "medium", "purpose": "Prepare the devcontainer, lockfiles, and pinned tools."},
        {"name": "install-tools", "owner": "workflow-router", "risk": "medium", "purpose": "Wire the minimum useful tools and adapters."},
        {"name": "verify", "owner": "evaluator", "risk": "low", "purpose": "Confirm the bootstrap is reproducible and bounded."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Record the bootstrap profile."},
    ],
},
"agentic-security-audit": {
    "family": "security",
    "description": "Audit agent-facing workflows, GitHub Actions, and secret handling.",
    "risk": "high",
    "stages": [
        {"name": "intake", "owner": "strategist", "risk": "low", "purpose": "Define the security review scope and blast radius."},
        {"name": "threat-model", "owner": "security-auditor", "risk": "high", "purpose": "Map threats across automation, tooling, and permissions."},
        {"name": "audit-actions", "owner": "agentic-actions-auditor", "risk": "high", "purpose": "Review GitHub Actions and agent integrations for weaknesses."},
        {"name": "scan-secrets", "owner": "varlock", "risk": "high", "purpose": "Check env handling, secret exposure, and logging boundaries."},
        {"name": "gate", "owner": "risk-sentinel", "risk": "high", "purpose": "Block unsafe changes and require human approval where needed."},
        {"name": "learn", "owner": "memory-curator", "risk": "low", "purpose": "Store the security pattern and the negative examples."},
    ],
},
"agent-council": {
    "family": 'meta',
    "description": 'Executive swarm council for architecture, workflow selection, and safety arbitration.',
    "risk": 'medium',
    "stages": [{'name': 'intake', 'owner': 'strategist', 'risk': 'low', 'purpose': 'Frame the objective and the decision boundary.'}, {'name': 'map', 'owner': 'chief-architect', 'risk': 'low', 'purpose': 'Map the system, the attack surface, and the leverage points.'}, {'name': 'compose', 'owner': 'workflow-composer', 'risk': 'low', 'purpose': 'Choose the best workflow or synthesize a new one.'}, {'name': 'route', 'owner': 'strategist', 'risk': 'low', 'purpose': 'Assign specialist agents and budgets after the winning path has been chosen.'}, {'name': 'adjudicate', 'owner': 'tournament-judge', 'risk': 'low', 'purpose': 'Compare 2-3 candidate paths internally, then select the strongest evidence-backed path.'}, {'name': 'gate', 'owner': 'risk-sentinel', 'risk': 'high', 'purpose': 'Block unsafe actions and require human approval when needed.'}, {'name': 'learn', 'owner': 'memory-curator', 'risk': 'low', 'purpose': 'Store the decision trail and reusable heuristics.'}],
},

"codebase-modernization": {
    "family": 'general',
    "description": 'Deep codebase modernization with architecture, refactor safety, and validation.',
    "risk": 'medium',
    "stages": [{'name': 'intake', 'owner': 'strategist', 'risk': 'low', 'purpose': 'Define the modernization objective and constraints.'}, {'name': 'map', 'owner': 'chief-architect', 'risk': 'low', 'purpose': 'Map critical paths, coupling, and module boundaries.'}, {'name': 'diagnose', 'owner': 'evaluator', 'risk': 'low', 'purpose': 'Identify the highest leverage defects and technical debt.'}, {'name': 'refactor', 'owner': 'backend-engineer', 'risk': 'medium', 'purpose': 'Apply the smallest safe structural improvement.'}, {'name': 'optimize', 'owner': 'performance-optimizer', 'risk': 'medium', 'purpose': 'Remove waste and improve the hot path.'}, {'name': 'verify', 'owner': 'qa-evaluator', 'risk': 'low', 'purpose': 'Validate behavior, regressions, and edge cases.'}, {'name': 'learn', 'owner': 'memory-curator', 'risk': 'low', 'purpose': 'Record the modernization pattern.'}],
},

"hardening-sprint": {
    "family": 'security',
    "description": 'Guarded hardening sprint for risky surfaces, secrets, and release paths.',
    "risk": 'high',
    "stages": [{'name': 'intake', 'owner': 'strategist', 'risk': 'low', 'purpose': 'Define the hardening scope and approval requirements.'}, {'name': 'threat-model', 'owner': 'security-reviewer', 'risk': 'high', 'purpose': 'Enumerate credible threats and privileged surfaces.'}, {'name': 'patch', 'owner': 'backend-engineer', 'risk': 'medium', 'purpose': 'Apply the smallest safe hardening patch.'}, {'name': 'verify', 'owner': 'evaluator', 'risk': 'medium', 'purpose': 'Validate evidence and confirm no new exposure.'}, {'name': 'gate', 'owner': 'risk-sentinel', 'risk': 'high', 'purpose': 'Enforce human review for high-risk changes.'}, {'name': 'learn', 'owner': 'memory-curator', 'risk': 'low', 'purpose': 'Record the security lesson and rollback path.'}],
},

"security-deep-dive": {
    "family": 'security',
    "description": 'Risk-first review loop with explicit approvals and evidence.',
    "risk": 'high',
    "stages": [{'name': 'intake', 'owner': 'strategist', 'risk': 'low', 'purpose': 'Define assets, trust boundaries, and blast radius.'}, {'name': 'threat-model', 'owner': 'security-reviewer', 'risk': 'high', 'purpose': 'Enumerate threats, abuse cases, and sensitive paths.'}, {'name': 'scan', 'owner': 'security-reviewer', 'risk': 'high', 'purpose': 'Review code, configs, and dependencies for exposure.'}, {'name': 'review', 'owner': 'evaluator', 'risk': 'medium', 'purpose': 'Validate evidence and require approvals where appropriate.'}, {'name': 'verify', 'owner': 'qa-evaluator', 'risk': 'medium', 'purpose': 'Check the mitigation path without weakening controls.'}, {'name': 'learn', 'owner': 'memory-curator', 'risk': 'low', 'purpose': 'Preserve the security lesson and the gate that mattered.'}],
},

"self-improving-pipeline": {
    "family": 'meta',
    "description": 'Recursive proposer-solver-reviewer-memorizer loop for self-improving runs.',
    "risk": 'medium',
    "stages": [{'name': 'intake', 'owner': 'strategist', 'risk': 'low', 'purpose': 'Frame the objective, constraints, and stop conditions.'}, {'name': 'observe', 'owner': 'evaluator', 'risk': 'low', 'purpose': 'Collect the evidence surface, baseline quality, and failure signals.'}, {'name': 'propose', 'owner': 'evolver', 'risk': 'low', 'purpose': 'Generate bounded improvement candidates, compare them silently, and rank by leverage.'}, {'name': 'solve', 'owner': 'backend-engineer', 'risk': 'medium', 'purpose': 'Apply the smallest safe code or configuration change.'}, {'name': 'critique', 'owner': 'evaluator', 'risk': 'low', 'purpose': 'Challenge the selected change, expose weak spots, and force one refinement when needed.'}, {'name': 'mutate', 'owner': 'evolver', 'risk': 'low', 'purpose': 'Promote the winning mutation or keep it as a proposal without widening scope.'}, {'name': 'verify', 'owner': 'qa-evaluator', 'risk': 'low', 'purpose': 'Re-run checks, confirm regressions are absent, and capture proof.'}, {'name': 'memorize', 'owner': 'memory-curator', 'risk': 'low', 'purpose': 'Persist the lesson, mutation, and retrieval cues.'}],
},

"skill-synthesis": {
    "family": 'meta',
    "description": 'Transform successful run patterns into reusable skills and templates.',
    "risk": 'low',
    "stages": [{'name': 'observe', 'owner': 'evaluator', 'risk': 'low', 'purpose': 'Collect recent run outcomes, evidence, and recurring motifs.'}, {'name': 'distill', 'owner': 'skill-curator', 'risk': 'low', 'purpose': 'Extract high-value habits, compress them, and convert them into skill candidates.'}, {'name': 'rank', 'owner': 'tournament-judge', 'risk': 'low', 'purpose': 'Score candidate skills by leverage, frequency, transferability, and clarity.'}, {'name': 'publish', 'owner': 'skill-curator', 'risk': 'low', 'purpose': 'Write the synthesized skills to the reusable library with minimal duplication.'}, {'name': 'verify', 'owner': 'evaluator', 'risk': 'low', 'purpose': 'Check that the new skills are consistent with evidence.'}, {'name': 'learn', 'owner': 'memory-curator', 'risk': 'low', 'purpose': 'Store the skill synthesis lesson and retrieval cues.'}],
},


}


def _stage_name(stage: Any) -> str:
    if isinstance(stage, dict):
        return str(stage.get("name") or stage.get("stage") or stage.get("title") or "stage")
    return str(stage)


def _stage_details(stage: Any) -> dict[str, Any]:
    if isinstance(stage, dict):
        payload = dict(stage)
        payload.setdefault("name", _stage_name(stage))
        return payload
    return {"name": _stage_name(stage)}


def load_workflow(name: str, bundle_root: Path | None = None) -> dict[str, Any]:
    if bundle_root:
        for ext in ("yaml", "yml", "json"):
            path = bundle_root / "workflows" / f"{name}.{ext}"
            if path.exists():
                data = load_yaml(path, {})
                if data:
                    return data
    return DEFAULT_WORKFLOWS.get(name, {"family": "general", "description": "", "stages": []})


def list_workflows(bundle_root: Path | None = None) -> list[str]:
    names = set(DEFAULT_WORKFLOWS)
    root = bundle_root or Path(__file__).resolve().parents[2]
    wf_dir = root / "workflows"
    if wf_dir.exists():
        for pattern in ("*.yaml", "*.yml", "*.json"):
            for path in wf_dir.glob(pattern):
                names.add(path.stem)
    return sorted(names)


def normalize_workflow(name: str, payload: dict[str, Any]) -> dict[str, Any]:
    stages = payload.get("stages", []) or []
    return {
        "name": name,
        "family": payload.get("family", "general"),
        "description": payload.get("description", ""),
        "risk": payload.get("risk", "medium"),
        "stages": [_stage_name(stage) for stage in stages],
        "stage_details": [_stage_details(stage) for stage in stages],
    }


def workflow_for_target(stack: list[str], target: str, preferred: str | None = None) -> str:
    t = target.lower()
    if preferred and preferred in DEFAULT_WORKFLOWS:
        return preferred
    if any(k in t for k in ["deep dive", "deep-dive", "full review", "end to end security", "red team"]):
        return "security-deep-dive"
    if any(k in t for k in ["security", "auth", "payment", "secret", "compliance"]):
        return "agentic-security-audit"
    if any(k in t for k in ["deep dive", "deep-dive", "full review", "end to end security", "red team"]):
        return "security-deep-dive"
    if any(k in t for k in ["benchmark", "eval", "grading", "rubric", "score"]):
        return "benchmark-loop"
    if any(k in t for k in ["skill synthesis", "synthesize skills", "build skills", "skill library", "generate skills"]):
        return "skill-synthesis"
    if any(k in t for k in ["self-improve", "self improve", "recursive", "mutation", "living swarm", "meta-evolution", "evolve"]):
        return "self-improving-pipeline"
    if any(k in t for k in ["council", "architecture council", "swarm council", "governance"]):
        return "agent-council"
    if any(k in t for k in ["skill synthesis", "skills", "template", "library", "catalog"]):
        return "skill-lifecycle"
    if any(k in t for k in ["parallel", "fan out", "fan-out", "multi angle", "cross validate"]):
        return "fan-out-fan-in"
    if any(k in t for k in ["subagent", "sub-agent", "independent task", "baton", "handoff", "hand off"]):
        return "hierarchical-delegation"
    if any(k in t for k in ["harness", "agent team", "orchestrator", "team design"]):
        return "hierarchical-delegation"
    if any(k in t for k in ["bootstrap", "devcontainer", "settings", "permissions", "env", "environment"]):
        return "repo-bootstrap"
    if any(k in t for k in ["expo", "react native", "react-native", "mobile build", "ios build", "android build"]):
        return "frontend-elite"
    if any(k in t for k in ["review", "merge", "code review", "revise"]):
        return "producer-reviewer"
    if any(k in t for k in ["modernize", "modernization", "refactor", "cleanup", "migration"]):
        return "codebase-modernization"
    if any(k in t for k in ["harden", "hardening", "security sprint", "safety"]):
        return "hardening-sprint"
    if any(k in t for k in ["prompt", "instruction", "system prompt"]):
        return "prompt-ops"
    if any(k in t for k in ["design", "ux", "layout", "ui", "visual", "motion"]):
        return "design-sprint"
    if any(k in t for k in ["test", "ci", "flaky", "failure", "regression"]):
        return "test-fix-loop"
    if any(k in t for k in ["release", "deploy", "ship", "publish"]):
        return "release-guarded"
    if any(k in t for k in ["research", "study", "analysis", "paper"]):
        return "research-boost"
    if any(k in t for k in ["architecture", "system design", "design review"]):
        return "architecture-review"
    if "frontend" in stack and "backend" in stack:
        return "autonomous-pipeline"
    if "frontend" in stack:
        return "frontend-elite"
    if "backend" in stack:
        return "backend-elite"
    if any(k in t for k in ["perf", "performance", "latency", "throughput"]):
        return "performance-tuning"
    return "autonomous-pipeline"


def workflow_summary(bundle_root: Path | None = None) -> list[dict[str, Any]]:
    root = bundle_root or Path(__file__).resolve().parents[2]
    return [normalize_workflow(name, load_workflow(name, bundle_root=root)) for name in list_workflows(bundle_root=root)]
