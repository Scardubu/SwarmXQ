#!/usr/bin/env bash
set -u

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]:-$0}")/.." >/dev/null 2>&1 && pwd -P)"
cd "$ROOT_DIR" || exit 1

failures=0

run_gate() {
  local name="$1"
  shift
  printf '%s\n' "==> ${name}"
  "$@"
  local code=$?
  if [[ $code -eq 0 ]]; then
    printf '%s\n' "${name} | ${code} | PASS | completed |"
  else
    failures=$((failures + 1))
    printf '%s\n' "${name} | ${code} | FAIL | command failed | inspect command output above"
  fi
  printf '\n'
}

run_blockable_gate() {
  local name="$1"
  local binary="$2"
  shift 2
  if ! command -v "$binary" >/dev/null 2>&1; then
    printf '%s\n\n' "${name} | 127 | BLOCKED_BY_ENVIRONMENT | ${binary} not installed | install ${binary}"
    return 0
  fi
  run_gate "$name" "$@"
}

printf '%s\n' "Command | Exit code | Status | Relevant evidence | Blocker"
printf '%s\n' "--- | ---: | --- | --- | ---"

run_gate "git diff --check" git diff --check
run_gate "git status --short" git status --short
run_gate "pnpm install --frozen-lockfile" pnpm install --frozen-lockfile
run_gate "pnpm run typecheck" pnpm run typecheck
run_gate "pnpm run lint" pnpm run lint
run_gate "pnpm run test" pnpm run test
run_gate "pnpm run build" pnpm run build
run_gate "api regression" pnpm --filter @swarmx/api run test:regression
run_gate "api model registry and Modelfile validation" pnpm --filter @swarmx/api run test:models
run_gate "api video regression" pnpm --filter @swarmx/api run test:video
run_gate "api factory regression" pnpm --filter @swarmx/api run test:factory
if [[ -x ".venv/bin/python" ]]; then
  run_gate "python pytest" .venv/bin/python -m pytest -q
  run_gate "python ruff" .venv/bin/python -m ruff check .
else
  printf '%s\n\n' "python pytest | 127 | BLOCKED_BY_ENVIRONMENT | .venv/bin/python missing | create .venv and install dev dependencies"
  printf '%s\n\n' "python ruff | 127 | BLOCKED_BY_ENVIRONMENT | .venv/bin/python missing | create .venv and install dev dependencies"
fi
run_blockable_gate "docker compose config" docker docker compose config

exit "$failures"
