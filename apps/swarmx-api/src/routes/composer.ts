import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { agentRegistry } from "./agents.js";
import {
  getOllamaBaseUrl,
  getAvailableModels,
  getConfiguredModels,
  checkOllamaHealth,
} from "../services/ollama.js";

import {
  getAdaptiveCallConfig,
  getAvailableRamMb,
  getJitteredDelayMs,
  currentPressureLevel,
  withTimeout,
  recordSuccess,
  recordFailure,
  jitteredDelay,
  type OperationKey,
  type ModelCallOverrides,
} from "../services/adaptive-timeout-config.js";
import {
  setActiveModel,
  recordLatency,
  recordTokens,
  recordTimeout,
} from "../services/swarm-pressure-monitor.js";
import {
  sanitizeReasoningOutput,
  extractJson,
} from "../services/reasoning-sanitizer.js";
import { getModelOrchestrator } from "../services/model-orchestrator.js";
import { resolveCanonicalTag } from "@swarmx/types/operator-map";
import { loadEnv } from "../lib/env.js";

type ComposerAgent = {
  id: string;
  name: string | undefined;
  status: string;
  role: string | undefined;
  currentTask: string | undefined;
  lastError?: string;
  resource?: {
    cpuPercent?: number;
  } | null;
};

type TimeoutBucket = "lt5s" | "lt15s" | "lt30s" | "lt45s" | "gte45s";

type PromptComplexity = "light" | "standard" | "deep";

type CircuitState = "closed" | "open" | "half-open";

type WorkflowRunStatus = "queued" | "running" | "success" | "failed" | "cancelled";

interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  status: WorkflowRunStatus;
  createdAt: string;
  updatedAt: string;
}

const _ce = loadEnv();
const TIMEOUT_HISTOGRAM_LOG_EVERY  = _ce.SWARMX_COMPOSER_TIMEOUT_HISTO_LOG_EVERY;
const COMPOSER_RETRY_MAX_ATTEMPTS  = Math.max(1, _ce.SWARMX_COMPOSER_RETRY_MAX_ATTEMPTS);
const COMPOSER_RETRY_BASE_DELAY_MS = Math.max(50, _ce.SWARMX_COMPOSER_RETRY_BASE_DELAY_MS);
const COMPOSER_RETRY_MAX_DELAY_MS  = Math.max(COMPOSER_RETRY_BASE_DELAY_MS, _ce.SWARMX_COMPOSER_RETRY_MAX_DELAY_MS);
const COMPOSER_CB_FAILURE_THRESHOLD = Math.max(1, _ce.SWARMX_COMPOSER_CB_FAILURE_THRESHOLD);
const COMPOSER_CB_OPEN_MS          = Math.max(1000, _ce.SWARMX_COMPOSER_CB_OPEN_MS);
const COMPOSER_DEEP_TIMEOUT_MS     = Math.max(30_000, _ce.SWARMX_COMPOSER_DEEP_TIMEOUT_MS);
// [V6.2-FIX-05] Lower the floor on constrained hosts via SWARMX_COMPOSER_DEEP_TIMEOUT_MIN_MS.
const COMPOSER_DEEP_TIMEOUT_MIN_MS = _ce.SWARMX_COMPOSER_DEEP_TIMEOUT_MIN_MS;

const composerTimeoutHistogram: Record<TimeoutBucket, number> = {
  lt5s: 0,
  lt15s: 0,
  lt30s: 0,
  lt45s: 0,
  gte45s: 0,
};

let composerTimeoutCount = 0;

const composerCircuit = {
  state: "closed" as CircuitState,
  failures: 0,
  openedAtMs: 0,
};

function classifyPromptComplexity(message: string): PromptComplexity {
  const q = message.toLowerCase();
  const deepSignals = [
    "deep",
    "analyze",
    "architecture",
    "root cause",
    "incident",
    "postmortem",
    "design",
    "optimize",
    "evolution",
    "workflow",
    "multi-agent",
  ];
  const deepHits = deepSignals.filter((s) => q.includes(s)).length;
  if (message.trim().length > 320 || deepHits >= 2) return "deep";
  if (message.trim().length <= 120) return "light";
  return "standard";
}

function computeAdaptiveTimeoutMs({
  message,
  timeoutMs,
  shortPromptTimeoutMs,
}: {
  message: string;
  timeoutMs: number;
  shortPromptTimeoutMs: number;
}): number {
  const complexity = classifyPromptComplexity(message);
  if (complexity === "deep") {
    // [V6.2-FIX-05] Use COMPOSER_DEEP_TIMEOUT_MIN_MS as the floor so operators
    // on constrained hardware can override the default 90s minimum.
    return Math.max(timeoutMs, COMPOSER_DEEP_TIMEOUT_MIN_MS);
  }
  if (complexity === "light") {
    return Math.min(timeoutMs, shortPromptTimeoutMs);
  }
  return timeoutMs;
}

function circuitIsOpen(nowMs: number): boolean {
  if (composerCircuit.state === "open") {
    if (nowMs - composerCircuit.openedAtMs >= COMPOSER_CB_OPEN_MS) {
      composerCircuit.state = "half-open";
      return false;
    }
    return true;
  }
  return false;
}

function circuitRecordSuccess(): void {
  composerCircuit.failures = 0;
  composerCircuit.openedAtMs = 0;
  composerCircuit.state = "closed";
}

function circuitRecordFailure(nowMs: number): void {
  composerCircuit.failures += 1;
  // [V6.2-FIX-06] Guard against re-opening an already-open circuit so that a
  // late error from a pre-open call cannot reset the openedAtMs countdown.
  if (composerCircuit.failures >= COMPOSER_CB_FAILURE_THRESHOLD && composerCircuit.state !== "open") {
    composerCircuit.state = "open";
    composerCircuit.openedAtMs = nowMs;
  }
}

function shouldRetryModelError(reason: string): boolean {
  const lower = reason.toLowerCase();
  return (
    lower.includes("timeout") ||
    lower.includes("abort") ||
    lower.includes("fetch") ||
    lower.includes("network") ||
    lower.includes("502") ||
    lower.includes("503") ||
    lower.includes("504")
  );
}

async function callOllama(
  ollamaBase: string,
  selectedModel: string,
  systemPrompt: string,
  message: string,
  keepAlive: string,
  numPredict: number,
  overrides?: ModelCallOverrides,
): Promise<{
  text: string;
  tokens?: number;
  raw?: unknown;
}> {
  const ollamaRes = await fetch(`${ollamaBase}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: selectedModel,
      stream: false,
      keep_alive: keepAlive,
      options: {
        num_predict: numPredict,
        ...(overrides ?? {}),
      },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: message },
      ],
    }),
  });

  if (!ollamaRes.ok) {
    const body = await ollamaRes.text();
    throw new Error(`Ollama ${ollamaRes.status}: ${body}`);
  }

  const data = (await ollamaRes.json()) as {
    message?: { content?: string };
    error?: string;
    eval_count?: number;
    prompt_eval_count?: number;
  };

  const text =
    data?.message?.content?.trim() ??
    data?.error ??
    "No response from model.";

  const totalTokens = (data.eval_count ?? 0) + (data.prompt_eval_count ?? 0);

  return {
    text,
    ...(totalTokens > 0 ? { tokens: totalTokens } : {}),
    raw: data,
  };
}

// ── [V6.2-FIX-26] Cold-load guard ─────────────────────────────────────────────
//
// Root cause: on low-VRAM hosts (8 GB RAM, no GPU) phi4-fast (4.1 GB) takes
// 60-120 s to load from disk. The composer AbortSignal fires at 45 s, the
// client disconnects, but Ollama's HTTP handler stays blocked on the in-progress
// model load. All subsequent /api/version probes time out → Ollama deadlocked.
//
// Fix: before entering the model call loop, check /api/ps (3 s timeout).
//   • If the target model IS loaded → proceed normally.
//   • If nothing is loaded → fire an async preload (no AbortSignal, so it
//     completes naturally without deadlocking Ollama) and return "warming up".
//     Caller retries in ~90 s when the model is warm.

/** Track in-progress preloads so we don't stack identical requests. */
const _preloadState = new Map<string, { startedAt: number; done: boolean }>();

interface LoadedModelState {
  reachable: boolean;
  names: Set<string>;
}

/**
 * Return loaded model state from Ollama (/api/ps).
 * reachable=false means the endpoint could not be queried.
 */
async function getLoadedModelState(ollamaBase: string): Promise<LoadedModelState> {
  try {
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 3_000);
    try {
      const res = await fetch(`${ollamaBase}/api/ps`, { signal: ctrl.signal });
      if (!res.ok) return { reachable: false, names: new Set() };
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      return {
        reachable: true,
        names: new Set(
          (json.models ?? [])
            .map((m) => m.name?.trim())
            .filter((n): n is string => Boolean(n)),
        ),
      };
    } finally {
      clearTimeout(tid);
    }
  } catch {
    return { reachable: false, names: new Set() };
  }
}

/**
 * Fire-and-forget model preload via /api/generate.
 * Intentionally has NO AbortSignal: we want the request to complete naturally
 * so Ollama can finish loading without a mid-load client disconnect (which
 * deadlocks the Ollama HTTP handler until the model finishes or Ollama restarts.
 * Keep the warmed model resident only briefly: the normal Composer request
 * receives its lifecycle policy from ModelOrchestrator, and the constrained
 * 8 GB profile must not pin a multi-gigabyte model for ten minutes.
 */
function startModelPreload(ollamaBase: string, modelTag: string): void {
  const existing = _preloadState.get(modelTag);
  const preloadAge = existing ? Date.now() - existing.startedAt : Infinity;
  // Skip if a preload is already running (< 180 s old and not done)
  if (existing && !existing.done && preloadAge < 180_000) {
    return;
  }
  const state = { startedAt: Date.now(), done: false };
  _preloadState.set(modelTag, state);
  // Intentionally no await — fire and forget
  void fetch(`${ollamaBase}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: modelTag,
      prompt: "Hi",
      stream: false,
      keep_alive: "30s",
      options: { num_predict: 1, temperature: 0, num_ctx: 256 },
    }),
    // NO AbortSignal — let the model load complete without client abort
  })
    .then((r) => { state.done = true; _preloadState.set(modelTag, { ...state, done: r.ok }); })
    .catch(() => { state.done = true; _preloadState.set(modelTag, { ...state, done: false }); });
}

