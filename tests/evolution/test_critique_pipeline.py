from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from swarmx.evolution.critic_agent import CriticVerdict
from swarmx.evolution.critique_pipeline import CritiquePipeline
from swarmx.evolution.redteam_agent import RedTeamVerdict


def make_pipeline(
    critic_decision: str = "APPROVE",
    rt_decision: str = "PASS",
    rt_severity: str | None = None,
    policy_approved: bool = True,
) -> CritiquePipeline:
    critic = MagicMock()
    critic.evaluate.return_value = CriticVerdict(
        decision=critic_decision,
        confidence=0.9,
        improvement_delta=5.0,
        reasoning="test",
    )
    red_team = MagicMock()
    red_team.attack.return_value = RedTeamVerdict(
        decision=rt_decision,
        attack_vector=None,
        failure_scenario=None,
        severity=rt_severity,
        reasoning="test",
    )
    policy = MagicMock()
    policy.evaluate.return_value = (policy_approved, "ok")
    policy.get_active_rules.return_value = []
    return CritiquePipeline(critic, red_team, policy)


def test_full_approval() -> None:
    pipeline = make_pipeline()
    approved, _ = pipeline.evaluate({}, "m1", [], [])
    assert approved is True


def test_critic_rejects() -> None:
    pipeline = make_pipeline(critic_decision="REJECT")
    approved, reason = pipeline.evaluate({}, "m1", [], [])
    assert approved is False
    assert "Critic rejected" in reason


def test_redteam_blocks_critical() -> None:
    pipeline = make_pipeline(rt_decision="FAIL", rt_severity="CRITICAL")
    approved, reason = pipeline.evaluate({}, "m1", [], [])
    assert approved is False
    assert "Red-team blocked" in reason


def test_redteam_low_severity_passes() -> None:
    pipeline = make_pipeline(rt_decision="FAIL", rt_severity="LOW")
    approved, _ = pipeline.evaluate({}, "m1", [], [])
    assert approved is True
