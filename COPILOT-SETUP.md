# SwarmXQ — GitHub Copilot & Codex Setup Guide
# V6.2.22 · APEX-17 r8 · 16 GB RAM Profile

Complete instructions for configuring GitHub Copilot and OpenAI Codex to leverage
the SwarmXQ 38-skill system, NEXUS routing, and V6.2.22 architectural constraints.

---

## PREREQUISITES

```bash
# Verify environment
node --version          # must be ≥20
pnpm --version          # must be ≥9
git --version           # ≥2.x
ollama --version        # must be installed (https://ollama.ai)
awk '/MemAvailable/ {printf "%d MB\n", $2/1024}' /proc/meminfo  # must be ≥8000 MB
```

**VS Code version:** 1.90+ (Copilot Chat requires 1.85+)

---

## STEP 1 — INSTALL GITHUB COPILOT

### VS Code Extension

```bash
# Install via VS Code CLI
code --install-extension GitHub.copilot
code --install-extension GitHub.copilot-chat

# Verify installation
code --list-extensions | grep -i copilot
# Expected:
# GitHub.copilot
# GitHub.copilot-chat
```

### Authenticate

1. Open VS Code → Click the Copilot icon (bottom status bar)
2. Select **Sign in to GitHub**
3. Complete OAuth flow in browser
4. Return to VS Code — status bar should show ✓ Copilot

### Verify Copilot is reading repository instructions

```bash
# The instructions file must exist at this exact path:
ls -la .github/copilot-instructions.md

# Open Copilot Chat in VS Code:
# Ctrl+Shift+I (or Cmd+Shift+I on macOS)
# Type: @workspace What are the SwarmXQ critical invariants?
# → Should reference SINGLE-7B LOCK, console.* zero tolerance, etc.
```

---

## STEP 2 — DEPLOY CONFIGURATION FILES

### 2a. Core instruction files

```bash
# These files are already in .github/ from the upgrade package:
ls .github/copilot-instructions.md   # ← main instructions (replaced old V2026.5.20)
ls .github/copilot-context.md         # ← new: quick reference + skill integration

# Verify key sections are present
grep "APEX-17 r8" .github/copilot-instructions.md | head -3
grep "16 GB" .github/copilot-instructions.md | head -3
grep "swarmxq-creative-director" .github/copilot-instructions.md | head -2
```

### 2b. VS Code settings

```bash
# Merge copilot-settings.json into your existing .vscode/settings.json
# Option A: Manual merge (recommended if settings.json has custom content)
cat .vscode/copilot-settings.json  # review, then add to .vscode/settings.json

# Option B: Auto-merge with jq (if jq is available)
jq -s '.[0] * .[1]' .vscode/settings.json .vscode/copilot-settings.json \
  > .vscode/settings_merged.json && mv .vscode/settings_merged.json .vscode/settings.json

# Verify the key setting is active
grep "useInstructionFiles" .vscode/settings.json
# Should show: "github.copilot.chat.codeGeneration.useInstructionFiles": true
```

### 2c. AGENTS.md files (Codex + OpenAI Agents SDK)

```bash
# Root AGENTS.md — governs all Codex tasks
ls AGENTS.md    # ← replaces previous generic version

# Per-package AGENTS.md
ls apps/swarmx-api/AGENTS.md   # ← API-specific Fastify/video pipeline constraints

# The existing .codex/engineering-safety.rules is preserved — do not overwrite
ls .codex/engineering-safety.rules
```

### 2d. SwarmXQ platform skills (if not already installed)

```bash
# Verify the 4 SwarmXQ platform skills exist
ls .ai/skills/swarmxq-video-pipeline-architect/SKILL.md  || echo "MISSING — install from upgrade package"
ls .ai/skills/swarmxq-model-orchestrator/SKILL.md        || echo "MISSING — install from upgrade package"
ls .ai/skills/swarmxq-creative-director/SKILL.md         || echo "MISSING — install from upgrade package"
ls .ai/skills/swarmxq-startup-ops-architect/SKILL.md     || echo "MISSING — install from upgrade package"
ls .ai/skills/swarmxq-ci-release-architect/SKILL.md      || echo "MISSING — install from upgrade package"
```

---

## STEP 3 — CONFIGURE COPILOT INSTRUCTION FILES

GitHub Copilot reads instruction files in order of specificity. Configure all three levels:

### Repository-level (already deployed above)

`.github/copilot-instructions.md` — applied to all Copilot Chat conversations in this repo.

### Workspace-level (optional — for VS Code workspaces)

```jsonc
// .vscode/your-workspace.code-workspace
{
  "settings": {
    "github.copilot.chat.codeGeneration.instructions": [
      { "file": "${workspaceFolder}/.github/copilot-instructions.md" },
      { "file": "${workspaceFolder}/.github/copilot-context.md" }
    ]
  }
}
```

### VS Code user-level (global fallback)

Open VS Code Settings (JSON) → `Ctrl+Shift+P` → "Open User Settings (JSON)":

