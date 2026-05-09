/**
 * agentSeed — Bootstrap the in-memory agent registry from agents/catalog.yaml.
 *
 * The registry starts empty on every cold boot. Without this service,
 * the dashboard shows "Active agents: 0" until the Python orchestrator
 * actually runs jobs and PATCHes agent state. This service eliminates
 * that gap by seeding all catalog agents as `idle` on startup.
 */

import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { agentRegistry } from "../routes/agents.js";
import type { AgentState } from "../types/events.js";

function resolveModelAlias(alias: string): string {
  const modelFast =
    process.env["SWARMX_MODEL_FAST"] ??
    process.env["SWARMX_COMPOSER_MODEL"] ??
    "phi4-fast";
  const modelCode =
    process.env["SWARMX_MODEL_CODE"] ?? "qwen-worker";
  const modelReason =
    process.env["SWARMX_MODEL_REASON"] ??
    process.env["SWARMX_MODEL_REASONER"] ??
    "deepseek-reasoner";

  switch (alias.toLowerCase()) {
    case "fast": return modelFast;
    case "code": return modelCode;
    case "reason": return modelReason;
    default: return alias;
  }
}

interface CatalogAgent {
  name: string;
  model: string;
  skillTags: string[];
}

function parseCatalog(raw: string): CatalogAgent[] {
  const agents: CatalogAgent[] = [];
  const lines = raw.split(/\r?\n/);

  let inAgentsList = false;
  let current: Partial<CatalogAgent> | null = null;
  let inSkillTags = false;

  for (const line of lines) {
    if (/^agents:/.test(line)) {
      inAgentsList = true;
      continue;
    }

    if (!inAgentsList) continue;

    if (/^[a-z]/.test(line) && !/^-/.test(line)) {
      inAgentsList = false;
      if (current?.name) {
        agents.push({ name: current.name, model: current.model ?? "fast", skillTags: current.skillTags ?? [] });
      }
      current = null;
      continue;
    }

    const agentStart = /^- name:\s+(.+)$/.exec(line);
    if (agentStart) {
      if (current?.name) {
        agents.push({ name: current.name, model: current.model ?? "fast", skillTags: current.skillTags ?? [] });
      }
      const agentName = agentStart[1];
      if (!agentName) continue;
      current = { name: agentName.trim(), model: "fast", skillTags: [] };
      inSkillTags = false;
      continue;
    }

    if (!current) continue;

    // Detect skill_tags list entry
    if (/^\s+skill_tags:/.test(line)) {
      inSkillTags = true;
      continue;
    }

    if (inSkillTags) {
      const tagMatch = /^\s+-\s+(.+)$/.exec(line);
      if (tagMatch) {
        const tag = tagMatch[1];
        if (tag) (current.skillTags ??= []).push(tag.trim());
        continue;
      } else if (!/^\s/.test(line) || /^\s+\w+:/.test(line)) {
        inSkillTags = false;
      }
    }

    const modelMatch = /^\s+model:\s+(.+)$/.exec(line);
    if (modelMatch) {
      const modelAlias = modelMatch[1];
      if (modelAlias) current.model = modelAlias.trim();
    }
  }

  if (current?.name) {
    agents.push({ name: current.name, model: current.model ?? "fast", skillTags: current.skillTags ?? [] });
  }

  return agents;
}

function locateCatalogCandidates(): string[] {
  const repoRoot = resolve(process.env["SWARMX_REPO_ROOT"] ?? process.cwd());
  return [
    join(repoRoot, "agents", "catalog.yaml"),
    join(repoRoot, "..", "agents", "catalog.yaml"),
    join(repoRoot, "..", "..", "agents", "catalog.yaml"),
  ];
}

