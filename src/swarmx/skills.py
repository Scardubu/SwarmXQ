from __future__ import annotations

from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from .utils import load_yaml


@dataclass
class SkillCard:
    name: str
    purpose: str
    triggers: list[str]
    stack: list[str]
    owner: str = "system"
    weight: int = 1
    version: str = "1.0.0"
    rating: float = 0.0
    usage_count: int = 0

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


DEFAULT_SKILLS = [
    SkillCard("design-system-polish", "Raise frontend coherence, spacing, hierarchy, motion, and accessibility.", ["ui", "frontend", "design", "layout", "visual"], ["frontend"], owner="design", weight=5),
    SkillCard("frontend-experience", "Improve interaction design, onboarding, conversion, and content flow.", ["ux", "conversion", "onboarding", "cta"], ["frontend"], owner="design", weight=4),
    SkillCard("backend-performance", "Tune hotspots, APIs, caching, and data flow efficiency.", ["api", "latency", "throughput", "backend", "perf"], ["backend"], owner="platform", weight=5),
    SkillCard("backend-architecture", "Strengthen boundaries, services, queues, and domain model clarity.", ["architecture", "service", "domain", "api"], ["backend"], owner="platform", weight=5),
    SkillCard("test-stabilization", "Repair flaky tests and strengthen deterministic verification.", ["test", "flaky", "ci", "failure", "regression"], ["generic"], owner="qa", weight=5),
    SkillCard("security-hardening", "Threat model secrets, auth, and deployment boundaries.", ["auth", "secret", "payment", "compliance", "security"], ["security", "devops"], owner="security", weight=5),
    SkillCard("observability", "Improve logs, traces, metrics, and actionable run summaries.", ["trace", "log", "telemetry", "debug", "observability"], ["generic"], owner="platform", weight=4),
    SkillCard("release-readiness", "Prepare changelogs, manifests, and rollout notes.", ["release", "ship", "publish", "deploy"], ["devops"], owner="release", weight=4),
    SkillCard("mcp-tooling", "Connect the swarm to external tools and context providers.", ["mcp", "tool", "server", "integration"], ["devops", "generic"], owner="platform", weight=4),
    SkillCard("memory-architecture", "Persist lessons and promote reusable experiences.", ["memory", "lesson", "retain", "recall", "archive"], ["generic"], owner="system", weight=4),
    SkillCard("refactor-safety", "Restructure code with guardrails and regression checks.", ["refactor", "cleanup", "rename", "simplify"], ["generic"], owner="engineering", weight=5),
    SkillCard("research-acceleration", "Gather sources, distill patterns, and convert findings into action.", ["research", "analysis", "paper", "compare", "source"], ["generic"], owner="research", weight=3),
    SkillCard("design-critique", "Find friction in hierarchy, flow, motion, accessibility, and narrative clarity.", ["design", "ux", "ui", "layout", "visual", "motion", "a11y"], ["frontend"], owner="design", weight=5),
    SkillCard("performance-optimization", "Improve CPU, render, memory, and network budgets.", ["performance", "budget", "cpu", "memory", "network"], ["frontend", "backend", "devops"], owner="platform", weight=4),
    SkillCard("release-governance", "Apply safe gating, approvals, and release sequencing.", ["release", "approval", "governance", "rollout"], ["devops", "security"], owner="release", weight=4),
    SkillCard("autonomy-ops", "Route work, maintain control loops, and keep the system bounded.", ["autonomous", "agent", "orchestration", "loop", "route"], ["generic"], owner="system", weight=5),
    SkillCard("workflow-routing", "Pick the highest leverage workflow and the right budget.", ["workflow", "route", "budget", "planner"], ["generic"], owner="system", weight=5),
    SkillCard("prompt-ops", "Shape system prompts, instruction hierarchy, and prompt hygiene for consistent outputs.", ["prompt", "instruction", "system prompt", "prompting"], ["generic"], owner="system", weight=4),
    SkillCard("eval-grading", "Design rubrics, scorecards, and trace-grade criteria for self-correction loops.", ["eval", "grading", "rubric", "score", "judge"], ["generic"], owner="qa", weight=5),
    SkillCard("benchmarking", "Build repeatable baselines, compare variants, and track regressions over time.", ["benchmark", "baseline", "compare", "measure", "latency"], ["generic"], owner="qa", weight=4),
    SkillCard("incident-command", "Stabilize outages, coordinate mitigation, and preserve a clean postmortem trail.", ["incident", "outage", "postmortem", "rollback", "blameless"], ["devops", "security"], owner="release", weight=5),
    SkillCard("swarm-evolution", "Compare candidate mutations, keep high-value improvements, and preserve working patterns.", ["mutate", "tournament", "selection", "evolve", "survivor"], ["generic"], owner="system", weight=5),
    SkillCard("trace-grading", "Score evidence quality, critique depth, and actionable output.", ["trace", "grade", "score", "evidence", "judge"], ["generic"], owner="qa", weight=5),
    SkillCard("memory-graph", "Persist lessons, retrieval cues, and cross-run patterns.", ["memory", "recall", "lesson", "pattern", "archive"], ["generic"], owner="system", weight=5),
    SkillCard("sandbox-ops", "Run bounded experiments and rollback-safe mutations.", ["sandbox", "isolate", "rollback", "dry-run", "boundary"], ["devops", "security"], owner="security", weight=5),
    SkillCard("agent-routing", "Route work to the right agent, model, and workflow with deterministic control.", ["route", "planner", "orchestrate", "delegate", "assign"], ["generic"], owner="system", weight=5),
    SkillCard("latent-ensemble-selection", "Generate 2-3 internal variants, score them silently, and keep the best candidate.", ["competition", "variant", "compare approaches", "choose best", "tournament"], ["generic"], owner="system", weight=5),
    SkillCard("critic-gate", "Run one adversarial self-check and refine the candidate when weaknesses appear.", ["critic", "self-check", "review", "edge cases", "challenge"], ["generic"], owner="system", weight=5),
    SkillCard("confidence-gating", "Adjust output mode by confidence: direct answer, refine once, or constrain assumptions.", ["confidence", "uncertainty", "assumption", "clarify", "simplify"], ["generic"], owner="system", weight=5),
    SkillCard("precision-compression", "Strip redundancy early and preserve only the highest-signal reasoning path.", ["concise", "compress", "minimal", "high-signal", "tight"], ["generic"], owner="system", weight=4),
    # ── APEX-17: Engineering Intelligence (mattpocock adaptation) ─────────────────
    SkillCard("code-diagnose",         "Evidence-first hypothesis-elimination diagnosis before any fix. Gather → Hypothesize → Eliminate → Confirm.",                                         ["diagnose","root cause","bug","broken","not working","error","failure","why is this failing","investigate","reproduce","before fixing","understand the failure","trace the bug"],  ["generic"],           owner="engineering", weight=5),
    SkillCard("tdd-discipline",        "Red→Green→Refactor. Write the failing test before the implementation. Coverage and regression gating included.",                                       ["tdd","test first","red green refactor","write test first","test driven","failing test before code","specification by example","behavior before implementation","test before code"], ["generic"],           owner="qa",          weight=5),
    SkillCard("grill-with-docs",       "Interrogate every assumption against authoritative documentation. Enumerate, source, grill, produce verified manifest.",                               ["grill with docs","check the docs","verify against docs","docs vs code","is this documented","api contract","documentation drift","hallucination check","verify api","docs audit"],  ["generic"],           owner="system",      weight=5),
    SkillCard("architecture-improve",  "Holistic architecture review: map layers, detect drift, produce sequenced refactoring roadmap with vertical slice validation.",                        ["improve architecture","architecture review","codebase health","structural drift","service boundaries","coupling","cohesion","architectural debt"],                                    ["generic"],           owner="platform",    weight=5),
    SkillCard("improve-codebase-architecture", "Identify highest-leverage coupling/cohesion/boundary improvements, emit ranked proposals capped at 7. Vertical slice top 2.",               ["improve codebase","codebase architecture","ranked refactor proposals","structural improvement","coupling hotspots","cohesion gaps","absent abstractions"],                            ["generic"],           owner="engineering", weight=5),
    SkillCard("grill-me",             "Adversarial alignment interrogation. Surface BLOCKING/IMPORTANT/OPTIONAL gaps before work begins. Antidote to silent assumption.",                      ["grill me","interrogate requirements","challenge my plan","poke holes","find the gaps","what am I missing","alignment check","requirements audit","probe assumptions"],              ["generic"],           owner="system",      weight=5),
    SkillCard("zoom-out",             "Strategic direction reset. Recover context on mission drift. Produces keep/pivot/park/abandon verdict.",                                                 ["zoom out","step back","big picture","am i solving the right problem","direction reset","lost the thread","context recovery","mission drift","objective alignment"],                 ["generic"],           owner="system",      weight=5),
    SkillCard("debugging-strategies", "Systematic hypothesis-elimination debugging: Bisect, Divide-Conquer, Instrumentation, Differential, Time-Travel, Elimination.",                        ["debug","can't reproduce","intermittent failure","flapping","race condition","nondeterministic","production bug","why is this slow","bisect","weird behavior","silent failure"],       ["generic"],           owner="engineering", weight=5),

    # APEX-17: Meta-Orchestration (harness adaptation)
    SkillCard("dynamic-team-factory",     "Generate purpose-built agent teams using 6 orchestration patterns. Wire handoff contracts. Capture team delta for the evolution loop.",             ["build a team","generate team","team factory","dynamic team","harness team","which pattern","orchestration pattern","compose agents","mission team"],                              ["generic"],           owner="system",      weight=5),
    SkillCard("multi-agent-orchestrator", "Compose dynamic orchestration graphs. Decompose missions, route agents, manage shared state, govern convergence, capture deltas.",                 ["orchestrate","multi-agent","compose agents","build workflow","agent graph","coordinate agents","multi-step mission","parallel agents","spawn workers"],                             ["generic"],           owner="system",      weight=5),
    SkillCard("delta-evolution",          "Capture fitness delta, score config changes, attribute improvements/regressions, generate next ranked evolution proposals.",                       ["delta evolution","evolution delta","fitness delta","swarm improvement","evolve the swarm","self-improve","evolution proposal","capture delta","what improved"],                       ["generic"],           owner="system",      weight=5),

    # APEX-17: Security (antigravity adaptation)
    SkillCard("security-auditor",     "Full STRIDE + OWASP Top 10 audit with dependency CVE scanning and prioritized remediation plan. Model the attacker.",                                  ["security audit","owasp","stride","threat model","security review","attack surface","auth audit","injection risks","cve sweep","find vulnerabilities","secrets audit"],              ["security","devops"], owner="security",    weight=5),

    # APEX-17: Planning (weight 4)
    SkillCard("requirements-pipeline","Convert vague mission objectives into structured PRDs and vertical-sliced, immediately actionable issues with acceptance criteria.",                    ["prd","requirements","to issues","break into tickets","requirements document","what are we building","spec","feature spec","scope the work","user stories"],                          ["generic"],           owner="system",      weight=4),
]


