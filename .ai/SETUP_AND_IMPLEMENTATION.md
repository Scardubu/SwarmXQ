# SwarmXQ AI Skill Suite — Setup & Implementation Guide
## V6.2.21 · APEX-17 r8 · 36 Skills · Claude Code Edition

This guide covers the complete setup of the SwarmXQ AI skill system, including
the critical SwarmXQ platform skills that are NOT included in the generic skill zip.

---

## Overview: What you're setting up

```
SwarmXQ repo root/
├── CLAUDE.md                    ← AI control document (Claude Code reads this first)
├── NEXUS.md                     ← NEXUS orchestration engine
├── .ai/
│   └── skills/                  ← 36 SKILL.md files (34 generic + 2 SwarmXQ-specific)
│       ├── swarmxq-video-pipeline-architect/SKILL.md   ← PROVIDED SEPARATELY
│       ├── swarmxq-model-orchestrator/SKILL.md         ← PROVIDED SEPARATELY
│       └── [34 other skills from generic zip]
└── .claude/
    └── commands/                ← Slash commands for Claude Code
        ├── nexus.md             ← /nexus  — task routing
        ├── video.md             ← /video  — video pipeline deep-dive
        ├── audit.md             ← /audit  — system audit
        └── forge.md             ← /forge  — skill generation
```

---

## Part 1 — Prerequisites

### Claude Code

This skill system is designed for **Claude Code** (the CLI tool), not Claude.ai.
Skills are read from disk during coding sessions, not installed as browser extensions.

```bash
# Verify Claude Code is installed
claude --version

# If not installed:
npm install -g @anthropic-ai/claude-code
```

### Repository baseline

Confirm you are on the correct baseline before installing:

```bash
git log --oneline -3
# Should show V6.2.21 or later as the most recent commit

git status
# Must be clean working tree before proceeding
```

---

## Part 2 — Directory Structure Setup

### Step 1: Create the required directories

From the SwarmXQ repository root:

```bash
mkdir -p .ai/skills
mkdir -p .claude/commands
```

### Step 2: Install CLAUDE.md and NEXUS.md

Place the provided files at the repository root:

```
SwarmXQ-root/
├── CLAUDE.md     ← copy refined version here
└── NEXUS.md      ← already in repo, verify it matches V6.2.21
```

Verify NEXUS.md contains the V6.2.21 verified ground truth section:

```bash
grep -c "V6.2.21" NEXUS.md
# Should return at least 1
```

---

## Part 3 — Installing the 34 Generic Skills

### From the `_ai.zip` archive

The generic skill zip contains 36 entries but **you must install only 34 of them**.
Two skills in the zip are SabiScore-specific and must NOT be placed in SwarmXQ's
`.ai/skills/` directory.

#### Option A — Selective extraction (recommended)

```bash
# Extract all skills from the zip
unzip _ai.zip -d /tmp/ai-extract/

# Copy ALL skills except the SabiScore ones
# Note: glob pattern matching requires [[ ]] (double brackets), not [ ] (single)
for skill in /tmp/ai-extract/.ai/skills/*/; do
  name=$(basename "$skill")
  if [[ "$name" != sabiscore-* ]]; then
    cp -r "$skill" .ai/skills/
    echo "Installed: $name"
  else
    echo "SKIPPED (SabiScore): $name"
  fi
done
```

#### Option B — Manual extraction

```bash
unzip _ai.zip -d /tmp/ai-extract/
cp -r /tmp/ai-extract/.ai/skills/* .ai/skills/

# Then remove the SabiScore skills
rm -rf .ai/skills/sabiscore-betting-engine-auditor/
rm -rf .ai/skills/sabiscore-provider-adapter-architect/
```

### Verify the 34 generic skills are installed

```bash
ls .ai/skills/ | grep -v "swarmxq-" | wc -l
# Must return 34

ls .ai/skills/ | grep "sabiscore"
# Must return nothing (empty)
```

---

## Part 4 — Installing the 2 SwarmXQ Platform Skills

These two skills are the most critical for SwarmXQ and are **not in the generic zip**.
They are provided separately with this guide.

### Step 1: Create skill directories

```bash
mkdir -p .ai/skills/swarmxq-video-pipeline-architect
mkdir -p .ai/skills/swarmxq-model-orchestrator
```

### Step 2: Place the skill files

Copy the provided SKILL.md files:

```bash
# Place provided files:
cp swarmxq-video-pipeline-architect/SKILL.md .ai/skills/swarmxq-video-pipeline-architect/SKILL.md
cp swarmxq-model-orchestrator/SKILL.md       .ai/skills/swarmxq-model-orchestrator/SKILL.md
```

