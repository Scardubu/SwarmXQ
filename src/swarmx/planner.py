from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from .config import SwarmConfig
from .risk import approval_required, risk_for_path, risk_from_text
from .skills import match_skills
from .state import AgentRole, Plan, RiskLevel, TaskItem
from .workflows import load_workflow, normalize_workflow, workflow_for_target

STACK_RULES = {
    "frontend": ["package.json", "pnpm-lock.yaml", "yarn.lock", "bun.lockb", "src", "app", "pages", "components", "vite.config", "next.config", "nuxt.config", "remix.config", "svelte.config", "astro.config", "tailwind.config", "ui", "design", "tsconfig.json"],
    "backend": ["pyproject.toml", "requirements.txt", "poetry.lock", "Pipfile", "app.py", "main.py", "server.py", "src", "go.mod", "Cargo.toml", "pom.xml", "build.gradle", "api", "service"],
    "mobile": ["ios", "android", "flutter", "pubspec.yaml"],
    "devops": ["Dockerfile", "docker-compose", "k8s", "helm", "terraform", ".github/workflows", "release", "chart.yaml"],
    "security": ["security", "auth", "policy", "compliance", "oauth", "sso", "secret"],
    "data": ["db", "warehouse", "analytics", "etl", "pipeline", "postgres", "mysql", "sqlite", "parquet"],
    "dotnet": [".csproj", ".sln", "appsettings.json", "packages.lock.json"],
    "java": ["pom.xml", "build.gradle", "gradlew", "settings.gradle"],
    "rust": ["Cargo.toml", "Cargo.lock"],
    "go": ["go.mod", "go.sum"],
    "ruby": ["Gemfile", "Rakefile"],
    "php": ["composer.json", "artisan", "phpunit.xml"],
}


def _collect_paths(repo: Path) -> list[str]:
    out: list[str] = []
    for root, dirs, files in os.walk(repo):
        rel_root = Path(root).relative_to(repo)
        rel_str = rel_root.as_posix()
        if rel_str.startswith(".git") or rel_str.startswith(".swarmx"):
            dirs[:] = []
            continue
        dirs[:] = [d for d in dirs if d not in {".git", ".swarmx", "node_modules", "dist", "build", "target", "vendor", "coverage", "__pycache__", ".next"}]
        for d in dirs:
            out.append((rel_root / d).as_posix() if rel_str != "." else d)
        for f in files:
            out.append((rel_root / f).as_posix() if rel_str != "." else f)
        if len(out) > 7000:
            break
    return out


def detect_stack(repo: Path) -> list[str]:
    entries = [p.lower() for p in _collect_paths(repo)]
    stack: list[str] = []
    for name, needles in STACK_RULES.items():
        if any(any(needle.lower() in item for needle in needles) for item in entries):
            stack.append(name)
    if not stack:
        stack.append("generic")
    return stack


def _role(name: str, mission: str, tools: list[str], human_gate: bool = False, model_hint: str | None = None, skill_tags: list[str] | None = None, framework_tags: list[str] | None = None) -> AgentRole:
    return AgentRole(
        name=name,
        mission=mission,
        tools=tools,
        model_hint=model_hint,
        can_autorun=not human_gate,
        human_gate=human_gate,
        skill_tags=skill_tags or [],
        framework_tags=framework_tags or [],
    )


