"""swarmx.memory.types — V5 Memory Taxonomy.

Defines MemoryKind enum and confidence/promotion thresholds.
All values are additive — no existing 'lesson' semantics changed.
"""
from __future__ import annotations

from enum import Enum


class MemoryKind(str, Enum):
    LESSON = "lesson"          # existing — preserved exactly
    EPISODIC = "episodic"      # full run trace snapshots (who did what, when, outcome)
    SEMANTIC = "semantic"      # FTS5-indexed concept summaries (what the swarm "knows")
    PROCEDURAL = "procedural"  # skill/pattern recipes extracted from successful runs
    ASSOCIATIVE = "associative"  # cross-run graph expansions (what connects to what)


# Confidence thresholds
CONSOLIDATION_THRESHOLD: float = 0.30    # below this: merge candidates
CURATOR_REVIEW_THRESHOLD: float = 0.40   # below this after merge: human curator sign-off
AUTO_PROMOTE_SCORE: float = 0.80         # run score above this: synthesize procedural memory