def _bundle_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _catalog_paths(repo: str | Path | None = None, runtime_home: str | Path | None = None) -> list[Path]:
    paths = [
        _bundle_root() / "skills" / "catalog.yaml",
    ]
    if runtime_home:
        home = Path(runtime_home)
        paths.extend([
            home / "skills" / "catalog.yaml",
            home / "skills" / "generated.yaml",
            home / "skills.yaml",
        ])
    if repo:
        repo = Path(repo)
        paths.extend([
            repo / ".swarmx" / "skills" / "catalog.yaml",
            repo / ".swarmx" / "skills" / "generated.yaml",
            repo / ".swarmx" / "skills.yaml",
            repo / "skills" / "catalog.yaml",
            repo / "skills.yaml",
        ])
    return paths


def load_custom_skills(path: str | Path) -> list[SkillCard]:
    payload = load_yaml(path, {}) or {}
    out: list[SkillCard] = []
    for item in payload.get("skills", []):
        try:
            out.append(SkillCard(
                name=item["name"],
                purpose=item.get("purpose", ""),
                triggers=list(item.get("triggers", [])),
                stack=list(item.get("stack", [])),
                owner=item.get("owner", "system"),
                weight=int(item.get("weight", 1)),
                version=str(item.get("version", "1.0.0")),
                rating=float(item.get("rating", 0.0)),
                usage_count=int(item.get("usage_count", 0)),
            ))
        except Exception:
            continue
    return out