def build_roles(stack: list[str], target: str, frameworks: list[str] | None = None) -> list[AgentRole]:
    frameworks = frameworks or []
    target_l = target.lower()
    roles = [
        _role("strategist", "Clarify goals, split work, and enforce stop conditions.", ["git", "python"], model_hint="fast", skill_tags=["autonomy-ops", "workflow-routing", "skill-router", "latent-ensemble-selection", "signal-triage", "output-quality-gate", "confidence-gating"]),
        _role("workflow-router", "Choose the best skill set and workflow shape for the task.", ["git", "python"], model_hint="fast", skill_tags=["skill-router", "workflow-routing", "autonomy-ops", "confidence-gating"]),
        _role("chief-architect", "Define durable boundaries, system shape, and design tradeoffs.", ["git", "python"], model_hint="reason", skill_tags=["chief-architecture", "backend-architecture", "refactor-safety", "latent-ensemble-selection"], framework_tags=["langgraph", "crewai", "adk"]),
        _role("workflow-composer", "Select or synthesize the best workflow for the objective and stack.", ["git", "python"], model_hint="reason", skill_tags=["workflow-composition", "workflow-routing", "fan-out-fan-in", "producer-reviewer", "expert-pool", "hierarchical-delegation", "latent-ensemble-selection"], framework_tags=["langgraph", "agent_framework"]),
        _role("risk-sentinel", "Enforce safety boundaries, approvals, and rollback discipline.", ["git", "python"], human_gate=True, model_hint="fast", skill_tags=["risk-sentinel", "security-hardening", "release-governance", "agentic-actions-auditor", "varlock", "confidence-gating"], framework_tags=["openai_agents", "adk"]),
        _role("evaluator", "Run checks, score results, and verify acceptance criteria.", ["git", "python"], model_hint="fast", skill_tags=["observability", "test-stabilization", "eval-grading", "critic-gate", "signal-triage", "output-quality-gate", "confidence-gating"], framework_tags=["langgraph", "agent_framework"]),
        _role("memory-curator", "Record durable lessons, preferences, and reusable patterns.", ["git", "python"], model_hint="fast", skill_tags=["memory-architecture", "skill-synthesis", "precision-compression"]),
        _role("skill-curator", "Promote repeated wins into reusable skills and templates.", ["git", "python"], model_hint="fast", skill_tags=["skill-synthesis", "template-authoring", "memory-architecture", "skill-developer", "skill-improver", "skill-check", "confidence-gating"]),
        _role("subagent-coordinator", "Split work into subagents and merge their outputs deterministically.", ["git", "python"], model_hint="reason", skill_tags=["subagent-driven-development", "hierarchical-delegation", "fan-out-fan-in", "precision-compression"]),
        _role("expert-pool", "Select the minimum useful specialist set for the task.", ["git", "python"], model_hint="reason", skill_tags=["expert-pool", "fan-out-fan-in", "latent-ensemble-selection"]),
        _role("producer", "Implement the smallest safe change slice and hand evidence to review.", ["git", "python"], model_hint="code", skill_tags=["producer-reviewer", "subagent-driven-development", "precision-compression"]),
        _role("reviewer", "Review produced work for correctness, safety, and completeness.", ["git", "python"], model_hint="fast", skill_tags=["producer-reviewer", "skill-check", "eval-grading", "critic-gate"]),
        _role("tournament-judge", "Compare candidate plans and select the strongest evidence-backed survivor.", ["git", "python"], model_hint="fast", skill_tags=["tournament-selection", "eval-grading", "benchmarking", "latent-ensemble-selection", "confidence-gating"]),
    ]
    if "frontend" in stack or any(k in target_l for k in ["ui", "ux", "design", "layout", "visual", "motion", "accessibility"]):
        roles.extend([
            _role("design-critic", "Pressure-test hierarchy, flow, motion, accessibility, and polish.", ["git", "node", "npm"], model_hint="fast", skill_tags=["design-critique", "design-system-polish"], framework_tags=["langgraph", "crewai", "strands"]),
            _role("frontend-architect", "Improve component systems, interactions, and frontend implementation quality.", ["git", "node", "npm", "pnpm"], model_hint="code", skill_tags=["frontend-experience", "design-system-polish", "refactor-safety"], framework_tags=["langgraph", "crewai", "strands"]),
        ])
    if "backend" in stack or any(k in target_l for k in ["api", "service", "db", "database", "backend", "data", "pipeline", "etl"]):
        roles.extend([
            _role("backend-engineer", "Improve APIs, data flows, error handling, and performance.", ["git", "python", "go", "cargo", "dotnet", "java"], model_hint="code", skill_tags=["backend-architecture", "backend-performance", "refactor-safety"], framework_tags=["autogen", "adk", "langgraph"]),
            _role("data-engineer", "Improve schemas, pipelines, query efficiency, and data observability.", ["git", "python", "sql", "go"], model_hint="code", skill_tags=["observability", "backend-performance", "research-acceleration", "benchmarking"], framework_tags=["langgraph", "adk", "crewai"]),
            _role("performance-optimizer", "Find bottlenecks and reduce latency, memory, and waste.", ["git", "python"], model_hint="code", skill_tags=["performance-optimization", "backend-performance", "benchmarking"], framework_tags=["langgraph", "autogen"]),
        ])
    if "security" in stack or any(k in target_l for k in ["auth", "payment", "security", "compliance", "secret"]):
        roles.append(_role("security-reviewer", "Threat-model risky paths, secrets, auth, and release impact.", ["git", "python"], human_gate=True, model_hint="code", skill_tags=["security-hardening", "release-governance"], framework_tags=["openai_agents", "adk", "crewai"]))
        roles.append(_role("risk-sentinel", "Enforce safety gates and rollback expectations for high-impact operations.", ["git", "python"], human_gate=True, model_hint="fast", skill_tags=["risk-sentinel", "security-hardening"]))
    if any(k in target_l for k in ["release", "deploy", "ship", "publish"]):
        roles.append(_role("release-manager", "Stage, validate, and gate release preparation.", ["git", "python"], human_gate=True, model_hint="code", skill_tags=["release-readiness", "release-governance", "incident-command"], framework_tags=["crewai", "adk", "langgraph"]))
    if any(k in target_l for k in ["test", "ci", "flaky", "failure", "regression"]):
        roles.append(_role("qa-evaluator", "Reproduce, isolate, and stabilize failing checks.", ["git", "python", "pytest"], model_hint="code", skill_tags=["test-stabilization", "eval-grading", "benchmarking"], framework_tags=["langgraph", "autogen"]))
    if any(k in target_l for k in ["research", "study", "analysis", "paper"]):
        roles.append(_role("research-analyst", "Synthesize evidence into actionable engineering guidance.", ["git", "python"], model_hint="reason", skill_tags=["research-acceleration", "context7-auto-research"], framework_tags=["autogen", "strands"]))
        roles.append(_role("context-researcher", "Fetch current documentation and freshness-sensitive guidance.", ["git", "python"], model_hint="reason", skill_tags=["context7-auto-research", "research-acceleration"], framework_tags=["langgraph", "openai_agents"]))
    if any(k in target_l for k in ["bootstrap", "devcontainer", "settings", "permissions", "env", "environment"]):
        roles.append(_role("environment-governor", "Set up reproducible environments, permissions, and secure variables.", ["git", "python"], model_hint="code", skill_tags=["devcontainer-setup", "claude-settings-audit", "varlock"], framework_tags=["langgraph", "openai_agents", "mcp"]))
    if any(k in target_l for k in ["security", "audit", "actions", "workflow", "secret"]):
        roles.append(_role("security-auditor", "Audit workflows, secrets, and agent integrations for security issues.", ["git", "python"], human_gate=True, model_hint="reason", skill_tags=["agentic-actions-auditor", "varlock", "security-hardening"], framework_tags=["openai_agents", "langgraph"]))
    if any(k in target_l for k in ["tool", "mcp", "integration", "automation"]):
        roles.append(_role("mcp-toolsmith", "Bind external tools and context providers with a clean MCP surface.", ["git", "python"], model_hint="code", skill_tags=["mcp-tooling", "workflow-routing"], framework_tags=["mcp", "autogen"]))
    if any(k in target_l for k in ["prompt", "instruction", "system prompt"]):
        roles.append(_role("prompt-architect", "Design prompt hierarchies, constraints, and reusable control prompts.", ["git", "python"], model_hint="reason", skill_tags=["prompt-ops", "eval-grading"], framework_tags=["langgraph", "openai_agents", "agent_framework"]))
        roles.append(_role("skill-curator", "Capture reusable prompt patterns and template them for future runs.", ["git", "python"], model_hint="fast", skill_tags=["skill-synthesis", "template-authoring"]))
    if any(k in target_l for k in ["benchmark", "eval", "grading", "rubric", "score"]):
        roles.append(_role("benchmark-analyst", "Build rubrics, compare variants, and promote the best measured outcome.", ["git", "python"], model_hint="reason", skill_tags=["benchmarking", "eval-grading"], framework_tags=["langgraph", "autogen", "agent_framework"]))
    if any(k in target_l for k in ["incident", "outage", "postmortem", "rollback"]):
        roles.append(_role("incident-commander", "Coordinate containment, mitigation, and evidence-preserving recovery.", ["git", "python"], human_gate=True, model_hint="reason", skill_tags=["incident-command", "security-hardening"], framework_tags=["crewai", "langgraph", "adk"]))
    roles.append(_role("evolver", "Propose bounded upgrades to roles, tools, thresholds, and workflow routing.", ["git", "python"], human_gate=True, model_hint="reason", skill_tags=["autonomy-ops", "memory-architecture", "workflow-routing"], framework_tags=["langgraph", "adk", "crewai"]))
    # Deduplicate by role name — first occurrence (base council) wins
    seen: set[str] = set()
    deduped: list[AgentRole] = []
    for role in roles:
        if role.name not in seen:
            seen.add(role.name)
            deduped.append(role)
    return deduped


