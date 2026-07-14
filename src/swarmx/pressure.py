"""swarmx.pressure — Procfs-based runtime memory pressure state machine.

Reads /proc/meminfo to measure available RAM and /proc/swaps for ZRAM
utilisation. Returns a PressureLevel (normal | high | critical) that the
orchestrator and DAG graph executor consume to adapt concurrency and skip
non-essential steps under memory stress.

Design constraints:
  - Never raises — all reads degrade gracefully to PressureLevel.NORMAL.
  - No external dependencies; stdlib only.
  - Async-safe: get_pressure_async does the same bounded procfs read directly.
  - Module-level cached snapshot (TTL-based) avoids hammering procfs every step.

CHANGES V5.9 vs prior:
  [ENH-05] New module. Procfs-driven pressure state used by orchestrator,
           brain/graph.py DAG executor, and SSE governor broadcaster.
"""
from __future__ import annotations

import time
from enum import Enum
from pathlib import Path
from typing import NamedTuple

# ─── Public types ─────────────────────────────────────────────────────────────

class PressureLevel(str, Enum):
    NORMAL   = "normal"
    HIGH     = "high"
    CRITICAL = "critical"


class PressureSnapshot(NamedTuple):
    level:          PressureLevel
    available_mb:   int    # MemAvailable from /proc/meminfo (0 = unreadable)
    zram_used_pct:  float  # fraction of ZRAM device used (0.0–1.0)
    timestamp:      float  # time.monotonic() of measurement


# ─── Procfs readers (pure sync, never raise) ──────────────────────────────────

def _read_meminfo() -> dict[str, int]:
    """Parse /proc/meminfo → {key: kB_value}. Returns {} on any error."""
    try:
        raw = Path("/proc/meminfo").read_text(encoding="ascii", errors="replace")
        result: dict[str, int] = {}
        for line in raw.splitlines():
            parts = line.split()
            if len(parts) >= 2:
                key = parts[0].rstrip(":")
                try:
                    result[key] = int(parts[1])
                except ValueError:
                    pass
        return result
    except Exception:
        return {}


def _read_zram_used_pct(device_size_mb: int = 4096) -> float:
    """
    Estimate ZRAM utilisation from /proc/swaps.

    Reads the 'Used' column (kB) for zram entries and divides by the
    configured device size. Returns 0.0 if /proc/swaps is unreadable or
    no zram entry is found.
    """
    try:
        raw = Path("/proc/swaps").read_text(encoding="ascii", errors="replace")
        total_used_kb = 0
        for line in raw.splitlines()[1:]:   # skip header
            cols = line.split()
            if len(cols) >= 4 and "zram" in cols[0]:
                try:
                    total_used_kb += int(cols[3])
                except ValueError:
                    pass
        if device_size_mb <= 0:
            return 0.0
        return min(total_used_kb / (device_size_mb * 1024), 1.0)
    except Exception:
        return 0.0


# ─── Core measurement ─────────────────────────────────────────────────────────

def _measure(
    warn_mb: int,
    critical_mb: int,
    zram_warn_pct: float,
    zram_critical_pct: float,
    zram_device_mb: int,
) -> PressureSnapshot:
    mem = _read_meminfo()
    available_mb = mem.get("MemAvailable", 0) // 1024

    zram_used = _read_zram_used_pct(zram_device_mb)

    # Determine level — whichever dimension is worse wins.
    if available_mb == 0:
        # Unreadable procfs → non-blocking, assume normal.
        level = PressureLevel.NORMAL
    elif available_mb <= critical_mb or zram_used >= zram_critical_pct:
        level = PressureLevel.CRITICAL
    elif available_mb <= warn_mb or zram_used >= zram_warn_pct:
        level = PressureLevel.HIGH
    else:
        level = PressureLevel.NORMAL

    return PressureSnapshot(
        level=level,
        available_mb=available_mb,
        zram_used_pct=round(zram_used, 3),
        timestamp=time.monotonic(),
    )


# ─── TTL-cached module-level snapshot ────────────────────────────────────────

_CACHE: PressureSnapshot | None = None
_CACHE_TTL_S: float = 5.0   # updated at first get_pressure() call from config


def _cache_expired() -> bool:
    if _CACHE is None:
        return True
    return (time.monotonic() - _CACHE.timestamp) > _CACHE_TTL_S


def reset_pressure_cache() -> None:
    """Clear the module-level pressure snapshot cache for deterministic tests."""
    global _CACHE
    _CACHE = None


def get_pressure(
    warn_mb: int = 1500,
    critical_mb: int = 800,
    zram_warn_pct: float = 0.60,
    zram_critical_pct: float = 0.85,
    zram_device_mb: int = 4096,
    ttl_s: float = 5.0,
    force: bool = False,
) -> PressureSnapshot:
    """
    Return a cached PressureSnapshot; re-measure after ttl_s seconds.

    Callers should pass thresholds from SwarmConfig on first call; subsequent
    cached calls with default args reuse the last measurement.

    Args:
        warn_mb:            MemAvailable threshold for HIGH pressure (MB).
        critical_mb:        MemAvailable threshold for CRITICAL pressure (MB).
        zram_warn_pct:      ZRAM used fraction triggering HIGH (0.0–1.0).
        zram_critical_pct:  ZRAM used fraction triggering CRITICAL (0.0–1.0).
        zram_device_mb:     Configured ZRAM device size (MB) for % calculation.
        ttl_s:              Cache lifetime in seconds.
        force:              If True, bypass cache and re-measure immediately.

    Returns:
        PressureSnapshot — never raises.
    """
    global _CACHE, _CACHE_TTL_S
    _CACHE_TTL_S = ttl_s
    if not force and not _cache_expired():
        return _CACHE  # type: ignore[return-value]
    _CACHE = _measure(warn_mb, critical_mb, zram_warn_pct, zram_critical_pct, zram_device_mb)
    return _CACHE


async def get_pressure_async(
    warn_mb: int = 1500,
    critical_mb: int = 800,
    zram_warn_pct: float = 0.60,
    zram_critical_pct: float = 0.85,
    zram_device_mb: int = 4096,
    ttl_s: float = 5.0,
    force: bool = False,
) -> PressureSnapshot:
    """Async wrapper for the cached pressure reader.

    The work is limited to small procfs reads and cache checks. Running it
    directly avoids default-executor lifecycle issues in short-lived asyncio
    runners while keeping the public async API intact.
    """
    return get_pressure(
        warn_mb,
        critical_mb,
        zram_warn_pct,
        zram_critical_pct,
        zram_device_mb,
        ttl_s,
        force,
    )


def level_from_config(cfg: object) -> PressureLevel:
    """
    Convenience: call get_pressure with thresholds extracted from a SwarmConfig
    (or any object with pressure_warn_mb / pressure_critical_mb attributes).

    Falls back to defaults if attributes are absent.
    """
    warn = getattr(cfg, "pressure_warn_mb", 1500)
    crit = getattr(cfg, "pressure_critical_mb", 800)
    ttl  = getattr(cfg, "pressure_check_interval_s", 5.0)
    return get_pressure(warn_mb=warn, critical_mb=crit, ttl_s=ttl).level


def concurrency_limit_from_config(cfg: object) -> int:
    """
    Return the appropriate max-concurrent value for the current pressure level,
    reading governance.concurrency.* from a SwarmConfig-like object.
    """
    level = level_from_config(cfg)
    if level is PressureLevel.CRITICAL:
        return getattr(cfg, "governance_critical_max", 1)
    if level is PressureLevel.HIGH:
        return getattr(cfg, "governance_high_max", 1)
    return getattr(cfg, "governance_normal_max", 2)