const ROLE_MAP: Record<string, string> = {
  strategist: "Routing & planning strategy",
  "design-critic": "UX critique & accessibility audit",
  "mcp-toolsmith": "MCP tool design & integration",
  "frontend-architect": "Frontend architecture & UI systems",
  "tournament-judge": "Evolution tournament evaluation",
  "context-researcher": "Context research & knowledge synthesis",
  "research-analyst": "Deep research & literature analysis",
  "skill-librarian": "Skill library curation & retrieval",
  "qa-evaluator": "Quality assurance & test evaluation",
  "chief-architect": "System architecture & technical leadership",
  "subagent-coordinator": "Sub-agent orchestration & delegation",
  evolver: "Autonomous system evolution",
  "performance-optimizer": "Performance analysis & optimization",
  "perf-optimizer": "Performance profiling & tuning",
  "data-engineer": "Data pipeline & ETL engineering",
  "workflow-composer": "Workflow composition & orchestration",
  "prompt-architect": "Prompt engineering & optimization",
  "backend-engineer": "Backend systems & API engineering",
  "skill-curator": "Skill discovery & lifecycle management",
  evaluator: "Output evaluation & scoring",
  "memory-curator": "Memory graph curation & retrieval",
  "release-manager": "Release coordination & deployment",
  "risk-sentinel": "Risk detection & policy enforcement",
  "security-reviewer": "Security review & code audit",
  "security-auditor": "Deep security audit & threat modelling",
  "benchmark-analyst": "Benchmark design & performance analysis",
  "incident-commander": "Incident response & escalation",
  "workflow-router": "Workflow routing & dispatch",
  reviewer: "Peer review & feedback",
  producer: "Content & artifact production",
  "environment-governor": "Environment lifecycle & resource governance",
};

function deriveRole(name: string): string {
  return ROLE_MAP[name] ?? `${name.replace(/-/g, " ")} agent`;
}

// ── Static catalog snapshot (fallback when catalog.yaml not found) ────────────
// [SEED-01] Matches agents/catalog.yaml as of v2026.06
const STATIC_CATALOG_SNAPSHOT = `
agents:
- name: strategist
  model: fast
- name: design-critic
  model: fast
- name: mcp-toolsmith
  model: code
- name: frontend-architect
  model: code
- name: tournament-judge
  model: fast
- name: context-researcher
  model: reason
- name: research-analyst
  model: reason
- name: skill-librarian
  model: fast
- name: qa-evaluator
  model: code
- name: chief-architect
  model: reason
- name: subagent-coordinator
  model: reason
- name: evolver
  model: reason
- name: performance-optimizer
  model: code
- name: perf-optimizer
  model: code
- name: data-engineer
  model: code
- name: workflow-composer
  model: reason
- name: prompt-architect
  model: reason
- name: backend-engineer
  model: code
- name: skill-curator
  model: fast
- name: evaluator
  model: fast
- name: memory-curator
  model: fast
- name: release-manager
  model: code
- name: risk-sentinel
  model: fast
- name: security-reviewer
  model: code
- name: security-auditor
  model: reason
- name: benchmark-analyst
  model: reason
- name: incident-commander
  model: reason
- name: workflow-router
  model: fast
- name: reviewer
  model: fast
- name: producer
  model: fast
- name: environment-governor
  model: code
`;

async function seedFromCatalog(server: FastifyInstance): Promise<number> {
  const candidates = locateCatalogCandidates();

  let raw: string | null = null;
  let catalogPath: string | null = null;
  for (const candidate of candidates) {
    try {
      raw = await readFile(candidate, "utf8");
      catalogPath = candidate;
      break;
    } catch {
      // try next candidate
    }
  }

  if (!raw || !catalogPath) {
    server.log.warn({ tried: candidates }, "[agentSeed] catalog.yaml not found — using static snapshot");
    raw = STATIC_CATALOG_SNAPSHOT;
    catalogPath = "<static-snapshot>";
  }

  const catalog = parseCatalog(raw);
  if (catalog.length === 0) {
    server.log.warn({ catalogPath }, "[agentSeed] catalog parse produced 0 agents");
    return 0;
  }

  let seeded = 0;
  for (const entry of catalog) {
    if (agentRegistry.has(entry.name)) continue;

    const agent: AgentState = {
      id: entry.name,
      name: entry.name
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" "),
      role: deriveRole(entry.name),
      model: resolveModelAlias(entry.model),
      status: "idle",
      currentTask: "standby",
      cgroupPath: `/sys/fs/cgroup/swarmx.slice/agent-${entry.name}.scope`,
    };

    agentRegistry.set(entry.name, agent);
    seeded++;
  }

  server.log.info(
    { catalogPath, total: catalog.length, seeded, skipped: catalog.length - seeded },
    "[agentSeed] Agent registry seeded from catalog",
  );

  return seeded;
}

export function startAgentSeedService(server: FastifyInstance): void {
  setTimeout(() => {
    void seedFromCatalog(server).catch((err) => {
      server.log.warn({ err }, "[agentSeed] Initial seed failed");
    });
  }, 500);

  process.on("SIGHUP", () => {
    server.log.info("[agentSeed] SIGHUP received — reloading agent catalog");
    void seedFromCatalog(server).catch(() => {
      // best effort
    });
  });

  server.log.info(
    { catalogPath: locateCatalogCandidates()[0] },
    "[agentSeed] Agent seed service registered",
  );
}
