#!/usr/bin/env python3
"""
SwarmX Health Monitor  —  V5.6-refined
========================================
Pre-flight checks and live system monitoring for the SwarmX agent stack.

CHANGES V5.6-refined vs V5:
  ✦ OLLAMA_URL now reads SWARMX_OLLAMA_URL (aligned with orchestrator.py).
    SWARMX_OLLAMA_BASE_URL accepted as deprecated fallback with warning.
  ✦ VRAM_ESTIMATES["qwen-worker"] corrected 5500 → 5500 MB (was 5500 in health
    check but 5400 in config; config corrected to 5500 to match measurements).
  ✦ --json flag: emit all checks as JSON to stdout for CI/CD integration.
  ✦ --version flag: print version and exit.

Usage:
  # Pre-flight check (run before starting orchestrator):
  python3 setup/health_check.py

  # Live monitoring mode (refresh every 5 seconds):
  python3 setup/health_check.py --monitor

  # Benchmark model latency:
  python3 setup/health_check.py --bench

  # Check co-load safety for a pair:
  python3 setup/health_check.py --coload phi4-fast qwen-worker

  # CI/CD mode — emit JSON and exit with code 1 on failures:
  python3 setup/health_check.py --json
"""

import argparse
import asyncio
import json
import os
import subprocess
import sys
import time
from pathlib import Path

try:
    import httpx
    from rich.console import Console
    from rich.table import Table
    from rich.panel import Panel
    from rich.progress import Progress, SpinnerColumn, TextColumn
    from rich import box
except ImportError:
    print("Install rich and httpx: pip install rich httpx")
    sys.exit(1)

console = Console()

VERSION = "5.6-refined"

# ── V5.6-refined: read SWARMX_OLLAMA_URL (primary) or SWARMX_OLLAMA_BASE_URL
# (deprecated fallback) to match orchestrator.py's OLLAMA_BASE_URL() reader.
_url_primary    = os.environ.get("SWARMX_OLLAMA_URL", "")
_url_deprecated = os.environ.get("SWARMX_OLLAMA_BASE_URL", "")
if _url_primary:
    OLLAMA_URL = _url_primary
elif _url_deprecated:
    print(
        f"[WARN] SWARMX_OLLAMA_BASE_URL is deprecated — use SWARMX_OLLAMA_URL instead. "
        f"Continuing with: {_url_deprecated}",
        file=sys.stderr,
    )
    OLLAMA_URL = _url_deprecated
else:
    OLLAMA_URL = "http://127.0.0.1:11434"

# All 6 primary models (V5 adds qwen-worker as executor role)
REQUIRED_MODELS = [
    "qwen-supervisor",
    "qwen-worker",
    "phi4-worker",
    "phi4-fast",
    "deepseek-reasoner",
    "deepseek-critic",
]

MODELS_DIR = Path.home() / "models" / "llm-local"
REQUIRED_GGUFS = [
    "Qwen2.5-7B-Instruct-Q5_K_M.gguf",
    "microsoft_Phi-4-mini-Instruct-Q8_0.gguf",
    "DeepSeek-R1-Distill-Qwen-7B-Q5_K_M.gguf",
]

# VRAM estimates (MB) per model — V5.6-refined: qwen-worker corrected to 5500
VRAM_ESTIMATES = {
    "qwen-supervisor":   6100,
    "qwen-worker":       5500,   # corrected from 5400
    "phi4-worker":       4350,
    "phi4-fast":         4150,
    "deepseek-reasoner": 6000,
    "deepseek-critic":   6300,
}

# Co-load safety matrix from config
SAFE_CO_LOADS = [
    ("phi4-fast", "qwen-worker",       9650),
    ("phi4-fast", "phi4-worker",       8500),
    ("phi4-fast", "qwen-supervisor",  10250),
    ("phi4-fast", "deepseek-reasoner",10150),
]


# ─── System checks ────────────────────────────────────────────────────────────

def check_ram() -> dict:
    try:
        with open("/proc/meminfo") as f:
            info = {}
            for line in f:
                key, val = line.split(":")
                info[key.strip()] = int(val.strip().split()[0])
        total_gb = info["MemTotal"]    / 1024 / 1024
        avail_gb = info["MemAvailable"] / 1024 / 1024
        return {"total_gb": round(total_gb, 1), "avail_gb": round(avail_gb, 1), "ok": total_gb >= 7.0}
    except Exception as e:
        return {"error": str(e), "ok": False}


