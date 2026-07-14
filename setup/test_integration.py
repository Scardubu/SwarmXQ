#!/usr/bin/env python3
"""
SwarmX Integration Tests — V5
==============================
Validates that all 6 primary models respond correctly with valid JSON schemas.
Run after installation to verify the system works end-to-end.

Usage:
  python3 setup/test_integration.py
  python3 setup/test_integration.py --model phi4-worker
  python3 setup/test_integration.py --verbose
  python3 setup/test_integration.py --fast   # skip deepseek models (quick CI pass)
"""

import argparse
import asyncio
import json
import sys
import time
from pathlib import Path

try:
    import httpx
    from rich import box
    from rich.console import Console
    from rich.table import Table
except ImportError:
    print("pip install rich httpx")
    sys.exit(1)

sys.path.insert(0, str(Path(__file__).parent.parent / "orchestration"))
from orchestrator import extract_json, load_schemas, strip_think_block, validate_message

console   = Console()
OLLAMA_URL = "http://127.0.0.1:11434"


# ─── Test definitions ─────────────────────────────────────────────────────────

TEST_CASES = [

    # ── phi4-fast: complexity scoring ─────────────────────────────────────────
    {
        "name":  "phi4-fast / complexity score",
        "model": "phi4-fast",
        "fast":  True,
        "prompt": json.dumps({
            "task_id": "test-001",
            "instruction": "Score the complexity of this task on a scale 0.0 to 1.0. "
                           "Return a classify JSON with label='complexity' and confidence=<score>.",
            "task": "Write a Python function to reverse a string."
        }),
        "validate_fn": lambda r: (
            r.get("type") == "classify" and
            r.get("label") == "complexity" and
            0.0 <= float(r.get("confidence", -1)) <= 1.0
        ),
        "schema": None,
    },

    # ── phi4-fast: binary classification ──────────────────────────────────────
    {
        "name":  "phi4-fast / classify",
        "model": "phi4-fast",
        "fast":  True,
        "prompt": json.dumps({
            "task_id": "test-002",
            "instruction": "Classify this as a coding or non-coding task.",
            "text": "Explain the concept of binary search trees."
        }),
        "validate_fn": lambda r: (
            r.get("type") == "classify" and
            isinstance(r.get("label"), str) and
            0.0 <= float(r.get("confidence", -1)) <= 1.0
        ),
        "schema": None,
    },

    # ── phi4-fast: routing decision ────────────────────────────────────────────
    {
        "name":  "phi4-fast / route",
        "model": "phi4-fast",
        "fast":  True,
        "prompt": json.dumps({
            "task_id": "test-003",
            "instruction": "Route this task to the correct agent.",
            "task": "Generate a 200-line Python class for a binary search tree with unit tests."
        }),
        "validate_fn": lambda r: (
            r.get("type") == "route" and
            r.get("routed_to") in ("phi4-worker", "qwen-worker", "deepseek-reasoner", "qwen-supervisor", "abort")
        ),
        "schema": None,
    },

    # ── phi4-fast: JSON validation ────────────────────────────────────────────
    {
        "name":  "phi4-fast / validate",
        "model": "phi4-fast",
        "fast":  True,
        "prompt": json.dumps({
            "task_id": "test-004",
            "schema": "step_complete",
            "data": {
                "type": "step_complete", "task_id": "test-004", "step_id": 1,
                "output": "result_value", "confidence": "high", "warnings": []
            },
            "instruction": "Validate this JSON object. Return a validate schema response."
        }),
        "validate_fn": lambda r: (
            r.get("type") == "validate" and r.get("valid") is True
        ),
        "schema": None,
    },

    # ── phi4-worker: tool_call emission ──────────────────────────────────────
    {
        "name":  "phi4-worker / tool_call",
        "model": "phi4-worker",
        "fast":  True,
        "prompt": json.dumps({
            "type": "delegation", "task_id": "test-010", "step_id": 1,
            "agent": "worker",
            "instruction": "Read the file at path '/tmp/test_swarmx.txt' and return its contents.",
            "input": None, "expected_output_schema": "tool_call", "timeout_seconds": 30
        }),
        "validate_fn": lambda r: (
            r.get("type") in ("tool_call", "step_complete", "step_error", "ESCALATE") and
            r.get("task_id") is not None
        ),
        "schema": None,
    },

    # ── phi4-worker: step_complete ────────────────────────────────────────────
    {
        "name":  "phi4-worker / step_complete",
        "model": "phi4-worker",
        "fast":  True,
        "prompt": json.dumps({
            "type": "delegation", "task_id": "test-011", "step_id": 1,
            "agent": "worker",
            "instruction": "Return the first 5 Fibonacci numbers as a JSON array in the output field.",
            "input": None, "expected_output_schema": "step_complete", "timeout_seconds": 30
        }),
        "validate_fn": lambda r: (
            r.get("type") == "step_complete" and
            r.get("confidence") in ("high", "medium", "low") and
            isinstance(r.get("warnings"), list)
        ),
        "schema": "step_complete",
    },

    # ── qwen-worker: step_complete (executor role) ────────────────────────────
    {
        "name":  "qwen-worker / step_complete",
        "model": "qwen-worker",
        "fast":  True,
        "prompt": json.dumps({
            "type": "delegation", "task_id": "test-015", "step_id": 1,
            "agent": "executor",
            "instruction": "Return the sorted version of [3, 1, 4, 1, 5, 9, 2, 6] as a step_complete JSON.",
            "input": None, "expected_output_schema": "step_complete", "timeout_seconds": 30
        }),
        "validate_fn": lambda r: (
            r.get("type") == "step_complete" and
            r.get("confidence") in ("high", "medium", "low")
        ),
        "schema": "step_complete",
    },

    # ── qwen-supervisor: plan emission ────────────────────────────────────────
    {
        "name":  "qwen-supervisor / plan",
        "model": "qwen-supervisor",
        "fast":  True,
        "prompt": json.dumps({
            "task_id": "test-020",
            "user_request": "Fetch the content of https://example.com and summarise it in one sentence.",
            "instruction": "Decompose into a plan. Use worker for simple tasks. Emit plan schema JSON."
        }),
        "validate_fn": lambda r: (
            r.get("type") == "plan" and
            isinstance(r.get("steps"), list) and
            len(r.get("steps", [])) >= 1 and
            all("step_id" in s and "agent" in s and "action" in s for s in r.get("steps", []))
        ),
        "schema": "plan",
    },

    # ── qwen-supervisor: validation ───────────────────────────────────────────
    {
        "name":  "qwen-supervisor / validation",
        "model": "qwen-supervisor",
        "fast":  True,
        "prompt": json.dumps({
            "task_id": "test-021", "step_id": 1,
            "result": {
                "type": "step_complete", "task_id": "test-021", "step_id": 1,
                "output": [1, 1, 2, 3, 5], "confidence": "high", "warnings": []
            },
            "instruction": "Validate this step result. Emit a validation schema JSON."
        }),
        "validate_fn": lambda r: (
            r.get("type") == "validation" and
            r.get("status") in ("pass", "fail", "retry") and
            r.get("next_action") in ("continue", "retry_step", "escalate", "abort")
        ),
        "schema": "validation",
    },

    # ── deepseek-reasoner: think-then-JSON ───────────────────────────────────
    {
        "name":  "deepseek-reasoner / analysis",
        "model": "deepseek-reasoner",
        "fast":  False,
        "prompt": json.dumps({
            "task_id": "test-030", "step_id": 1,
            "instruction": (
                "In under 100 words, explain the trade-off between greedy search and "
                "beam search in language model decoding. Emit analysis schema JSON."
            ),
            "input": None
        }),
        "validate_fn": lambda r: (
            r.get("type") == "analysis" and
            isinstance(r.get("conclusion"), str) and len(r.get("conclusion", "")) > 10 and
            r.get("confidence") in ("HIGH", "MEDIUM", "LOW", "high", "medium", "low")
        ),
        "schema": None,
        "strip_think": True,
    },

    # ── deepseek-reasoner: code emission ─────────────────────────────────────
    {
        "name":  "deepseek-reasoner / code",
        "model": "deepseek-reasoner",
        "fast":  False,
        "prompt": json.dumps({
            "task_id": "test-031", "step_id": 1,
            "instruction": (
                "Write a Python function `fibonacci(n: int) -> list[int]` that returns "
                "the first n Fibonacci numbers. Emit code schema JSON with code in the 'code' field."
            ),
            "input": None
        }),
        "validate_fn": lambda r: (
            r.get("type") == "code" and
            r.get("language") is not None and
            isinstance(r.get("code"), str) and len(r.get("code", "")) > 20
        ),
        "schema": None,
        "strip_think": True,
    },

]


