"""Tests for src/swarmx/console/output.py — singleton console, safe_print, emit_json."""
from __future__ import annotations

import json


def test_get_console_returns_same_instance():
    from swarmx.console.output import get_console, reset_console

    reset_console()
    c1 = get_console()
    c2 = get_console()
    assert c1 is c2


def test_reset_console_creates_new_instance():
    from swarmx.console.output import get_console, reset_console

    reset_console()
    c1 = get_console()
    reset_console()
    c2 = get_console()
    assert c1 is not c2


def test_emit_json_writes_valid_json(capsys):
    from swarmx.console.output import emit_json

    emit_json({"key": "value", "num": 42})
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert data["key"] == "value"
    assert data["num"] == 42


def test_emit_json_nested(capsys):
    from swarmx.console.output import emit_json

    payload = {"results": [{"id": 1}, {"id": 2}], "total": 2}
    emit_json(payload)
    captured = capsys.readouterr()
    data = json.loads(captured.out)
    assert data["total"] == 2
    assert len(data["results"]) == 2


def test_safe_print_no_crash(monkeypatch):
    """safe_print must not raise even if markup is malformed."""
    from swarmx.console.output import reset_console, safe_print

    reset_console()
    # Should not raise
    safe_print("[bold]Hello[/bold]")
    safe_print("plain text")
    safe_print("")


def test_safe_print_in_no_color_mode(monkeypatch):
    monkeypatch.setenv("NO_COLOR", "1")
    from swarmx.console.output import reset_console, safe_print

    reset_console()
    safe_print("[brand]SwarmX[/brand]")  # must not raise


def test_emit_error_prints_message(capsys, monkeypatch):
    """emit_error prints an error panel (it does NOT raise SystemExit by itself)."""


    # Use JSON mode so output goes to stdout and is easy to assert.
    monkeypatch.setenv("SWARMX_JSON", "1")
    import importlib

    import swarmx.console.compat as _compat
    importlib.reload(_compat)

    # Reload output so it picks up the new compat state
    import swarmx.console.output as _out
    importlib.reload(_out)

    _out.emit_error("something went wrong", code=1)
    captured = capsys.readouterr()
    import json
    data = json.loads(captured.out)
    assert data["error"] == "something went wrong"
    assert data["code"] == 1
