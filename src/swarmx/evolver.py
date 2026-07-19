from __future__ import annotations

import json
import secrets
import structlog
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import yaml

from .config import SwarmConfig
from .event_bus import EventKind  # [IEP-FIX] For EVOLUTION_BLOCKED_IEP telemetry
from .evolution.critic_agent import CriticAgent
from .evolution.critique_pipeline import CritiquePipeline
from .evolution.redteam_agent import RedTeamAgent
from .llm import generate
from .memory import (
    load_recent_memories,
    load_recent_runs,
    store_memory,
    store_proposal,
    summarize_memories,
    summarize_runs,
)
from .policy import assess_action
from .risk import HIGH_RISK_KEYWORDS  # [V5.9-FIX-03] Import from risk.py — RISK_KEYWORDS was never in policy.py
from .skills import save_generated_skill_catalog, synthesize_skills_from_summary
from .state import EvolutionProposal
from .storage import get_kv, list_missions, store_skill_record
from .telemetry import emit_event  # [IEP-FIX] For IEP block telemetry
from .utils import read_json, write_json

logger = structlog.get_logger("swarmx.evolver")


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


# ── IEP Elite Invariants — field-level auto-apply lock ───────────────────────
#
# These field names are sourced directly from configs/guardrails.yaml
# `never_auto_apply`. Any evolution proposal whose patch touches one of these
# fields is permanently blocked from auto-apply, regardless of risk tier.
#
# Rationale: the blast-radius gate (LOW = auto-eligible) operates on risk tier
# only. The IEP gate is a second, independent layer that operates on field
# identity. A LOW-risk proposal that modifies `halt_over_hallucinate` must be
# blocked even though its risk tier qualifies it for auto-apply.
#
# To add a new invariant: add the field name here AND to guardrails.yaml
# never_auto_apply. The two lists must be kept in sync.

_IEP_LOCKED_FIELDS: frozenset[str] = frozenset({
    # crossover ceilings (multi-island exploration)
    "crossover_probability_explore_ceiling",
    "crossover_probability_exploit_floor",
    "crossover_probability_explore",
    "crossover_probability_exploit",
    # critic gate
    "critic_gate_max_passes",
    # ensemble minimum
    "latent_ensemble_min_variants",
    # confidence gate
    "halt_over_hallucinate",
    # fix log ceiling
    "fix_log_critical_ceiling",
    "critical_ceiling",
    # safety gates — top-level safety keys
    "approval_required_for",
    "credential_touch",
    "production_deploy",
    "auto_apply_risk_floor",
    "allow_destructive_actions",
    "secrets_hygiene",
    # blast radius thresholds
    "auto_apply_eligible",
    "blast_radius",
})


def _iep_fields_touched(proposal: EvolutionProposal) -> set[str]:
    """Return the set of IEP-locked field names present in a proposal's patch.

    Performs a recursive key walk over the patch dict so nested fields
    (e.g. patch["evolution"]["multi_island"]["crossover_probability_explore"])
    are detected regardless of nesting depth.
    """
    if not isinstance(proposal.patch, dict):
        return set()

    touched: set[str] = set()

    def _walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        for key, value in node.items():
            if key in _IEP_LOCKED_FIELDS:
                touched.add(key)
            _walk(value)

    _walk(proposal.patch)
    return touched


def _touches_iep_invariant(proposal: EvolutionProposal) -> bool:
    """Return True if this proposal's patch touches any IEP-locked field."""
    return bool(_iep_fields_touched(proposal))


# ── Divergent proposal generation — system prompt ─────────────────────────────

_DIVERGENT_EVOLUTION_SYSTEM_PROMPT = """
You are an evolution strategist for a self-improving AI swarm (SwarmX).
Your task: propose one targeted self-improvement to the swarm's configuration,
runtime behaviour, or prompt templates based on the provided evolution context.

The proposal MUST address a specific, evidence-backed gap or opportunity visible
in the recent mission outcomes, memory records, and run statistics supplied.
It must be safe, internally consistent, and independently reversible.

Your stance for this proposal is specified below the schema hint.
""".strip()


def _proposal_id(scope: str) -> str:
    stamp = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    nonce = secrets.token_hex(3)
    return f"proposal-{stamp}-{nonce}-{scope}"


# ── Multi-island fitness scoring (since APEX.10, updated APEX.15) ──────────────────────────