def _stage_owner(stage: str, stack: list[str], target: str) -> tuple[str, RiskLevel]:
    s = stage.lower()
    target_l = target.lower()
    if s in {"intake", "triage", "classify", "observe", "map"}:
        return "strategist", RiskLevel.LOW
    if s in {"design-critique", "wireframe", "layout-review", "polish", "design-system"}:
        return "design-critic", RiskLevel.MEDIUM
    if s in {"benchmark", "grade", "score"}:
        return "benchmark-analyst", RiskLevel.LOW
    if s in {"architecture", "recommend", "implement", "optimize", "repair", "mitigate", "draft"}:
        if "frontend" in stack and "backend" not in stack:
            return "frontend-architect", RiskLevel.MEDIUM
        if "backend" in stack or any(k in target_l for k in ["api", "service", "db", "backend"]):
            return "backend-engineer", RiskLevel.MEDIUM
        return "backend-engineer", RiskLevel.MEDIUM
    if s in {"profile", "performance", "identify"}:
        return "performance-optimizer", RiskLevel.MEDIUM
    if s in {"threat-model", "scan", "security", "audit-actions", "scan-secrets"}:
        return "security-reviewer", RiskLevel.HIGH
    if s in {"gate"}:
        return "risk-sentinel", RiskLevel.HIGH
    if s in {"verify", "qa", "test", "visual-qa"}:
        return "evaluator", RiskLevel.MEDIUM
    if s in {"review"}:
        return "reviewer", RiskLevel.MEDIUM
    if s in {"release", "package", "release-notes"}:
        return "release-manager", RiskLevel.HIGH
    if s in {"produce", "revise"}:
        return "producer", RiskLevel.MEDIUM
    if s in {"collect", "synthesize"}:
        return "research-analyst", RiskLevel.LOW
    if s in {"learn", "postmortem", "reflect", "retrospect", "memorize"}:
        return "memory-curator", RiskLevel.LOW
    if s in {"evolve", "propose", "apply"}:
        return "evolver", RiskLevel.MEDIUM
    if s in {"prompt", "instruction", "system-prompt", "prompt-ops"}:
        return "prompt-architect", RiskLevel.LOW
    if s in {"incident", "contain", "rollback"}:
        return "incident-commander", RiskLevel.HIGH
    if s in {"decompose", "fan-in", "synthesize-merge"}:
        return "subagent-coordinator", RiskLevel.LOW
    if s in {"fan-out", "select-experts", "consult", "combine"}:
        return "expert-pool", RiskLevel.LOW
    if s in {"delegate", "architect"}:
        return "chief-architect", RiskLevel.LOW
    if s in {"inspect", "validate", "publish"}:
        return "skill-curator", RiskLevel.LOW
    if s in {"audit-settings", "prepare-env", "install-tools"}:
        return "environment-governor", RiskLevel.MEDIUM
    return "strategist", RiskLevel.LOW