### Step 3: Verify SwarmXQ skills

```bash
ls .ai/skills/ | grep "swarmxq-"
# Must return:
# swarmxq-model-orchestrator
# swarmxq-video-pipeline-architect

grep -l "SINGLE-7B" .ai/skills/swarmxq-model-orchestrator/SKILL.md
# Must return the file path

grep -l "render_assembly" .ai/skills/swarmxq-video-pipeline-architect/SKILL.md
# Must return the file path
```

---

## Part 5 — Installing the Claude Code Commands

### Step 1: Place command files

```bash
cp claude-commands/nexus.md  .claude/commands/nexus.md
cp claude-commands/video.md  .claude/commands/video.md
cp claude-commands/audit.md  .claude/commands/audit.md
cp claude-commands/forge.md  .claude/commands/forge.md
```

### Step 2: Verify commands

```bash
ls .claude/commands/
# Must return:
# audit.md
# forge.md
# nexus.md
# video.md
```

---

## Part 6 — Full Verification Checklist

Run this after completing Parts 1–5:

```bash
echo "=== SwarmXQ Skill Suite Verification ==="

echo ""
echo "--- Checking CLAUDE.md ---"
test -f CLAUDE.md && echo "✓ CLAUDE.md present" || echo "✗ CLAUDE.md MISSING"
grep -q "V6.2.21" CLAUDE.md && echo "✓ CLAUDE.md at V6.2.21 baseline" || echo "✗ CLAUDE.md version mismatch"

echo ""
echo "--- Checking NEXUS.md ---"
test -f NEXUS.md && echo "✓ NEXUS.md present" || echo "✗ NEXUS.md MISSING"

echo ""
echo "--- Counting generic skills (expect 34) ---"
GENERIC_COUNT=$(ls .ai/skills/ | grep -v "^swarmxq-" | wc -l | tr -d ' ')
echo "Generic skills: $GENERIC_COUNT"
[ "$GENERIC_COUNT" -eq 34 ] && echo "✓ Correct count" || echo "✗ Expected 34, got $GENERIC_COUNT"

echo ""
echo "--- Checking SwarmXQ platform skills ---"
test -f .ai/skills/swarmxq-video-pipeline-architect/SKILL.md \
  && echo "✓ swarmxq-video-pipeline-architect installed" \
  || echo "✗ swarmxq-video-pipeline-architect MISSING"

test -f .ai/skills/swarmxq-model-orchestrator/SKILL.md \
  && echo "✓ swarmxq-model-orchestrator installed" \
  || echo "✗ swarmxq-model-orchestrator MISSING"

echo ""
echo "--- Checking SabiScore skills are NOT present (must be empty) ---"
SABISCORE=$(ls .ai/skills/ | grep "^sabiscore-")
[ -z "$SABISCORE" ] \
  && echo "✓ No SabiScore skills present (correct)" \
  || echo "✗ SabiScore skills found — remove them: $SABISCORE"

echo ""
echo "--- Counting total skills (expect 36) ---"
TOTAL=$(ls .ai/skills/ | wc -l | tr -d ' ')
echo "Total skills: $TOTAL"
[ "$TOTAL" -eq 36 ] && echo "✓ Correct total" || echo "✗ Expected 36, got $TOTAL"

echo ""
echo "--- Checking Claude Code commands ---"
for cmd in nexus video audit forge; do
  test -f ".claude/commands/${cmd}.md" \
    && echo "✓ /${cmd} command installed" \
    || echo "✗ /${cmd} command MISSING"
done

echo ""
echo "=== Verification complete ==="
```

All checks must pass before proceeding to Part 7.

---

## Part 7 — Claude Code Configuration

### Recommended `.claude/settings.json`

Create or update `.claude/settings.json` in the repository root:

```json
{
  "model": "claude-opus-4-6",
  "contextFiles": [
    "CLAUDE.md",
    "NEXUS.md"
  ],
  "skillsDirectory": ".ai/skills",
  "commandsDirectory": ".claude/commands",
  "permissions": {
    "allow": [
      "Bash(git:*)",
      "Bash(pnpm:*)",
      "Bash(npx:*)",
      "Bash(grep:*)",
      "Bash(cat:*)",
      "Bash(wc:*)",
      "Bash(awk:*)",
      "Read(**)",
      "Write(apps/**)",
      "Write(packages/**)",
      "Write(src/**)",
      "Write(.ai/skills/**)",
      "Write(.claude/commands/**)",
      "Write(.serena/memories/**)"
    ],
    "deny": [
      "Bash(rm -rf /)",
      "Bash(curl:*)",
      "Bash(wget:*)"
    ]
  }
}
```