def _score_multi_island(
    kind: str,
    *,
    success_rate: float | None,
    blocked_tasks: int,
    test_failure_rate: float | None,
    memory_bias: int,
    island_winner_history: list[str] | None = None,
) -> tuple[float, str]:
    """Score a proposal candidate across three islands and return the best score
    along with the winning island label.

    Backward-compatible: the returned float is the same as the original _score()
    output range. The island label is new information exposed to callers that opt in.
    """
    island_winner_history = island_winner_history or []

    base_a = _base_score(kind)   # Island A: conservative, proven
    base_b = base_a - 0.02       # Island B: lateral, slightly riskier
    base_c = base_a - 0.03       # Island C: compressed, fewest steps

    # Evidence adjustments (same logic as original, applied to all islands)
    evidence_delta = 0.0
    if success_rate is not None:
        evidence_delta += max(0.0, 0.75 - success_rate) * 0.45
    if test_failure_rate is not None:
        evidence_delta += max(0.0, test_failure_rate) * 0.30
    evidence_delta += min(blocked_tasks, 8) * 0.03
    evidence_delta += min(memory_bias, 6) * 0.01

    score_a = round(min(base_a + evidence_delta, 0.99), 3)
    score_b = round(min(base_b + evidence_delta + 0.04, 0.99), 3)  # leverage bonus
    score_c = round(min(base_c + evidence_delta + 0.02, 0.99), 3)  # simplicity bonus

    # Diversity bonus: reward island that breaks a convergence streak
    convergence_winner = None
    if len(island_winner_history) >= 3:
        if all(w == island_winner_history[-1] for w in island_winner_history[-3:]):
            convergence_winner = island_winner_history[-1]

    def _diversity_bonus(label: str) -> float:
        return 0.04 if (convergence_winner and label != convergence_winner) else 0.0

    scores = {
        "A": round(min(score_a + _diversity_bonus("A"), 0.99), 3),
        "B": round(min(score_b + _diversity_bonus("B"), 0.99), 3),
        "C": round(min(score_c + _diversity_bonus("C"), 0.99), 3),
    }
    winner = max(scores, key=lambda k: scores[k])
    return scores[winner], winner


def _base_score(kind: str) -> float:
    """Base score per proposal kind — preserved from original APEX.9 logic."""
    bases = {
        "bootstrap":   0.95,
        "reliability": 0.90,
        "safety":      0.88,
        "trace-grading": 0.86,
        "routing":     0.82,
        "skills":      0.80,
        "templates":   0.78,
    }
    return bases.get(kind, 0.60)


def _score(
    kind: str,
    *,
    success_rate: float | None,
    blocked_tasks: int,
    test_failure_rate: float | None,
    memory_bias: int,
) -> float:
    """Backward-compatible single score. Delegates to multi-island internally."""
    score, _ = _score_multi_island(
        kind,
        success_rate=success_rate,
        blocked_tasks=blocked_tasks,
        test_failure_rate=test_failure_rate,
        memory_bias=memory_bias,
    )
    return score


# ── PromptBreeder strategy weight registry (session-scoped, in-process) ──────
# FIX v2.0: added _strategy_lock to protect the two counters from
# concurrent mutation in ThreadingHTTPServer — previously any two simultaneous
# /api/evolve calls could race on these dicts and silently corrupt win counts.

_strategy_lock: threading.Lock = threading.Lock()
_strategy_wins: dict[str, int] = {}
_strategy_losses: dict[str, int] = {}
_PROMOTION_THRESHOLD = 2
_DEMOTION_THRESHOLD  = 3
_MAX_ACTIVE_STRATEGIES = 5


def _record_island_result(island: str, won: bool) -> None:
    """Update PromptBreeder strategy counters for the given island.

    Thread-safe via _strategy_lock.
    """
    # Guard: hybrid labels like "A×B" are valid tournament results but should
    # not pollute the per-island counters.  Only track canonical single labels.
    if island not in {"A", "B", "C"}:
        return
    with _strategy_lock:
        if won:
            _strategy_wins[island]   = _strategy_wins.get(island, 0) + 1
            _strategy_losses[island] = 0  # reset loss streak on a win
        else:
            _strategy_losses[island] = _strategy_losses.get(island, 0) + 1
            if _strategy_losses[island] >= _DEMOTION_THRESHOLD:
                # De-weight: reduce win count (never fully remove — preserves diversity)
                _strategy_wins[island] = max(0, _strategy_wins.get(island, 0) - 1)


