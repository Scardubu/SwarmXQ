---
name: swarmxq-ci-release-architect
description: >
  Governs the SwarmXQ CI/CD pipeline, GitHub Actions configuration, quality gate
  sequencing, CHANGELOG protocol, and release checklist. Owns the .github/workflows/ci.yml
  structure (pnpm install → tsc × 3 → vitest × 2 → 5 regression scripts → next build →
  whitespace check → console.* invariant check), pnpm store caching strategy, Ollama model
  stub injection for offline regression runs, and the release validation checklist.
  Use this skill for ANY change to .github/workflows/, the quality gate execution order,
  CHANGELOG.md format, release tagging, or CI failure diagnosis. Triggers: "GitHub Actions",
  "ci.yml", "quality gate", "pnpm cache", "pnpm store", "regression script CI", "vitest run",
  "tsc --noEmit", "next build CI", "release checklist", "deploy gate", "CHANGELOG",
  "offline CI", "Ollama model stub", "ci gate ordering", "ci.yml matrix", "ubuntu-latest",
  "release gate", "commit to main", "PR gate", "branch protection". Always load
  git-workflow-architect alongside this skill for commit message conventions and
  branch protection configuration.
---

# SwarmXQ CI / Release Architect

CI is the last line of defence between a broken invariant and a production commit.
The SwarmXQ quality gate is not optional — it is the only mechanism that prevents
`console.*` drift, broken TypeScript contracts, and creative quality regressions from
reaching `main`. This skill owns the full gate stack from PR open to merge.

---

## The 8-Gate Release Checklist

Run in this order on every PR to `main`. All 8 must be green.

```
[ ] 1. api tsc          — pnpm -F swarmx-api tsc --noEmit          (zero type errors)
[ ] 2. types tsc        — pnpm -F swarmx-types tsc --noEmit        (zero type errors)
[ ] 3. dashboard tsc    — pnpm -F swarmx-dashboard tsc --noEmit    (zero type errors)
[ ] 4. vitest dashboard — pnpm -F swarmx-dashboard vitest run      (≥52 passing)
[ ] 5. vitest api       — pnpm -F swarmx-api vitest run            (grows from Priority 4)
[ ] 6. regressions      — 5 scripts, all exit 0 (no Ollama/Redis needed)
[ ] 7. dashboard build  — pnpm -F swarmx-dashboard next build      (10+ routes, zero errors)
[ ] 8. invariants       — console.* → zero hits; process.env[ → ≤10 hits
```

**Gate 8 — Invariant Check Commands:**
```bash
# console.* invariant (must return zero output)
grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes
# → zero hits required; any hit is a CRITICAL violation

# env schema coverage (post Priority 3)
grep -rn 'process\.env\[' apps/swarmx-api/src/services apps/swarmx-api/src/routes
# → ≤10 hits; each must be documented as an intentional escape hatch

# TONE_RULES completeness (Priority 6)
grep -A 40 'TONE_RULES' apps/swarmx-api/src/services/video-orchestrator.ts | \
  grep -E "contrarian|urgent|educational|cinematic|warm|minimal|faceless_broll|kinetic_text"
# → all 8 tone variants must appear
```

---

## GitHub Actions CI — Production Configuration

`.github/workflows/ci.yml` — Target: Priority 2 milestone

```yaml
name: SwarmXQ CI

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

env:
  # Node version pinned to match local dev environment
  NODE_VERSION: "20"
  PNPM_VERSION: "9"

jobs:
  quality-gate:
    name: SwarmXQ Quality Gate (8 checks)
    runs-on: ubuntu-latest
    timeout-minutes: 20

    steps:
      # ── Setup ────────────────────────────────────────────────────────────────
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: ${{ env.PNPM_VERSION }}

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: ${{ env.NODE_VERSION }}
          cache: "pnpm"

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      # ── Gate 1–3: TypeScript ──────────────────────────────────────────────
      - name: "[Gate 1] API TypeScript"
        run: pnpm -F swarmx-api tsc --noEmit

      - name: "[Gate 2] Types TypeScript"
        run: pnpm -F swarmx-types tsc --noEmit

      - name: "[Gate 3] Dashboard TypeScript"
        run: pnpm -F swarmx-dashboard tsc --noEmit

      # ── Gate 4–5: Tests ───────────────────────────────────────────────────
      - name: "[Gate 4] Vitest — Dashboard (≥52 required)"
        run: pnpm -F swarmx-dashboard vitest run

      - name: "[Gate 5] Vitest — API (0+ accepted; grows from Priority 4)"
        run: pnpm -F swarmx-api vitest run
        continue-on-error: false  # flip to false once Priority 4 ships

      # ── Gate 6: Regression Scripts ────────────────────────────────────────
      # These scripts require NO Ollama and NO Redis — pure offline logic tests.
      # They test: timeout config, video pipeline state machine, model eviction
      # metrics, system health shape, and reasoning sanitizer edge cases.
      - name: "[Gate 6a] Regression: adaptive-timeout"
        run: npx tsx apps/swarmx-api/scripts/adaptive-timeout-regression.ts

      - name: "[Gate 6b] Regression: video-pipeline"
        run: npx tsx apps/swarmx-api/scripts/video-regression-check.ts

      - name: "[Gate 6c] Regression: eviction-metrics"
        run: npx tsx apps/swarmx-api/scripts/eviction-metric-regression.ts

      - name: "[Gate 6d] Regression: system-health"
        run: npx tsx apps/swarmx-api/scripts/system-health-regression.ts

      - name: "[Gate 6e] Regression: reasoning-sanitizer"
        run: npx tsx apps/swarmx-api/scripts/reasoning-sanitizer-regression.ts

      # ── Gate 7: Dashboard Build ────────────────────────────────────────────
      - name: "[Gate 7] Dashboard next build (10+ routes, zero errors)"
        run: pnpm -F swarmx-dashboard next build
        env:
          # Stub all API-dependent env vars for build-time validation
          NEXT_PUBLIC_API_URL: "http://localhost:3001"

      # ── Gate 8: Invariant Checks ──────────────────────────────────────────
      - name: "[Gate 8a] console.* zero-tolerance check"
        run: |
          HITS=$(grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes 2>/dev/null | wc -l)
          if [ "$HITS" -gt 0 ]; then
            echo "❌ CRITICAL: $HITS console.* hits found in services/routes"
            grep -rn 'console\.' apps/swarmx-api/src/services apps/swarmx-api/src/routes
            exit 1
          fi
          echo "✅ console.* invariant: zero hits"

      - name: "[Gate 8b] Whitespace check"
        run: git diff --check

      - name: "[Gate 8c] TONE_RULES completeness"
        run: |
          TONES="contrarian urgent educational cinematic warm minimal faceless_broll kinetic_text"
          MISSING=""
          for tone in $TONES; do
            if ! grep -q "\"$tone\"" apps/swarmx-api/src/services/video-orchestrator.ts 2>/dev/null; then
              MISSING="$MISSING $tone"
            fi
          done
          if [ -n "$MISSING" ]; then
            echo "⚠️  WARNING: Missing TONE_RULES variants:$MISSING"
            echo "Add these before merging creative quality changes."
            # Non-blocking until Priority 6 ships; change exit to 1 after Priority 6
            exit 0
          fi
          echo "✅ TONE_RULES completeness: all 8 variants present"
```

