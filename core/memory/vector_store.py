"""
core/memory/vector_store — REDIRECT SHIM
=========================================
This file is a redirect to the canonical implementation in src/core/memory/vector_store.py.

The root core/ directory duplicated src/core/ with an older, threading-lock-deficient
VectorStore that omitted the _MODEL_LOCK guard on SentenceTransformer initialization —
allowing concurrent callers to race and double-initialize the embedding model.

All consumers should import from src.core.memory.vector_store or install the
package and import from core.memory.vector_store (this shim re-exports everything).
"""
from __future__ import annotations

# Re-export everything from the canonical fixed implementation.
# src/core/memory/vector_store.py has the _MODEL_LOCK threading fix (threading.Lock
# guards SentenceTransformer lazy init against concurrent callers).
try:
    from src.core.memory.vector_store import *  # noqa: F401, F403
    from src.core.memory.vector_store import VectorStore, get_vector_store  # noqa: F401
except ImportError:
    # Installed package path (production)
    from swarmx.core.memory.vector_store import *  # noqa: F401, F403
    from swarmx.core.memory.vector_store import VectorStore, get_vector_store  # noqa: F401