def get_dominant_island() -> str | None:
    """Return the island with the highest win count that has reached the
    promotion threshold, or None.

    FIX v2.0: previously returned the *first* island to cross the
    threshold (dict iteration order), not the *most dominant* one.  Now
    takes a snapshot under the lock and returns the highest-wins island.
    """
    with _strategy_lock:
        eligible = {k: v for k, v in _strategy_wins.items() if v >= _PROMOTION_THRESHOLD}
    if not eligible:
        return None
    return max(eligible, key=lambda k: eligible[k])


# ── Main proposal builder ─────────────────────────────────────────────────────

def build_evolution_proposals(
    runtime_dir: Path,
    repo: Path | None = None,
    cfg: SwarmConfig | None = None,
) -> list[EvolutionProposal]:
    cfg = cfg or SwarmConfig()
    runs = load_recent_runs(runtime_dir, limit=max(cfg.proposal_budget * 4, 20))
    memories = load_recent_memories(runtime_dir, limit=max(cfg.proposal_budget * 4, 20))
    run_summary = summarize_runs(runs)
    memory_summary = summarize_memories(memories)

    # Load island winner history from run records
    island_winner_history: list[str] = []
    for run in runs[-10:]:
        w = (run if isinstance(run, dict) else {}).get("island_winner")
        if w:
            island_winner_history.append(str(w))

    proposals: list[EvolutionProposal] = []
    success_rate        = run_summary.get("success_rate")
    blocked_tasks_total = int(run_summary.get("blocked_tasks_total") or 0)
    test_failure_rate   = run_summary.get("test_failure_rate")
    memory_bias         = len(memories)

    def _scored(kind: str) -> tuple[float, str]:
        return _score_multi_island(
            kind,
            success_rate=success_rate,
            blocked_tasks=blocked_tasks_total,
            test_failure_rate=test_failure_rate,
            memory_bias=memory_bias,
            island_winner_history=island_winner_history,
        )

    if not runs:
        score, island = _scored("bootstrap")
        proposals.append(EvolutionProposal(
            id=_proposal_id("bootstrap"),
            created_at=now_iso(),
            scope="bootstrap",
            reason="No prior runs found; seed runtime defaults, memory retention, and approval gates.",
            patch={
                "runtime": {"autonomous": True, "review_required": True, "checkpoint_every": 1},
                "evolution": {"proposal_only_by_default": True, "auto_apply_low_risk": True,
                              "selection_strategy": "tournament"},
            },
            risk="low",
            score=score,
        ))
        _record_island_result(island, won=True)

        # ── Dr. Zero pre-seeding ────────────────────────────────────────────
        # When no runs exist, seed one diversity proposal per island so the
        # first tournament has variance to select from rather than all scoring
        # identically against an empty history.
        #
        # Island A — correctness-first: strict safety gates, max evaluation passes
        # Island B — leverage-first:    exploit branching, aggressive routing
        # Island C — simplicity-first:  minimal patch surface, compressed context
        dr_zero_seeds = [
            EvolutionProposal(
                id=_proposal_id("dr-zero-island-a"),
                created_at=now_iso(),
                scope="dr-zero-correctness",
                reason="Dr. Zero seed (Island A): correctness-first strategy for first-run diversity.",
                patch={
                    "runtime": {"checkpoint_every": 1, "review_required": True, "max_iterations": 4},
                    "safety": {"approval_required_for": ["high", "critical"], "allow_destructive_actions": False},
                    "evolution": {"budget": {"refinement_passes": 3}},
                },
                risk="low",
                score=round(min(_base_score("reliability") + 0.02, 0.99), 3),
            ),
            EvolutionProposal(
                id=_proposal_id("dr-zero-island-b"),
                created_at=now_iso(),
                scope="dr-zero-leverage",
                reason="Dr. Zero seed (Island B): leverage-first strategy for first-run diversity.",
                patch={
                    "routing": {"workflow_preference": "autonomous-pipeline"},
                    "runtime": {"autonomous": True, "auto_apply": False, "worker_pool_size": 2},
                    "evolution": {"selection_strategy": "tournament", "budget": {"proposals_per_run": 5}},
                },
                risk="low",
                score=round(min(_base_score("routing") + 0.04, 0.99), 3),
            ),
            EvolutionProposal(
                id=_proposal_id("dr-zero-island-c"),
                created_at=now_iso(),
                scope="dr-zero-simplicity",
                reason="Dr. Zero seed (Island C): simplicity-first strategy for first-run diversity.",
                patch={
                    "runtime": {"max_iterations": 2, "checkpoint_every": 2, "evaluator_passes": 1},
                    "evolution": {"proposal_only_by_default": True},
                    "observability": {"trace_level": "minimal"},
                },
                risk="low",
                score=round(min(_base_score("templates") + 0.03, 0.99), 3),
            ),
        ]
        proposals.extend(dr_zero_seeds)
        _record_island_result("A", won=False)
        _record_island_result("B", won=False)
        _record_island_result("C", won=False)

        proposals.sort(key=lambda p: p.score, reverse=True)
        return proposals[: cfg.proposal_budget]

    if isinstance(success_rate, float) and success_rate < 0.75:
        score, island = _scored("reliability")
        proposals.append(EvolutionProposal(
            id=_proposal_id("reliability"),
            created_at=now_iso(),
            scope="reliability",
            reason=f"Recent success rate is {success_rate:.3f}; tighten checkpoints and increase evaluator passes.",
            patch={
                "runtime": {"checkpoint_every": 1, "review_required": True,
                            "max_iterations": max(cfg.max_iterations, 4)},
                "evolution": {"budget": {"refinement_passes": max(cfg.evaluator_passes, 3)}},
            },
            risk="low",
            score=score,
        ))
        _record_island_result(island, won=True)

    if blocked_tasks_total > 0 or (isinstance(test_failure_rate, float) and test_failure_rate > 0.25):
        score, island = _scored("safety")
        proposals.append(EvolutionProposal(
            id=_proposal_id("safety"),
            created_at=now_iso(),
            scope="safety",
            reason="Blocked work or failing tests — keep guardrails strict until surface stabilises.",
            patch={
                "safety": {"approval_required_for": ["high", "critical"],
                           "allow_destructive_actions": False},
                "runtime": {"auto_apply": False},
            },
            risk="low",
            score=score,
        ))
        _record_island_result(island, won=True)

    if run_summary.get("common_workflows"):
        score, island = _scored("routing")
        top_workflow = run_summary.get("common_workflows", [])[0][0] if run_summary.get("common_workflows") else cfg.workflow_preference
        proposals.append(EvolutionProposal(
            id=_proposal_id("routing"),
            created_at=now_iso(),
            scope="routing",
            reason="Promote most frequent workflow patterns into routing defaults.",
            patch={
                "routing": {"workflow_preference": top_workflow},
                "observability": {"trace_every_stage": True},
            },
            risk="low",
            score=score,
        ))
        _record_island_result(island, won=True)

    if memory_summary.get("kind_counts", {}).get("test-failure") or memory_summary.get("kind_counts", {}).get("blocking-pattern"):
        score, island = _scored("trace-grading")
        proposals.append(EvolutionProposal(
            id=_proposal_id("trace-grading"),
            created_at=now_iso(),
            scope="trace-grading",
            reason="Repeated failure patterns suggest stronger trace grading and tighter evidence gating.",
            patch={
                "observability": {"trace_level": "stage", "record_model_output": True},
                "evolution": {"budget": {"refinement_passes": max(cfg.evaluator_passes, 3)}},
            },
            risk="low",
            score=score,
        ))
        _record_island_result(island, won=True)

    # Skills proposal — always include
    score, island = _scored("skills")
    proposals.append(EvolutionProposal(
        id=_proposal_id("skills"),
        created_at=now_iso(),
        scope="skills",
        reason="Capture dominant lessons into a reusable skill update for future runs.",
        patch={
            "skills": {
                "top_workflows":       run_summary.get("common_workflows", []),
                "top_memory_kinds":    memory_summary.get("kind_counts", {}),
                "latest_success_rate": success_rate,
                "top_tags":            memory_summary.get("top_tags", []),
                "island_winner":       get_dominant_island(),
            },
        },
        risk="low",
        score=score,
    ))

    # Templates proposal — always include
    score, island = _scored("templates")
    proposals.append(EvolutionProposal(
        id=_proposal_id("templates"),
        created_at=now_iso(),
        scope="templates",
        reason="Package strongest patterns into reusable templates for future runs.",
        patch={
            "templates": {
                "top_tags":          memory_summary.get("top_tags", []),
                "workflow_leaders":  run_summary.get("common_workflows", []),
                "dominant_island":   get_dominant_island(),
            },
        },
        risk="low",
        score=score,
    ))

    # Island convergence proposal (since APEX.10)
    if len(island_winner_history) >= 3 and all(w == island_winner_history[-1] for w in island_winner_history[-3:]):
        proposals.append(EvolutionProposal(
            id=_proposal_id("island-exploration"),
            created_at=now_iso(),
            scope="island-exploration",
            reason=f"Island convergence detected (last 3 winners: {island_winner_history[-3:]}). "
                   "Increase crossover probability to trigger exploration.",
            patch={
                "evolution": {
                    "multi_island": {
                        "crossover_probability_exploit": 0.45,
                        "crossover_probability_explore": 0.60,
                    },
                },
            },
            risk="low",
            score=round(min(0.83, _base_score("routing")), 3),
        ))

    # ── Divergent K=3 proposal pass (conservative / aggressive / lateral) ─────
    # Generates LLM-driven proposals under three cognitive stances, critiques
    # all three, and appends the Pareto-optimal survivor.  Non-critical — a
    # failure here never blocks the rule-based proposals above.
    _divergent_context: dict[str, Any] = {
        "run_summary": run_summary,
        "memory_summary": memory_summary,
        "success_rate": success_rate,
        "blocked_tasks_total": blocked_tasks_total,
        "test_failure_rate": test_failure_rate,
        "island_winner_history": island_winner_history[-5:],
        "dominant_island": get_dominant_island(),
        "cfg": {
            "max_iterations": cfg.max_iterations,
            "proposal_budget": cfg.proposal_budget,
            "evaluator_passes": cfg.evaluator_passes,
            "workflow_preference": cfg.workflow_preference,
        },
    }
    _divergent_recent = list_missions(runtime_dir, limit=5)
    _divergent_proposal = _run_divergent_proposal(
        runtime_dir,
        evolution_context=_divergent_context,
        recent_missions=_divergent_recent,
        cfg=cfg,
    )
    if _divergent_proposal is not None:
        proposals.append(_divergent_proposal)
        logger.info("divergent_proposal_added", scope=_divergent_proposal.scope, score=round(_divergent_proposal.score, 3))

    proposals.sort(key=lambda p: p.score, reverse=True)
    return proposals[: cfg.proposal_budget]