---

## pnpm Store Caching Strategy

The cache key must include `pnpm-lock.yaml` to invalidate on dependency changes.
Without the lock file, stale installs cause intermittent CI failures.

```yaml
# Included in setup-node step above via cache: "pnpm"
# Manual cache approach if needed:
- name: Get pnpm store directory
  shell: bash
  run: |
    echo "STORE_PATH=$(pnpm store path --silent)" >> $GITHUB_ENV

- uses: actions/cache@v4
  name: Setup pnpm cache
  with:
    path: ${{ env.STORE_PATH }}
    key: ${{ runner.os }}-pnpm-store-${{ hashFiles('**/pnpm-lock.yaml') }}
    restore-keys: |
      ${{ runner.os }}-pnpm-store-
```

---

## Offline CI Protocol

Gates 1–5, 8 and all 5 regression scripts run completely offline.
Gate 7 (`next build`) requires only local packages.

**What CANNOT run in CI without additional setup:**
- Anything requiring a live Ollama instance (live inference tests)
- Anything requiring a live Redis connection (integration tests with BullMQ)
- The `video-render-smoke.ts` script (requires FFmpeg binary)

Document all CI-skipped gates explicitly in the workflow with a comment block.
Never mark a skipped gate as passing — add a `if: false` condition with a comment.

---

## CHANGELOG Protocol

Every milestone commit must update `CHANGELOG.md` in this format:

```markdown
## [V6.x.y] — YYYY-MM-DD

### feat(video): <milestone name>

**What shipped:**
- [specific change 1]
- [specific change 2]

**Files changed:** N files

**Quality gate results:**
- [x] api tsc
- [x] types tsc
- [x] dashboard tsc
- [x] vitest dashboard (N passing)
- [x] vitest api (N passing / skipped: offline)
- [x] 5 regression scripts
- [x] dashboard next build
- [x] invariants clean
- [ ] Gate 8c TONE_RULES: skipped — Priority 6 not yet shipped

**Skipped gates (reason):**
- Redis not available in session → BullMQ regression skipped
```

---

## Branch Protection Requirements

When configuring `main` branch protection:

```
Required status checks:
  ✅ SwarmXQ CI / Quality Gate (8 checks)

Required approvals: 1 (when team ≥ 2)
Dismiss stale reviews: true
Require up-to-date branches: true
Include administrators: true

Block direct pushes to main: true
Block force pushes: true
```

---

## Release Tagging Convention

```bash
# Tag format: v<MAJOR>.<MINOR>.<PATCH>
# Major: architectural milestone (pipeline redesign, new LLM provider)
# Minor: new feature or milestone completion
# Patch: bug fix or invariant correction

git tag -a v6.2.22 -m "feat: 16 GB profile, creative director skill, startup ops"
git push origin v6.2.22
```

---

## Autonomous Scanning — CI/Release Violations

### Critical (fix before committing anything else)
- CI `ci.yml` missing Gate 8a (`console.*` check) → add invariant step
- Regression scripts running in wrong order → enforce sequential, not parallel
- `pnpm install` not using `--frozen-lockfile` → add flag; a dirty install masks dep drift
- Gate 5 set to `continue-on-error: true` when API unit tests exist → flip to false
- CHANGELOG.md not updated in a milestone commit → add entry before tagging

### High Impact (add to next session queue if found)
- No `timeout-minutes` on CI job → runaway job consumes GH Actions minutes
- No Ollama stub for offline regression scripts → scripts that assume Ollama is down need explicit offline guard
- Missing branch protection on `main` → direct pushes bypass gate
- No pnpm cache key including `pnpm-lock.yaml` → stale cache causes intermittent failures

### Medium Impact (log to memory note)
- CI job name not aligned with gate numbering → confusing failure messages
- CHANGELOG format inconsistent across milestones → standardize on the template above
- No artifact upload of `next build` output → cannot inspect build failures post-run