function timeoutBucketFor(elapsedMs: number): TimeoutBucket {
  if (elapsedMs < 5_000) return "lt5s";
  if (elapsedMs < 15_000) return "lt15s";
  if (elapsedMs < 30_000) return "lt30s";
  if (elapsedMs < 45_000) return "lt45s";
  return "gte45s";
}

function timeoutHistogramCompact(): string {
  return [
    `lt5s:${composerTimeoutHistogram.lt5s}`,
    `lt15s:${composerTimeoutHistogram.lt15s}`,
    `lt30s:${composerTimeoutHistogram.lt30s}`,
    `lt45s:${composerTimeoutHistogram.lt45s}`,
    `gte45s:${composerTimeoutHistogram.gte45s}`,
  ].join("|");
}

function shouldLogHistogram(): boolean {
  if (!Number.isFinite(TIMEOUT_HISTOGRAM_LOG_EVERY) || TIMEOUT_HISTOGRAM_LOG_EVERY <= 0) {
    return true;
  }
  return composerTimeoutCount % TIMEOUT_HISTOGRAM_LOG_EVERY === 0;
}

function workflowRunsFilePath(): string {
  return path.join(loadEnv().SWARMX_HOME, "state", "workflow-runs.jsonl");
}

async function loadWorkflowRuns(limit = 1000): Promise<WorkflowRunRecord[]> {
  try {
    const raw = await readFile(workflowRunsFilePath(), "utf8");
    const rows = raw
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as WorkflowRunRecord;
        } catch {
          return null;
        }
      })
      .filter((row): row is WorkflowRunRecord => row !== null);
    return rows.slice(-limit);
  } catch {
    return [];
  }
}

async function formatWorkflowLastHourSummary(): Promise<string> {
  const now = Date.now();
  const horizonMs = 60 * 60 * 1000;
  const runs = await loadWorkflowRuns(1500);

  const inWindow = runs.filter((run) => {
    const ts = Date.parse(run.updatedAt || run.createdAt);
    return Number.isFinite(ts) && now - ts <= horizonMs;
  });

  if (inWindow.length === 0) {
    return [
      "Workflow run summary (last 60 minutes)",
      "Total runs: 0",
      "Success: 0",
      "Failed: 0",
      "Cancelled: 0",
      "Running: 0",
      "Queued: 0",
      "",
      "No workflow runs recorded in the last hour.",
    ].join("\n");
  }

  const counts = {
    success: 0,
    failed: 0,
    cancelled: 0,
    running: 0,
    queued: 0,
  };
  const perWorkflow = new Map<string, { total: number; success: number; failed: number }>();

  for (const run of inWindow) {
    if (run.status in counts) {
      counts[run.status as keyof typeof counts] += 1;
    }
    const bucket = perWorkflow.get(run.workflowId) ?? { total: 0, success: 0, failed: 0 };
    bucket.total += 1;
    if (run.status === "success") bucket.success += 1;
    if (run.status === "failed") bucket.failed += 1;
    perWorkflow.set(run.workflowId, bucket);
  }

  const terminal = counts.success + counts.failed + counts.cancelled;
  const successRate = terminal > 0 ? ((counts.success / terminal) * 100).toFixed(1) : "0.0";

  const topWorkflows = [...perWorkflow.entries()]
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 6);

  return [
    "Workflow run summary (last 60 minutes)",
    `Total runs: ${inWindow.length}`,
    `Success: ${counts.success}`,
    `Failed: ${counts.failed}`,
    `Cancelled: ${counts.cancelled}`,
    `Running: ${counts.running}`,
    `Queued: ${counts.queued}`,
    `Success rate (terminal runs): ${successRate}%`,
    "",
    "Top workflows:",
    ...topWorkflows.map(([id, c]) =>
      `  • ${id}: ${c.total} run${c.total === 1 ? "" : "s"} (success ${c.success}, failed ${c.failed})`,
    ),
  ].join("\n");
}

function detectLocalIntent(
  message: string,
): "running_by_role" | "high_cpu" | "available_agents" | "simple_copy" | "python_calculator" | "presence_ping" | "idle_unassigned" | "workflow_last_hour" | "agent_errors" | null {
  // [V6.2-ENH-01] Normalize before matching: strip leading/trailing whitespace
  // and trailing punctuation so common variants ("hello!", "are you there?",
  // " ping ") resolve without adding an entry for each permutation.
  const q = message.toLowerCase().trim().replace(/[!?.,:;]+$/, "");
  if (
    q === "are you there" ||
    q === "you there" ||
    q === "still there" ||
    q === "ping" ||
    q === "hello" ||
    q === "hi" ||
    q === "hey" ||
    q === "hey there" ||
    q === "status" ||
    q === "swarm status" ||
    q === "fleet status"
  ) {
    return "presence_ping";
  }
  if ((q.includes("running agents") || q.includes("active agents")) && q.includes("grouped by role")) {
    return "running_by_role";
  }
  if ((q.includes("available") || q.includes("availble")) && q.includes("agent")) {
    return "available_agents";
  }
  if (
    q.includes("idle") &&
    (q.includes("why") || q.includes("assigned") || q.includes("tasks") || q.includes("standby"))
  ) {
    return "idle_unassigned";
  }
  if (q.includes("cpu") && (q.includes("above") || q.includes("over") || q.includes("greater than"))) {
    return "high_cpu";
  }
  if (
    (q.includes("welcome message") || q.includes("greeting message") || q.includes("intro message")) &&
    (q.includes("simple") || q.includes("short") || q.includes("quick") || q.includes("write"))
  ) {
    return "simple_copy";
  }
  if (q.includes("python") && q.includes("calculator") && (q.includes("simple") || q.includes("write") || q.includes("build"))) {
    return "python_calculator";
  }
  const asksWorkflowWindow =
    (q.includes("workflow") || q.includes("workflows")) &&
    (q.includes("last hour") || q.includes("past hour") || q.includes("previous hour") || q.includes("1 hour"));
  const asksBreakdown = q.includes("breakdown") || q.includes("success") || q.includes("fail") || q.includes("failed");
  if (asksWorkflowWindow && asksBreakdown) {
    return "workflow_last_hour";
  }
  // [V6.2-ENH-06] Agent error queries can be answered entirely from the live
  // registry without a model call, making them instant even when Ollama is down.
  if (
    (q.includes("error") || q.includes("errors") || q.includes("fatal") || q.includes("failing") || q.includes("broken")) &&
    (q.includes("agent") || q.includes("agents")) &&
    (q.includes("list") || q.includes("show") || q.includes("find") || q.includes("what") || q.includes("which") || q.includes("diagnose"))
  ) {
    return "agent_errors";
  }
  return null;
}

