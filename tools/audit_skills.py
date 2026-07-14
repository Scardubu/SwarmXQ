from __future__ import annotations

import argparse
import json
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Create a lightweight skills archive audit.")
    parser.add_argument("--input", action="append", default=[], help="Skill archive path to inventory.")
    parser.add_argument("--out", required=True, help="Markdown report path.")
    args = parser.parse_args()

    inputs = [Path(item) for item in args.input]
    rows = []
    for path in inputs:
      rows.append({
          "path": str(path),
          "exists": path.exists(),
          "size_bytes": path.stat().st_size if path.exists() else 0,
      })

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    lines = [
        "# Skills Audit",
        "",
        "```json",
        json.dumps(rows, indent=2),
        "```",
        "",
    ]
    out.write_text("\n".join(lines), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
