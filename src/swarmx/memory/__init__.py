# swarmx.memory package — V5
# swarmx.memory package — V5
# Re-exports everything from the original memory.py (now _core.py) so that
# all existing callers (`from .memory import learn_from_run`) continue to work
# without modification, even though memory.py is shadowed by this package directory.
from ._core import (
    append_jsonl,
    consolidate_memories,
    # V5 extensions
    decay_score,
    hybrid_search,
    learn_from_run,
    load_recent_memories,
    load_recent_runs,
    prune_runtime_artifacts,
    search_memories,
    store_checkpoint,
    store_memory,
    store_proposal,
    store_run,
    summarize_evidence,
    summarize_memories,
    summarize_runs,
)
from .types import AUTO_PROMOTE_SCORE, CONSOLIDATION_THRESHOLD, CURATOR_REVIEW_THRESHOLD, MemoryKind

__all__ = [
    # V5 types
    "MemoryKind",
    "CONSOLIDATION_THRESHOLD",
    "CURATOR_REVIEW_THRESHOLD",
    "AUTO_PROMOTE_SCORE",
    # Core memory functions (backward-compat)
    "append_jsonl",
    "store_run",
    "store_checkpoint",
    "store_proposal",
    "store_memory",
    "load_recent_runs",
    "load_recent_memories",
    "prune_runtime_artifacts",
    "summarize_runs",
    "summarize_memories",
    "learn_from_run",
    "summarize_evidence",
    "search_memories",
    # V5 extensions
    "decay_score",
    "hybrid_search",
    "consolidate_memories",
]