```jsonc
{
  "github.copilot.chat.codeGeneration.instructions": [
    {
      "text": "This is a SwarmXQ project. Always check .github/copilot-instructions.md for project-specific invariants before generating code."
    }
  ]
}
```

---

## STEP 4 — CONFIGURE CODEX / OPENAI AGENTS

### For OpenAI Codex CLI (if using)

```bash
# Install Codex CLI (if not already installed)
npm install -g @openai/codex

# Codex reads AGENTS.md automatically when present
# Verify it's at the repo root
ls AGENTS.md

# Test Codex reads the constraints
codex "what are the critical invariants for model calls in SwarmXQ?"
# Should reference: SINGLE-7B LOCK, sanitizeReasoningOutput(), resolveCanonicalTag()
```

### For OpenAI Assistants API / Agents SDK

```python
# If building custom agents, attach the relevant AGENTS.md as context:
with open("AGENTS.md") as f:
    swarmxq_constraints = f.read()

with open(".ai/skills/swarmxq-video-pipeline-architect/SKILL.md") as f:
    pipeline_skill = f.read()

assistant = client.beta.assistants.create(
    name="SwarmXQ Dev Assistant",
    instructions=f"{swarmxq_constraints}\n\n{pipeline_skill}",
    model="gpt-4o"
)
```

### For ChatGPT Code Interpreter (manual workflow)

When starting a SwarmXQ coding session in ChatGPT:

```
1. Upload: CLAUDE.md, NEXUS.md, and the relevant .ai/skills/[skill]/SKILL.md
2. Paste this in your first message:

"Read all uploaded files before responding. You are assisting with the SwarmXQ
codebase (V6.2.22, APEX-17 r8). Enforce all invariants from CLAUDE.md —
especially SINGLE-7B LOCK, console.* zero tolerance, resolveCanonicalTag(),
sanitizeReasoningOutput(), and the video stage immutable order.
Use the SKILL.md file for domain-specific constraints."
```

---

## STEP 5 — USING SKILLS IN COPILOT CHAT

The `.ai/skills/` files contain domain-expert constraints. Reference them in
Copilot Chat using the `#file` syntax:

### Pattern 1: Single-domain task

```
@workspace #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md
Add a timeout guard to the storyboard_generation stage that respects the
adaptive-timeout-config circuit breaker.
```

### Pattern 2: Cross-domain task (load multiple skills)

```
@workspace
  #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md
  #file:.ai/skills/swarmxq-model-orchestrator/SKILL.md
  #file:.ai/skills/swarmxq-creative-director/SKILL.md
The scripting stage needs to enforce TONE_RULES and pass the script through
sanitizeReasoningOutput(). Show me the correct implementation pattern.
```

### Pattern 3: Invariant audit

```
@workspace #file:.github/copilot-instructions.md
  #file:apps/swarmx-api/src/services/video-orchestrator.ts
Audit this file for all 12 SwarmXQ critical invariants from copilot-instructions.md.
Report any violations as Critical, High, or Medium.
```

### Pattern 4: Code generation with context

```
@workspace #file:.github/copilot-context.md
  #file:packages/swarmx-types/src/operator-map.ts
Generate a new route handler for POST /api/video/resume that:
- calls requireVideoWriteAuth()
- validates body with Zod
- uses resolveCanonicalTag() for any model tag in the body
- returns typed VideoJob
```

### Pattern 5: Full task orchestration (mirrors /nexus command)

```
@workspace #file:NEXUS.md #file:CLAUDE.md
I need to implement BullMQ default-on (Priority 1 milestone). Route this task through
NEXUS and tell me which skills to load and in what order.
```

---

## STEP 6 — VERIFY INTEGRATION

Run all of these to confirm Copilot + Codex are correctly configured:

### Test 1: Copilot reads hardware profile

```
# In Copilot Chat:
@workspace What is the correct OLLAMA_MAX_LOADED_MODELS value and why?
# Expected: "2 on 16 GB — allows Pilot + one 7B resident; was 1 on 8 GB"
```

### Test 2: Copilot rejects legacy tags

```
# In Copilot Chat:
@workspace Should I use phi4-fast-scar or instruct-phi4-pro-q8-prod in a service?
# Expected: "instruct-phi4-pro-q8-prod (Pilot) — phi4-fast-scar is a forbidden V5 legacy alias"
```

### Test 3: Copilot knows skill routing

```
# In Copilot Chat:
@workspace Which skill file governs changes to TONE_RULES in video-orchestrator.ts?
# Expected: ".ai/skills/swarmxq-creative-director/SKILL.md"
```

### Test 4: Copilot knows video stage invariants

```
# In Copilot Chat:
@workspace What must be called before every 7B model load in the video pipeline?
# Expected: "evictIncompatible() from ModelOrchestrator"
```

### Test 5: Codex reads AGENTS.md

```bash
# If using Codex CLI:
codex "What happens if console.log appears in apps/swarmx-api/src/services/?"
# Expected: references CRITICAL invariant, suggests log.* from logger.ts
```

