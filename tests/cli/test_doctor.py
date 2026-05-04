"""Tests for src/swarmx/console/commands/doctor.py — run_checks() contract."""
from __future__ import annotations


def test_run_checks_returns_list():
    from swarmx.console.commands.doctor import run_checks

    results = run_checks()
    assert isinstance(results, list)
    assert len(results) > 0


def test_run_checks_item_schema():
    from swarmx.console.commands.doctor import run_checks

    results = run_checks()
    for item in results:
        # run_checks returns TypedDict-like CheckResult objects
        assert "check" in item, f"Missing 'check' key in {item}"
        assert "status" in item, f"Missing 'status' key in {item}"
        assert item["status"] in {"ok", "warn", "error", "skip"}, (
            f"Unexpected status '{item['status']}' in {item}"
        )


def test_run_checks_python_version_check_present():
    from swarmx.console.commands.doctor import run_checks

    results = run_checks()
    names = [r["check"] for r in results]
    assert any("python" in n.lower() for n in names), (
        f"Expected a Python version check; got: {names}"
    )


def test_run_checks_no_crash():
    """run_checks() must not raise TypeError or AttributeError."""
    from swarmx.console.commands.doctor import run_checks

    try:
        run_checks()
    except SystemExit:
        pass  # acceptable — doctor may exit on hard errors
