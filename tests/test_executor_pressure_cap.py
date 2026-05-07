from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace

from swarmx.event_bus import EventKind
from swarmx.executor import _apply_pressure_iteration_cap
from swarmx.pressure import PressureLevel


def _fake_cfg() -> SimpleNamespace:
    return SimpleNamespace(home=Path("/tmp"))


def test_pressure_cap_high(monkeypatch) -> None:
    events: list[tuple[Path, object, dict[str, object]]] = []

    monkeypatch.setattr("swarmx.executor.level_from_config", lambda cfg: PressureLevel.HIGH)

    def _emit(home: Path, kind: object, payload: dict[str, object]) -> None:
        events.append((home, kind, payload))

    monkeypatch.setattr("swarmx.executor.emit_event", _emit)

    capped = _apply_pressure_iteration_cap(5, _fake_cfg(), "run-high")

    assert capped == 2
    assert len(events) == 1
    assert events[0][1] == EventKind.HEALTH_CHECK
    assert events[0][2]["pressure"] == PressureLevel.HIGH.value
    assert events[0][2]["max_iterations"] == 2


def test_pressure_cap_critical(monkeypatch) -> None:
    monkeypatch.setattr("swarmx.executor.level_from_config", lambda cfg: PressureLevel.CRITICAL)
    monkeypatch.setattr("swarmx.executor.emit_event", lambda *args, **kwargs: None)

    capped = _apply_pressure_iteration_cap(7, _fake_cfg(), "run-critical")

    assert capped == 1


def test_pressure_cap_is_non_blocking_on_errors(monkeypatch) -> None:
    def _boom(cfg):
        raise RuntimeError("probe failed")

    monkeypatch.setattr("swarmx.executor.level_from_config", _boom)

    capped = _apply_pressure_iteration_cap(4, _fake_cfg(), "run-error")

    assert capped == 4