def _run_divergent_proposal(
    runtime_dir: Path,
    evolution_context: dict[str, Any],
    recent_missions: list[dict[str, Any]],
    cfg: SwarmConfig,
) -> EvolutionProposal | None:
    """
    Generate K=3 divergent proposals (conservative / aggressive / lateral),
    run each through the adversarial critique + policy gate, and return the
    Pareto-optimal survivor as an ``EvolutionProposal``.

    Returns ``None`` if all proposals are rejected or the divergent path is
    unavailable.  This function is always non-critical — exceptions are
    logged and swallowed so the rule-based proposals are never blocked.
    """
    try:
        from core.evolution.divergent_proposer import DivergentProposer  # type: ignore[import]
    except Exception as exc:
        logger.debug("divergent_proposer_unavailable", exc=str(exc))
        return None

    try:
        runtime_cfg = read_json(runtime_dir / "config.json", {}) if (runtime_dir / "config.json").exists() else {}
        repo_value = runtime_cfg.get("repo") if isinstance(runtime_cfg, dict) else None
        repo_path = Path(str(repo_value)).expanduser().resolve() if repo_value else None

        llm_adapter = _LLMClientAdapter(cfg, cfg.model_reason)
        critic = CriticAgent(
            llm_client=llm_adapter,
            memory_graph=_MemoryGraphAccessor(runtime_dir),
        )
        red_team = RedTeamAgent(llm_client=llm_adapter)
        policy_engine = _EvolutionPolicyEngine(repo_path, cfg)
        pipeline = CritiquePipeline(
            critic=critic,
            red_team=red_team,
            policy_engine=policy_engine,
            runtime_dir=runtime_dir,
        )

        proposer = DivergentProposer(
            llm_client=llm_adapter,
            critique_pipeline=pipeline,
            base_system_prompt=_DIVERGENT_EVOLUTION_SYSTEM_PROMPT,
        )
        ranked = proposer.generate_proposals(
            evolution_context=evolution_context,
            mission_id=f"divergent-{_proposal_id('divergent')}",
            recent_missions=recent_missions,
            policy_rules=policy_engine.get_active_rules(),
        )
        if ranked is None:
            return None

        # ── Delta-driven skill invocation (APEX-16) ───────────────────────────
        delta = pipeline.last_delta or {}
        if delta:
            _delta_pid = delta.get("proposal_id", "unknown")
            store_memory(runtime_dir, {
                "id": f"memory-{_delta_pid}-evolution-delta",
                "type": "evolution_delta",
                "proposal_id": _delta_pid,
                "delta_action": delta.get("delta_action", "unknown"),
                "evolution_signal": delta.get("evolution_signal"),
                "triggered_skills": delta.get("triggered_skills", []),
                "fitness_axes": delta.get("fitness_axes", {}),
                "composite_score": delta.get("composite_score", 0.0),
                "ts": now_iso(),
            })
            logger.info("evolution_delta", proposal=delta.get("proposal_id"), action=delta.get("delta_action"), signal=delta.get("evolution_signal"), skills=delta.get("triggered_skills"))
        # ─────────────────────────────────────────────────────────────────────

        # Derive EvolutionProposal score from Pareto score (clamp to [0, 0.99])
        pareto_score = round(min(max(ranked.pareto_score, 0.0), 0.99), 3)
        proposal_dict = ranked.proposal
        return EvolutionProposal(
            id=_proposal_id(f"divergent-{ranked.stance}"),
            created_at=now_iso(),
            scope=str(proposal_dict.get("scope") or f"divergent-{ranked.stance}"),
            reason=str(proposal_dict.get("reason") or f"Divergent ({ranked.stance}) proposal selected by Pareto gate."),
            patch=dict(proposal_dict.get("patch") or {}),
            risk=str(proposal_dict.get("risk") or "low"),
            score=pareto_score,
        )
    except Exception as exc:
        logger.warning("divergent_proposal_failed", exc=str(exc))
        return None