def _risk_from_value(value: Any, fallback: RiskLevel) -> RiskLevel:
    if isinstance(value, RiskLevel):
        return value
    if isinstance(value, str):
        try:
            return RiskLevel(value.lower())
        except Exception:
            return fallback
    return fallback


# ── Static owner → model_hint mapping (mirrors build_roles triadic_dispatch) ──
# Used by _build_tasks() to propagate the correct triadic dispatch hint to each
# TaskItem without requiring the full roles list to be threaded through.
# FIX v4.1-post: replaces undefined `role.model_hint` NameError on line 220.
_OWNER_MODEL_HINTS: dict[str, str] = {
    # ── Phi-4-mini (fast) — routing, evaluation, lightweight ops ─────────────
    "strategist":          "fast",
    "workflow-router":     "fast",
    "evaluator":           "fast",
    "memory-curator":      "fast",
    "skill-curator":       "fast",
    "reviewer":            "fast",
    "tournament-judge":    "fast",
    "risk-sentinel":       "fast",
    "skill-sentinel":      "fast",
    "skill-check":         "fast",
    "design-critic":       "fast",
    "release-manager":     "fast",
    # ── DeepSeek-R1 (reason) — planning, architecture, logic chains ───────────
    "chief-architect":     "reason",
    "workflow-composer":   "reason",
    "subagent-coordinator":"reason",
    "expert-pool":         "reason",
    "research-analyst":    "reason",
    "context-researcher":  "reason",
    "benchmark-analyst":   "reason",
    "evolver":             "reason",
    "security-auditor":    "reason",
    "incident-commander":  "reason",
    "prompt-architect":    "reason",
    # ── Qwen2.5-Coder (code) — implementation, tool-use, agentic tasks ────────
    "backend-engineer":    "code",
    "frontend-architect":  "code",
    "data-engineer":       "code",
    "performance-optimizer":"code",
    "perf-optimizer":      "code",
    "mcp-toolsmith":       "code",
    "security-reviewer":   "code",
    "qa-evaluator":        "code",
    "producer":            "code",
    "skill-developer":     "code",
    "skill-librarian":     "code",
    "environment-governor":"code",
}