function formatAgentErrors(agents: ComposerAgent[]): string {
  const errored = agents.filter((a) => isErrorStatus(a.status));
  const lines: string[] = [];
  lines.push("SwarmX agent error report");
  lines.push(`Total registered: ${agents.length}`);
  lines.push(`Agents in error/fatal state: ${errored.length}`);

  if (errored.length === 0) {
    lines.push("");
    lines.push("No agents are currently in an error state.");
    return lines.join("\n");
  }

  lines.push("");
  for (const agent of errored) {
    const name = agent.name ?? agent.id;
    const task = agent.currentTask?.trim() ? `Last task: ${agent.currentTask}` : "No task recorded";
    const err = agent.lastError?.trim() ? `Last error: ${agent.lastError}` : "No error message available";
    lines.push(`  • ${name} [${agent.status}]`);
    lines.push(`    ${task}`);
    lines.push(`    ${err}`);
  }

  lines.push("");
  lines.push("Possible causes:");
  lines.push("- Ollama model failed to load (check ollama serve logs)");
  lines.push("- Tool execution timeout in a long-running step");
  lines.push("- Network error reaching a configured endpoint");
  lines.push("");
  lines.push("Next action: check ~/.swarmx/logs/ for agent-specific traces.");
  return lines.join("\n");
}

function isActiveStatus(status: string): boolean {
  return status === "running" || status === "active";
}

function isErrorStatus(status: string): boolean {
  return status === "error" || status === "fatal";
}

function formatIdleUnassigned(agents: ComposerAgent[]): string {
  const active = agents.filter((a) => isActiveStatus(a.status));
  const idle = agents.filter((a) => a.status === "idle");
  const errored = agents.filter((a) => isErrorStatus(a.status));

  const lines: string[] = [];
  lines.push("SwarmX fleet assignment summary");
  lines.push(`Active agents: ${active.length}`);
  lines.push(`Idle agents: ${idle.length}`);
  lines.push(`Error agents: ${errored.length}`);
  lines.push(`Total registered: ${agents.length}`);
  lines.push("");

  if (idle.length === 0) {
    lines.push("No agents are idle right now.");
    return lines.join("\n");
  }

  lines.push("Why agents are idle:");
  lines.push("- No workflow or mission is currently queued/running, so idle agents stay on standby by design.");
  lines.push("- Agent seeding initializes availability only; task assignment begins when a mission/workflow is dispatched.");
  lines.push("- Execution policy and risk gates can intentionally defer task starts until explicit run requests.");
  lines.push("");
  lines.push("Next action:");
  lines.push("- Start a run from Composer or Workflows to transition eligible agents from idle to active.");

  return lines.join("\n");
}

function formatPresencePing(agents: ComposerAgent[]): string {
  const active = agents.filter((a) => isActiveStatus(a.status)).length;
  const error = agents.filter((a) => isErrorStatus(a.status)).length;
  const total = agents.length;

  return [
    'SwarmX fleet summary (responding to: "are you there?")',
    `Active agents: ${active}`,
    `Error agents: ${error}`,
    `Total registered: ${total}`,
    total > 0
      ? `  • ${agents[0]?.name ?? agents[0]?.id} [${agents[0]?.status}] — ${agents[0]?.currentTask ?? "standby"}`
      : "No agents are currently registered.",
  ].join("\n");
}

function formatSimpleCopy(message: string): string {
  const q = message.toLowerCase();
  if (q.includes("welcome message") || q.includes("greeting message") || q.includes("intro message")) {
    return "Welcome to SwarmX. Your fleet is ready, your tools are online, and you can start from here.";
  }

  return "I can help with short operator copy, fleet status, and direct swarm questions right away.";
}

function formatPythonCalculator(): string {
  return [
    "Here is a simple Python calculator you can run locally:",
    "",
    "```python",
    "def add(a: float, b: float) -> float:",
    "    return a + b",
    "",
    "def subtract(a: float, b: float) -> float:",
    "    return a - b",
    "",
    "def multiply(a: float, b: float) -> float:",
    "    return a * b",
    "",
    "def divide(a: float, b: float) -> float:",
    "    if b == 0:",
    "        raise ValueError(\"Cannot divide by zero\")",
    "    return a / b",
    "",
    "if __name__ == \"__main__\":",
    "    first = float(input(\"First number: \"))",
    "    second = float(input(\"Second number: \"))",
    "    print(\"Add:\", add(first, second))",
    "    print(\"Subtract:\", subtract(first, second))",
    "    print(\"Multiply:\", multiply(first, second))",
    "    print(\"Divide:\", divide(first, second))",
    "```",
  ].join("\n");
}