def _merge_cards(cards: list[SkillCard]) -> list[SkillCard]:
    merged: dict[str, SkillCard] = {card.name: card for card in DEFAULT_SKILLS}
    for card in cards:
        merged[card.name] = card
    return sorted(merged.values(), key=lambda s: (-s.weight, s.name))


def skill_library(repo: str | Path | None = None, runtime_home: str | Path | None = None) -> list[SkillCard]:
    cards: list[SkillCard] = []
    for path in _catalog_paths(repo=repo, runtime_home=runtime_home):
        if path.exists():
            cards.extend(load_custom_skills(path))
    return _merge_cards(cards)


def synthesize_skills_from_summary(summary: dict[str, Any] | None = None) -> list[SkillCard]:
    summary = summary or {}
    top_tags = summary.get("top_tags", []) or []
    candidates: list[SkillCard] = []
    for tag, count in top_tags[:8]:
        slug = str(tag).replace(" ", "-").replace("_", "-").lower()
        candidates.append(SkillCard(
            name=f"synth-{slug}",
            purpose=f"Reuse the recurring {tag} pattern observed across recent runs.",
            triggers=[str(tag).lower()],
            stack=["generic"],
            owner="system",
            weight=max(2, min(5, int(count) if isinstance(count, int) else 3)),
        ))
    return candidates