def _build_tasks(
    workflow: dict[str, Any],
    stack: list[str],
    target: str,
    repo: Path,
    runtime_home: Path | None = None,
    roles: list[AgentRole] | None = None,
) -> list[TaskItem]:
    """Build TaskItem list from workflow stages.

    FIX v4.1-post [PLAN-FIX-01]:
        The previous implementation referenced `role.model_hint` where `role`
        was undefined — causing a NameError on every run that hit this path.
        Fix: resolve model_hint from _OWNER_MODEL_HINTS static table keyed by
        owner name, with an optional live roles-list override for dynamic hints
        set by build_roles() (framework-specific or target-specific overrides).

    Parameters
    ----------
    roles:
        Optional list from build_roles(). When supplied, per-role model_hint
        overrides from framework / target branching take precedence over the
        static table. Pass None (default) to use the static table only.
    """
    # Build a live lookup dict from the roles list when available.
    # Falls back to _OWNER_MODEL_HINTS for any owner not in the live list.
    live_hints: dict[str, str | None] = {}
    if roles:
        for r in roles:
            if r.model_hint is not None:
                live_hints[r.name] = r.model_hint

    tasks: list[TaskItem] = []
    for stage in workflow.get("stages", []):
        if isinstance(stage, dict):
            stage_name = str(stage.get("name") or stage.get("stage") or stage.get("title") or "stage")
            owner, stage_risk = _stage_owner(stage_name, stack, target)
            owner = str(stage.get("owner") or owner)
            stage_risk = _risk_from_value(stage.get("risk"), stage_risk)
            detail = str(stage.get("purpose") or stage.get("description") or f"{stage_name.replace('-', ' ').title()} stage for {target}.")
            skill_tags = list(stage.get("skill_tags", []) or [])
        else:
            stage_name = str(stage)
            owner, stage_risk = _stage_owner(stage_name, stack, target)
            detail = f"{stage_name.replace('-', ' ').title()} stage for {target}."
            skill_tags = []

        # FIX [PLAN-FIX-01]: resolve model_hint safely — live list first, then static table
        resolved_hint: str | None = live_hints.get(owner) or _OWNER_MODEL_HINTS.get(owner)

        matched = [skill.name for skill in match_skills(stack, f"{target} {stage_name} {detail}", repo=repo, runtime_home=runtime_home)[:5]]
        combined = list(dict.fromkeys(skill_tags + matched))
        tasks.append(TaskItem(
            title=stage_name,
            detail=detail,
            owner=owner,
            risk=stage_risk,
            skill_tags=combined,
            model_hint=resolved_hint,  # [PLAN-FIX-01] was: role.model_hint (NameError)
        ))
    if not any(t.title == "learn" for t in tasks):
        tasks.append(TaskItem(
            title="learn",
            detail="Record durable lessons and update the swarm memory.",
            owner="memory-curator",
            risk=RiskLevel.LOW,
            skill_tags=["memory-architecture", "autonomy-ops"],
            model_hint="fast",
        ))
    return tasks