# ─── Test runner ──────────────────────────────────────────────────────────────

async def run_test(client: httpx.AsyncClient, tc: dict, verbose: bool = False) -> dict:
    t0 = time.monotonic()
    try:
        resp = await client.post(
            f"{OLLAMA_URL}/api/chat",
            json={
                "model":    tc["model"],
                "messages": [{"role": "user", "content": tc["prompt"]}],
                "stream":   False,
            },
            timeout=180,
        )
        resp.raise_for_status()
        data = resp.json()
        raw  = data.get("message", {}).get("content", "")

        if tc.get("strip_think"):
            raw = strip_think_block(raw)

        parsed = extract_json(raw)

        schema_errors = []
        if tc.get("schema") and parsed:
            schema_errors = validate_message(parsed, tc["schema"])

        fn_ok   = tc["validate_fn"](parsed) if parsed else False
        elapsed = time.monotonic() - t0
        tok_out = data.get("eval_count", 0)
        tps     = tok_out / max(elapsed, 0.001)

        if verbose and parsed:
            console.print(f"\n  [dim]Response ({len(raw)} chars):[/]")
            console.print(f"  [dim]{json.dumps(parsed, indent=2)[:600]}[/]")

        return {
            "ok":           fn_ok and not schema_errors,
            "fn_ok":        fn_ok,
            "schema_errors": schema_errors,
            "parsed_type":  parsed.get("type") if parsed else None,
            "duration_s":   round(elapsed, 2),
            "tokens_out":   tok_out,
            "tps":          round(tps, 1),
            "parse_ok":     parsed is not None,
            "cached":       data.get("prompt_eval_count", 1) == 0,
        }

    except Exception as e:
        return {"ok": False, "error": str(e), "duration_s": round(time.monotonic() - t0, 2)}