def match_skills(stack: list[str], target: str, repo: str | Path | None = None, runtime_home: str | Path | None = None) -> list[SkillCard]:
    target_l = target.lower()
    chosen: list[SkillCard] = []
    for skill in skill_library(repo=repo, runtime_home=runtime_home):
        if any(s in stack for s in skill.stack if s != "generic"):
            chosen.append(skill)
            continue
        if any(trigger in target_l for trigger in skill.triggers):
            chosen.append(skill)
    if not chosen:
        chosen.extend([s for s in skill_library(repo=repo, runtime_home=runtime_home) if "generic" in s.stack][:5])
    dedup: dict[str, SkillCard] = {}
    for skill in chosen:
        dedup[skill.name] = skill
    return sorted(dedup.values(), key=lambda s: (-s.weight, s.name))


def save_generated_skill_catalog(path: str | Path, skills: list[SkillCard], metadata: dict[str, Any] | None = None) -> None:
    payload = {"meta": metadata or {}, "skills": [s.to_dict() for s in skills]}
    import yaml
    p = Path(path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")


def promote_skill_from_run(
    runtime_dir: str | Path,
    record: dict[str, Any],
    cfg: Any | None = None,
) -> SkillCard:
    """Synthesize a SkillCard from a RunRecord dict and persist it to the generated catalog.

    The card name is derived from the run's primary tag or mission id so it is
    idempotent across repeated promotions of the same run.
    """
    runtime_dir = Path(runtime_dir)
    tags: list[str] = record.get("tags") or record.get("top_tags") or []
    mission: str = record.get("mission") or record.get("id") or "promoted"
    slug = str(tags[0] if tags else mission).replace(" ", "-").replace("_", "-").lower()[:48]
    score: float = float(record.get("score") or record.get("final_score") or 0.0)
    card = SkillCard(
        name=f"promoted-{slug}",
        purpose=str(record.get("summary") or record.get("mission") or f"Promoted from run {mission}."),
        triggers=[str(t).lower() for t in tags[:5]] or [slug],
        stack=list(record.get("stack") or ["generic"]),
        owner=str(record.get("owner") or "system"),
        weight=max(2, min(5, round(score * 5) if score <= 1.0 else 3)),
        version="1.0.0",
        rating=round(score, 4),
        usage_count=1,
    )
    generated_path = runtime_dir / "skills" / "generated.yaml"
    try:
        existing: list[SkillCard] = []
        if generated_path.exists():
            existing = load_custom_skills(generated_path)
        existing = [s for s in existing if s.name != card.name]
        existing.append(card)
        save_generated_skill_catalog(generated_path, existing, metadata={"source": "promote_skill_from_run"})
    except Exception:
        pass
    return card
