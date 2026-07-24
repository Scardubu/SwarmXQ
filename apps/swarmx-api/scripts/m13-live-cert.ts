/**
 * M13 Golden-Path Live Re-Certification harness.
 *
 * Submits a real video job through the running API, polls until completion,
 * and asserts all M13 success criteria:
 *   1. stageValidationTrace populated (≥3 entries)
 *   2. modelsUsed populated (≥4 text stages)
 *   3. certificationTier ≥ PRODUCTION_PACK_VALID
 *   4. /api/system/health exposes voice.benchmark + runtimeProfile
 *   5. QC report present in completed job output
 *
 * Requires:
 *   - Fastify API server running at SWARMX_API_BASE_URL / SWARMX_API_URL
 *     (default http://127.0.0.1:3001)
 *   - SWARMX_VIDEO_API_TOKEN env var set
 *   - Ollama + Redis + Kokoro online
 *
 * Exits 0 on all assertions passing; exits 1 on any failure.
 */

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// ── Constants ─────────────────────────────────────────────────────────────────

function resolveApiBase(): string {
  const explicit = process.env["SWARMX_API_BASE_URL"] ?? process.env["SWARMX_API_URL"];
  if (explicit?.trim()) {
    return explicit.trim().replace(/\/$/, "");
  }
  const host = process.env["SWARMX_API_HOST"] ?? "127.0.0.1";
  const port = process.env["SWARMX_API_PORT"] ?? "3001";
  return `http://${host}:${port}`.replace(/\/$/, "");
}

const API_BASE = resolveApiBase();
const API_TOKEN = process.env["SWARMX_VIDEO_API_TOKEN"] ?? "";
const POLL_INTERVAL_MS = 10_000;
const JOB_TIMEOUT_MS = 30 * 60 * 1_000; // 30 minutes
const FULL_PIPELINE_MIN_AVAILABLE_MB = 6_170;

const CERT_RANK: Record<string, number> = {
  TECHNICALLY_VALID: 1,
  CREATIVE_REVIEW_REQUIRED: 2,
  PRODUCTION_PACK_VALID: 3,
  READY_TO_POST: 4,
  PUBLISHING: 5,
  PUBLISHED_VERIFIED: 6,
};

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

const repoRoot = resolve(fileURLToPath(import.meta.url), "../../../../");
const certDir = resolve(repoRoot, ".swarmx/video/artifacts/m13");

// ── Types (minimal — HTTP-only, no service imports) ───────────────────────────

interface VideoJob {
  id: string;
  status: string;
  stageValidationTrace?: unknown[];
  modelsUsed?: Record<string, string>;
  certificationTier?: string;
  renderPackage?: { qualityReport?: unknown };
  output?: {
    modelsUsed?: Record<string, string>;
    certificationTier?: string;
    mediaQualityReport?: unknown;
  };
  error?: unknown;
  errorCode?: string;
  overallProgress?: number;
  currentStage?: string;
}

interface HealthResponse {
  status: string;
  ollama?: { reachable?: boolean };
  models?: Array<{ role?: string; tag?: string; status?: string; error?: string }>;
  voice?: { benchmark?: { recommendedProviderId?: string } };
  runtimeProfile?: {
    id?: string;
    availableRamMb?: number;
    blockers?: string[];
    warnings?: string[];
  };
}

interface CertAssertion {
  name: string;
  passed: boolean;
  expected: string;
  actual: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function authHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(API_TOKEN ? { Authorization: `Bearer ${API_TOKEN}` } : {}),
  };
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function isCertAtLeast(tier: string | undefined, min: string): boolean {
  const actual = CERT_RANK[tier ?? ""] ?? 0;
  const required = CERT_RANK[min] ?? 0;
  return actual >= required;
}

function assert_cert(assertions: CertAssertion[], name: string, passed: boolean, expected: string, actual: string): void {
  assertions.push({ name, passed, expected, actual });
  if (!passed) process.stderr.write(`  ✗ ${name}: expected ${expected}, got ${actual}\n`);
  else process.stdout.write(`  ✓ ${name}\n`);
}

