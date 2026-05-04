# swarmx.memory package — V5
# swarmx.memory package — V5
# Re-exports everything from the original memory.py (now _core.py) so that
# all existing callers (`from .memory import learn_from_run`) continue to work
# without modification, even though memory.py is shadowed by this package directory.
from .types import MemoryKind, CONSOLIDATION_THRESHOLD, CURATOR_REVIEW_THRESHOLD, AUTO_PROMOTE_SCORE
from ._core import (
    append_jsonl,
    store_run,
    store_checkpoint,
    store_proposal,
    store_memory,
    load_recent_runs,
    load_recent_memories,
    prune_runtime_artifacts,
    summarize_runs,
    summarize_memories,
    learn_from_run,
    summarize_evidence,
    search_memories,
    # V5 extensions
    decay_score,
    hybrid_search,
    consolidate_memories,
)

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
