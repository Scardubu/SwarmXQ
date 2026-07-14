"""Tests for core.evolution.divergent_proposer."""
from __future__ import annotations

import json
from unittest.mock import MagicMock

from core.evolution.divergent_proposer import (
    STANCES,
    DivergentProposer,
    RankedProposal,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_proposal(
    *,
    improvement_delta: float = 0.5,
    confidence: float = 0.8,
    risk_score: float = 0.2,
) -> dict:
    return {
        "scope": "reliability",
        "reason": "test proposal",
        "patch": {"runtime": {"checkpoint_every": 1}},
        "risk": "low",
        "estimated_improvement_delta": improvement_delta,
        "confidence": confidence,
        "risk_score": risk_score,
    }


def _make_llm(proposals: list[dict | None]) -> MagicMock:
    """Return an LLM mock that yields each proposal JSON in order (round-robin)."""
    client = MagicMock()
    responses = iter(
        [json.dumps(p) if p is not None else "{invalid json{{" for p in proposals]
    )
    client.complete.side_effect = lambda **_kwargs: next(responses, json.dumps(_make_proposal()))
    return client


def _make_critique(decisions: list[tuple[bool, str]]) -> MagicMock:
    """Return a CritiquePipeline mock yielding decisions in order."""
    pipeline = MagicMock()
    responses = iter(decisions)
    pipeline.evaluate.side_effect = lambda **_kwargs: next(
        responses, (True, "default-approved")
    )
    return pipeline


def _proposer(llm=None, critique=None, prompt: str = "base prompt") -> DivergentProposer:
    return DivergentProposer(
        llm_client=llm or MagicMock(),
        critique_pipeline=critique or MagicMock(),
        base_system_prompt=prompt,
    )


# ---------------------------------------------------------------------------
# STANCES constant
# ---------------------------------------------------------------------------


def test_stances_has_three_entries():
    assert set(STANCES.keys()) == {"conservative", "aggressive", "lateral"}


def test_stances_each_have_temperature_and_suffix():
    for name, cfg in STANCES.items():
        assert "temperature" in cfg, f"{name} missing temperature"
        assert "system_suffix" in cfg, f"{name} missing system_suffix"
        assert isinstance(cfg["temperature"], (int, float))
        assert isinstance(cfg["system_suffix"], str) and cfg["system_suffix"]


# ---------------------------------------------------------------------------
# RankedProposal.pareto_score
# ---------------------------------------------------------------------------


def test_pareto_score_formula():
    r = RankedProposal(
        stance="conservative",
        proposal={},
        improvement_delta=0.5,
        confidence=0.8,
        risk_score=0.2,
    )
    expected = (0.5 * 0.8) / (1.0 + 0.2)
    assert abs(r.pareto_score - expected) < 1e-9


def test_pareto_score_high_risk_penalised():
    low_risk = RankedProposal("a", {}, 0.5, 0.8, 0.1)
    high_risk = RankedProposal("b", {}, 0.5, 0.8, 0.9)
    assert low_risk.pareto_score > high_risk.pareto_score


def test_pareto_score_high_confidence_rewarded():
    low_conf = RankedProposal("a", {}, 0.5, 0.3, 0.2)
    high_conf = RankedProposal("b", {}, 0.5, 0.9, 0.2)
    assert high_conf.pareto_score > low_conf.pareto_score


# ---------------------------------------------------------------------------
# generate_proposals — all approved
# ---------------------------------------------------------------------------


def test_returns_none_when_all_rejected():
    llm = _make_llm([_make_proposal()] * 3)
    critique = _make_critique([(False, "too risky")] * 3)
    result = _proposer(llm, critique).generate_proposals(
        evolution_context={},
        mission_id="m-001",
        recent_missions=[],
        policy_rules=[],
    )
    assert result is None


def test_returns_best_when_all_approved():
    # conservative → delta=0.3, conf=0.9, risk=0.1 → pareto≈0.245
    # aggressive   → delta=0.9, conf=0.6, risk=0.8 → pareto≈0.300
    # lateral      → delta=0.8, conf=0.7, risk=0.3 → pareto≈0.431  ← winner
    props = [
        _make_proposal(improvement_delta=0.3, confidence=0.9, risk_score=0.1),
        _make_proposal(improvement_delta=0.9, confidence=0.6, risk_score=0.8),
        _make_proposal(improvement_delta=0.8, confidence=0.7, risk_score=0.3),
    ]
    llm = _make_llm(props)
    critique = _make_critique([(True, "ok")] * 3)
    result = _proposer(llm, critique).generate_proposals(
        evolution_context={}, mission_id="m-002", recent_missions=[], policy_rules=[]
    )
    assert result is not None
    assert result.stance == "lateral"
    expected = (0.8 * 0.7) / (1.0 + 0.3)
    assert abs(result.pareto_score - expected) < 1e-6


def test_skips_rejected_and_returns_survivor():
    props = [
        _make_proposal(improvement_delta=0.4, confidence=0.7, risk_score=0.3),  # conservative — rejected
        _make_proposal(improvement_delta=0.6, confidence=0.8, risk_score=0.2),  # aggressive  — approved
        _make_proposal(improvement_delta=0.3, confidence=0.5, risk_score=0.1),  # lateral     — approved
    ]
    llm = _make_llm(props)
    critique = _make_critique([(False, "rejected"), (True, "ok"), (True, "ok")])
    result = _proposer(llm, critique).generate_proposals(
        evolution_context={}, mission_id="m-003", recent_missions=[], policy_rules=[]
    )
    assert result is not None
    assert result.stance == "aggressive"


# ---------------------------------------------------------------------------
# generate_proposals — invalid LLM output
# ---------------------------------------------------------------------------


def test_skips_bad_json_proposal():
    """A stance that returns invalid JSON must be skipped, not raise."""
    client = MagicMock()
    responses = ["{not valid", json.dumps(_make_proposal()), json.dumps(_make_proposal())]
    idx = iter(range(len(responses)))
    client.complete.side_effect = lambda **_: responses[next(idx)]
    critique = _make_critique([(True, "ok")] * 3)
    result = _proposer(client, critique).generate_proposals(
        evolution_context={}, mission_id="m-004", recent_missions=[], policy_rules=[]
    )
    assert result is not None  # at least one stance produced a valid proposal


def test_skips_non_dict_json():
    """A stance that returns a JSON array must be skipped."""
    client = MagicMock()
    responses = [json.dumps([1, 2, 3]), json.dumps(_make_proposal()), json.dumps(_make_proposal())]
    idx = iter(range(len(responses)))
    client.complete.side_effect = lambda **_: responses[next(idx)]
    critique = _make_critique([(True, "ok")] * 3)
    result = _proposer(client, critique).generate_proposals(
        evolution_context={}, mission_id="m-005", recent_missions=[], policy_rules=[]
    )
    assert result is not None


def test_llm_exception_is_swallowed():
    """An LLM call that raises must not propagate."""
    client = MagicMock()
    client.complete.side_effect = RuntimeError("connection refused")
    critique = _make_critique([(True, "ok")])
    result = _proposer(client, critique).generate_proposals(
        evolution_context={}, mission_id="m-006", recent_missions=[], policy_rules=[]
    )
    assert result is None


def test_critique_exception_is_swallowed():
    """A critique call that raises must not propagate."""
    llm = _make_llm([_make_proposal()] * 3)
    critique = MagicMock()
    critique.evaluate.side_effect = Exception("critique down")
    result = _proposer(llm, critique).generate_proposals(
        evolution_context={}, mission_id="m-007", recent_missions=[], policy_rules=[]
    )
    assert result is None


# ---------------------------------------------------------------------------
# generate_proposals — missing score fields use defaults
# ---------------------------------------------------------------------------


def test_missing_score_fields_use_defaults():
    """Proposals that omit scoring fields should fall back to (1.0, 0.5, 0.5)."""
    minimal = {"scope": "test", "reason": "r", "patch": {}, "risk": "low"}
    client = MagicMock()
    client.complete.return_value = json.dumps(minimal)
    critique = _make_critique([(True, "ok")] * 3)
    result = _proposer(client, critique).generate_proposals(
        evolution_context={}, mission_id="m-008", recent_missions=[], policy_rules=[]
    )
    assert result is not None
    assert result.improvement_delta == 1.0
    assert result.confidence == 0.5
    assert result.risk_score == 0.5


# ---------------------------------------------------------------------------
# generate_proposals — LLM receives correct system prompt
# ---------------------------------------------------------------------------


def test_llm_receives_stance_specific_suffix():
    """Each stance must pass its suffix in the system argument."""
    client = MagicMock()
    client.complete.return_value = json.dumps(_make_proposal())
    critique = _make_critique([(True, "ok")] * 3)
    _proposer(client, critique, prompt="BASE").generate_proposals(
        evolution_context={"k": "v"},
        mission_id="m-009",
        recent_missions=[],
        policy_rules=[],
    )
    assert client.complete.call_count == 3
    system_prompts = [call.kwargs["system"] for call in client.complete.call_args_list]
    assert any(STANCES["conservative"]["system_suffix"] in s for s in system_prompts)
    assert any(STANCES["aggressive"]["system_suffix"] in s for s in system_prompts)
    assert any(STANCES["lateral"]["system_suffix"] in s for s in system_prompts)
    assert all(s.startswith("BASE") for s in system_prompts)