function formatErrorForOutput(error: unknown): string {
  if (typeof error === "string") return error;
  if (error == null) return "";
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

function collectPreflightFailures(health: HealthResponse): string[] {
  const failures: string[] = [];

  if (health.status === "degraded") {
    failures.push("system health status is degraded");
  } else if (health.status !== "ok" && health.status !== "warning") {
    failures.push(`system health status is ${health.status}`);
  }

  if (health.ollama?.reachable !== true) {
    failures.push("Ollama is not reachable");
  }

  const missingModels = (health.models ?? []).filter((model) => model.status !== "ready");
  if (missingModels.length > 0) {
    const summary = missingModels
      .map((model) => `${model.role ?? "model"}:${model.tag ?? "unknown"}=${model.status ?? "unknown"}`)
      .join(", ");
    failures.push(`model readiness failed (${summary})`);
  }

  const blockers = health.runtimeProfile?.blockers ?? [];
  if (blockers.length > 0) {
    failures.push(`runtime profile blockers present (${blockers.join("; ")})`);
  }

  const availableRamMb = health.runtimeProfile?.availableRamMb;
  if (availableRamMb == null) {
    failures.push("runtimeProfile.availableRamMb is missing");
  } else if (availableRamMb < FULL_PIPELINE_MIN_AVAILABLE_MB) {
    failures.push(
      `available RAM ${availableRamMb} MB is below full-pipeline minimum ${FULL_PIPELINE_MIN_AVAILABLE_MB} MB`,
    );
  }

  if (health.voice?.benchmark?.recommendedProviderId == null) {
    failures.push("voice benchmark recommendation is missing");
  }

  if (health.runtimeProfile?.id == null) {
    failures.push("runtimeProfile.id is missing");
  }

  return failures;
}

function formatProgress(progress: number | undefined): string {
  if (progress == null) {
    return "--";
  }
  const normalized = progress <= 1 ? progress * 100 : progress;
  return `${Math.round(normalized)}%`;
}

function resolveModelsUsed(job: VideoJob): Record<string, string> {
  return job.modelsUsed ?? job.output?.modelsUsed ?? {};
}

function resolveCertificationTier(job: VideoJob): string | undefined {
  return job.certificationTier ?? job.output?.certificationTier;
}

function hasQualityReport(job: VideoJob): boolean {
  return job.renderPackage?.qualityReport != null || job.output?.mediaQualityReport != null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

process.stdout.write("\n┌─ M13 Live Re-Certification ─────────────────────────────────────┐\n");
process.stdout.write(`│ API:   ${API_BASE}\n`);
process.stdout.write("│ Mode:  direct Fastify API validation\n");
process.stdout.write(`│ Auth:  ${API_TOKEN ? "Bearer ***" : "MISSING — video writes will be blocked"}\n`);
process.stdout.write("└──────────────────────────────────────────────────────────────────┘\n\n");

if (!API_TOKEN) {
  process.stderr.write("ERROR: SWARMX_VIDEO_API_TOKEN is not set. Exiting.\n");
  process.exit(1);
}

// Step 1 — Pre-flight: health check
process.stdout.write("Step 1 — Pre-flight health check\n");
let health: HealthResponse;
try {
  health = await getJson<HealthResponse>("/api/system/health");
  process.stdout.write(`  API reachable: status=${health.status}\n`);
} catch (err) {
  process.stderr.write(`  ERROR: API not reachable at ${API_BASE} — ${String(err)}\n`);
  process.stderr.write("  Ensure the API server is running and SWARMX_API_BASE_URL is correct.\n");
  process.exit(1);
}

const preflightVoice = health.voice?.benchmark?.recommendedProviderId;
const preflightProfile = health.runtimeProfile?.id;
const preflightAvailableMb = health.runtimeProfile?.availableRamMb;
const modelReadyCount = (health.models ?? []).filter((model) => model.status === "ready").length;
const modelTotalCount = health.models?.length ?? 0;
process.stdout.write(`  voice.benchmark.recommendedProviderId: ${preflightVoice ?? "null"}\n`);
process.stdout.write(`  runtimeProfile.id: ${preflightProfile ?? "null"}\n`);
process.stdout.write(`  runtimeProfile.availableRamMb: ${preflightAvailableMb ?? "null"}\n`);
process.stdout.write(`  model readiness: ${modelReadyCount}/${modelTotalCount} ready\n`);

const preflightFailures = collectPreflightFailures(health);
if (preflightFailures.length > 0) {
  process.stderr.write("\nERROR: M13 preflight failed. No video job was submitted.\n");
  for (const failure of preflightFailures) {
    process.stderr.write(`  - ${failure}\n`);
  }
  process.stderr.write("\nRecover the runtime and rerun test:m13.\n");
  process.exit(1);
}

process.stdout.write("\n");

// Step 2 — Submit job
const clientRequestId = `m13-live-cert-${Date.now()}`;
process.stdout.write(`Step 2 — Submit job (clientRequestId: ${clientRequestId})\n`);

const jobBody = {
  prompt: "Habit formation accelerates when it becomes visible.",
  platform: "tiktok",
  niche: "motivational",
  targetDurationSeconds: 18,
  tone: "kinetic_text",
  style: "kinetic_text",
  captionStyle: "bold_center",
  voice: "narrator",
  clientRequestId,
};

interface JobCreateResponse { jobId: string; message?: string }
const created = await postJson<JobCreateResponse>("/api/video/jobs", jobBody);
const jobId = created.jobId;
assert.ok(jobId, "POST /api/video/jobs must return a jobId");
process.stdout.write(`  Job created: ${jobId}\n\n`);

// Step 3 — Poll to completion
process.stdout.write("Step 3 — Polling job to completion (30 min timeout)\n");
const startedAt = Date.now();
let job: VideoJob | null = null;

while (true) {
  if (Date.now() - startedAt > JOB_TIMEOUT_MS) {
    process.stderr.write("ERROR: Job did not complete within 30 minutes.\n");
    process.exit(1);
  }

  job = await getJson<VideoJob>(`/api/video/jobs/${jobId}`);
  const progress = formatProgress(job.overallProgress);
  process.stdout.write(`  [${new Date().toISOString()}] status=${job.status} stage=${job.currentStage ?? "?"} progress=${progress}\n`);

  if (TERMINAL_STATUSES.has(job.status)) break;
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

if (job.status !== "completed") {
  process.stderr.write(`ERROR: Job ended with status=${job.status}\n`);
  const formattedError = formatErrorForOutput(job.error);
  if (formattedError) process.stderr.write(`  error: ${formattedError}\n`);
  if (job.errorCode) process.stderr.write(`  errorCode: ${job.errorCode}\n`);
  process.exit(1);
}

const wallSec = ((Date.now() - startedAt) / 1_000).toFixed(0);
process.stdout.write(`\n  Job completed in ${wallSec}s\n\n`);

// Step 4 — Assert M13 criteria
process.stdout.write("Step 4 — M13 criteria assertions\n");
const assertions: CertAssertion[] = [];

const traceLen = job.stageValidationTrace?.length ?? 0;
assert_cert(assertions, "stageValidationTrace populated (≥3 entries)", traceLen >= 3, "≥3", String(traceLen));

const modelsCount = Object.keys(resolveModelsUsed(job)).length;
assert_cert(assertions, "modelsUsed populated (≥4 text stages)", modelsCount >= 4, "≥4", String(modelsCount));

const certTier = resolveCertificationTier(job) ?? "none";
assert_cert(assertions, "certificationTier ≥ PRODUCTION_PACK_VALID", isCertAtLeast(certTier, "PRODUCTION_PACK_VALID"), "≥PRODUCTION_PACK_VALID", certTier);

const hasQcReport = hasQualityReport(job);
assert_cert(assertions, "QC report present in completed job output", hasQcReport, "present", hasQcReport ? "present" : "missing");

// Step 5 — Re-check health post-completion
process.stdout.write("\nStep 5 — Post-completion health check\n");
const healthPost = await getJson<HealthResponse>("/api/system/health");
const postVoice = healthPost.voice?.benchmark?.recommendedProviderId;
const postProfile = healthPost.runtimeProfile?.id;

assert_cert(assertions, "health: voice.benchmark.recommendedProviderId present", postVoice != null, "non-null", postVoice ?? "null");
assert_cert(assertions, "health: runtimeProfile.id present", postProfile != null, "non-null", postProfile ?? "null");

// Step 6 — Write report
await mkdir(certDir, { recursive: true });

const failedCount = assertions.filter((a) => !a.passed).length;
const report = {
  version: "M13",
  generatedAt: new Date().toISOString(),
  jobId,
  clientRequestId,
  wallTimeSecs: Number(wallSec),
  certificationTier: certTier,
  stageValidationTraceLength: traceLen,
  modelsUsedCount: modelsCount,
  preflight: { voiceRecommended: preflightVoice, runtimeProfileId: preflightProfile },
  postCompletion: { voiceRecommended: postVoice, runtimeProfileId: postProfile },
  assertions,
  passed: failedCount === 0,
};

const reportPath = resolve(certDir, "m13-cert-report.json");
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

process.stdout.write(`\nReport written: ${reportPath}\n`);

if (failedCount > 0) {
  process.stderr.write(`\n✗ M13 FAILED — ${failedCount} assertion(s) did not pass.\n`);
  process.exit(1);
}

process.stdout.write(`\n✓ M13 PASSED — all ${assertions.length} assertions satisfied.\n`);
process.stdout.write(`  certificationTier: ${certTier}  |  wallTime: ${wallSec}s\n\n`);