---

## STEP 7 — COPILOT FOR CI (Priority 2 MILESTONE)

GitHub Copilot Workspace can draft `.github/workflows/ci.yml`:

```
# In GitHub Copilot Workspace or Copilot Chat with repository access:
@workspace #file:.ai/skills/swarmxq-ci-release-architect/SKILL.md
  #file:.github/copilot-instructions.md

Draft .github/workflows/ci.yml that implements all 8 SwarmXQ quality gates:
1. api tsc --noEmit
2. types tsc --noEmit
3. dashboard tsc --noEmit
4. dashboard vitest run (≥52)
5. api vitest run
6. 5 regression scripts (no Ollama/Redis needed)
7. dashboard next build
8. console.* invariant check (must return zero hits)

Use ubuntu-latest, pnpm@9, Node 20, pnpm store cache keyed on pnpm-lock.yaml.
```

---

## QUICK REFERENCE — COPILOT CHAT COMMANDS

| Goal | Copilot Chat command |
|---|---|
| Load full project context | `@workspace #file:.github/copilot-instructions.md` |
| Video pipeline question | `@workspace #file:.ai/skills/swarmxq-video-pipeline-architect/SKILL.md [question]` |
| Model orchestration question | `@workspace #file:.ai/skills/swarmxq-model-orchestrator/SKILL.md [question]` |
| Creative quality question | `@workspace #file:.ai/skills/swarmxq-creative-director/SKILL.md [question]` |
| Startup/Ollama perf question | `@workspace #file:.ai/skills/swarmxq-startup-ops-architect/SKILL.md [question]` |
| CI gate question | `@workspace #file:.ai/skills/swarmxq-ci-release-architect/SKILL.md [question]` |
| Full task routing | `@workspace #file:NEXUS.md [task description]` |
| Invariant audit | `@workspace #file:.github/copilot-instructions.md Audit [file] for invariants` |
| Commit message | `/commit` → Copilot reads `.github/copilot-instructions.md` for convention |
| PR description | `/pr-description` → uses pull request generation instructions |

---

## TROUBLESHOOTING

### Copilot not reading instructions

```bash
# Verify the file is committed and at the correct path
git ls-files .github/copilot-instructions.md   # must return the file path
git ls-files .github/copilot-context.md

# Check VS Code setting is enabled
cat .vscode/settings.json | grep useInstructionFiles
# Must show: "github.copilot.chat.codeGeneration.useInstructionFiles": true

# Restart VS Code after settings changes
```

### Copilot suggesting legacy model tags

```bash
# The instructions are loaded but Copilot may fall back to training data.
# Add an explicit constraint in the chat:
@workspace #file:.github/copilot-instructions.md
Note: never suggest -scar suffix model tags. Use only APEX-17 r8 canonical tags
from packages/swarmx-types/src/operator-map.ts
```

### Codex not reading AGENTS.md

```bash
# AGENTS.md must be at the repo root
ls -la AGENTS.md

# For Codex CLI, verify it's in the working directory
pwd && ls AGENTS.md

# If using Codex within a pnpm workspace package, ensure AGENTS.md is in
# the package directory (apps/swarmx-api/AGENTS.md) as well as root
```

### Skills not found

```bash
# Check the .ai/skills/ directory is populated
ls .ai/skills/ | grep swarmxq
# Expected:
# swarmxq-ci-release-architect
# swarmxq-creative-director
# swarmxq-model-orchestrator
# swarmxq-startup-ops-architect
# swarmxq-video-pipeline-architect

# If missing, install from the upgrade package:
cp -r swarmxq-upgrade/.ai/skills/swarmxq-*  .ai/skills/
```

---

## FILE DEPLOYMENT SUMMARY

```
DEPLOY THESE FILES:
──────────────────────────────────────────────────────────────────
.github/copilot-instructions.md     ← REPLACE existing file
.github/copilot-context.md          ← NEW
.vscode/copilot-settings.json       ← NEW (merge into settings.json)
AGENTS.md                           ← REPLACE existing file
apps/swarmx-api/AGENTS.md          ← NEW

ALREADY DEPLOYED (from previous upgrade session):
──────────────────────────────────────────────────────────────────
CLAUDE.md                           ← V6.2.22 (replaced V6.2.21)
NEXUS.md                            ← v2.2 (replaced v2.1)
.ai/skills/swarmxq-creative-director/SKILL.md
.ai/skills/swarmxq-startup-ops-architect/SKILL.md
.ai/skills/swarmxq-model-orchestrator/SKILL.md
.ai/skills/swarmxq-video-pipeline-architect/SKILL.md
.ai/skills/swarmxq-ci-release-architect/SKILL.md
.claude/commands/video.md
.claude/commands/model-ops.md
.claude/commands/nexus.md
.claude/commands/forge.md

DO NOT MODIFY:
──────────────────────────────────────────────────────────────────
.codex/engineering-safety.rules     ← preserved as-is
.agents/skills/                     ← Copilot Workspace skills (separate system)
```
