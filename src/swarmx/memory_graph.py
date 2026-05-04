from __future__ import annotations

from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from .storage import list_memories, list_runs, list_missions, list_events, search_memories


def _tokenize(text: str) -> list[str]:
    tokens = []
    for raw in text.lower().replace("_", " ").replace("-", " ").split():
        token = "".join(ch for ch in raw if ch.isalnum())
        if len(token) >= 3:
            tokens.append(token)
    return tokens


def build_memory_graph(runtime_home: Path, limit: int = 250) -> dict[str, Any]:
    memories = list_memories(runtime_home, limit=limit)
    runs = list_runs(runtime_home, limit=max(50, limit // 2))
    missions = list_missions(runtime_home, limit=max(25, limit // 4))
    events = list_events(runtime_home, limit=max(50, limit // 2))

    node_counts: Counter[str] = Counter()
    tag_counts: Counter[str] = Counter()
    kind_counts: Counter[str] = Counter()
    workflow_counts: Counter[str] = Counter()
    event_counts: Counter[str] = Counter()
    edges: Counter[tuple[str, str]] = Counter()

    def touch(node_id: str) -> None:
        node_counts[node_id] += 1

    def connect(source: str, target: str, weight: int = 1) -> None:
        edges[(source, target)] += weight
        touch(source)
        touch(target)

    for memory in memories:
        node_id = f"memory:{memory.get('id')}"
        touch(node_id)
        kind = str(memory.get("kind") or "lesson")
        kind_counts[kind] += 1
        connect(node_id, f"kind:{kind}")
        for tag in [str(tag) for tag in (memory.get("tags") or []) if str(tag).strip()]:
            tag_counts[tag] += 1
            connect(node_id, f"tag:{tag}")
        content = " ".join([str(memory.get("summary") or ""), str(memory.get("content") or "")])
        for token in _tokenize(content)[:10]:
            connect(node_id, f"token:{token}")
        if memory.get("source_run"):
            connect(node_id, f"run:{memory.get('source_run')}")

    for run in runs:
        node_id = f"run:{run.get('id')}"
        touch(node_id)
        workflow = str(run.get("workflow") or "unknown")
        workflow_counts[workflow] += 1
        connect(node_id, f"workflow:{workflow}")
        for token in _tokenize(str(run.get("summary") or "") + " " + str(run.get("target") or ""))[:12]:
            connect(node_id, f"token:{token}")

    for mission in missions:
        node_id = f"mission:{mission.get('id')}"
        touch(node_id)
        workflow = str(mission.get("workflow") or "mission")
        workflow_counts[workflow] += 1
        connect(node_id, f"workflow:{workflow}")
        connect(node_id, f"risk:{mission.get('risk') or 'unknown'}")
        objective = " ".join([str(mission.get("objective") or ""), str(mission.get("target") or "")])
        for token in _tokenize(objective)[:12]:
            connect(node_id, f"token:{token}")

    for event in events:
        kind = str(event.get("kind") or "event")
        event_counts[kind] += 1
        node_id = f"event:{kind}"
        touch(node_id)
        payload = event.get("payload") or {}
        if isinstance(payload, dict):
            for token in _tokenize(" ".join([str(v) for v in payload.values() if isinstance(v, (str, int, float))]))[:5]:
                connect(node_id, f"token:{token}")

    nodes = []
    for node_id, count in node_counts.items():
        kind = node_id.split(":", 1)[0]
        nodes.append({"id": node_id, "kind": kind, "count": count})
    nodes.sort(key=lambda item: item["count"], reverse=True)

    edge_list = [{"source": source, "target": target, "weight": weight} for (source, target), weight in edges.items()]
    edge_list.sort(key=lambda item: item["weight"], reverse=True)

    return {
        "nodes": nodes[:500],
        "edges": edge_list[:800],
        "summary": {
            "memories": len(memories),
            "runs": len(runs),
            "missions": len(missions),
            "events": len(events),
            "top_kinds": kind_counts.most_common(10),
            "top_tags": tag_counts.most_common(15),
            "top_workflows": workflow_counts.most_common(10),
            "top_events": event_counts.most_common(10),
        },
    }


def search_memory_graph(runtime_home: Path, query: str, limit: int = 20) -> dict[str, Any]:
    q = (query or "").strip()
    matches = []
    for kind, rows in [
        ("memory", list_memories(runtime_home, limit=400)),
        ("run", list_runs(runtime_home, limit=200)),
        ("mission", list_missions(runtime_home, limit=200)),
    ]:
        for row in rows:
            hay = " ".join([
                str(row.get("id", "")),
                str(row.get("kind", kind)),
                str(row.get("summary", row.get("objective", ""))),
                str(row.get("content", "")),
                str(row.get("target", "")),
                str(row.get("workflow", "")),
                " ".join(row.get("tags", []) or []),
            ]).lower()
            score = sum(hay.count(token) for token in _tokenize(q)) if q else 1
            if q and score == 0:
                continue
            matches.append({"kind": kind, "score": score, "item": row})
    matches.sort(key=lambda item: (item["score"], str(item["item"].get("created_at", ""))), reverse=True)
    return {"query": q, "results": matches[:limit], "count": len(matches)}
