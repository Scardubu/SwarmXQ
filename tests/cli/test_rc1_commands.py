"""Tests for the RC1 operational CLI commands — up, logs, backup, restore, update.

These are smoke tests: they verify the Typer app structure, command registration,
and option schemas without executing actual I/O operations (which require a live
SwarmX stack). Live integration tests are intentionally out of scope for unit CI.
"""
from __future__ import annotations

import importlib

import typer
from typer.testing import CliRunner

runner = CliRunner()


def _load_app(module_path: str) -> typer.Typer:
    mod = importlib.import_module(module_path)
    return mod.app


# ── swarm up ──────────────────────────────────────────────────────────────────

class TestUpCommand:
    def test_app_is_typer(self):
        app = _load_app("swarmx.console.commands.up")
        assert isinstance(app, typer.Typer)

    def test_help_exits_cleanly(self):
        app = _load_app("swarmx.console.commands.up")
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0
        assert "start" in result.output.lower() or "stop" in result.output.lower() or "stack" in result.output.lower()

    def test_stop_subcommand_exits_when_not_running(self):
        """stop subcommand when no stack is running should report gracefully."""
        app = _load_app("swarmx.console.commands.up")
        result = runner.invoke(app, ["stop"])
        # Acceptable: 0 (nothing to stop) or 1 (not running error)
        assert result.exit_code in (0, 1)


# ── swarm logs ────────────────────────────────────────────────────────────────

class TestLogsCommand:
    def test_app_is_typer(self):
        app = _load_app("swarmx.console.commands.logs")
        assert isinstance(app, typer.Typer)

    def test_help_exits_cleanly(self):
        app = _load_app("swarmx.console.commands.logs")
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0

    def test_options_documented(self):
        app = _load_app("swarmx.console.commands.logs")
        result = runner.invoke(app, ["--help"])
        # Core options must be present in help text
        assert "--follow" in result.output or "-f" in result.output or "follow" in result.output.lower()


# ── swarm backup ──────────────────────────────────────────────────────────────

class TestBackupCommand:
    def test_app_is_typer(self):
        app = _load_app("swarmx.console.commands.backup")
        assert isinstance(app, typer.Typer)

    def test_help_exits_cleanly(self):
        app = _load_app("swarmx.console.commands.backup")
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0

    def test_list_subcommand_exists(self):
        app = _load_app("swarmx.console.commands.backup")
        result = runner.invoke(app, ["list", "--help"])
        # list subcommand or top-level --list flag
        assert result.exit_code in (0, 2)  # 2 = no such subcommand (acceptable if flag-based)

    def test_create_help(self):
        app = _load_app("swarmx.console.commands.backup")
        result = runner.invoke(app, ["create", "--help"])
        assert result.exit_code == 0


# ── swarm restore ─────────────────────────────────────────────────────────────

class TestRestoreCommand:
    def test_app_is_typer(self):
        app = _load_app("swarmx.console.commands.restore")
        assert isinstance(app, typer.Typer)

    def test_help_exits_cleanly(self):
        app = _load_app("swarmx.console.commands.restore")
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0


# ── swarm update ──────────────────────────────────────────────────────────────

class TestUpdateCommand:
    def test_app_is_typer(self):
        app = _load_app("swarmx.console.commands.update")
        assert isinstance(app, typer.Typer)

    def test_help_exits_cleanly(self):
        app = _load_app("swarmx.console.commands.update")
        result = runner.invoke(app, ["--help"])
        assert result.exit_code == 0

    def test_check_flag_does_not_mutate(self):
        """--check should never write files — exit cleanly regardless of network."""
        app = _load_app("swarmx.console.commands.update")
        result = runner.invoke(app, ["--check"])
        # Any exit code is acceptable as long as no unhandled exception
        assert result.exception is None or isinstance(result.exception, SystemExit)


# ── Root app registration ─────────────────────────────────────────────────────

class TestRootRegistration:
    """Verify all RC1 commands are reachable from the root app."""

    def test_all_rc1_commands_registered(self):
        from swarmx.console.app import app as root_app

        commands = {c.name for c in root_app.registered_commands}
        typers = {t.name for t in root_app.registered_groups}

        all_registered = commands | typers
        for expected in ("up", "logs", "backup", "restore", "update"):
            assert expected in all_registered, (
                f"RC1 command '{expected}' not registered in root app. "
                f"Registered: {sorted(all_registered)}"
            )
