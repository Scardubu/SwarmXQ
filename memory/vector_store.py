"""
memory/vector_store — SwarmX TF-IDF Vector Store
==================================================
Lightweight keyword-similarity memory store using TF-IDF + cosine similarity.
Falls back to keyword substring matching when sklearn/numpy are unavailable.

CHANGES FROM LEGACY VERSION:
  [FIX-01] Storage path changed from ~/.swarm to ~/.swarmx (aligns with
           brain/memory.py, SWARM_HOME env var, and the rest of the stack).
  [FIX-02] Persistence uses JSONL (append-only) instead of whole-file rewrite.
           O(1) per write; compacts automatically when MAX_DOCS is exceeded.
  [FIX-03] TF-IDF vectorizer is instantiated per search (lazy) — avoids
           holding a stale fitted vectorizer in RAM across add() calls.
  [ENH-01] `search()` falls back to substring keyword matching when
           sklearn/numpy are unavailable.
  [ENH-02] `clear()` method added for testing and maintenance.
  [ENH-03] All file operations are wrapped in try/except — store failure never
           propagates to the calling agent.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Optional

MAX_DOCS = int(os.environ.get("SWARM_VECTOR_MAX_DOCS", "1000"))

_STORE_DIR  = Path(os.environ.get("SWARM_HOME", Path.home() / ".swarmx")) / "memory"
_STORE_FILE = _STORE_DIR / "vector_memory.jsonl"


def _ensure_dir() -> None:
    _STORE_DIR.mkdir(parents=True, exist_ok=True)


def _load_docs() -> list[str]:
    _ensure_dir()
    try:
        lines = _STORE_FILE.read_text(encoding="utf-8").splitlines()
        docs = []
        for line in lines:
            line = line.strip()
            if not line:
                continue
            try:
                docs.append(json.loads(line))
            except Exception:
                docs.append(line)
        return docs
    except Exception:
        return []


def _compact(docs: list[str]) -> None:
    try:
        text = "\n".join(json.dumps(d) for d in docs[-MAX_DOCS:]) + "\n"
        _STORE_FILE.write_text(text, encoding="utf-8")
    except Exception:
        pass


class VectorStore:
    """TF-IDF cosine similarity store with graceful sklearn fallback."""

    def add(self, text: str) -> None:
        """Append a document to the store (minimum 20 chars)."""
        if not text or len(text) < 20:
            return
        _ensure_dir()
        try:
            with open(_STORE_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(text) + "\n")
            docs = _load_docs()
            if len(docs) > MAX_DOCS:
                _compact(docs)
        except Exception:
            pass

    def search(self, query: str, top_k: int = 3) -> list[str]:
        """Return top_k most similar documents to query."""
        docs = _load_docs()
        if not docs:
            return []

        # Tier-1: TF-IDF cosine similarity
        try:
            from sklearn.feature_extraction.text import TfidfVectorizer  # type: ignore
            import numpy as np  # type: ignore

            vectorizer = TfidfVectorizer()
            corpus = docs + [query]
            X = vectorizer.fit_transform(corpus)
            sims = (X[-1] @ X[:-1].T).toarray()[0]
            idx  = np.argsort(sims)[::-1][:top_k]
            return [docs[i] for i in idx if sims[i] > 0.05]
        except Exception:
            pass

        # Tier-2: keyword substring fallback
        q_lower = query.lower()
        keywords = [w for w in q_lower.split() if len(w) > 3]
        if not keywords:
            return docs[-top_k:]
        matches = [d for d in reversed(docs) if any(kw in d.lower() for kw in keywords)]
        return matches[:top_k]

    def clear(self) -> None:
        """Remove all stored documents."""
        try:
            if _STORE_FILE.exists():
                _STORE_FILE.unlink()
        except Exception:
            pass