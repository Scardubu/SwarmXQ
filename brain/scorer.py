"""
brain/scorer — SwarmX V5.8 Output Quality Scorer
==================================================
Re-exports the production multi-signal scorer from brain.loop so that callers
can do `from brain.scorer import score_output` without importing brain.loop
directly (avoids potential circular imports and keeps the API surface clean).

The production scorer uses 5 weighted signals (0.20 each):
  1. Non-trivial length (>= 80 chars)
  2. Structured data present (JSON / code blocks)
  3. No explicit error indicators
  4. Word count >= 30
  5. Contains actionable language

IMPORTANT: Do NOT redefine score_output here.  The legacy 3-signal stub that
previously lived in this file was causing non-deterministic quality gating
depending on Python's import order.  The single authoritative definition lives
in brain/loop.py and is re-exported below.
"""
from __future__ import annotations

# Single authoritative definition — do not duplicate
from brain.loop import score_output  # noqa: F401

__all__ = ["score_output"]
