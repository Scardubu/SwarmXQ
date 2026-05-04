from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import pytest
from core.skills.crystallizer import (
    CRYSTALLIZATION_THRESHOLD,
    MIN_SUCCESS_RATE,
    SkillCrystallizer,
)


def _make_task(intent: str, tools: list[str], outcome: str = "SUCCESS", duration_ms: int = 100) -> dict:
    return {
        "intent": intent,
        "tools_used": tools,
        "outcome": outcome,
        "duration_ms": duration_ms,
    }


def _make_mission(mission_id: str, tasks: list[dict]) -> dict:
    return {"id": mission_id, "completed_tasks": tasks}


@pytest.fixture
def propose_fn():
    return MagicMock(return_value=[])


@pytest.fixture
def crystallizer(propose_fn):
    return SkillCrystallizer(propose_fn=propose_fn)


# ---------------------------------------------------------------------------
# analyze()
# ---------------------------------------------------------------------------

def test_analyze_returns_no_proposals_below_threshold(crystallizer):
    missions = [
        _make_mission(f"m{i}", [_make_task("lint code", ["ruff", "black"])])
        for i in range(CRYSTALLIZATION_THRESHOLD - 1)
    ]
    proposals = crystallizer.analyze(missions)
    assert proposals == []


def test_analyze_proposes_above_threshold(crystallizer):
    missions = [
        _make_mission(f"m{i}", [_make_task("lint code", ["ruff", "black"])])
        for i in range(CRYSTALLIZATION_THRESHOLD)
    ]
    proposals = crystallizer.analyze(missions)
    assert len(proposals) == 1
    p = proposals[0]
    assert p["type"] == "SKILL_CRYSTALLIZATION"
    assert "auto_skill_" in p["skill_name"]
    assert p["success_rate"] == 1.0
    assert p["scope"] == "skills"
    assert p["risk"] == "low"
    assert isinstance(p["patch"], dict)


def test_analyze_skips_low_success_rate(crystallizer):
    missions = [
        _make_mission(
            f"m{i}",
            [_make_task("deploy service", ["kubectl"], outcome="FAILURE" if i % 2 else "SUCCESS")],
        )
        for i in range(CRYSTALLIZATION_THRESHOLD + 2)
    ]
    proposals = crystallizer.analyze(missions)
    # Success rate ≤ 50 %, should be skipped
    assert all(
        p["success_rate"] >= MIN_SUCCESS_RATE for p in proposals
    )


def test_analyze_counts_fingerprint_once_per_mission(crystallizer):
    """A single mission that repeats the same task N times should only count as 1."""
    repeated_task = _make_task("build image", ["docker"])
    # One mission with 5 identical tasks — should still only contribute count=1
    missions = [
        _make_mission("m_repeat", [repeated_task] * 5),
    ]
    proposals = crystallizer.analyze(missions)
    assert proposals == []  # count=1, below threshold=3


def test_analyze_template_structure(crystallizer):
    missions = [
        _make_mission(f"m{i}", [_make_task("run tests", ["pytest"], duration_ms=200)])
        for i in range(CRYSTALLIZATION_THRESHOLD)
    ]
    proposals = crystallizer.analyze(missions)
    assert len(proposals) == 1
    tmpl = proposals[0]["template"]
    assert tmpl["version"] == "1.0"
    assert "intent_pattern" in tmpl
    assert "tools" in tmpl
    assert "success_criteria" in tmpl


def test_analyze_multiple_distinct_patterns(crystallizer):
    task_a = _make_task("lint code", ["ruff"])
    task_b = _make_task("run migrations", ["alembic"])
    missions = [
        _make_mission(f"m{i}", [task_a, task_b])
        for i in range(CRYSTALLIZATION_THRESHOLD)
    ]
    proposals = crystallizer.analyze(missions)
    skill_names = {p["skill_name"] for p in proposals}
    assert len(skill_names) == 2  # two distinct fingerprints proposed


# ---------------------------------------------------------------------------
# run()
# ---------------------------------------------------------------------------

def test_run_calls_propose_fn_when_proposals_exist(propose_fn, crystallizer):
    missions = [
        _make_mission(f"m{i}", [_make_task("build docs", ["sphinx"])])
        for i in range(CRYSTALLIZATION_THRESHOLD)
    ]
    n = crystallizer.run(missions)
    assert n == 1
    propose_fn.assert_called_once()


def test_run_returns_zero_when_no_patterns(propose_fn, crystallizer):
    n = crystallizer.run([])
    assert n == 0
    propose_fn.assert_not_called()


def test_run_does_not_raise_when_propose_fn_raises(crystallizer):
    """Crystallizer must be non-critical — never propagates propose errors."""
    def bad_propose(*args, **kwargs):
        raise RuntimeError("gate offline")

    c = SkillCrystallizer(propose_fn=bad_propose)
    missions = [
        _make_mission(f"m{i}", [_make_task("format code", ["black"])])
        for i in range(CRYSTALLIZATION_THRESHOLD)
    ]
    # Should not raise
    n = c.run(missions)
    assert n == 1
