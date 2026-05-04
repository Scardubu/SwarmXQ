"""
memory/faiss_store — SwarmX FAISS Semantic Memory Store
=========================================================
High-quality semantic nearest-neighbour store using FAISS + SentenceTransformer.
Degrades to VectorStore (TF-IDF) when optional ML dependencies are absent.

CHANGES FROM LEGACY VERSION:
  [FIX-01] CRITICAL: All faiss / sentence-transformers imports are guarded
           in try/except.  The legacy bare `import faiss` at module level
           caused an ImportError that propagated through brain/rag.py and
           crashed the entire brain module on minimal deployments.
  [FIX-02] Storage path changed from ~/.swarm to ~/.swarmx (aligns with
           SWARM_HOME env var and the rest of the stack).
  [FIX-03] `FAISSStore()` constructor now returns a `VectorStore` instance
           (not itself) when ML deps are unavailable — callers get a fully
           functional store object in either case.
  [ENH-01] Index and data files are written atomically via temp-file + rename.
  [ENH-02] `clear()` method added.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

_STORE_DIR = Path(os.environ.get("SWARM_HOME", Path.home() / ".swarmx")) / "memory"
_INDEX_FILE = _STORE_DIR / "faiss.index"
_DATA_FILE  = _STORE_DIR / "faiss_data.jsonl"

_MODEL_NAME = os.environ.get("SWARM_SBERT_MODEL", "all-MiniLM-L6-v2")


def _ensure_dir() -> None:
    _STORE_DIR.mkdir(parents=True, exist_ok=True)


class _FallbackStore:
    """Returned by FAISSStore() when ML deps are missing."""

    def add(self, text: str) -> None:
        from memory.vector_store import VectorStore
        VectorStore().add(text)

    def search(self, query: str, k: int = 3) -> list[str]:
        from memory.vector_store import VectorStore
        return VectorStore().search(query, top_k=k)

    def clear(self) -> None:
        from memory.vector_store import VectorStore
        VectorStore().clear()


class _FAISSStoreImpl:
    """Internal FAISS implementation (only instantiated when deps are present)."""

    def __init__(self, model: Any, faiss: Any) -> None:
        self._model = model
        self._faiss = faiss
        _ensure_dir()
        self._data: list[str] = []
        if _INDEX_FILE.exists() and _DATA_FILE.exists():
            try:
                self._index = faiss.read_index(str(_INDEX_FILE))
                self._data = [
                    json.loads(line)
                    for line in _DATA_FILE.read_text(encoding="utf-8").splitlines()
                    if line.strip()
                ]
            except Exception:
                self._index = faiss.IndexFlatL2(384)
        else:
            self._index = faiss.IndexFlatL2(384)

    def _save(self) -> None:
        try:
            import numpy as np  # already imported upstream
            tmp_idx  = _INDEX_FILE.with_suffix(".tmp")
            tmp_data = _DATA_FILE.with_suffix(".tmp")
            self._faiss.write_index(self._index, str(tmp_idx))
            tmp_data.write_text(
                "\n".join(json.dumps(d) for d in self._data) + "\n",
                encoding="utf-8",
            )
            tmp_idx.rename(_INDEX_FILE)
            tmp_data.rename(_DATA_FILE)
        except Exception:
            pass

    def add(self, text: str) -> None:
        if not text:
            return
        try:
            import numpy as np
            emb = self._model.encode([text])
            self._index.add(np.array(emb).astype("float32"))
            self._data.append(text)
            self._save()
        except Exception:
            pass

    def search(self, query: str, k: int = 3) -> list[str]:
        if not self._data:
            return []
        try:
            import numpy as np
            emb = self._model.encode([query])
            k   = min(k, len(self._data))
            _, I = self._index.search(np.array(emb).astype("float32"), k)
            return [self._data[i] for i in I[0] if 0 <= i < len(self._data)]
        except Exception:
            return []

    def clear(self) -> None:
        try:
            self._data = []
            self._index = self._faiss.IndexFlatL2(384)
            for f in (_INDEX_FILE, _DATA_FILE):
                if f.exists():
                    f.unlink()
        except Exception:
            pass


def FAISSStore() -> Any:
    """
    Factory that returns the best available store.

    Returns _FAISSStoreImpl when faiss + sentence-transformers are present,
    otherwise returns _FallbackStore (which delegates to VectorStore).
    """
    try:
        import faiss  # type: ignore
        from sentence_transformers import SentenceTransformer  # type: ignore
        model = SentenceTransformer(_MODEL_NAME)
        return _FAISSStoreImpl(model=model, faiss=faiss)
    except Exception:
        return _FallbackStore()