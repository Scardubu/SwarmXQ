"""Tests for src/swarmx/console/compat.py — env-var detection helpers."""
from __future__ import annotations

import importlib


def _reload_compat():
    """Force-reload compat module so fresh env state is picked up."""
    import swarmx.console.compat as m
    importlib.reload(m)
    return m


class TestIsNoColor:
    def test_false_by_default(self, monkeypatch):
        monkeypatch.delenv("NO_COLOR", raising=False)
        monkeypatch.delenv("SWARMX_NO_COLOR", raising=False)
        m = _reload_compat()
        assert m.is_no_color() is False

    def test_true_when_no_color_set(self, monkeypatch):
        monkeypatch.setenv("NO_COLOR", "1")
        m = _reload_compat()
        assert m.is_no_color() is True

    def test_true_when_swarmx_no_color_set(self, monkeypatch):
        monkeypatch.delenv("NO_COLOR", raising=False)
        monkeypatch.setenv("SWARMX_NO_COLOR", "1")
        m = _reload_compat()
        assert m.is_no_color() is True


class TestIsCI:
    def test_false_by_default(self, monkeypatch):
        monkeypatch.delenv("CI", raising=False)
        m = _reload_compat()
        assert m.is_ci() is False

    def test_true_when_ci_set(self, monkeypatch):
        monkeypatch.setenv("CI", "true")
        m = _reload_compat()
        assert m.is_ci() is True


class TestIsJsonMode:
    def test_false_by_default(self, monkeypatch):
        monkeypatch.delenv("SWARMX_JSON", raising=False)
        m = _reload_compat()
        assert m.is_json_mode() is False

    def test_true_when_set(self, monkeypatch):
        monkeypatch.setenv("SWARMX_JSON", "1")
        m = _reload_compat()
        assert m.is_json_mode() is True


class TestIsQuiet:
    def test_false_by_default(self, monkeypatch):
        monkeypatch.delenv("SWARMX_QUIET", raising=False)
        m = _reload_compat()
        assert m.is_quiet() is False

    def test_true_when_set(self, monkeypatch):
        monkeypatch.setenv("SWARMX_QUIET", "1")
        m = _reload_compat()
        assert m.is_quiet() is True


class TestTerminalWidth:
    def test_returns_integer(self):
        m = _reload_compat()
        assert isinstance(m.terminal_width(), int)
        assert m.terminal_width() >= 40


class TestHasOptionalDeps:
    def test_returns_bool(self):
        m = _reload_compat()
        assert isinstance(m.has_textual(), bool)
        assert isinstance(m.has_questionary(), bool)
        assert isinstance(m.has_typer(), bool)