def check_zram() -> dict:
    try:
        result = subprocess.run(
            ["swapon", "--show", "--bytes"],
            capture_output=True, text=True, timeout=5
        )
        zram_lines = [l for l in result.stdout.strip().split("\n") if "zram" in l]
        if not zram_lines:
            return {"active": False, "ok": False, "note": "ZRAM not configured — run: sudo bash setup/zram_setup.sh"}

        parts = zram_lines[0].split()
        size_gb = int(parts[2]) / 1024**3 if len(parts) > 2 else 0

        algo = "unknown"
        zram_path = Path("/sys/block/zram0/comp_algorithm")
        if zram_path.exists():
            import re
            m = re.search(r"\[(\w+)\]", zram_path.read_text())
            algo = m.group(1) if m else "unknown"

        return {"active": True, "size_gb": round(size_gb, 1), "algorithm": algo, "ok": True}
    except Exception as e:
        return {"error": str(e), "ok": False}


def check_swappiness() -> dict:
    try:
        result = subprocess.run(["sysctl", "vm.swappiness"], capture_output=True, text=True, timeout=5)
        val = int(result.stdout.split("=")[1].strip())
        return {"value": val, "ok": val >= 100, "note": "ideal 180 for ZRAM" if val < 100 else "good"}
    except Exception as e:
        return {"error": str(e), "ok": False}