def build_plan(target: str, repo: Path, review_required: bool = False, cfg: SwarmConfig | None = None) -> Plan:
    cfg = cfg or SwarmConfig()
    stack = detect_stack(repo)
    workflow_name = workflow_for_target(stack, target, preferred=cfg.workflow_preference)
    workflow_payload = load_workflow(workflow_name, bundle_root=Path(__file__).resolve().parents[2])
    workflow_meta = normalize_workflow(workflow_name, workflow_payload)

    text_risk = risk_from_text(target)
    path_risk = risk_for_path(target)
    risk = max(text_risk, path_risk, key=lambda r: list(RiskLevel).index(r))
    goal = f"Accelerate {target} with stack-aware autonomous work and guarded self-evolution."
    matched_skills = [skill.name for skill in match_skills(stack, target, repo=repo)]
    frameworks = list(dict.fromkeys(cfg.framework_preference))
    roles = build_roles(stack, target, frameworks=frameworks)
    tasks = _build_tasks(workflow_payload, stack, target, repo=repo, runtime_home=cfg.home, roles=roles)

    for task in tasks:
        if not task.skill_tags:
            task.skill_tags = list(matched_skills[:4])
    return Plan(
        target=target,
        stack=stack,
        workflow=workflow_name,
        risk=risk,
        goal=goal,
        tasks=tasks,
        roles=roles,
        approval_required=approval_required(risk, review_required),
        notes=[
            "Graph-style routing is internal and deterministic.",
            "Any risky operation is gated.",
            "Self-evolution writes proposals before application.",
            "Local model routing uses fast and code models when available.",
            "Workflow metadata may include structured stage ownership and risk hints.",
            "Per-stage skill tags are composed from target, stack, and workflow context.",
        ],
        workflow_meta=workflow_meta,
        skill_matches=matched_skills,
        frameworks=frameworks,
    )
