"""
tests/brain/test_scorer — Ensures brain.scorer re-exports the production scorer.

This test is a regression guard for the name-collision fix.  If brain/scorer.py
ever reintroduces its own `score_output` definition, these tests will catch the
divergence by verifying both the symbol identity and the scoring behaviour.
"""
from __future__ import annotations

import pytest


def test_scorer_reexports_loop_scorer():
    """brain.scorer.score_output must be the SAME object as brain.loop.score_output."""
    from brain.loop import score_output as loop_fn
    from brain.scorer import score_output as scorer_fn
    assert scorer_fn is loop_fn, (
        "brain.scorer.score_output must re-export brain.loop.score_output — "
        "do NOT define a separate score_output in brain/scorer.py"
    )


@pytest.mark.parametrize("text, expected_min", [
    ("",                                               0.0),   # empty → 0
    ("error: something went wrong",                    0.0),   # error signal
    ("x" * 79,                                         0.0),   # below length threshold
    ("x" * 80,                                         0.20),  # length signal only
    ("Use `implement` to create the pipeline.\n" * 5,  0.60),  # multiple signals
    (
        '{"steps": [{"action": "deploy", "model": "qwen"}]}\n'
        "Implement the following changes to the CI pipeline.\n" * 3,
        0.80,
    ),
])
def test_score_output_signals(text, expected_min):
    """Production scorer returns a score >= expected_min for the given text."""
    from brain.scorer import score_output
    score = score_output(text)
    assert 0.0 <= score <= 1.0, f"Score out of range: {score}"
    assert score >= expected_min, (
        f"Expected score >= {expected_min} for text {text[:60]!r}, got {score}"
    )


def test_score_output_actionable_language():
    """Text with concrete action verbs scores higher than vague text."""
    from brain.scorer import score_output
    vague      = "There might be some considerations to think about perhaps."
    actionable = (
        "Implement the deployment pipeline using GitHub Actions. "
        "Create the workflow YAML and configure the runner. "
        "Add the deploy step with environment variables set correctly."
    )
    assert score_output(actionable) > score_output(vague)


def test_score_output_no_error_bonus():
    """Absence of error indicators gives a scoring bonus over error-containing text."""
    from brain.scorer import score_output
    clean = "The pipeline ran successfully and produced the expected artifacts."
    with_error = "error: The pipeline failed. Traceback: unable to connect."
    assert score_output(clean) > score_output(with_error)