def _merge_dicts(base: dict[str, Any], override: dict[str, Any]) -> dict[str, Any]:
    out = dict(base)
    for key, value in override.items():
        if isinstance(value, dict) and isinstance(out.get(key), dict):
            out[key] = _merge_dicts(out[key], value)
        else:
            out[key] = value
    return out


def _apply_runtime_patch(runtime_dir: Path, patch: dict[str, Any]) -> Path:
    cfg_json = runtime_dir / "config.json"
    current = read_json(cfg_json, {}) if cfg_json.exists() else {}
    merged = _merge_dicts(current if isinstance(current, dict) else {}, patch)
    write_json(cfg_json, merged)
    try:
        cfg_yaml = runtime_dir / "config.yaml"
        cfg_yaml.write_text(yaml.safe_dump(merged, sort_keys=False), encoding="utf-8")
    except Exception:
        pass
    return cfg_json


def _extract_json_object(text: str) -> dict[str, Any] | None:
    text = (text or "").strip()
    if not text:
        return None
    try:
        data = json.loads(text)
        return data if isinstance(data, dict) else None
    except Exception:
        pass

    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    snippet = text[start : end + 1]
    try:
        data = json.loads(snippet)
        return data if isinstance(data, dict) else None
    except Exception:
        return None


class _LLMClientAdapter:
    """Adapter that exposes a complete(system, user, temperature) interface."""

    def __init__(self, cfg: SwarmConfig, model: str):
        self.cfg = cfg
        self.model = model

    def complete(self, system: str, user: str, temperature: float = 0.1) -> str:
        del temperature  # model temperature controls are provider-specific in SwarmX.
        result = generate(
            prompt=user,
            system=system,
            model=self.model,
            provider=self.cfg.provider,
            cfg=self.cfg,
            role="evaluator",
            use_adversarial_check=False,
        )
        text = str(result)
        parsed = _extract_json_object(text)
        if parsed is not None:
            return json.dumps(parsed)
        return json.dumps(
            {
                "decision": "REJECT",
                "confidence": 0.0,
                "improvement_delta": 0.0,
                "reasoning": "LLM response was not valid JSON.",
                "improvement_brief": "Return strict JSON using the required schema.",
            }
        )


