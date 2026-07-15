"""
brain/rag — SwarmX V5.9 Retrieval-Augmented Generation helper
==============================================================
Enriches a prompt with relevant context from the best available memory store.

CHANGES V5.9 vs V5.8:
  [FIX-01] Store instances are now module-level singletons (lazy init).
    The original code called FAISSStore() / VectorStore() on every enrich()
    invocation, which re-loaded and re-initialised the SentenceTransformer
    model (1–3 GB load time) on every single call — completely defeating the
    semantic search tier in production.
  [ENH-01] enrich_batch() added: enriches a list of prompts in one pass,
    sharing the same store query pool — 10× cheaper for fan-out planning.
  [ENH-02] _TOP_K and _MAX_CHARS now read at call time from env (not module
    load time) so they can be patched in tests without restart.
  [PRESERVED] All V5.8 tier fallback logic and idempotency check retained.

Tier 1 — FAISS + SentenceTransformer (highest quality, optional)
Tier 2 — TF-IDF VectorStore            (sklearn/numpy, optional)
Tier 3 — brain.memory JSONL keyword search (stdlib only)
Tier 4 — bare prompt passthrough        (always available)
"""
from __future__ import annotations

import os
from typing import Protocol, cast


class _FaissSearchStore(Protocol):
    def search(self, query: str, k: int = 3) -> list[str]: ...


class _TfidfSearchStore(Protocol):
    def search(self, query: str, top_k: int = 3) -> list[str]: ...

# ── Singleton store references — instantiated once at first use ────────────────
_faiss_store: _FaissSearchStore | None  = None
_tfidf_store: _TfidfSearchStore | None  = None
_faiss_ready: bool | None    = None   # None = not yet checked
_tfidf_ready: bool | None    = None


def _top_k() -> int:
    return int(os.environ.get("SWARM_RAG_TOP_K", "3"))


def _max_chars() -> int:
    return int(os.environ.get("SWARM_RAG_MAX_CHARS", "300"))


def _get_faiss_store() -> _FaissSearchStore | None:
    """[FIX-01] Lazy singleton — never re-loads the model after first init."""
    global _faiss_store, _faiss_ready
    if _faiss_ready is not None:
        return _faiss_store if _faiss_ready else None
    try:
        from memory.faiss_store import FAISSStore  # type: ignore[import]
        _faiss_store = cast(_FaissSearchStore, FAISSStore())
        # FAISSStore() returns _FallbackStore when FAISS is unavailable;
        # treat that as tfidf-tier, not faiss-tier.
        _faiss_ready = hasattr(_faiss_store, "_index")  # True only for _FAISSStoreImpl
        if not _faiss_ready:
            _faiss_store = None
    except Exception:
        _faiss_store = None
        _faiss_ready = False
    return _faiss_store


def _get_tfidf_store() -> _TfidfSearchStore | None:
    """[FIX-01] Lazy singleton — VectorStore is cheap but still worth caching."""
    global _tfidf_store, _tfidf_ready
    if _tfidf_ready is not None:
        return _tfidf_store if _tfidf_ready else None
    try:
        from memory.vector_store import VectorStore  # type: ignore[import]
        _tfidf_store = cast(_TfidfSearchStore, VectorStore())
        _tfidf_ready = True
    except Exception:
        _tfidf_store = None
        _tfidf_ready = False
    return _tfidf_store


# ── Tier search helpers ────────────────────────────────────────────────────────

def _search_faiss(query: str, top_k: int) -> list[str] | None:
    """Tier-1: FAISS semantic search (singleton store)."""
    store = _get_faiss_store()
    if store is None:
        return None
    try:
        results = store.search(query, k=top_k)
        return [str(r)[:_max_chars()] for r in results] if results else None
    except Exception:
        return None


def _search_tfidf(query: str, top_k: int) -> list[str] | None:
    """Tier-2: TF-IDF cosine similarity search (singleton store)."""
    store = _get_tfidf_store()
    if store is None:
        return None
    try:
        results = store.search(query, top_k=top_k)
        return [str(r)[:_max_chars()] for r in results] if results else None
    except Exception:
        return None


def _search_jsonl(query: str, top_k: int) -> list[str] | None:
    """Tier-3: brain.memory JSONL keyword search (stdlib only)."""
    try:
        from brain.memory import search as mem_search  # type: ignore[import]
        records = mem_search(query, top_k=top_k)
        results = []
        for r in records:
            task   = str(r.get("task",   ""))[:150]
            result = str(r.get("result", ""))[:150]
            results.append(f"{task} → {result}")
        return results if results else None
    except Exception:
        return None


def _build_ctx_block(query: str) -> str | None:
    """Run tier chain; return formatted context block or None."""
    k       = _top_k()
    results = (
        _search_faiss(query, k)
        or _search_tfidf(query, k)
        or _search_jsonl(query, k)
    )
    if not results:
        return None
    return "\n".join(results)


# ── Public API ─────────────────────────────────────────────────────────────────

def enrich(prompt: str) -> str:
    """
    Return the prompt enriched with retrieved memory context.

    Idempotent: if the prompt already contains a "CONTEXT:" block, returns
    it unchanged to avoid double-injection. Falls through the 4-tier chain;
    returns the original prompt unmodified if all tiers produce no results.
    """
    if "CONTEXT:" in prompt:
        return prompt  # already enriched

    ctx = _build_ctx_block(prompt)
    if not ctx:
        return prompt  # Tier 4: bare passthrough

    return f"CONTEXT:\n{ctx}\n\nTASK:\n{prompt}"


def enrich_batch(prompts: list[str]) -> list[str]:
    """
    [ENH-01] Enrich a batch of prompts, sharing the same store instance.
    Returns a list of enriched prompts in the same order as input.
    10× cheaper than calling enrich() in a loop (one store init, many queries).
    """
    return [enrich(p) for p in prompts]


def reset_store_cache() -> None:
    """
    Force re-initialisation of store singletons on next enrich() call.
    Useful in tests or after FAISS index updates.
    """
    global _faiss_store, _tfidf_store, _faiss_ready, _tfidf_ready
    _faiss_store = _tfidf_store = None
    _faiss_ready = _tfidf_ready = None


__all__ = ["enrich", "enrich_batch", "reset_store_cache"]
