#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# [V5.9-ENH-06] One-click startup now launches API + dashboard together.
# Use --legacy to force the old standalone dashboard server behaviour.
if [[ "${1:-}" == "--legacy" ]]; then
	shift
	exec bash "$ROOT/swarm.sh" dashboard "$@"
fi

exec bash "$ROOT/swarm.sh" up --dashboard "$@"