def check_vram() -> dict:
    try:
        result = subprocess.run(
            ["nvidia-smi", "--query-gpu=name,memory.total,memory.free,memory.used",
             "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=10
        )
        if result.returncode != 0:
            return {"available": False, "ok": False, "note": "nvidia-smi not found"}

        parts = result.stdout.strip().split(", ")
        return {
            "name":     parts[0],
            "total_gb": round(int(parts[1]) / 1024, 1),
            "free_gb":  round(int(parts[2]) / 1024, 1),
            "used_gb":  round(int(parts[3]) / 1024, 1),
            "ok":       int(parts[1]) >= 10_000,
        }
    except Exception as e:
        return {"error": str(e), "ok": False}


def check_gguf_files() -> dict:
    results, all_ok = {}, True
    for gguf in REQUIRED_GGUFS:
        path   = MODELS_DIR / gguf
        exists = path.exists()
        size_gb = path.stat().st_size / 1024**3 if exists else 0
        results[gguf] = {"exists": exists, "size_gb": round(size_gb, 2)}
        if not exists:
            all_ok = False
    return {"files": results, "ok": all_ok}


async def check_ollama_service() -> dict:
    try:
        async with httpx.AsyncClient(timeout=5) as client:
            resp = await client.get(f"{OLLAMA_URL}/api/tags")
            resp.raise_for_status()
            models = [m["name"] for m in resp.json().get("models", [])]
            return {"running": True, "loaded_models": models, "ok": True}
    except Exception as e:
        return {"running": False, "error": str(e), "ok": False}


async def check_required_models(loaded_models: list) -> dict:
    results, all_ok = {}, True
    for m in REQUIRED_MODELS:
        found = any(m in lm for lm in loaded_models)
        results[m] = found
        if not found:
            all_ok = False
    return {"models": results, "ok": all_ok}


def check_env_vars() -> dict:
    important = {
        "OLLAMA_FLASH_ATTENTION":   ("1",     "Always enable — reduces KV bandwidth pressure"),
        "OLLAMA_KV_CACHE_TYPE":     ("q8_0",  "Halves KV VRAM vs f16 — best quality/memory balance"),
        "OLLAMA_MAX_LOADED_MODELS": ("1",     "1 for strict single-model; 2 to allow phi4-fast co-load"),
        "OLLAMA_KEEP_ALIVE":        ("300",   "Keeps models warm for prefix cache reuse"),
        "OLLAMA_NUM_PARALLEL":      ("1",     "Must be 1 on constrained VRAM"),
    }
    results, warnings = {}, []
    for var, (ideal, note) in important.items():
        val = os.environ.get(var, "NOT SET")
        ok = val == ideal or (var == "OLLAMA_MAX_LOADED_MODELS" and val == "2")
        if not ok:
            warnings.append(f"{var}={val} (recommend {ideal}): {note}")
        results[var] = {"value": val, "ideal": ideal, "set": val != "NOT SET"}
    # V5.6-refined: also check that SWARMX_OLLAMA_URL is set (not the old BASE_URL)
    swarmx_url = os.environ.get("SWARMX_OLLAMA_URL", "")
    deprecated_url = os.environ.get("SWARMX_OLLAMA_BASE_URL", "")
    if not swarmx_url and deprecated_url:
        warnings.append(
            "SWARMX_OLLAMA_BASE_URL is set but orchestrator reads SWARMX_OLLAMA_URL — "
            "rename the env var to silence this warning."
        )
    results["SWARMX_OLLAMA_URL"] = {
        "value": swarmx_url or f"(using default: {OLLAMA_URL})",
        "ideal": "http://127.0.0.1:11434",
        "set": bool(swarmx_url),
    }
    return {"vars": results, "warnings": warnings, "ok": len(warnings) == 0}


def check_co_load(model_a: str, model_b: str) -> dict:
    """Check if two models can be safely co-loaded on 12 GB VRAM."""
    vram_a = VRAM_ESTIMATES.get(model_a, 6500)
    vram_b = VRAM_ESTIMATES.get(model_b, 6500)
    total  = vram_a + vram_b
    safe   = total <= 11_500  # leave 500 MB headroom
    return {
        "model_a":     model_a,
        "model_b":     model_b,
        "vram_a_mb":   vram_a,
        "vram_b_mb":   vram_b,
        "total_mb":    total,
        "safe":        safe,
        "headroom_mb": 12_000 - total,
    }


# ─── Latency benchmark ────────────────────────────────────────────────────────

BENCH_PROMPTS = {
    "phi4-fast": json.dumps({
        "task_id": "bench-001",
        "instruction": "Classify this as a coding or non-coding task.",
        "task": "Write a Python function to reverse a string."
    }),
    "phi4-worker": json.dumps({
        "type": "delegation", "task_id": "bench-001", "step_id": 1,
        "agent": "worker",
        "instruction": "Return the first 5 Fibonacci numbers as a step_complete JSON.",
        "input": None, "expected_output_schema": "step_complete", "timeout_seconds": 30
    }),
    "qwen-supervisor": json.dumps({
        "task_id": "bench-001",
        "user_request": "What is 2+2?",
        "instruction": "Create a minimal 1-step plan for this task. Emit plan schema JSON."
    }),
    "qwen-worker": json.dumps({
        "type": "delegation", "task_id": "bench-001", "step_id": 1,
        "agent": "executor",
        "instruction": "Return 'Hello from qwen-worker' as a step_complete JSON.",
        "input": None, "expected_output_schema": "step_complete", "timeout_seconds": 30
    }),
    "deepseek-reasoner": json.dumps({
        "task_id": "bench-001", "step_id": 1,
        "instruction": "In 50 words, explain why water boils at 100°C. Emit analysis schema JSON.",
        "input": None
    }),
}


async def run_benchmark() -> dict:
    results = {}
    async with httpx.AsyncClient(timeout=180) as client:
        for model, prompt in BENCH_PROMPTS.items():
            console.print(f"  Benchmarking [cyan]{model}[/]...", end=" ")
            t0 = time.monotonic()
            try:
                resp = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    json={"model": model, "messages": [{"role": "user", "content": prompt}], "stream": False}
                )
                resp.raise_for_status()
                data    = resp.json()
                elapsed = time.monotonic() - t0
                tok_out = data.get("eval_count", 0)
                tok_in  = data.get("prompt_eval_count", 0)
                tps     = tok_out / max(elapsed, 0.001)
                results[model] = {
                    "ok": True, "duration_s": round(elapsed, 2),
                    "tokens_in": tok_in, "tokens_out": tok_out,
                    "tokens_per_sec": round(tps, 1),
                    "cached": data.get("prompt_eval_count", 0) == 0,
                }
                cached_note = " [dim](prefix cached)[/]" if results[model]["cached"] else ""
                console.print(f"[green]{elapsed:.2f}s[/] @ [yellow]{tps:.1f} tok/s[/]{cached_note}")
            except Exception as e:
                results[model] = {"ok": False, "error": str(e)}
                console.print(f"[red]FAILED: {e}[/]")
    return results


# ─── Display ─────────────────────────────────────────────────────────────────