class _MemoryGraphAccessor:
    """Minimal memory accessor used by CriticAgent context hydration."""

    def __init__(self, runtime_dir: Path):
        self.runtime_dir = runtime_dir

    def get(self, key: str) -> Any:
        return get_kv(self.runtime_dir, key, default=None)


class _EvolutionPolicyEngine:
    """Policy adapter for proposal-level gate checks in the evolution loop."""

    def __init__(self, repo: Path | None, cfg: SwarmConfig):
        self.repo = repo
        self.cfg = cfg

    def evaluate(self, proposal: dict[str, Any]) -> tuple[bool, str]:
        scope = str(proposal.get("scope") or "proposal")
        reason = str(proposal.get("reason") or "")
        decision = assess_action("evolution-proposal", f"{scope} {reason}", self.repo, self.cfg)
        if decision.allowed:
            return True, f"Policy approved (risk={decision.risk})"
        explanation = ", ".join(decision.reasons) or f"risk={decision.risk}"
        return False, f"Policy rejected: {explanation}"

    def get_active_rules(self) -> list[str]:
        rules: list[str] = []
        for phrase in HIGH_RISK_KEYWORDS:  # [V5.9-FIX-03] HIGH_RISK_KEYWORDS is a flat set
                rules.append(f"high:{phrase}")
        return rules


