#!/usr/bin/env bash
# swarm-up.sh — convenience wrapper: start / stop the SwarmX stack.
# Usage: ./swarm-up.sh [--dashboard] [--detach] [--down] [--restart]
# Delegates to: swarm.sh up  (src/swarmx/console/commands/up.py)
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

exec bash "$ROOT/swarm.sh" up "$@"
