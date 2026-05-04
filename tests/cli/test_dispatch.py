from __future__ import annotations

import sys
import types

import pytest

import swarmx.cli as cli


@pytest.fixture
def premium_stub(monkeypatch):
    calls: list[tuple[str, list[str] | None]] = []

    def _premium_main() -> None:
        calls.append(("premium", sys.argv[1:]))

    monkeypatch.setitem(sys.modules, "swarmx.console.entry", types.SimpleNamespace(main=_premium_main))
    return calls


def test_legacy_only_commands_stay_on_argparse(monkeypatch, premium_stub):
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 7)

    code = cli.main(["plan", ".", "stabilize"])

    assert code == 7
    assert premium_stub == [("legacy", ["plan", ".", "stabilize"])]


def test_run_legacy_shape_prefers_legacy(monkeypatch, premium_stub):
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 9)

    code = cli.main(["run", ".", "--target", "stabilize"])

    assert code == 9
    assert premium_stub == [("legacy", ["run", ".", "--target", "stabilize"])]


def test_run_typer_shape_uses_premium_and_restores_argv(monkeypatch, premium_stub):
    original_argv = sys.argv[:]
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 1)

    code = cli.main(["run", "stabilize", "--repo", "."])

    assert code == 0
    assert premium_stub == [("premium", ["run", "stabilize", "--repo", "."])]
    assert sys.argv == original_argv


def test_doctor_without_subcommand_uses_legacy(monkeypatch, premium_stub):
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 3)

    code = cli.main(["doctor", "--json"])

    assert code == 3
    assert premium_stub == [("legacy", ["doctor", "--json"])]


def test_doctor_check_uses_premium(monkeypatch, premium_stub):
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 1)

    code = cli.main(["doctor", "check", "--json"])

    assert code == 0
    assert premium_stub == [("premium", ["doctor", "check", "--json"])]


def test_status_repo_shape_prefers_legacy(monkeypatch, premium_stub):
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 5)

    code = cli.main(["status", "."])

    assert code == 5
    assert premium_stub == [("legacy", ["status", "."])]


def test_status_show_uses_premium(monkeypatch, premium_stub):
    monkeypatch.setattr(cli, "_legacy_main", lambda argv=None: premium_stub.append(("legacy", argv)) or 1)

    code = cli.main(["status", "show", "--json"])

    assert code == 0
    assert premium_stub == [("premium", ["status", "show", "--json"])]