async def main():
    parser = argparse.ArgumentParser(description="SwarmX V5 integration tests")
    parser.add_argument("--model",   default=None, help="Run tests for one model only")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument("--fast",    action="store_true", help="Skip slow deepseek tests")
    args = parser.parse_args()

    load_schemas()

    cases = TEST_CASES
    if args.model:
        cases = [tc for tc in TEST_CASES if tc["model"] == args.model]
        if not cases:
            console.print(f"[red]No tests found for model: {args.model}[/]")
            sys.exit(1)
    if args.fast:
        cases = [tc for tc in cases if tc.get("fast", False)]

    console.print(f"\n[bold cyan]SwarmX V5 Integration Tests[/] — {len(cases)} cases\n")

    results = {}
    async with httpx.AsyncClient() as client:
        for tc in cases:
            console.print(f"  Testing [cyan]{tc['name']}[/]...", end=" ")
            r = await run_test(client, tc, verbose=args.verbose)
            results[tc["name"]] = r

            if r.get("ok"):
                cached_note = " [dim](cached)[/]" if r.get("cached") else ""
                console.print(
                    f"[green]PASS[/] [dim]{r.get('duration_s','?')}s, "
                    f"{r.get('tps','?')} tok/s, type={r.get('parsed_type','?')}[/]{cached_note}"
                )
            else:
                console.print(
                    f"[red]FAIL[/] [dim]parse_ok={r.get('parse_ok')}, "
                    f"fn_ok={r.get('fn_ok')}, "
                    f"errors={r.get('schema_errors', r.get('error', '?'))}[/]"
                )

    passed = sum(1 for r in results.values() if r.get("ok"))
    failed = len(results) - passed

    table = Table(title="Test Summary", box=box.ROUNDED)
    table.add_column("Test",       width=40)
    table.add_column("Result",     width=8)
    table.add_column("Duration",   width=10)
    table.add_column("tok/s",      width=8)
    table.add_column("Type",       width=20)

    for name, r in results.items():
        status = "[green]PASS[/]" if r.get("ok") else "[red]FAIL[/]"
        table.add_row(
            name, status,
            f"{r.get('duration_s','?')}s",
            str(r.get('tps', '-')),
            str(r.get('parsed_type', r.get('error', '-')[:20])),
        )

    console.print("\n")
    console.print(table)
    console.print(
        f"\n[bold]{'[green]All tests passed' if failed == 0 else f'[red]{failed} test(s) failed'}[/] "
        f"({passed}/{len(results)})"
    )

    sys.exit(0 if failed == 0 else 1)


if __name__ == "__main__":
    asyncio.run(main())