### Confirm Claude Code sees the CLAUDE.md

```bash
cd /path/to/SwarmXQ-repo
claude
# First message: "What skills and commands do you have available?"
# Claude should list all 36 skills and 4 commands
```

---

## Part 8 — First Session Protocol

Once setup is complete, start every new Claude Code session with:

### Option A — Full session kickoff via `/audit`

```
/audit
```

Claude will:
1. Load the full audit skill graph
2. Run the invariant scan
3. Verify quality gates
4. Classify all components against V6.2.21 ground truth
5. Output the audit report with the next milestone recommendation

### Option B — Targeted task via `/nexus`

```
/nexus [describe your task here]

Example:
/nexus Enable BullMQ by default and implement Worker process separation with Redis fallback to in-memory queue
```

Claude will classify the intent, select the minimum skill graph, state a session plan, and wait for your approval before writing code.

### Option C — Video pipeline work via `/video`

```
/video [describe the video pipeline task]

Example:
/video The storyboard_generation stage is not sanitizing DeepSeek think blocks before parsing the JSON output
```

---

## Part 9 — Skill Usage Reference

### How Claude Code reads skills

Claude Code reads `CLAUDE.md` first on session start. When NEXUS routes a task,
it reads the selected SKILL.md files from `.ai/skills/[skill-name]/SKILL.md`.
Skills are read on-demand — not preloaded into context.

### Skill chain recipes for SwarmXQ

#### "Video Pipeline Audit" — pre-commit check
```
/nexus audit the video-orchestrator.ts and video-queue.ts for all Critical invariant violations
```
Skills loaded: `swarmxq-video-pipeline-architect` → `swarmxq-model-orchestrator` → `backend-systems-auditor`

#### "BullMQ Default-On" — Priority 1 milestone
```
/nexus enable SWARMX_VIDEO_USE_BULLMQ=1 by default with Worker separation and Redis fallback to in-memory queue
```
Skills loaded: `bullmq-job-architect` → `swarmxq-video-pipeline-architect` → `backend-systems-auditor` → `testing-strategy-architect`

#### "GitHub Actions CI" — Priority 2 milestone
```
/nexus create .github/workflows/ci.yml covering all 8 quality gates with pnpm cache
```
Skills loaded: `git-workflow-architect` → `testing-strategy-architect` → `release-incident-operations-architect`

#### "16 GB Profile" — Priority 5 milestone
```
/nexus write startup-enhanced.sh to activate dual-model residency and Pilot keep-alive for the 16 GB host
```
Skills loaded: `swarmxq-model-orchestrator` → `swarmxq-video-pipeline-architect` → `backend-systems-auditor`

#### "Dashboard UI Polish"
```
/nexus the virality score panel needs circular gauges per dimension with color-coded thresholds
```
Skills loaded: `swarmxq-video-pipeline-architect` → `data-visualization-architect` → `frontend-product-design-architect` → `accessibility-system-architect`

#### "Security Hardening"
```
/nexus perform a full security audit of the video API routes and rate-limit implementation
```
Skills loaded: `security-hardening-auditor` → `backend-systems-auditor` → `api-contract-governance-architect`

---

## Part 10 — Memory System Integration

SwarmXQ uses Serena for cross-session memory. After each session:

### Write a session memory note

```bash
# Template at templates/memory-note.md — fill in and save as:
.serena/memories/project_v<VERSION>.md
```

Required fields:
- **Shipped** — commits, version, files changed
- **Quality gate results** — what passed, what was skipped and why
- **Host profile** — RAM at start, Ollama status, `startup-enhanced.sh` active?
- **Runtime pivots** — what changed from the plan
- **New invariants discovered**
- **Remaining work** — next session starting point

### Update the memory index

```bash
echo "project_v<VERSION>.md — <YYYY-MM-DD> — <one-sentence summary>" >> .serena/memories/MEMORY.md
```

### Session opener reads memory first

```bash
cat .serena/memories/MEMORY.md
cat .serena/memories/project_v6.2.21.md   # or most recent
```

---

## Part 11 — Troubleshooting

### Claude isn't using NEXUS before implementing

Cause: CLAUDE.md not found, or "Core Execution Rule" section is missing.

Fix:
```bash
# Verify CLAUDE.md is at repo root (not in a subdirectory)
ls -la CLAUDE.md

# Verify the mandatory entry point section is present
grep -c "MANDATORY SKILL ENTRY POINT" CLAUDE.md
# Must return 1
```

### A skill isn't being activated

Cause: The trigger phrase in the task isn't matching the skill's `description` field.