def apply_proposals(
    runtime_dir: Path,
    proposals: list[EvolutionProposal],
    auto_apply: bool = False,
    cfg: SwarmConfig | None = None,
) -> list[dict[str, Any]]:
    cfg = cfg or SwarmConfig()
    applied: list[dict[str, Any]] = []
    applied_dir = runtime_dir / "evolution" / "applied"
    applied_dir.mkdir(parents=True, exist_ok=True)

    runtime_cfg = read_json(runtime_dir / "config.json", {}) if (runtime_dir / "config.json").exists() else {}
    repo_value = runtime_cfg.get("repo") if isinstance(runtime_cfg, dict) else None
    repo_path = Path(str(repo_value)).expanduser().resolve() if repo_value else None

    critic_agent = CriticAgent(
        llm_client=_LLMClientAdapter(cfg, cfg.model_reason),
        memory_graph=_MemoryGraphAccessor(runtime_dir),
    )
    red_team_agent = RedTeamAgent(llm_client=_LLMClientAdapter(cfg, cfg.model_reason))
    policy_engine = _EvolutionPolicyEngine(repo_path, cfg)
    pipeline = CritiquePipeline(
        critic=critic_agent,
        red_team=red_team_agent,
        policy_engine=policy_engine,
        runtime_dir=runtime_dir,
    )
    recent_missions = list_missions(runtime_dir, limit=5)
    policy_rules = policy_engine.get_active_rules()

    for proposal in proposals:
        path = store_proposal(runtime_dir, proposal)
        result: dict[str, Any] = {
            "proposal": proposal.id,
            "stored": str(path),
            "applied": False,
            "score": proposal.score,
        }

        # ── [IEP-FIX] Gate 0: IEP invariant field-level check ────────────────
        # This gate runs BEFORE the critique pipeline and BEFORE the blast-radius
        # tier check. A proposal touching any _IEP_LOCKED_FIELDS field is
        # permanently blocked from auto-apply regardless of risk tier.
        #
        # This is the code enforcement of configs/guardrails.yaml never_auto_apply.
        # The blast-radius gate (risk == "low") is a necessary but NOT sufficient
        # condition for auto-apply when IEP invariants are involved.
        if auto_apply:
            iep_touched = _iep_fields_touched(proposal)
            if iep_touched:
                block_reason = (
                    f"IEP invariant lock: proposal '{proposal.id}' touches permanently "
                    f"locked field(s) {sorted(iep_touched)}. "
                    f"These fields are listed in configs/guardrails.yaml never_auto_apply "
                    f"and cannot be auto-applied at any risk tier. "
                    f"Human approval required."
                )
                logger.warning("iep_invariant_block", proposal=proposal.id, reason=block_reason)
                result.update({
                    "rejected": True,
                    "blocked_iep": True,
                    "iep_fields_touched": sorted(iep_touched),
                    "critique_reason": block_reason,
                })
                # Emit telemetry — operators must be able to see IEP blocks
                try:
                    emit_event(runtime_dir, EventKind.EVOLUTION_BLOCKED_IEP, {
                        "proposal_id": proposal.id,
                        "scope": proposal.scope,
                        "risk": proposal.risk,
                        "iep_fields": sorted(iep_touched),
                        "reason": block_reason,
                    })
                except Exception:
                    pass  # telemetry must never block the safety decision
                store_memory(runtime_dir, {
                    "id": f"memory-{proposal.id}-evolution-iep-blocked",
                    "kind": "evolution-iep-blocked",
                    "summary": block_reason,
                    "scope": proposal.scope,
                    "proposal_id": proposal.id,
                    "iep_fields": sorted(iep_touched),
                    "tags": ["evolution", "iep", "blocked", proposal.scope],
                })
                applied.append(result)
                continue  # Hard stop — do not proceed to critique or apply
        # ── End IEP gate ──────────────────────────────────────────────────────

        approved, reason = pipeline.evaluate(
            proposal=proposal.to_dict(),
            mission_id=proposal.id,
            recent_missions=recent_missions,
            policy_rules=policy_rules,
        )
        result["critique_reason"] = reason
        if not approved:
            result.update(
                {
                    "rejected": True,
                    "improvement_brief": pipeline.last_improvement_brief,
                }
            )
            store_memory(
                runtime_dir,
                {
                    "id": f"memory-{proposal.id}-evolution-rejected",
                    "kind": "evolution-rejected",
                    "summary": reason,
                    "scope": proposal.scope,
                    "proposal_id": proposal.id,
                    "score": proposal.score,
                    "improvement_brief": pipeline.last_improvement_brief,
                    "tags": ["evolution", "rejected", proposal.scope],
                },
            )
            applied.append(result)
            continue

        should_apply = auto_apply and proposal.risk == "low"
        if should_apply:
            applied_path = applied_dir / f"{proposal.id}.json"
            write_json(applied_path, proposal.to_dict())
            if isinstance(proposal.patch, dict) and proposal.patch:
                _apply_runtime_patch(runtime_dir, proposal.patch)
                if proposal.scope in {"skills", "templates"}:
                    summary = summarize_memories(
                        load_recent_memories(runtime_dir, limit=max(cfg.proposal_budget * 4, 20))
                    )
                    generated = synthesize_skills_from_summary(summary)
                    save_generated_skill_catalog(
                        runtime_dir / "skills" / "generated.yaml",
                        generated,
                        {"source_proposal": proposal.id, "scope": proposal.scope},
                    )
            store_memory(runtime_dir, {
                "id":          f"memory-{proposal.id}-evolution-applied",
                "kind":        "evolution-applied",
                "summary":     proposal.reason,
                "scope":       proposal.scope,
                "proposal_id": proposal.id,
                "score":       proposal.score,
                "tags":        ["evolution", proposal.scope],
            })
            result.update({"applied": True, "applied_path": str(applied_path)})
        applied.append(result)
    return applied


