"""
memory — SwarmX Vector Memory Package
======================================
Canonical import surface for all memory backends. Callers import from here
rather than individual submodules so they are insulated from optional deps.

Backends (tried in priority order):
  1. FAISSStore  — semantic nearest-neighbour (requires faiss-cpu + sentence-transformers)
  2. VectorStore — TF-IDF cosine similarity  (requires scikit-learn + numpy)
  3. None        — no ML deps; brain.memory JSONL used as fallback

Usage:
    from memory import get_store, add, search, stats

    # Direct API (delegates to best available store)
    add("some text to remember")
    results = search("query string", top_k=5)

    # Store instance (for advanced use)
    store = get_store()
    if store:
        store.add("text")
"""
from __future__ import annotations

from typing import Any

# ── Internal singleton ─────────────────────────────────────────────────────────

_STORE: Any = None
_STORE_RESOLVED = False


def get_store(*, force_reload: bool = False) -> Any:
    """
    Return the best available vector store instance.
    Singleton — same instance returned on every call unless force_reload=True.

    Priority:
      1. FAISSStore  — semantic NN (requires faiss + sbert)
      2. VectorStore — TF-IDF cosine similarity
      3. None        — no ML deps available; use brain.memory JSONL instead
    """
    global _STORE, _STORE_RESOLVED
    if _STORE_RESOLVED and not force_reload:
        return _STORE

    for factory in (
        lambda: __import__("memory.faiss_store", fromlist=["FAISSStore"]).FAISSStore(),
        lambda: __import__("memory.vector_store", fromlist=["VectorStore"]).VectorStore(),
    ):
        try:
            _STORE = factory()
            _STORE_RESOLVED = True
            return _STORE
        except Exception:
            continue

    _STORE = None
    _STORE_RESOLVED = True
    return None


# ── Unified convenience API ────────────────────────────────────────────────────

def add(text: str) -> bool:
    """
    Add text to the vector store. Returns True on success.
    Falls back gracefully to brain.memory JSONL if no ML store is available.
    """
    store = get_store()
    if store is not None and hasattr(store, "add"):
        try:
            store.add(text)
            return True
        except Exception:
            pass

    # Fallback: persist to brain JSONL memory
    try:
        from brain.memory import store as jsonl_store  # type: ignore[import]
        jsonl_store(task=text[:500], result="[embedded]")
        return True
    except Exception:
        return False


def search(query: str, top_k: int = 3) -> list[str]:
    """
    Search for semantically similar documents. Returns list of text snippets.
    Falls back through FAISS → TF-IDF → JSONL keyword search.
    """
    store = get_store()
    if store is not None and hasattr(store, "search"):
        try:
            results = store.search(query, k=top_k)
            if results:
                return [str(r) for r in results[:top_k]]
        except Exception:
            pass

    # Fallback: JSONL keyword search
    try:
        from brain.memory import search as jsonl_search  # type: ignore[import]
        records = jsonl_search(query, top_k=top_k)
        return [
            f"{r.get('task', '')[:150]} → {r.get('result', '')[:150]}"
            for r in records
        ]
    except Exception:
        return []


def stats() -> dict[str, Any]:
    """
    Return a dict describing the active store and its stats.
    """
    store = get_store()
    backend = type(store).__name__ if store else "JSONLFallback"
    info: dict[str, Any] = {"backend": backend}

    if hasattr(store, "__len__"):
        try:
            info["document_count"] = len(store)
        except Exception:
            pass

    # Always include JSONL stats
    try:
        from brain.memory import stats as jsonl_stats  # type: ignore[import]
        info["jsonl"] = jsonl_stats()
    except Exception:
        pass

    return info


def reset() -> None:
    """Force re-initialisation of the store singleton. For test isolation."""
    global _STORE, _STORE_RESOLVED
    _STORE = None
    _STORE_RESOLVED = False


__all__ = ["get_store", "add", "search", "stats", "reset"]