def render_preflight_table(checks: dict) -> Table:
    table = Table(title=f"SwarmX V{VERSION} Pre-flight Check", box=box.ROUNDED, show_header=True)
    table.add_column("Check",   style="bold", width=30)
    table.add_column("Status",  width=10)
    table.add_column("Details", width=50)

    def row(name, ok, detail):
        status = "[green]✓ PASS[/]" if ok else "[red]✗ FAIL[/]"
        table.add_row(name, status, detail)

    def warn_row(name, detail):
        table.add_row(name, "[yellow]⚠ WARN[/]", detail)

    ram = checks.get("ram", {})
    row("System RAM", ram.get("ok"), f"{ram.get('total_gb','?')} GB total, {ram.get('avail_gb','?')} GB available")

    z = checks.get("zram", {})
    if z.get("active"):
        row("ZRAM", z.get("ok"), f"{z.get('size_gb','?')} GB, algo={z.get('algorithm','?')}")
    else:
        row("ZRAM", False, z.get("note", "Not active"))

    sw = checks.get("swappiness", {})
    row("vm.swappiness", sw.get("ok"), f"= {sw.get('value','?')} ({sw.get('note','')})")

    vram = checks.get("vram", {})
    if vram.get("ok"):
        row("VRAM (GPU)", True, f"{vram.get('name','?')}: {vram.get('total_gb','?')} GB total, {vram.get('free_gb','?')} GB free")
    else:
        row("VRAM (GPU)", False, vram.get("note", vram.get("error", "?")))

    for fname, info in checks.get("ggufs", {}).get("files", {}).items():
        short = fname.replace(".gguf", "")[:28]
        row(f"GGUF: {short}", info.get("exists"), f"{info.get('size_gb', 0):.2f} GB" if info.get("exists") else "MISSING — download required")

    oll = checks.get("ollama", {})
    row("Ollama service", oll.get("running"), f"{len(oll.get('loaded_models', []))} models found" if oll.get("running") else oll.get("error", "not running"))

    for m, present in checks.get("models", {}).get("models", {}).items():
        row(f"Model: {m}", present, "registered" if present else "missing — run install.sh")

    env = checks.get("env", {})
    for var, info in env.get("vars", {}).items():
        ok_val = info.get("value") == info.get("ideal") or \
                 (var == "OLLAMA_MAX_LOADED_MODELS" and info.get("value") in ("1", "2")) or \
                 (var == "SWARMX_OLLAMA_URL" and info.get("set"))
        detail = f"={info.get('value', 'NOT SET')} (ideal: {info.get('ideal')})"
        if ok_val:
            row(f"ENV {var}", True, detail)
        else:
            warn_row(f"ENV {var}", detail)

    return table


def render_benchmark_table(bench: dict) -> Table:
    table = Table(title="Latency Benchmark Results", box=box.ROUNDED)
    table.add_column("Model",         style="bold cyan", width=22)
    table.add_column("Duration",      width=10)
    table.add_column("Tokens/sec",    width=12)
    table.add_column("In / Out",      width=12)
    table.add_column("Cached",        width=8)
    table.add_column("Status",        width=10)

    for model, r in bench.items():
        if r.get("ok"):
            table.add_row(
                model,
                f"{r['duration_s']}s",
                f"{r['tokens_per_sec']} t/s",
                f"{r.get('tokens_in',0)} / {r.get('tokens_out',0)}",
                "✓" if r.get("cached") else "-",
                "[green]✓[/]",
            )
        else:
            table.add_row(model, "-", "-", "-", "-", f"[red]FAIL: {r.get('error','?')[:18]}[/]")
    return table


