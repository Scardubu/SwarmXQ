from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from swarmx.execution_gate import gate_execution
from swarmx.policy import ExecutionPolicy, PolicyDecision
from swarmx.state import RiskLevel


def _fake_cfg() -> SimpleNamespace:
    return SimpleNamespace(home=Path("/tmp"))


def test_gate_execution_allows_and_publishes(monkeypatch) -> None:
    decision = PolicyDecision(
        allowed=True,
        risk=RiskLevel.LOW.value,
        tier="low",
        human_gate=False,
        reasons=[],
        mitigations=[],
        confidence=0.95,
        mode=ExecutionPolicy.AUTONOMOUS.value,
    )
    published: list[tuple[Path, object, dict[str, object]]] = []

    monkeypatch.setattr("swarmx.execution_gate.assess_action", lambda *args, **kwargs: decision)

    def _publish(home: Path, kind: object, payload: dict[str, object]) -> None:
        published.append((home, kind, payload))

    monkeypatch.setattr("swarmx.execution_gate.publish", _publish)

    out = gate_execution(
        "run",
        "stabilize backend",
        Path("."),
        _fake_cfg(),
        review_required=False,
        job_id="job-123",
    )

    assert out.allowed is True
    assert out.mode == ExecutionPolicy.AUTONOMOUS.value
    assert len(published) == 1
    assert published[0][2]["action"] == "run"
    assert published[0][2]["job_id"] == "job-123"


def test_gate_execution_fail_closed_when_assessment_raises(monkeypatch) -> None:
    def _boom(*args, **kwargs):
        raise RuntimeError("policy backend unavailable")

    monkeypatch.setattr("swarmx.execution_gate.assess_action", _boom)
    monkeypatch.setattr("swarmx.execution_gate.publish", lambda *args, **kwargs: None)

    out = gate_execution("run", "high risk", Path("."), _fake_cfg())

    assert out.allowed is False
    assert out.risk == RiskLevel.CRITICAL.value
    assert out.mode == ExecutionPolicy.BLOCKED.value
    assert out.human_gate is True
    assert any(reason.startswith("assessment_error:RuntimeError") for reason in out.reasons)
