"""
tests/test_pressure.py — Unit tests for src/swarmx/pressure.py

CHANGES V5.9:
  [ENH-05] New test module verifying procfs pressure state machine.
"""
from __future__ import annotations

import pytest

from swarmx.pressure import (
    PressureLevel,
    PressureSnapshot,
    _measure,
    _read_meminfo,
    _read_zram_used_pct,
    concurrency_limit_from_config,
    get_pressure,
    get_pressure_async,
    level_from_config,
    reset_pressure_cache,
)


@pytest.fixture(autouse=True)
def _reset_pressure_cache_fixture() -> None:
    reset_pressure_cache()


# ─── _read_meminfo ────────────────────────────────────────────────────────────

def test_read_meminfo_returns_dict():
    result = _read_meminfo()
    # On Linux this must have MemTotal; in CI it may be missing — just verify type.
    assert isinstance(result, dict)


def test_read_meminfo_has_mem_available_on_linux():
    import platform
    if platform.system() != "Linux":
        pytest.skip("procfs only on Linux")
    result = _read_meminfo()
    assert "MemAvailable" in result
    assert result["MemAvailable"] > 0


# ─── _read_zram_used_pct ──────────────────────────────────────────────────────

def test_read_zram_used_pct_returns_float():
    result = _read_zram_used_pct(4096)
    assert isinstance(result, float)
    assert 0.0 <= result <= 1.0


def test_read_zram_used_pct_zero_size():
    result = _read_zram_used_pct(0)
    assert result == 0.0


# ─── _measure ─────────────────────────────────────────────────────────────────

def test_measure_normal_when_proc_unreadable(monkeypatch):
    """If /proc/meminfo is unreadable, _measure should return NORMAL (non-blocking)."""
    monkeypatch.setattr("swarmx.pressure._read_meminfo", lambda: {})
    snap = _measure(1500, 800, 0.60, 0.85, 4096)
    assert snap.level == PressureLevel.NORMAL
    assert snap.available_mb == 0


def test_measure_critical_when_ram_below_threshold(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 400 * 1024})   # 400 MB < 800 MB
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.1)
    snap = _measure(1500, 800, 0.60, 0.85, 4096)
    assert snap.level == PressureLevel.CRITICAL
    assert snap.available_mb == 400


def test_measure_high_when_ram_between_thresholds(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 1200 * 1024})  # 1200 MB: warn<1200<1500
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    snap = _measure(1500, 800, 0.60, 0.85, 4096)
    assert snap.level == PressureLevel.HIGH


def test_measure_normal_when_ram_above_threshold(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 3000 * 1024})  # 3000 MB > 1500 MB
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    snap = _measure(1500, 800, 0.60, 0.85, 4096)
    assert snap.level == PressureLevel.NORMAL


def test_measure_critical_when_zram_above_threshold(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 4000 * 1024})  # plenty of RAM
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.90)  # >0.85
    snap = _measure(1500, 800, 0.60, 0.85, 4096)
    assert snap.level == PressureLevel.CRITICAL


def test_measure_high_when_zram_between_thresholds(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 4000 * 1024})
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.70)  # 0.60-0.85
    snap = _measure(1500, 800, 0.60, 0.85, 4096)
    assert snap.level == PressureLevel.HIGH


# ─── get_pressure (caching) ───────────────────────────────────────────────────

def test_get_pressure_returns_snapshot(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 3000 * 1024})
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    snap = get_pressure(force=True)
    assert isinstance(snap, PressureSnapshot)
    assert snap.level in (PressureLevel.NORMAL, PressureLevel.HIGH, PressureLevel.CRITICAL)


def test_get_pressure_uses_cache(monkeypatch):
    """Second call within TTL must not re-read (call count stays 1)."""
    call_count = {"n": 0}

    def _fake_meminfo():
        call_count["n"] += 1
        return {"MemAvailable": 4000 * 1024}

    monkeypatch.setattr("swarmx.pressure._read_meminfo", _fake_meminfo)
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)

    get_pressure(ttl_s=60, force=True)     # prime cache
    get_pressure(ttl_s=60)                 # should use cache
    assert call_count["n"] == 1            # only one call


def test_get_pressure_force_bypasses_cache(monkeypatch):
    call_count = {"n": 0}

    def _fake_meminfo():
        call_count["n"] += 1
        return {"MemAvailable": 4000 * 1024}

    monkeypatch.setattr("swarmx.pressure._read_meminfo", _fake_meminfo)
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)

    get_pressure(ttl_s=60, force=True)
    get_pressure(ttl_s=60, force=True)
    assert call_count["n"] == 2


# ─── get_pressure_async ───────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_get_pressure_async_returns_snapshot(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 3000 * 1024})
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    snap = await get_pressure_async(force=True)
    assert isinstance(snap, PressureSnapshot)


# ─── level_from_config / concurrency_limit_from_config ───────────────────────

class _FakeCfg:
    pressure_warn_mb = 1500
    pressure_critical_mb = 800
    pressure_check_interval_s = 5.0
    governance_normal_max = 2
    governance_high_max = 1
    governance_critical_max = 1


def test_level_from_config_normal(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 4000 * 1024})
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    level = level_from_config(_FakeCfg())
    assert level == PressureLevel.NORMAL


def test_concurrency_limit_normal(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 4000 * 1024})
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    limit = concurrency_limit_from_config(_FakeCfg())
    assert limit == 2


def test_concurrency_limit_high(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 1200 * 1024})  # HIGH
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    limit = concurrency_limit_from_config(_FakeCfg())
    assert limit == 1


def test_concurrency_limit_critical(monkeypatch):
    monkeypatch.setattr("swarmx.pressure._read_meminfo",
                        lambda: {"MemAvailable": 500 * 1024})  # CRITICAL
    monkeypatch.setattr("swarmx.pressure._read_zram_used_pct", lambda _: 0.0)
    limit = concurrency_limit_from_config(_FakeCfg())
    assert limit == 1
