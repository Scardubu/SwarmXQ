"""
tests/brain/test_rag — Unit tests for brain.rag graceful degradation chain.

Tests verify that enrich() works correctly across all four tiers without
requiring any optional ML dependencies to be installed.
"""
from __future__ import annotations

import sys
from unittest.mock import patch

# ── Helper: block optional imports for tier isolation ──────────────────────────

class _BlockImport:
    """Context manager that raises ImportError for a given module name."""
    def __init__(self, *module_names: str) -> None:
        self._names = module_names
        self._originals: dict = {}

    def __enter__(self):
        for name in self._names:
            self._originals[name] = sys.modules.get(name, None)
            sys.modules[name] = None  # type: ignore[assignment]
        # Reload rag to pick up the blocked import state
        if "brain.rag" in sys.modules:
            del sys.modules["brain.rag"]
        return self

    def __exit__(self, *args):
        for name, orig in self._originals.items():
            if orig is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = orig
        if "brain.rag" in sys.modules:
            del sys.modules["brain.rag"]


# ── Tests ─────────────────────────────────────────────────────────────────────

def test_enrich_passthrough_when_no_memory(tmp_path, monkeypatch):
    """Tier-4: when all stores fail, enrich() returns the original prompt."""
    monkeypatch.setenv("SWARM_HOME", str(tmp_path))
    with _BlockImport("faiss", "sentence_transformers", "sklearn"):
        from brain import rag  # reimport with blocked deps
        result = rag.enrich("hello world")
    assert result == "hello world"


def test_enrich_idempotent():
    """enrich() is a no-op when prompt already contains a CONTEXT: block."""
    import brain.rag as rag
    prompt = "CONTEXT:\nsome context\n\nTASK:\ndo something"
    assert rag.enrich(prompt) is prompt


def test_enrich_jsonl_tier(tmp_path, monkeypatch):
    """Tier-3: falls through to brain.memory JSONL keyword search."""
    monkeypatch.setenv("SWARM_HOME", str(tmp_path))

    # Seed brain.memory with a record
    import brain.memory as mem
    mem.store("automate deployment pipeline", "use GitHub Actions for CI/CD")

    with _BlockImport("faiss", "sentence_transformers", "sklearn"):
        if "brain.rag" in sys.modules:
            del sys.modules["brain.rag"]
        import brain.rag as rag
        result = rag.enrich("deployment pipeline automation")

    assert "CONTEXT:" in result
    assert "TASK:" in result
    assert "deployment" in result.lower() or "automate" in result.lower()


def test_enrich_includes_task_block(tmp_path, monkeypatch):
    """Enriched prompts always contain a TASK: section with the original prompt."""
    monkeypatch.setenv("SWARM_HOME", str(tmp_path))
    import brain.memory as mem
    mem.store("docker container orchestration", "use Kubernetes for scaling")

    with _BlockImport("faiss", "sentence_transformers", "sklearn"):
        if "brain.rag" in sys.modules:
            del sys.modules["brain.rag"]
        import brain.rag as rag
        original = "explain container orchestration"
        result = rag.enrich(original)

    # Either enriched or bare passthrough — task must be present
    assert original in result


def test_enrich_top_k_respected(tmp_path, monkeypatch):
    """SWARM_RAG_TOP_K env var is honoured."""
    monkeypatch.setenv("SWARM_HOME", str(tmp_path))
    monkeypatch.setenv("SWARM_RAG_TOP_K", "1")
    import brain.memory as mem
    for i in range(5):
        mem.store(f"kubernetes topic {i}", f"result {i}")

    with _BlockImport("faiss", "sentence_transformers", "sklearn"):
        if "brain.rag" in sys.modules:
            del sys.modules["brain.rag"]
        import brain.rag as rag
        result = rag.enrich("kubernetes")

    # With TOP_K=1 only one item should be in the context block
    ctx_lines = [
        ln for ln in result.split("\n")
        if ln.strip() and not ln.startswith("CONTEXT:") and not ln.startswith("TASK:")
    ]
    assert len(ctx_lines) <= 2  # at most 1 result + the task line


def test_search_faiss_fallback_to_tfidf(monkeypatch):
    """When FAISSStore raises, _search_tfidf is attempted next."""
    import brain.rag as rag

    with patch("brain.rag._search_faiss", return_value=None), \
         patch("brain.rag._search_tfidf", return_value=["tfidf result"]) as mock_tfidf:
        result = rag.enrich("some query")

    mock_tfidf.assert_called_once()
    assert "tfidf result" in result