# ── Skill crystallization pass (Evolve stage) ──────────────────────────────

def run_skill_crystallization(
    runtime_dir: Path,
    cfg: SwarmConfig | None = None,
    auto_apply: bool = False,
    limit: int = 20,
) -> int:
    """
    Run the SkillCrystallizer against the most recent *limit* missions.

    Each proposed skill template is routed through the standard
    ``apply_proposals`` critique + policy gate.  Approved low-risk proposals
    that pass the gate are additionally persisted to the ``skills`` DB table
    via ``store_skill_record``.

    Returns the number of proposals submitted (0 if none).
    Called by the Evolve stage after ``apply_proposals``.
    """
    cfg = cfg or SwarmConfig()
    try:
        from core.skills.crystallizer import SkillCrystallizer  # type: ignore[import]
    except Exception as exc:
        logger.warning("skill_crystallizer_unavailable", exc=str(exc))
        return 0

    def _wrapped_propose(
        proposals: list[EvolutionProposal],
        *,
        runtime_dir: Path = runtime_dir,  # noqa: B008
        auto_apply: bool = auto_apply,
        cfg: SwarmConfig | None = cfg,
    ) -> list[dict[str, Any]]:
        results = apply_proposals(runtime_dir, proposals, auto_apply=auto_apply, cfg=cfg)
        # Persist approved, applied proposals to the skills table
        for res, proposal in zip(results, proposals, strict=False):
            if res.get("applied"):
                crystallized = (
                    proposal.patch.get("skills", {}).get("crystallized", {})
                    if isinstance(proposal.patch, dict)
                    else {}
                )
                for fp_key, skill_meta in crystallized.items():
                    try:
                        store_skill_record(
                            runtime_dir,
                            {
                                "id": f"auto_skill_{fp_key}",
                                "name": skill_meta.get("name", f"auto_skill_{fp_key}"),
                                "description": skill_meta.get("description"),
                                "template": skill_meta.get("template", {}),
                                "source": "crystallized",
                                "status": "active",
                            },
                        )
                    except Exception:
                        pass
        return results

    recent = list_missions(runtime_dir, limit=limit)
    crystallizer = SkillCrystallizer(propose_fn=_wrapped_propose)
    n = crystallizer.run(
        recent,
        runtime_dir=runtime_dir,
        auto_apply=auto_apply,
        cfg=cfg,
    )
    if n:
        logger.info("crystallizer_proposed_skills", count=n)
    return n