# ─── Main ────────────────────────────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description=f"SwarmX V{VERSION} health check")
    parser.add_argument("--monitor", action="store_true", help="Live monitoring mode")
    parser.add_argument("--bench",   action="store_true", help="Run latency benchmark")
    parser.add_argument("--coload",  nargs=2, metavar=("MODEL_A", "MODEL_B"),
                        help="Check co-load safety for two models")
    parser.add_argument("--json",    action="store_true", help="Emit checks as JSON to stdout (CI/CD mode)")
    parser.add_argument("--version", action="store_true", help="Print version and exit")
    args = parser.parse_args()

    if args.version:
        print(f"SwarmX health check V{VERSION}")
        return

    if args.coload:
        result = check_co_load(*args.coload)
        safe_str = "[green]SAFE[/]" if result["safe"] else "[red]UNSAFE — OOM risk[/]"
        if args.json:
            print(json.dumps(result, indent=2))
        else:
            console.print(f"\n{result['model_a']} + {result['model_b']}: "
                          f"{result['total_mb']} MB / 12,000 MB — {safe_str} "
                          f"(headroom: {result['headroom_mb']} MB)")
        return

    if not args.json:
        console.print(Panel.fit(
            f"[bold cyan]SwarmX V{VERSION} Health Check[/]\n"
            "Verifying system config for local multi-agent LLM stack",
            border_style="cyan"
        ))

    with Progress(SpinnerColumn(), TextColumn("[cyan]{task.description}"), console=console,
                  disable=args.json) as prog:
        t = prog.add_task("Running system checks...", total=None)
        ollama_info = await check_ollama_service()
        loaded = ollama_info.get("loaded_models", [])
        checks = {
            "ram":        check_ram(),
            "zram":       check_zram(),
            "swappiness": check_swappiness(),
            "vram":       check_vram(),
            "ggufs":      check_gguf_files(),
            "ollama":     ollama_info,
            "models":     await check_required_models(loaded),
            "env":        check_env_vars(),
        }
        prog.remove_task(t)

    if args.json:
        failures_list = []
        if not checks["ram"]["ok"]:    failures_list.append("RAM < 7 GB")
        if not checks["vram"]["ok"]:   failures_list.append("VRAM unavailable or < 10 GB")
        if not checks["ggufs"]["ok"]:  failures_list.append("Missing GGUF files")
        if not checks["ollama"]["ok"]: failures_list.append("Ollama not running")
        if not checks["models"]["ok"]: failures_list.append("Missing Ollama models")
        print(json.dumps({
            "version": VERSION,
            "ts": time.time(),
            "ollama_url": OLLAMA_URL,
            "checks": checks,
            "failures": failures_list,
            "ready": len(failures_list) == 0,
        }, indent=2, default=str))
        sys.exit(0 if not failures_list else 1)

    console.print(render_preflight_table(checks))

    failures = []
    if not checks["ram"]["ok"]:     failures.append("RAM < 7 GB")
    if not checks["vram"]["ok"]:    failures.append("VRAM unavailable or < 10 GB")
    if not checks["ggufs"]["ok"]:   failures.append("Missing GGUF files")
    if not checks["ollama"]["ok"]:  failures.append("Ollama not running")
    if not checks["models"]["ok"]:  failures.append("Missing Ollama models")

    warnings = []
    if not checks["zram"]["ok"]:       warnings.append("ZRAM not active — expected ~4 GB performance swap")
    if not checks["swappiness"]["ok"]: warnings.append("vm.swappiness not optimised for ZRAM")
    if not checks["env"]["ok"]:        warnings.extend(checks["env"]["warnings"])

    if failures:
        console.print(f"\n[bold red]✗ {len(failures)} critical issue(s) — system not ready:[/]")
        for f in failures:
            console.print(f"  [red]• {f}[/]")
        sys.exit(1)
    elif warnings:
        console.print(f"\n[bold yellow]⚠ {len(warnings)} warning(s) — system functional but not optimised:[/]")
        for w in warnings:
            console.print(f"  [yellow]• {w}[/]")
    else:
        console.print("\n[bold green]✓ All checks passed — system ready.[/]")

    if args.bench:
        console.print("\n[bold]Running latency benchmark...[/]")
        if not checks["ollama"]["ok"]:
            console.print("[red]Skipping benchmark — Ollama not running.[/]")
        else:
            bench = await run_benchmark()
            console.print(render_benchmark_table(bench))

    if args.monitor:
        console.print("\n[dim]Live monitoring mode — press Ctrl+C to exit[/]")
        while True:
            await asyncio.sleep(5)
            vram = check_vram()
            ram  = check_ram()
            console.print(
                f"RAM: {ram.get('avail_gb','?')} GB avail | "
                f"VRAM: {vram.get('free_gb','?')} GB free / "
                f"{vram.get('used_gb','?')} GB used | "
                f"{time.strftime('%H:%M:%S')}"
            )


if __name__ == "__main__":
    asyncio.run(main())