#!/usr/bin/env python3
"""Audit and build the curated SwarmXQ SCAR skills catalog.

Usage:
  python tools/audit_scar_skills.py --skills-dir skills/scar --out skills/catalog.yaml
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from swarmx.skill_loader import build_catalog_from_paths, validate_catalog_payload, write_catalog  # noqa: E402

EXPECTED = {
    "accessibility-system-architect",
    "backend-domain-model-architect",
    "data-visualization-architect",
    "elite-skill-forge",
    "frontend-product-design-architect",
    "motion-performance-architect",
    "multi-agent-orchestration-architect",
    "real-time-systems-architect",
}


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit curated SCAR skills for SwarmXQ")
    parser.add_argument("--skills-dir", default="skills/scar")
    parser.add_argument("--out", default="skills/catalog.yaml")
    parser.add_argument("--write", action="store_true", help="Write catalog.yaml after validation")
    args = parser.parse_args()

    skills_dir = (ROOT / args.skills_dir).resolve()
    payload = build_catalog_from_paths([skills_dir], catalog_root=ROOT)
    names = {item.get("name") for item in payload.get("skills", [])}
    issues = validate_catalog_payload(payload)

    missing = sorted(EXPECTED - names)
    extra = sorted(names - EXPECTED)
    for name in missing:
        issues.append(type("Issue", (), {"severity": "error", "to_dict": lambda self, n=name: {"path": "skills/scar", "severity": "error", "message": f"missing expected skill: {n}"}})())
    for name in extra:
        issues.append(type("Issue", (), {"severity": "warning", "to_dict": lambda self, n=name: {"path": "skills/scar", "severity": "warning", "message": f"unexpected extra skill: {n}"}})())

    ok = not any(getattr(issue, "severity", "") == "error" for issue in issues)
    if args.write and ok:
        write_catalog(payload, ROOT / args.out)

    print(json.dumps({
        "ok": ok,
        "count": len(payload.get("skills", [])),
        "names": sorted(names),
        "output": str(ROOT / args.out),
        "written": bool(args.write and ok),
        "issues": [issue.to_dict() for issue in issues],
    }, indent=2, ensure_ascii=False))
    return 0 if ok else 2


if __name__ == "__main__":
    raise SystemExit(main())
