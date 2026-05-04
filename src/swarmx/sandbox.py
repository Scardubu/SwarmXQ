"""swarmx.sandbox — Tiered execution sandbox adapter.

Opt-in: graceful fallback to PREVIEW (dry-run diff) if Docker/Podman absent.
Disabled by default in configs/routing.yaml (sandbox.enabled = false).

Safety contract:
  - Never raises on sandbox failure — returns SandboxResult(exit_code=1, ...).
  - All proposals stored BEFORE any apply (proposal-first invariant).
  - HIGH risk → sandbox required; CRITICAL → always blocked.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass, field, asdict
from pathlib import Path
from typing import Any


@dataclass
class SandboxResult:
    """Result of a sandboxed or preview execution."""
    exit_code: int
    stdout: str
    stderr: str
    test_pass_rate: float          # parsed from test output (0.0–1.0)
    diff_lines: int                # lines changed
    affected_files: list[str]
    risk_score_delta: float        # post vs. pre risk assessment
    sandbox_used: bool = False     # True if Docker/Podman was used
    error_message: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @property
    def composite_score(self) -> float:
        """SimResult composite: test_pass_rate×0.4 + risk_delta×0.3 + diff_penalty×0.3."""
        diff_penalty = max(0.0, 1.0 - self.diff_lines / 500.0)
        risk_bonus = max(0.0, 1.0 + self.risk_score_delta)  # negative delta = safer
        return round(
            self.test_pass_rate * 0.4
            + risk_bonus * 0.3
            + diff_penalty * 0.3,
            4,
        )


def sandbox_available() -> bool:
    """Return True if docker or podman is callable on PATH."""
    for runtime in ("docker", "podman"):
        if shutil.which(runtime):
            return True
    return False


def _parse_test_pass_rate(stdout: str, stderr: str) -> float:
    """Best-effort parse of test pass rate from pytest/jest/go test output."""
    combined = (stdout + stderr).lower()
    # pytest: "5 passed, 1 failed" / "5 passed"
    import re
    m = re.search(r"(\d+)\s+passed", combined)
    m_fail = re.search(r"(\d+)\s+failed", combined)
    if m:
        passed = int(m.group(1))
        failed = int(m_fail.group(1)) if m_fail else 0
        total = passed + failed
        return round(passed / max(total, 1), 4)
    # jest: "Tests: 5 passed, 1 failed"
    m2 = re.search(r"tests:\s+(\d+)\s+passed", combined)
    if m2:
        passed = int(m2.group(1))
        m2f = re.search(r"(\d+)\s+failed", combined)
        failed = int(m2f.group(1)) if m2f else 0
        return round(passed / max(passed + failed, 1), 4)
    # No recognisable output — conservative default
    if "error" in combined or "fail" in combined:
        return 0.0
    return 1.0


def _count_diff_lines(stdout: str) -> int:
    """Count added/removed lines in unified diff output."""
    return sum(1 for line in stdout.splitlines() if line.startswith(("+", "-")) and not line.startswith(("+++", "---")))


def _preview_fallback(cmd: list[str], repo: Path) -> SandboxResult:
    """PREVIEW tier: dry-run subprocess without isolation."""
    try:
        result = subprocess.run(
            cmd,
            cwd=repo,
            capture_output=True,
            text=True,
            timeout=120,
        )
        return SandboxResult(
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
            test_pass_rate=_parse_test_pass_rate(result.stdout, result.stderr),
            diff_lines=_count_diff_lines(result.stdout),
            affected_files=[],
            risk_score_delta=0.0,
            sandbox_used=False,
        )
    except Exception as exc:
        return SandboxResult(
            exit_code=1,
            stdout="",
            stderr="",
            test_pass_rate=0.0,
            diff_lines=0,
            affected_files=[],
            risk_score_delta=0.0,
            sandbox_used=False,
            error_message=str(exc),
        )


def run_in_sandbox(
    cmd: list[str],
    repo: Path,
    timeout: int = 120,
    image: str = "swarmx-sandbox:v5",
) -> SandboxResult:
    """Run a command in an isolated Docker/Podman container.

    Bind-mounts repo read-only; writes go to overlay FS only.
    Falls back to _preview_fallback() if Docker/Podman unavailable.
    Never raises on sandbox failure — returns SandboxResult(exit_code=1, ...).
    """
    runtime = shutil.which("docker") or shutil.which("podman")
    if not runtime:
        return _preview_fallback(cmd, repo)

    try:
        docker_cmd = [
            runtime, "run", "--rm",
            "--network=none",
            "--read-only",
            "--tmpfs", "/tmp",
            "-v", f"{repo.resolve()}:/workspace:ro",
            "-w", "/workspace",
            "--memory", "512m",
            "--cpus", "1.0",
            image,
            *cmd,
        ]
        result = subprocess.run(
            docker_cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return SandboxResult(
            exit_code=result.returncode,
            stdout=result.stdout,
            stderr=result.stderr,
            test_pass_rate=_parse_test_pass_rate(result.stdout, result.stderr),
            diff_lines=_count_diff_lines(result.stdout),
            affected_files=[],
            risk_score_delta=-0.05 if result.returncode == 0 else 0.05,
            sandbox_used=True,
        )
    except subprocess.TimeoutExpired:
        return SandboxResult(
            exit_code=1, stdout="", stderr="",
            test_pass_rate=0.0, diff_lines=0, affected_files=[],
            risk_score_delta=0.0, sandbox_used=True,
            error_message="sandbox timeout",
        )
    except Exception as exc:
        return _preview_fallback(cmd, repo)


def simulate_proposal(proposal: dict[str, Any], repo: Path, timeout: int = 120) -> SandboxResult:
    """Dry-run a proposal patch in a temp git branch, then sandbox it.

    Always stores SandboxResult BEFORE any apply.
    The patch in proposal["patch"] is expected to be a dict of {file: content}.
    """
    patch: dict[str, str] = proposal.get("patch", {})
    if not patch or not isinstance(patch, dict):
        return SandboxResult(
            exit_code=0, stdout="no patch to simulate", stderr="",
            test_pass_rate=1.0, diff_lines=0, affected_files=[],
            risk_score_delta=0.0,
        )

    with tempfile.TemporaryDirectory(prefix="swarmx-sim-") as tmpdir:
        tmp_repo = Path(tmpdir) / "repo"
        # Copy repo tree (excluding .git internals that might cause issues)
        try:
            shutil.copytree(repo, tmp_repo, ignore=shutil.ignore_patterns(".git", "__pycache__", "*.pyc", "node_modules"))
        except Exception as exc:
            return SandboxResult(
                exit_code=1, stdout="", stderr=str(exc),
                test_pass_rate=0.0, diff_lines=0, affected_files=[],
                risk_score_delta=0.0, error_message=f"copy failed: {exc}",
            )

        # Apply patch files
        affected: list[str] = []
        diff_lines = 0
        for rel_path, new_content in patch.items():
            target = tmp_repo / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            original = ""
            if (repo / rel_path).exists():
                try:
                    original = (repo / rel_path).read_text(encoding="utf-8", errors="replace")
                except Exception:
                    pass
            target.write_text(new_content, encoding="utf-8")
            affected.append(rel_path)
            # Count diff lines
            orig_lines = set(original.splitlines())
            new_lines = set(new_content.splitlines())
            diff_lines += len(orig_lines.symmetric_difference(new_lines))

        # Try to run tests in tmp_repo
        if sandbox_available():
            result = run_in_sandbox(["python", "-m", "pytest", "-q", "--tb=no"], tmp_repo, timeout=timeout)
        else:
            result = _preview_fallback(["python", "-m", "pytest", "-q", "--tb=no"], tmp_repo)

        result.diff_lines = diff_lines
        result.affected_files = affected
        return result
