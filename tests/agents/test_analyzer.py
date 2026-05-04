"""
tests/agents/test_analyzer — Unit tests for agents.analyzer result aggregator.

Covers:
  - Basic string aggregation
  - Dict result extraction
  - Error detection and counting
  - Empty input edge case
  - Async variant
"""
from __future__ import annotations

import asyncio

import pytest

from agents.analyzer import analyze_output, analyze_output_async


def test_analyze_string_results():
    """Plain string results are joined and success is True when no errors."""
    results = ["Step 1 complete.", "Step 2 complete.", "Step 3 complete."]
    out = analyze_output(results)
    assert out["count"] == 3
    assert out["errors"] == 0
    assert out["success"] is True
    assert "Step 1 complete." in out["summary"]
    assert "Step 3 complete." in out["summary"]


def test_analyze_dict_results():
    """Dict results with 'result' key are extracted for summary."""
    results = [
        {"result": "deployed service", "status": "ok"},
        {"result": "test passed",      "status": "ok"},
    ]
    out = analyze_output(results)
    assert "deployed service" in out["summary"]
    assert "test passed" in out["summary"]
    assert out["success"] is True


def test_analyze_error_detection():
    """Items containing error indicators increment the error counter."""
    results = [
        "Step 1 complete.",
        "error: connection refused to host",
        "Step 3 complete.",
        "traceback (most recent call last): ...",
    ]
    out = analyze_output(results)
    assert out["count"] == 4
    assert out["errors"] == 2
    assert out["success"] is False


def test_analyze_empty_results():
    """Empty result list returns zero counts and empty summary."""
    out = analyze_output([])
    assert out["count"] == 0
    assert out["errors"] == 0
    assert out["success"] is True
    assert out["summary"] == ""


def test_analyze_mixed_types():
    """Mixed string/dict/other types all convert without raising."""
    results = ["text result", {"result": "dict result"}, 42, None]
    out = analyze_output(results)
    assert out["count"] == 4
    assert "text result" in out["summary"]
    assert "dict result" in out["summary"]


def test_analyze_output_async():
    """analyze_output_async() returns identical structure to sync version."""
    results = ["async step done.", "another async step done."]
    sync_out  = analyze_output(results)
    async_out = asyncio.run(analyze_output_async(results))
    assert sync_out == async_out


def test_analyze_failed_keyword_variants():
    """All error-keyword variants are detected."""
    error_phrases = [
        "error: something",
        "Exception: something",
        "FAILED at step 3",
        "traceback in module",
    ]
    for phrase in error_phrases:
        out = analyze_output([phrase])
        assert out["errors"] >= 1, f"Should detect error in: {phrase!r}"


def test_analyze_success_flag_is_bool():
    """success field is always a bool, not a truthy int."""
    out = analyze_output(["all good"])
    assert type(out["success"]) is bool