function parseCpuThreshold(message: string, fallback = 80): number {
  const match = message.match(/(above|over|greater than)\s*(\d{1,3})\s*%?/i);
  if (!match) return fallback;
  const parsed = Number.parseInt(match[2] ?? "", 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(100, Math.max(1, parsed));
}

function fallbackForSimplePrompt(message: string): string | null {
  const q = message.toLowerCase();

  // [V6.2-FIX-21] Broaden Python match: cover "script", "function", "hook", and
  // bare "python" + code-creation verbs so common prompts don't reach the fleet
  // summary fallback when the model is offline.
  if (q.includes("python") && (
    q.includes("function") ||
    q.includes("hook") ||
    q.includes("script") ||
    ((q.includes("write") || q.includes("create") || q.includes("build") || q.includes("simple")) && q.includes("python"))
  )) {
    return [
      "Model offline fallback: here is a simple Python script template.",
      "",
      "```python",
      "#!/usr/bin/env python3",
      "\"\"\"Simple Python script.\"\"\"",
      "",
      "",
      "def main() -> None:",
      "    print(\"Hello from SwarmX!\")",
      "",
      "",
      "if __name__ == \"__main__\":",
      "    main()",
      "```",
      "",
      "Start Ollama and pull a model for a richer, task-specific response:",
      "  ollama pull instruct-phi4-pro-q8-prod",
    ].join("\n");
  }

  if (q.includes("javascript") && (q.includes("function") || q.includes("script"))) {
    return [
      "Model offline fallback: here is a simple JavaScript template.",
      "",
      "```javascript",
      "function greet(name) {",
      "  return `Hello, ${name}!`;",
      "}",
      "",
      "process.stdout.write(`${greet(\"SwarmX\")}\\n`);",
      "```",
    ].join("\n");
  }

  // [V6.2-FIX-23] TypeScript function/script template.
  if (
    (q.includes("typescript") || q.includes(" ts ") || q.includes(".ts")) &&
    (q.includes("function") || q.includes("script") || q.includes("write") || q.includes("create"))
  ) {
    return [
      "Model offline fallback: here is a simple TypeScript template.",
      "",
      "```typescript",
      "interface Config {",
      "  name: string;",
      "  value: number;",
      "}",
      "",
      "function formatConfig(cfg: Config): string {",
      "  return `${cfg.name}: ${cfg.value}`;" ,
      "}",
      "",
      "process.stdout.write(`${formatConfig({ name: \"SwarmX\", value: 42 })}\\n`);",
      "```",
      "",
      "Start Ollama and pull a model for a task-specific response:",
      "  ollama pull instruct-phi4-pro-q8-prod",
    ].join("\n");
  }

  // [V6.2-FIX-23] Bash/shell script template.
  if (
    (q.includes("bash") || q.includes("shell") || q.includes("sh")) &&
    (q.includes("script") || q.includes("write") || q.includes("create") || q.includes("simple"))
  ) {
    return [
      "Model offline fallback: here is a simple Bash script template.",
      "",
      "```bash",
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      "",
      "NAME=\"SwarmX\"",
      "",
      "echo \"Hello from $NAME!\"",
      "",
      "# Check a condition",
      "if [[ -d \"$HOME/.swarmx\" ]]; then",
      "  echo \"SwarmX runtime found at $HOME/.swarmx\"",
      "else",
      "  echo \"SwarmX runtime not initialised — run swarm-init.sh\"",
      "fi",
      "```",
      "",
      "Start Ollama and pull a model for a task-specific script:",
      "  ollama pull instruct-phi4-pro-q8-prod",
    ].join("\n");
  }

  // [V6.2-FIX-23] Generic JSON example template.
  if (
    q.includes("json") &&
    (q.includes("example") || q.includes("template") || q.includes("format") || q.includes("write") || q.includes("sample"))
  ) {
    return [
      "Model offline fallback: here is a generic JSON structure example.",
      "",
      "```json",
      "{",
      "  \"name\": \"my-task\",",
      "  \"status\": \"pending\",",
      "  \"priority\": 1,",
      "  \"tags\": [\"swarmx\", \"automation\"],",
      "  \"metadata\": {",
      "    \"createdAt\": \"2026-01-01T00:00:00Z\",",
      "    \"owner\": \"strategist\"",
      "  }",
      "}",
      "```",
    ].join("\n");
  }

  return null;
}

function normalizeModelTag(model: string): string {
  const trimmed = model.trim();
  if (!trimmed) return "";
  return trimmed.includes(":") ? trimmed : `${trimmed}:latest`;
}

function pickBestDiscoveredModel(
  discoveredModels: string[],
  preferredModels: string[],
): string | null {
  if (discoveredModels.length === 0) return null;

  const normalizedDiscovered = discoveredModels.map((m) => m.trim()).filter(Boolean);
  const byLower = new Map(normalizedDiscovered.map((m) => [m.toLowerCase(), m]));

  for (const preferred of preferredModels) {
    const normalized = normalizeModelTag(preferred);
    if (!normalized) continue;
    const direct = byLower.get(normalized.toLowerCase());
    if (direct) return direct;

    const base = normalized.split(":")[0]?.toLowerCase() ?? "";
    if (!base) continue;
    const sameBase = normalizedDiscovered.find(
      (candidate) => candidate.split(":")[0]?.toLowerCase() === base,
    );
    if (sameBase) return sameBase;
  }

  return normalizedDiscovered[0] ?? null;
}

function preferredModelCandidates(
  promptComplexity: PromptComplexity,
  runtimePressure: ReturnType<typeof currentPressureLevel>,
  selectedModel: string,
): string[] {
  // [APEX17-r8] Fallback defaults were migrated from legacy V5 tags to
  // canonical Pilot / Oracle / Forge tags (routing.yaml: model_fast /
  // model_reason / model_code). resolveCanonicalTag() still protects against
  // an operator-set env var carrying an older alias.
  const _me = loadEnv();
  const fastModel = normalizeModelTag(
    resolveCanonicalTag(_me.SWARMX_COMPOSER_FAST_MODEL ?? _me.SWARMX_MODEL_FAST ?? selectedModel),
  );
  const reasonModel = normalizeModelTag(resolveCanonicalTag(_me.SWARMX_MODEL_REASON));
  const codeModel   = normalizeModelTag(resolveCanonicalTag(_me.SWARMX_MODEL_CODE));

  if (runtimePressure === "critical") {
    return [fastModel, selectedModel];
  }

  if (promptComplexity === "deep") {
    return runtimePressure === "high"
      ? [fastModel, selectedModel, reasonModel, codeModel]
      : [reasonModel, selectedModel, fastModel, codeModel];
  }

  if (promptComplexity === "light") {
    return [fastModel, selectedModel, reasonModel];
  }

  return [selectedModel, fastModel, reasonModel, codeModel];
}

function formatRunningByRole(agents: ComposerAgent[]): string {
  const running = agents.filter((a) => isActiveStatus(a.status));
  const grouped = new Map<string, ComposerAgent[]>();
  for (const agent of running) {
    const role = (agent.role?.trim() || "unassigned").toLowerCase();
    const bucket = grouped.get(role);
    if (bucket) {
      bucket.push(agent);
    } else {
      grouped.set(role, [agent]);
    }
  }

  const lines: string[] = [];
  lines.push("SwarmX live fleet summary (grouped by role)");
  lines.push(`Active/running agents: ${running.length}`);
  lines.push(`Total registered: ${agents.length}`);

  if (running.length === 0) {
    lines.push("");
    lines.push("No active agents are currently running.");
    return lines.join("\n");
  }

  const sortedRoles = [...grouped.keys()].sort((left, right) => left.localeCompare(right));
  for (const role of sortedRoles) {
    const members = grouped.get(role) ?? [];
    lines.push("");
    lines.push(`Role: ${role} (${members.length})`);
    for (const member of members) {
      const name = member.name ?? member.id;
      const task = member.currentTask?.trim() || "no current task reported";
      lines.push(`  • ${name} — ${task}`);
    }
  }

  return lines.join("\n");
}

function formatHighCpuAgents(agents: ComposerAgent[], threshold: number): string {
  const over = agents
    .map((agent) => ({
      agent,
      cpu: agent.resource?.cpuPercent ?? 0,
    }))
    .filter((entry) => entry.cpu > threshold)
    .sort((left, right) => right.cpu - left.cpu);

  const lines: string[] = [];
  lines.push(`Agents with CPU usage above ${threshold}%`);
  lines.push(`Matches: ${over.length}`);
  lines.push(`Total registered: ${agents.length}`);

  if (over.length === 0) {
    lines.push("");
    lines.push("No agents currently exceed the CPU threshold.");
    return lines.join("\n");
  }

  lines.push("");
  for (const entry of over) {
    const a = entry.agent;
    const name = a.name ?? a.id;
    const task = a.currentTask?.trim() || "no current task reported";
    lines.push(`  • ${name} (${entry.cpu.toFixed(1)}%) — ${task}`);
  }

  return lines.join("\n");
}

function formatAvailableAgents(agents: ComposerAgent[]): string {
  const lines: string[] = [];
  const idle = agents.filter((a) => a.status === "idle");
  const running = agents.filter((a) => isActiveStatus(a.status));
  const unavailable = agents.filter((a) => isErrorStatus(a.status));

  const byRole = new Map<string, ComposerAgent[]>();
  for (const agent of agents) {
    const role = (agent.role?.trim() || "unassigned").toLowerCase();
    const bucket = byRole.get(role);
    if (bucket) {
      bucket.push(agent);
    } else {
      byRole.set(role, [agent]);
    }
  }

  lines.push("SwarmX available agents summary");
  lines.push(`Total registered: ${agents.length}`);
  lines.push(`Idle/available: ${idle.length}`);
  lines.push(`Active/running: ${running.length}`);
  lines.push(`Unavailable (error/fatal): ${unavailable.length}`);

  if (agents.length === 0) {
    lines.push("");
    lines.push("No agents are currently registered.");
    return lines.join("\n");
  }

  const roles = [...byRole.keys()].sort((a, b) => a.localeCompare(b));
  for (const role of roles) {
    const members = byRole.get(role) ?? [];
    lines.push("");
    lines.push(`Role: ${role} (${members.length})`);
    for (const member of members) {
      const name = member.name ?? member.id;
      lines.push(`  • ${name} [${member.status}]`);
    }
  }

  return lines.join("\n");
}

async function listAvailableModels(): Promise<string[]> {
  // [V6.1-FIX-13] Delegate to centralized resilient service
  return getAvailableModels();
}

const chatSchema = z.object({
  // [V6.1-FIX-05] Allow manual API calls without sessionId; server generates one.
  sessionId: z.string().min(1).max(128).optional(),
  message: z.string().min(1).max(8192),
  context: z
    .object({
      projectScope: z.string().min(1).max(512).optional(),
      recentProjects: z.array(z.string().min(1).max(512)).max(5).optional(),
      agents: z
        .array(
          z.object({
            id: z.string(),
            name: z.string().optional(),
            status: z.string(),
            role: z.string().optional(),
          })
        )
        .optional(),
      // [V6.2-FIX-13] Align with the shared SwarmX PressureLevel contract.
      // Accept legacy synonyms too so older dashboards keep working.
      pressureLevel: z.enum(["normal", "nominal", "elevated", "high", "critical"]).optional(),
    })
    .optional(),
});

// [V6.1-ENH-04] Structured Composer response metadata enables dashboard-level
// degraded/offline UX without brittle text parsing.
type ComposerResponseMode = "local" | "model" | "fallback";

interface ComposerResponseDiagnostics {
  reason?: string;
  ollamaReachable?: boolean;
  ollamaEndpoint?: string;
  model?: string;
  selectedModel?: string;
  timeoutMs?: number;
  retryCount?: number;
  circuitOpen?: boolean;
  pressureLevel?: ReturnType<typeof currentPressureLevel>;
  availableRamMb?: number;
}

interface ComposerResponsePayload {
  message: string;
  agentId: string;
  sessionId: string;
  mode: ComposerResponseMode;
  diagnostics?: ComposerResponseDiagnostics;
}

export async function composerRouter(server: FastifyInstance): Promise<void> {
  // [V6.1-FIX-13] Use centralized Ollama service
  const resolveOllamaBaseUrl = getOllamaBaseUrl;

  server.post(
    "/chat",
    async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = chatSchema.safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

      const { message, context } = parsed.data;
      // [V6.1-FIX-05] Normalize provided session ID or create a request-scoped fallback.
      const sessionId =
        parsed.data.sessionId?.trim() ||
        `composer-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

      const mkResponse = (
        responseMessage: string,
        mode: ComposerResponseMode,
        diagnostics?: ComposerResponseDiagnostics,
      ): ComposerResponsePayload => ({
        message: responseMessage,
        agentId: "swarmx-composer",
        sessionId,
        mode,
        ...(diagnostics ? { diagnostics } : {}),
      });

      // Build context from live registry plus client-provided snapshot.
      // [V5.9-FIX-06] Registry may be cold; merge in request context agents so
      // Composer still reports useful fleet state.
      const registryAgents = [...agentRegistry.values()].map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status,
        role: a.role,
        currentTask: a.currentTask,
        // [V6.2-ENH-06] exactOptionalPropertyTypes: include lastError only when
        // actually defined so the mapped object is assignable to ComposerAgent.
        ...(a.lastError !== undefined ? { lastError: a.lastError } : {}),
      }));
      const contextAgents = (context?.agents ?? []).map((a) => ({
        id: a.id,
        name: a.name,
        status: a.status as (typeof registryAgents)[number]["status"],
        role: a.role,
        currentTask: undefined,
      }));
      const merged = new Map<string, (typeof registryAgents)[number]>();
      for (const a of contextAgents) merged.set(a.id, a);
      for (const a of registryAgents) merged.set(a.id, { ...merged.get(a.id), ...a });
      const agents = [...merged.values()];

      const runningCount = agents.filter((a) => isActiveStatus(a.status)).length;
      const errorCount = agents.filter((a) => isErrorStatus(a.status)).length;

      const systemPrompt = [
        "You are the SwarmX AI Composer — the intelligent operator interface for the SwarmX autonomous agent swarm.",
        "Your role: answer operator questions, provide swarm status analysis, and suggest next actions.",
        context?.projectScope ? `Current project scope: ${context.projectScope}` : "",
        context?.recentProjects && context.recentProjects.length > 0
          ? `Recent local projects: ${context.recentProjects.join(", ")}`
          : "",
        `Current fleet state: ${runningCount} running, ${errorCount} in error, ${agents.length} total registered.`,
        "Registered agents:",
        ...agents.slice(0, 12).map(
          (a) => `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`,
        ),
        agents.length > 12 ? `  …and ${agents.length - 12} more` : "",
        "Be concise, accurate, and operator-focused.",
      ].filter((l) => l !== "").join("\n");

      // [SEED-FIX-01] Resolve model and normalize name — Ollama requires the tag
      // suffix (e.g. "instruct-phi4-pro-q8-prod:latest") when a model was pulled
      // with an explicit tag. If the configured name has no colon, append
      // ":latest" automatically.
      // [APEX17-r8] Default fallback updated from the legacy "phi4-fast" tag
      // (which no longer exists as an Ollama tag after the r7 canonical
      // migration — requesting it would 404) to the canonical Pilot tag.
      // resolveCanonicalTag() additionally normalizes any older alias an
      // operator might still have set in SWARM_MODEL_FAST /
      // SWARMX_MODEL_FAST, per Hard Constraint #1 (no legacy tags in
      // production code paths).
      const _re = loadEnv();
      const rawModel: string = resolveCanonicalTag(
        _re.SWARMX_COMPOSER_MODEL ?? _re.SWARMX_MODEL_FAST,
      );
      const model = rawModel.includes(":") ? rawModel : `${rawModel}:latest`;
      let selectedModel = model;
      const timeoutMs = _re.SWARMX_COMPOSER_TIMEOUT_MS;
      const composerNumPredict = _re.SWARMX_COMPOSER_NUM_PREDICT;
      // [APEX17-r8] Per-model keep-alive comes from ModelOrchestrator.requestModel().
      // This var is kept ONLY as an explicit operator override escape hatch —
      // empty string means "defer to the orchestrator".
      const composerKeepAliveOverride = _re.SWARMX_COMPOSER_KEEP_ALIVE?.trim() ?? "";
      const shortPromptTimeoutMs = _re.SWARMX_COMPOSER_SHORT_PROMPT_TIMEOUT_MS;

      let responseText = "";
      let usedSummaryFallback = false;
      let fallbackDiagnostics: ComposerResponseDiagnostics | null = null;

      // [V6.1-FIX-12] Fast deterministic answers for operational prompts that
      // can be computed directly from live fleet state (no model dependency).
      const localIntent = detectLocalIntent(message);
      // [V6.2-ENH-01] Adaptive timeout budget by prompt complexity.
      // Light prompts stay snappy; deep analysis prompts get a longer budget.
      const effectiveTimeoutMs = computeAdaptiveTimeoutMs({
        message,
        timeoutMs,
        shortPromptTimeoutMs,
      });
      const promptComplexity = classifyPromptComplexity(message);
      const runtimePressure = currentPressureLevel();
      const availableRamMb = getAvailableRamMb();
      // [V6.2-ENH-02] Advertise the server-side effective timeout so the client
      // can calibrate its own abort timer on future requests.
      void reply.header("X-Request-Timeout-Ms", String(effectiveTimeoutMs));
      // [V6.1-ENH-03] Route-level preflight decision telemetry for quick
      // operator diagnosis under latency pressure.
      server.log.info(
        {
          decision: localIntent ? "local" : "model",
          localIntent: localIntent ?? "none",
          msgChars: message.length,
          promptComplexity,
          model,
          timeoutMs: effectiveTimeoutMs,
          numPredict: composerNumPredict,
          keepAliveOverride: composerKeepAliveOverride || "(orchestrator-managed)",
          runtimePressure,
          availableRamMb,
          runningCount,
          errorCount,
          totalAgents: agents.length,
        },
        "composer_preflight",
      );
      if (localIntent === "running_by_role") {
        responseText = formatRunningByRole(agents);
        return mkResponse(responseText, "local");
      }
      if (localIntent === "high_cpu") {
        const threshold = parseCpuThreshold(message, 80);
        responseText = formatHighCpuAgents(agents, threshold);
        return mkResponse(responseText, "local");
      }
      if (localIntent === "available_agents") {
        responseText = formatAvailableAgents(agents);
        return mkResponse(responseText, "local");
      }
      if (localIntent === "idle_unassigned") {
        responseText = formatIdleUnassigned(agents);
        return mkResponse(responseText, "local");
      }
      if (localIntent === "presence_ping") {
        responseText = formatPresencePing(agents);
        return mkResponse(responseText, "local");
      }
      if (localIntent === "simple_copy") {
        responseText = formatSimpleCopy(message);
        return mkResponse(responseText, "local");
      }
      if (localIntent === "python_calculator") {
        responseText = formatPythonCalculator();
        return mkResponse(responseText, "local");
      }
      if (localIntent === "workflow_last_hour") {
        responseText = await formatWorkflowLastHourSummary();
        return mkResponse(responseText, "local");
      }
      if (localIntent === "agent_errors") {
        responseText = formatAgentErrors(agents);
        return mkResponse(responseText, "local");
      }

      // [V6.2-ENH-05] Pressure-aware routing: when the dashboard reports
      // "critical" runtime pressure, skip the model call entirely. Starting
      // an Ollama inference while the host is above ~90% RAM risks OOM-killing
      // either the model process or this API service. Respond with a live
      // fleet summary (same content as "presence_ping") and include a
      // diagnostic note so operators understand why no model call was made.
      if (context?.pressureLevel === "critical" || runtimePressure === "critical") {
        responseText =
          `[CRITICAL PRESSURE] Model call bypassed to protect host memory (${availableRamMb} MB available).\n\n` +
          formatPresencePing(agents);
        server.log.warn(
          {
            clientPressureLevel: context?.pressureLevel,
            runtimePressure,
            availableRamMb,
            runningCount,
            errorCount,
          },
          "composer_pressure_bypass",
        );
        return mkResponse(responseText, "local", {
          reason: "critical_pressure_bypass",
          pressureLevel: runtimePressure,
          availableRamMb,
        });
      }

      // [V6.1-PERF-05] Resolve Ollama endpoint only for model-routed prompts.
      // Local intents should never block on model discovery or Ollama health.
      // [V6.2-FIX-17] Parallelize all preflight I/O — all three calls share the
      // same cached OllamaServiceConfig so only the first triggers discovery.
      const [ollamaBase, preflightModels, preflightHealth] = await Promise.all([
        resolveOllamaBaseUrl(),
        listAvailableModels(),
        checkOllamaHealth(),
      ]);

      // [APEX17-r8] Singleton ModelOrchestrator — enforces SINGLE-7B LOCK via
      // evictIncompatible() and supplies per-model keep-alive policy. See
      // apps/swarmx-api/src/services/model-orchestrator.ts.
      const orchestrator = getModelOrchestrator(ollamaBase);

      // [V6.2-FIX-18] When Ollama /api/tags confirms zero installed models, skip
      // the model-call loop entirely — every candidate will 404, wasting time and
      // inflating circuit-breaker failures for a configuration problem, not a
      // transient error. Return actionable guidance immediately.
      // [V6.2-FIX-20] Include http-health (endpoint reachable, /api/tags failed or
      // empty) — both "http" and "http-health" indicate nothing to call.
      if (
        preflightModels.length === 0 &&
        preflightHealth.reachable &&
        (preflightHealth.methodUsed === "http" || preflightHealth.methodUsed === "http-health")
      ) {
        const noModelsMsg = [
          `SwarmX fleet summary (responding to: "${message}")`,
          "",
          `Active agents: ${runningCount}`,
          `Error agents: ${errorCount}`,
          `Total registered: ${agents.length}`,
          ...agents
            .slice(0, 8)
            .map((a) => `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`),
          agents.length > 8 ? `  …and ${agents.length - 8} more` : "",
          "",
          "Composer model fallback reason: No models installed on this Ollama endpoint",
          `Configured Ollama endpoint: ${preflightHealth.endpoint}`,
          `Model discovery source: ${preflightHealth.methodUsed}`,
          `Configured model: ${model} (resolved from: ${rawModel})`,
          "",
          "Install at least one model, then set SWARMX_COMPOSER_MODEL to that exact tag.",
          `  ollama pull ${rawModel}`,
          "  # or set SWARMX_COMPOSER_MODEL=<tag> in your .env.local",
        ]
          .filter((l) => l !== "")
          .join("\n");
        server.log.warn(
          { endpoint: preflightHealth.endpoint, model, configuredModel: rawModel },
          "composer_no_models_installed",
        );
        return mkResponse(noModelsMsg, "fallback", {
          reason: "No models installed on this Ollama endpoint",
          ollamaReachable: true,
          ollamaEndpoint: preflightHealth.endpoint,
          model,
          selectedModel,
          timeoutMs: effectiveTimeoutMs,
          pressureLevel: runtimePressure,
          availableRamMb,
        });
      }

      // [V6.2-FIX-26] Cold-load guard: before declaring Ollama unreachable, check if
      // a model warm-up is in progress. If /api/ps check responds (even with empty
      // list) or times out cleanly, Ollama is listening; preload and return fallback
      // with reason=model_warming_up instead of unreachable.
      if (preflightModels.length === 0 && !preflightHealth.reachable) {
        const loadedState = await getLoadedModelState(ollamaBase);
        const loadedNames = loadedState.names;
        const targetTags = [selectedModel, model, rawModel].filter(Boolean);
        const isWarm = targetTags.some((t) => loadedNames.has(t));

        // Only classify as warming up if /api/ps was actually reachable.
        if (!isWarm && loadedState.reachable) {
          startModelPreload(ollamaBase, normalizeModelTag(selectedModel));
          const warmingUpMsg = [
            `SwarmX model is warming up (responding to: "${message}")`,
            "",
            "The AI Composer model (instruct-phi4-pro-q8-prod, 4.3 GB) is currently loading.",
            "Estimated time: 60–120 seconds on this system.",
            "",
            "The dashboard will auto-retry in approximately 90 seconds.",
            "Or click 'Retry now' to probe earlier.",
            "",
            "Monitor model load progress:",
            `  curl http://127.0.0.1:11434/api/ps | jq '.models | map(.name)'`,
            "",
            "To manually pre-warm the model before next restart:",
            `  curl -X POST http://127.0.0.1:11434/api/generate -d '{"model":"instruct-phi4-pro-q8-prod:latest","prompt":"x","stream":false}' --max-time 120`,
          ]
            .filter((l) => l !== "")
            .join("\n");
          return mkResponse(warmingUpMsg, "fallback", {
            reason: "model_warming_up",
            ollamaReachable: true,
            ollamaEndpoint: ollamaBase,
            model,
            selectedModel,
            timeoutMs: effectiveTimeoutMs,
            pressureLevel: runtimePressure,
            availableRamMb,
          });
        }

        // [V6.2-FIX-21] Fail fast when Ollama is unreachable and model discovery
        // only returned static candidates. This avoids exhausting retry budgets
        // on guaranteed network failures and keeps operator UX responsive.
        // [V6.2-FIX-24] Check template fallback before generic fleet summary.
        const simpleFallbackPreflight = fallbackForSimplePrompt(message);
        if (simpleFallbackPreflight) {
          return mkResponse(simpleFallbackPreflight, "fallback", {
            reason: "Ollama endpoint unreachable during preflight",
            ollamaReachable: false,
            ollamaEndpoint: preflightHealth.endpoint || ollamaBase,
            model,
            selectedModel,
            timeoutMs: effectiveTimeoutMs,
            pressureLevel: runtimePressure,
            availableRamMb,
          });
        }
        const unreachableMsg = [
          `SwarmX fleet summary (responding to: "${message}")`,
          "",
          `Active agents: ${runningCount}`,
          `Error agents: ${errorCount}`,
          `Total registered: ${agents.length}`,
          ...agents
            .slice(0, 8)
            .map((a) => `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`),
          agents.length > 8 ? `  …and ${agents.length - 8} more` : "",
          "",
          "Composer model fallback reason: Ollama endpoint unreachable during preflight",
          `Configured Ollama endpoint: ${preflightHealth.endpoint || ollamaBase}`,
          `Model discovery source: ${preflightHealth.methodUsed}`,
          `Configured model: ${model} (resolved from: ${rawModel})`,
          "",
          "Start Ollama, then retry:",
          "  ollama serve",
          "  curl http://127.0.0.1:11434/api/tags",
        ]
          .filter((l) => l !== "")
          .join("\n");
        return mkResponse(unreachableMsg, "fallback", {
          reason: "Ollama endpoint unreachable during preflight",
          ollamaReachable: false,
          ollamaEndpoint: preflightHealth.endpoint || ollamaBase,
          model,
          selectedModel,
          timeoutMs: effectiveTimeoutMs,
          pressureLevel: runtimePressure,
          availableRamMb,
        });
      }

      // [V6.1-FIX-15] If the configured tag is stale but installed models are
      // discoverable, route to the first discovered model to avoid avoidable 404s.
      const configuredModelCandidates = (await getConfiguredModels())
        .map((candidate) => normalizeModelTag(candidate))
        .filter(Boolean);
      if (
        preflightModels.length > 0 &&
        !preflightModels.some((m) => m === model || m.startsWith(`${rawModel}:`))
      ) {
        selectedModel = pickBestDiscoveredModel(preflightModels, [
          model,
          rawModel,
          loadEnv().SWARMX_MODEL_FAST,
          "instruct-phi4-pro-q8-prod:latest",
          "instruct-phi4-pro-q8-prod",
        ]) ?? model;
        server.log.warn(
          { configuredModel: model, selectedModel, discoveredModelCount: preflightModels.length },
          "composer_model_autoselect",
        );
      }

      let modelAttemptStartedAt = 0;
      let retryCount = 0;

      // [V6.2-FIX-26] Cold-load guard: check /api/ps before attempting /api/chat.
      // If the target model is NOT in Ollama's resident set, a chat request would
      // trigger a cold disk load (60-120 s). The AbortSignal fires first (45 s),
      // the client disconnects, but Ollama's HTTP handler stays blocked on the
      // in-progress load — deadlocking all subsequent /api/version probes.
      // Fix: fire an async preload (no AbortSignal) and return "warming up".
      {
        const loadedState = await getLoadedModelState(ollamaBase);
        const loadedNames = loadedState.names;
        const targetTags = [
          selectedModel,
          model,
          rawModel,
        ].filter(Boolean);
        const isWarm = targetTags.some((t) => loadedNames.has(t));
        if (!isWarm && loadedState.reachable && loadedNames.size === 0) {
          // Nothing loaded at all → trigger async preload and return warming-up.
          startModelPreload(ollamaBase, normalizeModelTag(selectedModel));
          const preloadState = _preloadState.get(normalizeModelTag(selectedModel));
          const preloadAgeS = preloadState
            ? Math.round((Date.now() - preloadState.startedAt) / 1000)
            : 0;
          const warmingUpMsg = [
            `SwarmX model is warming up (responding to: "${message.slice(0, 80)}")`,
            "",
            "Ollama is reachable but no model is currently loaded in memory.",
            `Pilot (instruct-phi4-pro-q8-prod, ~4.3 GB) takes 60-120 s to load on`,
            `this host. A background preload has been started — please retry`,
            `your message in about 90 seconds.`,
            "",
            `Target model: ${model}`,
            `Ollama endpoint: ${ollamaBase}`,
            preloadAgeS > 0 ? `Preload started ${preloadAgeS}s ago` : "Preload just initiated",
            "",
            "Run `ollama ps` to monitor loading progress.",
          ]
            .filter(Boolean)
            .join("\n");
          server.log.info(
            {
              model,
              selectedModel,
              ollamaBase,
              preloadAge: preloadAgeS,
            },
            "composer_model_warming_up",
          );
          return mkResponse(warmingUpMsg, "fallback", {
            reason: "Model warming up — cold load in progress",
            ollamaReachable: true,
            ollamaEndpoint: ollamaBase,
            model,
            selectedModel,
            timeoutMs: effectiveTimeoutMs,
          });
        }
      }
      try {
        const modelCandidates = [
          ...preferredModelCandidates(promptComplexity, runtimePressure, selectedModel),
          ...configuredModelCandidates,
          ...preflightModels.map((candidate) => normalizeModelTag(candidate)),
        ]
          .map((m) => m.trim())
          .filter(Boolean)
          .filter((m, idx, arr) => arr.indexOf(m) === idx);

        if (circuitIsOpen(Date.now())) {
          throw new Error("Circuit breaker open: recent model failures exceeded threshold");
        }

        // [V6.2-FIX-01] Hard cap total model path budget so retries do not stall the route.
        const requestDeadlineMs = Date.now() + Math.max(10_000, effectiveTimeoutMs + 5_000);

        let lastError: Error | null = null;
        outer: for (const candidate of modelCandidates) {
          selectedModel = candidate;
          for (let attempt = 1; attempt <= COMPOSER_RETRY_MAX_ATTEMPTS; attempt++) {
            retryCount = Math.max(retryCount, attempt - 1);
            try {
              const remainingMs = requestDeadlineMs - Date.now();
              if (remainingMs <= 1500) {
                throw new Error("Composer request budget exceeded before model response");
              }
              const attemptTimeoutMs = Math.max(1200, Math.min(effectiveTimeoutMs, remainingMs));
              modelAttemptStartedAt = Date.now();

              const isRoutingCall =
                promptComplexity === "light" ||
                message.length < 120;

              const opKey: OperationKey = promptComplexity === "deep"
                ? "deep_reasoning"
                : isRoutingCall
                  ? "routing"
                  : "fast_chat";

              const {
                timeoutMs: adaptiveTimeoutMs,
                overrides,
                circuitOpen,
                pressure,
              } = getAdaptiveCallConfig(selectedModel, opKey);

              if (circuitOpen) {
                throw new Error(`Adaptive timeout circuit open for ${selectedModel}`);
              }

              // [APEX17-r8] Normalize through the canonical tag and request
              // readiness from the orchestrator BEFORE dispatch. This
              // enforces Hard Constraint #2 (SINGLE-7B LOCK) via
              // evictIncompatible() internally, and supplies the correct
              // per-model, per-pressure-mode keep-alive (e.g. "0s" for every
              // is7B specialist per configs/routing.yaml, vs the previous
              // static "10m" applied to everything). An explicit
              // SWARMX_COMPOSER_KEEP_ALIVE env override, if set, still wins.
              const canonicalSelectedModel = resolveCanonicalTag(selectedModel);
              const orchestratorResult = await orchestrator.requestModel(canonicalSelectedModel);
              const effectiveKeepAlive = composerKeepAliveOverride || orchestratorResult.keepAlive;

              if (orchestratorResult.evictedModels.length > 0) {
                server.log.info(
                  {
                    selectedModel: canonicalSelectedModel,
                    evictedModels: orchestratorResult.evictedModels,
                    orchestratorMode: orchestratorResult.mode,
                    ramAvailableMb: orchestratorResult.ramAvailableMb,
                  },
                  "composer_orchestrator_evicted",
                );
              }

              setActiveModel(selectedModel);

              const t0 = Date.now();

              try {
                const result = await withTimeout(
                  callOllama(
                    ollamaBase,
                    canonicalSelectedModel,
                    systemPrompt,
                    message,
                    effectiveKeepAlive,
                    composerNumPredict,
                    overrides,
                  ),
                  Math.min(adaptiveTimeoutMs, attemptTimeoutMs),
                  opKey,
                );

                recordSuccess(selectedModel);
                circuitRecordSuccess();
                orchestrator.onModelCallComplete(canonicalSelectedModel);

                const latencyMs = Date.now() - t0;

                recordLatency(latencyMs);
                recordTimeout(false);

                if (result.tokens) {
                  recordTokens(result.tokens);
                }

                server.log.debug(
                  {
                    selectedModel,
                    latencyMs,
                    pressure,
                    opKey,
                    adaptiveTimeoutMs,
                    keepAlive: effectiveKeepAlive,
                    attempt,
                  },
                  "composer_adaptive_call_ok",
                );

                // [APEX17-r8] sanitizeReasoningOutput() / extractJson() now
                // return structured result objects (SanitizeResult /
                // ExtractJsonResult<T>) rather than a bare string/value — see
                // apps/swarmx-api/src/services/reasoning-sanitizer.ts. This
                // also extends sanitization to EVERY DeepSeek-R1 family
                // model (Oracle, Auditor, Architect-deepseek, Lab-deepseek),
                // not just the literal substring "deepseek", which is the
                // same set in practice since all of those canonical tags
                // contain "deepseekr1" — kept as an explicit .includes()
                // check (rather than an is7B-style lookup) so this still
                // catches a model dispatched by a not-yet-canonicalized
                // legacy alias.
                const isDeepSeekFamily = canonicalSelectedModel.includes("deepseek");
                let cleanText = result.text;
                if (isDeepSeekFamily) {
                  const sanitized = sanitizeReasoningOutput(result.text);
                  cleanText = sanitized.text;
                  if (sanitized.hadThinkBlock || sanitized.hadHallucinatedXml || sanitized.wasTruncated) {
                    server.log.debug(
                      {
                        selectedModel: canonicalSelectedModel,
                        hadThinkBlock: sanitized.hadThinkBlock,
                        hadHallucinatedXml: sanitized.hadHallucinatedXml,
                        wasTruncated: sanitized.wasTruncated,
                        hadDuplicates: sanitized.hadDuplicates,
                        rawLength: sanitized.rawLength,
                        cleanLength: sanitized.cleanLength,
                      },
                      "composer_reasoning_sanitized",
                    );
                  }
                }

                responseText = cleanText;

                if (isDeepSeekFamily) {
                  const jsonResult = extractJson(cleanText);
                  if (!jsonResult.ok) {
                    server.log.debug(
                      { selectedModel: canonicalSelectedModel, error: jsonResult.error },
                      "composer_extract_json_miss",
                    );
                  }
                }

                break outer;
              } catch (adaptiveErr) {
                recordFailure(selectedModel);
                recordTimeout(true);

                const reason = adaptiveErr instanceof Error
                  ? adaptiveErr.message
                  : String(adaptiveErr);

                server.log.warn(
                  {
                    selectedModel,
                    reason,
                    pressure,
                    opKey,
                    adaptiveTimeoutMs,
                    attempt,
                  },
                  "composer_adaptive_call_failed",
                );

                throw adaptiveErr;
              }
            } catch (attemptErr) {
              const reason = attemptErr instanceof Error ? attemptErr.message : String(attemptErr);
              lastError = attemptErr instanceof Error ? attemptErr : new Error(reason);
              const canRetry = attempt < COMPOSER_RETRY_MAX_ATTEMPTS && shouldRetryModelError(reason);
              if (canRetry) {
                const delayMs = getJitteredDelayMs(
                  attempt - 1,
                  COMPOSER_RETRY_BASE_DELAY_MS,
                  COMPOSER_RETRY_MAX_DELAY_MS,
                );
                server.log.warn(
                  { selectedModel, attempt, delayMs, reason },
                  "composer_model_retry_backoff",
                );
                await jitteredDelay(
                  attempt - 1,
                  COMPOSER_RETRY_BASE_DELAY_MS,
                  COMPOSER_RETRY_MAX_DELAY_MS,
                );
                continue;
              }

              // [V6.2-FIX-15] Non-retryable failures such as 404 model-not-found
              // should advance to the next candidate immediately instead of
              // wasting the remaining attempts on the same missing tag.
              break;
            }
          }
        }

        if (typeof responseText !== "string" || responseText.trim().length === 0) {
          const fallbackError = lastError ?? new Error("Unknown model failure");
          throw fallbackError;
        }
      } catch (err) {
        const reason = err instanceof Error ? err.message : "Unknown error";
        const elapsedMs = modelAttemptStartedAt > 0 ? Date.now() - modelAttemptStartedAt : 0;
        const isTimeout = reason.toLowerCase().includes("timeout") || reason.toLowerCase().includes("abort");
        circuitRecordFailure(Date.now());
        if (isTimeout) {
          const bucket = timeoutBucketFor(elapsedMs);
          composerTimeoutHistogram[bucket] += 1;
          composerTimeoutCount += 1;
        }
        // [V6.2-FIX-07] Replace Promise.all with allSettled + per-call deadline
        // so a slow/unresponsive Ollama cannot stall the fallback response.
        const DIAG_DEADLINE_MS = 2500;
        const withDeadline = <T>(p: Promise<T>, fallback: T): Promise<T> =>
          Promise.race([
            p,
            new Promise<T>((resolve) => setTimeout(() => resolve(fallback), DIAG_DEADLINE_MS)),
          ]);
        const [availableModels, configuredModels, ollamaHealth] = await Promise.all([
          withDeadline(listAvailableModels(), []),
          withDeadline(getConfiguredModels(), []),
          withDeadline(checkOllamaHealth(), { reachable: false, endpoint: "", methodUsed: "static" }),
        ]);
        fallbackDiagnostics = {
          reason,
          ollamaReachable: ollamaHealth.reachable,
          ollamaEndpoint: ollamaHealth.endpoint,
          model,
          selectedModel,
          timeoutMs: effectiveTimeoutMs,
          retryCount,
          circuitOpen: composerCircuit.state === "open",
          pressureLevel: runtimePressure,
          availableRamMb,
        };
        server.log.warn(
          {
            err,
            model,
            selectedModel,
            activeModel: selectedModel,
            adaptivePressure: context?.pressureLevel,
            timeoutMs: effectiveTimeoutMs,
            elapsedMs,
            isTimeout,
            retryCount,
            circuitState: composerCircuit.state,
            circuitFailures: composerCircuit.failures,
            timeoutCount: composerTimeoutCount,
            ...(isTimeout && shouldLogHistogram() ? { timeoutHistogram: timeoutHistogramCompact() } : {}),
          },
          "Composer model call failed — using fleet summary fallback",
        );

        const simpleFallback = fallbackForSimplePrompt(message);
        if (simpleFallback) {
          responseText = simpleFallback;
          return mkResponse(responseText, "fallback", {
            reason,
            timeoutMs: effectiveTimeoutMs,
            model,
            selectedModel,
            retryCount,
            circuitOpen: composerCircuit.state === "open",
            pressureLevel: runtimePressure,
            availableRamMb,
          });
        }

        // [SEED-FIX-03] Surface actionable diagnostics: model mismatch vs timeout.
        const modelMismatch = availableModels.length > 0 && !availableModels.some(
          (m) => m === model || m.startsWith(rawModel + ":"),
        );
        // [V6.2-FIX-20] Include http-health (endpoint reachable, /api/tags failed or
        // empty) in the "no models" branch — both cases indicate nothing to call.
        const noInstalledModels =
          availableModels.length === 0 &&
          (ollamaHealth.methodUsed === "http" || ollamaHealth.methodUsed === "http-health");

        responseText = [
          `SwarmX fleet summary (responding to: "${message}")`,
          "",
          `Active agents: ${runningCount}`,
          `Error agents: ${errorCount}`,
          `Total registered: ${agents.length}`,
          ...agents
            .slice(0, 8)
            .map(
              (a) =>
                `  • ${a.name ?? a.id} [${a.status}]${a.currentTask ? ` — ${a.currentTask}` : ""}`,
            ),
          agents.length > 8 ? `  …and ${agents.length - 8} more` : "",
          "",
          `Composer model fallback reason: ${reason}`,
          `Configured Ollama endpoint: ${ollamaBase}`,
          `Model discovery source: ${ollamaHealth.methodUsed}`,
          `Configured model: ${model} (resolved from: ${rawModel})`,
          // [V6.2-FIX-19] "Last attempted model" is more accurate than "Selected model"
          // when the candidate loop exhausted all options — selectedModel holds the
          // last candidate tried, not a deliberate upfront choice.
          selectedModel !== model ? `Last attempted model: ${selectedModel}` : "",
          `Retry attempts used: ${retryCount}`,
          composerCircuit.state === "open"
            ? `Circuit breaker: OPEN for ${Math.ceil(COMPOSER_CB_OPEN_MS / 1000)}s after repeated model failures.`
            : `Circuit breaker: ${composerCircuit.state.toUpperCase()} (failures: ${composerCircuit.failures}).`,
          availableModels.length > 0
            ? `Available local models: ${availableModels.join(", ")}`
            : noInstalledModels
            ? "Available local models: (none installed on this Ollama endpoint)"
            : "Available local models: (unavailable - could not query /api/tags)",
          configuredModels.length > 0 ? `Configured model candidates: ${configuredModels.join(", ")}` : "",
          modelMismatch
            ? `⚠ Model "${model}" not found — try: SWARMX_COMPOSER_MODEL=${availableModels[0] ?? "instruct-phi4-pro-q8-prod:latest"}`
            : noInstalledModels
            ? "Install at least one model on this Ollama endpoint, then set SWARMX_COMPOSER_MODEL to that exact tag."
            : isTimeout
            ? `⏱ Timeout after ${effectiveTimeoutMs}ms — increase via SWARMX_COMPOSER_TIMEOUT_MS env var`
            : `Set SWARMX_COMPOSER_MODEL (or SWARM_MODEL_FAST / SWARMX_MODEL_FAST) to a model available in your local Ollama registry.`,
        ]
          .filter((l) => l !== "")
          .join("\n");
        usedSummaryFallback = true;
      }

      if (usedSummaryFallback) {
        return mkResponse(responseText, "fallback", fallbackDiagnostics ?? {
          reason: "model_path_unavailable",
          model,
          selectedModel,
          timeoutMs: effectiveTimeoutMs,
        });
      }

      return mkResponse(responseText, "model", {
        model,
        selectedModel,
        timeoutMs: effectiveTimeoutMs,
      });
    }
  );
}
