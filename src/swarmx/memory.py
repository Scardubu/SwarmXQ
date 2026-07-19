from __future__ import annotations

import json
from collections import Counter
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .state import EvolutionProposal, RunRecord
from .storage import list_memories as db_list_memories
from .storage import list_runs as db_list_runs
from .storage import store_proposal_record, store_run_record
from .utils import load_yaml, write_json


def now_iso() -> str:
    return datetime.now(UTC).isoformat()


def _dir(runtime_dir: Path, name: str) -> Path:
    return runtime_dir / name


def _jsonl_append(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _jsonl_trim(path: Path, keep: int) -> None:
    if keep <= 0 or not path.exists():
        return
    try:
        lines = [line for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]
    except Exception:
        return
    if len(lines) <= keep:
        return
    path.write_text("\n".join(lines[-keep:]) + "\n", encoding="utf-8")


def _retention_limit(runtime_dir: Path, key: str, default: int) -> int:
    cfg: dict[str, Any] = {}
    for candidate in (runtime_dir / "config.yaml", runtime_dir / "config.json"):
        if candidate.exists():
            try:
                if candidate.suffix == ".yaml":
                    cfg = load_yaml(candidate, {}) or {}
                else:
                    cfg = json.loads(candidate.read_text(encoding="utf-8"))
                if isinstance(cfg, dict):
                    break
            except Exception:
                cfg = {}
    try:
        # Check flat runtime config first (set by swarm init), then nested evolution.memory_policy
        flat = cfg.get("memory", {})
        nested = cfg.get("evolution", {}).get("memory_policy", {})
        value = flat.get(key) or nested.get(key) or nested.get(key.replace("retain_", "keep_")) or default
        return max(int(value), 1)
    except Exception:
        return default


def append_jsonl(path: str | Path, payload: dict[str, Any]) -> None:
    _jsonl_append(Path(path), payload)


def store_run(runtime_dir: Path, record: RunRecord) -> Path:
    runs_dir = _dir(runtime_dir, "runs")
    runs_dir.mkdir(parents=True, exist_ok=True)
    path = runs_dir / f"{record.id}.json"
    payload = record.to_dict()
    write_json(path, payload)
    runs_log = runtime_dir / "memory" / "runs.jsonl"
    _jsonl_append(runs_log, payload)
    try:
        store_run_record(runtime_dir, payload)
    except Exception:
        pass
    _jsonl_trim(runs_log, _retention_limit(runtime_dir, "retain_recent_runs", 50))
    prune_runtime_artifacts(runtime_dir)
    return path


def store_checkpoint(runtime_dir: Path, run_id: str, state: dict[str, Any]) -> Path:
    ckpt_dir = _dir(runtime_dir, "checkpoints")
    ckpt_dir.mkdir(parents=True, exist_ok=True)
    path = ckpt_dir / f"{run_id}.json"
    write_json(path, state)
    return path


def store_proposal(runtime_dir: Path, proposal: EvolutionProposal) -> Path:
    prop_dir = runtime_dir / "evolution" / "proposals"
    prop_dir.mkdir(parents=True, exist_ok=True)
    path = prop_dir / f"{proposal.id}.json"
    payload = proposal.to_dict()
    write_json(path, payload)
    try:
        store_proposal_record(runtime_dir, payload)
    except Exception:
        pass
    return path


def store_memory(runtime_dir: Path, payload: dict[str, Any]) -> Path:
    memory_dir = _dir(runtime_dir, "memory")
    memory_dir.mkdir(parents=True, exist_ok=True)
    entry = dict(payload)
    entry.setdefault("id", f"memory-{datetime.now(UTC).strftime('%Y%m%d%H%M%S%f')}")
    entry.setdefault("created_at", now_iso())
    entry.setdefault("kind", "lesson")
    path = memory_dir / f"{entry['id']}.json"
    write_json(path, entry)
    log_path = memory_dir / "memory.jsonl"
    _jsonl_append(log_path, entry)
    _jsonl_trim(log_path, _retention_limit(runtime_dir, "retain_recent_memories", 50))
    (memory_dir / "latest.json").write_text(json.dumps(entry, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    prune_runtime_artifacts(runtime_dir)
    return path


def load_recent_runs(runtime_dir: Path, limit: int = 20) -> list[dict[str, Any]]:
    try:
        stored = db_list_runs(runtime_dir, limit=limit)
        if stored:
            return stored
    except Exception:
        pass
    p = runtime_dir / "memory" / "runs.jsonl"
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").splitlines()
    out: list[dict[str, Any]] = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def load_recent_memories(runtime_dir: Path, limit: int = 20) -> list[dict[str, Any]]:
    try:
        stored = db_list_memories(runtime_dir, limit=limit)
        if stored:
            return stored
    except Exception:
        pass
    p = runtime_dir / "memory" / "memory.jsonl"
    if not p.exists():
        return []
    lines = p.read_text(encoding="utf-8").splitlines()
    out: list[dict[str, Any]] = []
    for line in lines[-limit:]:
        try:
            out.append(json.loads(line))
        except json.JSONDecodeError:
            continue
    return out


def _prune_json_files(folder: Path, keep: int) -> None:
    if keep <= 0 or not folder.exists():
        return
    files = sorted(
        [p for p in folder.glob('*.json') if p.is_file() and p.name not in {'latest.json'}],
        key=lambda p: p.stat().st_mtime,
    )
    for old in files[:-keep]:
        try:
            old.unlink()
        except Exception:
            continue


def prune_runtime_artifacts(runtime_dir: Path) -> dict[str, int]:
    run_keep = _retention_limit(runtime_dir, 'retain_recent_runs', 50)
    mem_keep = _retention_limit(runtime_dir, 'retain_recent_memories', 50)
    trace_keep = _retention_limit(runtime_dir, 'retain_recent_traces', 100)
    _prune_json_files(runtime_dir / 'runs', run_keep)
    _prune_json_files(runtime_dir / 'memory', mem_keep)
    _prune_json_files(runtime_dir / 'traces', trace_keep)
    _prune_json_files(runtime_dir / 'checkpoints', max(run_keep, 10))
    _prune_json_files(runtime_dir / 'evolution' / 'proposals', max(run_keep, 10))
    return {'runs': run_keep, 'memories': mem_keep, 'traces': trace_keep}


def summarize_runs(runs: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(runs)
    if total == 0:
        return {
            "runs": 0,
            "success_rate": None,
            "common_workflows": [],
            "status_counts": {},
            "latest_run_id": None,
            "latest_status": None,
            "latest_workflow": None,
            "latest_summary": None,
            "latest_created_at": None,
            "blocked_tasks_total": 0,
            "test_failure_rate": None,
        }
    successes = sum(1 for r in runs if r.get("status") == "success")
    workflow_counts: dict[str, int] = {}
    status_counts: dict[str, int] = {}
    blocked_tasks_total = 0
    test_failures = 0
    for r in runs:
        wf = r.get("workflow", "unknown")
        workflow_counts[wf] = workflow_counts.get(wf, 0) + 1
        status = r.get("status", "unknown")
        status_counts[status] = status_counts.get(status, 0) + 1
        blocked_tasks_total += len(r.get("metrics", {}).get("blocked_tasks", []))
        test_result = r.get("metrics", {}).get("test_command", {}) or {}
        if test_result.get("exit_code") not in (None, 0):
            test_failures += 1
    common = sorted(workflow_counts.items(), key=lambda kv: kv[1], reverse=True)[:5]
    latest = runs[-1]
    return {
        "runs": total,
        "success_rate": round(successes / total, 3),
        "common_workflows": common,
        "status_counts": status_counts,
        "latest_run_id": latest.get("id"),
        "latest_status": latest.get("status"),
        "latest_workflow": latest.get("workflow"),
        "latest_summary": latest.get("summary"),
        "latest_created_at": latest.get("created_at"),
        "blocked_tasks_total": blocked_tasks_total,
        "test_failure_rate": round(test_failures / total, 3),
    }


def summarize_memories(memories: list[dict[str, Any]]) -> dict[str, Any]:
    total = len(memories)
    if total == 0:
        return {"memories": 0, "kind_counts": {}, "top_tags": [], "latest_kind": None, "latest_summary": None}
    kinds = Counter(str(m.get("kind", "lesson")) for m in memories)
    tags = Counter(tag for m in memories for tag in (m.get("tags", []) or []))
    latest = memories[-1]
    return {
        "memories": total,
        "kind_counts": dict(kinds),
        "top_tags": tags.most_common(10),
        "latest_kind": latest.get("kind"),
        "latest_summary": latest.get("summary") or latest.get("note") or latest.get("content"),
    }


def learn_from_run(runtime_dir: Path, record: dict[str, Any]) -> list[Path]:
    created: list[Path] = []
    workflow = record.get("workflow", "unknown")
    status = record.get("status", "unknown")
    target = record.get("target", "")
    summary = record.get("summary", "")
    metrics = record.get("metrics", {}) or {}
    evidence = record.get("evidence", []) or []
    blocked = metrics.get("blocked_tasks", []) or []
    stack = []
    plan = record.get("plan")
    if isinstance(plan, dict):
        stack = list(plan.get("stack", []) or [])
    run_id = record.get("id") or "unknown"
    memory_base = {
        "source_run": run_id,
        "workflow": workflow,
        "status": status,
        "target": target,
        "tags": [workflow, status] + stack,
    }
    created.append(store_memory(runtime_dir, {
        **memory_base,
        "id": f"memory-{run_id}-run-summary",
        "kind": "run-summary",
        "summary": summary,
        "note": f"{workflow}::{status}",
        "content": summary,
        "evidence_count": len(evidence),
    }))
    if blocked:
        created.append(store_memory(runtime_dir, {
            **memory_base,
            "id": f"memory-{run_id}-blocking-pattern",
            "kind": "blocking-pattern",
            "summary": f"Blocked tasks detected: {', '.join(blocked[:5])}",
            "note": "Add stronger gates, smaller steps, or a safer workflow.",
            "tags": memory_base["tags"] + ["blocked", "safety"],
        }))
    test_result = metrics.get("test_command", {}) or {}
    if test_result.get("exit_code") not in (None, 0):
        created.append(store_memory(runtime_dir, {
            **memory_base,
            "id": f"memory-{run_id}-test-failure",
            "kind": "test-failure",
            "summary": f"Test command failed: {test_result.get('command')}",
            "note": (test_result.get("stderr") or test_result.get("stdout") or "")[:1000],
            "tags": memory_base["tags"] + ["test", "failure"],
        }))
    if evidence:
        created.append(store_memory(runtime_dir, {
            **memory_base,
            "id": f"memory-{run_id}-evidence-snapshot",
            "kind": "evidence-snapshot",
            "summary": summary,
            "content": evidence[-1][:2000],
            "tags": memory_base["tags"] + ["evidence"],
        }))
    return created


def summarize_evidence(evidence: list[str]) -> dict[str, Any]:
    return {
        "lines": len(evidence),
        "has_errors": any("error" in e.lower() or "fail" in e.lower() for e in evidence),
        "has_warnings": any("warn" in e.lower() for e in evidence),
    }


def search_memories(runtime_dir: Path, query: str, limit: int = 20) -> list[dict[str, Any]]:
    try:
        # The sqlite store gives the most durable view; use it when available.
        matches = []
        for memory in db_list_memories(runtime_dir, limit=500):
            hay = " ".join([str(memory.get("kind", "")), str(memory.get("summary", "")), str(memory.get("content", "")), " ".join(memory.get("tags", []) or [])]).lower()
            score = sum(hay.count(term) for term in query.lower().split() if term)
            if score:
                matches.append((score, memory))
        matches.sort(key=lambda item: item[0], reverse=True)
        return [m for _, m in matches[:limit]]
    except Exception:
        memories = load_recent_memories(runtime_dir, limit=500)
        terms = [term for term in query.lower().split() if term]
        out = []
        for memory in memories:
            hay = " ".join([str(memory.get("kind", "")), str(memory.get("summary", "")), str(memory.get("content", "")), " ".join(memory.get("tags", []) or [])]).lower()
            if any(term in hay for term in terms):
                out.append(memory)
        return out[:limit]


# ── V5 Memory Extensions ────────────────────────────────────────────────────────

import math as _math


def decay_score(memory: dict[str, Any], now: datetime | None = None) -> float:
    """Compute temporal decay score for a memory record.

    Uses exponential decay: score = confidence × exp(-λ × days_old)
    where λ=0.02 (half-life ≈ 35 days) for standard memories,
    and λ=0.005 (half-life ≈ 139 days) for SEMANTIC/PROCEDURAL kinds.

    Returns a float in [0.0, 1.0].
    """
    if now is None:
        now = datetime.now(UTC)
    confidence = float(memory.get("confidence") or memory.get("score") or 0.5)
    created_str = memory.get("created_at") or ""
    days_old = 0.0
    if created_str:
        try:
            created = datetime.fromisoformat(created_str.replace("Z", "+00:00"))
            if created.tzinfo is None:
                created = created.replace(tzinfo=UTC)
            days_old = max(0.0, (now - created).total_seconds() / 86400.0)
        except Exception:
            days_old = 0.0
    kind = str(memory.get("kind") or memory.get("memory_kind") or "lesson").lower()
    lam = 0.005 if kind in {"semantic", "procedural"} else 0.02
    score = confidence * _math.exp(-lam * days_old)
    return round(max(0.0, min(1.0, score)), 4)


def hybrid_search(
    runtime_dir: Path,
    query: str,
    limit: int = 20,
    fts_weight: float = 0.6,
    recency_weight: float = 0.2,
    decay_weight: float = 0.2,
) -> list[dict[str, Any]]:
    """Hybrid memory search combining FTS5 BM25, decay score, and recency.

    Search priority:
    1. FTS5 BM25 via memories_fts virtual table (if available — V5 migration ran)
    2. Fallback: token-frequency scoring (same as search_memories)
    Weights: fts_weight + decay_weight + recency_weight must sum to ~1.0.

    Performance contract: < 50ms p95 for up to 5000 memories.
    Returns memories ordered by composite hybrid score (descending).
    """
    if not query or not query.strip():
        return load_recent_memories(runtime_dir, limit=limit)

    now = datetime.now(UTC)

    # Attempt FTS5 path
    try:
        from .storage import connect
        with connect(runtime_dir) as conn:
            # Check if FTS5 table exists
            tbl_row = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
            ).fetchone()

            if tbl_row:
                # FTS5 BM25 path (lower bm25 rank = better match)
                fts_rows = conn.execute(
                    """
                    SELECT m.payload, bm25(memories_fts) as bm25_score
                    FROM memories_fts
                    JOIN memories m ON memories_fts.rowid = m.rowid
                    WHERE memories_fts MATCH ?
                    ORDER BY bm25_score
                    LIMIT ?
                    """,
                    (query, limit * 3),
                ).fetchall()

                if fts_rows:
                    import json as _json
                    scored: list[tuple[float, dict[str, Any]]] = []
                    max_bm25 = max(abs(float(r["bm25_score"])) for r in fts_rows) or 1.0
                    for i, row in enumerate(fts_rows):
                        mem = _json.loads(row["payload"]) if isinstance(row["payload"], str) else dict(row)
                        bm25_norm = 1.0 - (abs(float(row["bm25_score"])) / max_bm25)
                        d_score = decay_score(mem, now)
                        # recency: position in result set used as proxy
                        rec = 1.0 - (i / max(len(fts_rows), 1))
                        composite = (
                            bm25_norm * fts_weight
                            + d_score * decay_weight
                            + rec * recency_weight
                        )
                        scored.append((composite, mem))
                    scored.sort(key=lambda x: x[0], reverse=True)
                    return [m for _, m in scored[:limit]]
    except Exception:
        pass

    # Fallback: token-frequency + decay hybrid
    candidates = load_recent_memories(runtime_dir, limit=2000)
    terms = [t for t in query.lower().split() if t]
    scored_fb: list[tuple[float, dict[str, Any]]] = []
    for i, mem in enumerate(candidates):
        hay = " ".join([
            str(mem.get("kind", "")),
            str(mem.get("summary", "")),
            str(mem.get("content", "")),
            " ".join(mem.get("tags", []) or []),
        ]).lower()
        tf_score = sum(hay.count(t) for t in terms)
        if tf_score == 0:
            continue
        tf_norm = min(tf_score / 10.0, 1.0)
        d_score = decay_score(mem, now)
        rec = 1.0 - (i / max(len(candidates), 1))
        composite = tf_norm * fts_weight + d_score * decay_weight + rec * recency_weight
        scored_fb.append((composite, mem))
    scored_fb.sort(key=lambda x: x[0], reverse=True)
    return [m for _, m in scored_fb[:limit]]


def consolidate_memories(
    runtime_dir: Path,
    source_ids: list[str],
    summary: str,
    kind: str = "consolidated",
    tags: list[str] | None = None,
    confidence: float = 0.8,
) -> dict[str, Any]:
    """Consolidate a set of related memories into a single high-confidence record.

    Append-only: source memories are marked superseded=True, not deleted.
    The consolidated memory is stored as a new record with kind='consolidated'
    (or the provided kind) and references to all source IDs.

    Returns the new consolidated memory record.
    """
    ts = datetime.now(UTC).strftime("%Y%m%d%H%M%S%f")
    new_id = f"consolidated-{ts}"
    record: dict[str, Any] = {
        "id": new_id,
        "created_at": now_iso(),
        "kind": kind,
        "summary": summary,
        "content": summary,
        "confidence": round(confidence, 4),
        "source_ids": source_ids,
        "tags": tags or ["consolidated"],
        "superseded": False,
    }

    # Store consolidated record
    store_memory(runtime_dir, record)

    # Mark source memories as superseded in DB (non-destructive)
    try:
        from .storage import connect
        with connect(runtime_dir) as conn:
            for sid in source_ids:
                # Update payload JSON to set superseded=True
                row = conn.execute(
                    "SELECT payload FROM memories WHERE id=?", (sid,)
                ).fetchone()
                if row:
                    import json as _json
                    try:
                        payload = _json.loads(row["payload"])
                        payload["superseded"] = True
                        conn.execute(
                            "UPDATE memories SET payload=? WHERE id=?",
                            (_json.dumps(payload, ensure_ascii=False), sid),
                        )
                    except Exception:
                        pass
                # Also update V5 superseded column if it exists
                try:
                    conn.execute(
                        "UPDATE memories SET superseded=1 WHERE id=?", (sid,)
                    )
                except Exception:
                    pass
    except Exception:
        pass

    return record