Fix: Use a more specific trigger phrase from the skill's frontmatter:
```bash
# Check what triggers a skill
grep -A 5 "Triggers:" .ai/skills/swarmxq-model-orchestrator/SKILL.md
```

Or explicitly request the skill:
```
/nexus [task description] — use swarmxq-model-orchestrator
```

### SwarmXQ skills not found

```bash
ls .ai/skills/ | grep "swarmxq-"
# If empty, the skills weren't installed — re-run Part 4
```

### SabiScore skills were accidentally installed

```bash
ls .ai/skills/ | grep "sabiscore-"
# If any returned, remove them:
rm -rf .ai/skills/sabiscore-betting-engine-auditor/
rm -rf .ai/skills/sabiscore-provider-adapter-architect/
```

### Commands not found

```bash
ls .claude/commands/
# If empty or missing entries, re-run Part 5

# Commands must be inside the repository root's .claude/commands/ directory
# NOT at ~/.claude/commands/ (that's the global location)
```

### Quality gates failing after setup

Run the full gate suite to identify which gate is broken:

```bash
pnpm -F swarmx-api tsc --noEmit 2>&1 | head -20
pnpm -F swarmx-dashboard vitest run 2>&1 | tail -20
npx tsx apps/swarmx-api/scripts/video-regression-check.ts
```

If gates were green before setup and are now failing, the CLAUDE.md or skill files
may have been placed incorrectly and Claude Code modified source files during setup.
Restore from git and retry:

```bash
git checkout -- .
# Then repeat Part 2 only (file placement, no source changes)
```

---

---

## Part 12 — Ollama & System Performance Setup

Run this once before the first Claude Code session to configure CPU-only inference optimally.

### Step 1: Place startup-enhanced.sh

Copy the provided `startup-enhanced.sh` to the repository root:

```bash
cp startup-enhanced.sh /path/to/SwarmXQ-root/startup-enhanced.sh
chmod +x startup-enhanced.sh
```

### Step 2: Run startup-enhanced.sh before starting Ollama

```bash
# Source it (not execute) so env vars persist in your shell session
source ./startup-enhanced.sh

# Verify vars are set
echo "NUM_PARALLEL=${OLLAMA_NUM_PARALLEL}"     # must be 1
echo "FLASH=${OLLAMA_FLASH_ATTENTION}"          # must be 1
echo "KV_TYPE=${OLLAMA_KV_CACHE_TYPE}"          # must be q8_0
echo "THREADS=${OLLAMA_NUM_THREADS}"            # must be 3 (WSL2)
```

### Step 3: Start Ollama (after sourcing startup-enhanced.sh)

```bash
# In a separate terminal (keep the env vars from Step 2 active)
ollama serve &

# Verify Pilot is warmed (takes 30-60 seconds first time)
ollama ps
# Should show: instruct-phi4-pro-q8-prod  ... (running)
```

### Step 4: Verify Ollama is accessible from the API

```bash
curl http://localhost:11434/api/tags
# Should return JSON with model list including instruct-phi4-pro-q8-prod
```

### WSL2 Performance Note

**Windows Defender / antivirus** can reduce Claude Code file-read throughput by 40–60% in WSL2
because it scans files opened from the WSL2 filesystem via the Windows kernel bridge.

Mitigate:
```powershell
# In Windows PowerShell (as Administrator):
Add-MpPreference -ExclusionPath "\\wsl$\Ubuntu\home\[your-user]\SwarmXQ"
# Replace with your actual WSL2 path
```

Additionally: run Claude Code from within the WSL2 terminal (not Windows Terminal → WSL2).
Launching `claude` from a native WSL2 terminal avoids the Windows filesystem bridge entirely.

---

## Quick Reference: File Locations

| File | Path in repository |
|---|---|
| AI control document | `CLAUDE.md` |
| NEXUS orchestrator | `NEXUS.md` |
| SwarmXQ video skill | `.ai/skills/swarmxq-video-pipeline-architect/SKILL.md` |
| SwarmXQ model skill | `.ai/skills/swarmxq-model-orchestrator/SKILL.md` |
| Generic skills (34) | `.ai/skills/<skill-name>/SKILL.md` |
| /nexus command | `.claude/commands/nexus.md` |
| /video command | `.claude/commands/video.md` |
| /audit command | `.claude/commands/audit.md` |
| /forge command | `.claude/commands/forge.md` |
| Session memory index | `.serena/memories/MEMORY.md` |
| Session memory notes | `.serena/memories/project_v<VERSION>.md` |
| **16 GB startup script** | `startup-enhanced.sh` ← **source before starting Ollama** |
| Claude Code settings | `.claude/settings.json` |
