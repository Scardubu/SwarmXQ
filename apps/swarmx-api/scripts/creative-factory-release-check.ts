/**
 * Creative Factory source-aware release invariants.
 *
 * This script checks cross-package safety properties that are too broad for a
 * single unit test but too important to leave as documentation-only promises.
 * It is intentionally offline: no Docker, Redis, Ollama, or network required.
 */

import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

const repoRoot = new URL("../../../", import.meta.url);
const PUBLIC_VIDEO_TOKEN_ENV = `NEXT_PUBLIC_${"SWARMX_VIDEO_API_TOKEN"}`;

async function readRepoFile(path: string): Promise<string> {
  return readFile(new URL(path, repoRoot), "utf8");
}

async function listFilesRecursive(relativeDir: string): Promise<string[]> {
  const root = new URL(relativeDir, repoRoot);
  const results: string[] = [];
  async function walk(absDir: string, relPrefix: string): Promise<void> {
    const entries = await readdir(absDir, { withFileTypes: true });
    await Promise.all(entries.map(async (entry) => {
      const relPath = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      const absPath = join(absDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath, relPath);
        return;
      }
      if (entry.isFile()) results.push(`${relativeDir.replace(/\/$/, "")}/${relPath}`);
    }));
  }
  await walk(root.pathname, "");
  return results.sort();
}

function assertIncludes(source: string, needle: string, message: string): void {
  assert.ok(source.includes(needle), message);
}

const workflowSource = await readRepoFile("apps/swarmx-api/src/services/creative-factory-workflow.ts");
for (const stage of [
  "INTAKE_VALIDATE",
  "BRAND_AUDIENCE_RESOLVE",
  "EPISODE_SCRIPT_VALIDATE",
  "HUMAN_REVIEW",
  "PLATFORM_PACKAGE",
  "PUBLISH_OR_EXPORT",
  "ANALYTICS_INGEST",
  "LEARNING_UPDATE",
]) {
  assertIncludes(workflowSource, `"${stage}"`, `Creative Factory workflow must include ${stage}`);
}
assertIncludes(workflowSource, "hydrateWorkflowRunsFromDisk", "workflow runs must hydrate from durable state");
assertIncludes(workflowSource, "idempotencyKey", "workflow runs must carry an idempotency key");
assertIncludes(workflowSource, "humanApprovalRequired", "workflow stages must model human approval gates");

const localStoreSource = await readRepoFile("apps/swarmx-api/src/services/local-state-store.ts");
assertIncludes(localStoreSource, "appendFileSync", "local state store must keep an append-only lifecycle journal");
assertIncludes(localStoreSource, "renameSync", "local state store must write atomic snapshots through rename");
assertIncludes(localStoreSource, "schemaVersion", "local state store must version persisted snapshots");

const serverSource = await readRepoFile("apps/swarmx-api/src/server.ts");
assertIncludes(serverSource, "hydrateVideoQueueFromDisk", "API startup must hydrate video jobs");
assertIncludes(serverSource, "hydrateSeriesRegistryFromDisk", "API startup must hydrate series jobs");
assertIncludes(serverSource, "hydrateWorkflowRunsFromDisk", "API startup must hydrate workflow runs");
assertIncludes(serverSource, "SWARMX_VIDEO_API_TOKEN is not set", "production write-token fail-closed warning must remain");

const preproducerSource = await readRepoFile("apps/swarmx-api/src/services/video-episode-preproducer.ts");
assertIncludes(
  preproducerSource,
  'status: qualityGateResult.passed ? "complete" : "failed"',
  "mandatory quality-gate failure must not mark pre-production complete",
);
assertIncludes(preproducerSource, "QUALITY_GATE_FAILED", "failed mandatory quality gates must expose a stable code");

const seriesTypesSource = await readRepoFile("packages/swarmx-types/src/series-types.ts");
assertIncludes(seriesTypesSource, "EpisodePreProductionErrorCode", "episode pre-production failures must be typed");
assertIncludes(seriesTypesSource, "QUALITY_GATE_FAILED", "quality-gate failures must have a canonical error code");

const dashboardProxySource = await readRepoFile("apps/swarmx-dashboard/src/app/api/[...path]/route.ts");
assertIncludes(dashboardProxySource, 'headers.delete("authorization")', "proxy must strip browser Authorization headers");
assertIncludes(dashboardProxySource, 'headers.delete("x-video-api-key")', "proxy must strip browser video API-key headers");
assertIncludes(dashboardProxySource, "process.env.SWARMX_VIDEO_API_TOKEN", "proxy must use server-only video token");
assert.equal(
  dashboardProxySource.includes(PUBLIC_VIDEO_TOKEN_ENV),
  false,
  "proxy must never read a public video write-token env var",
);

const nextConfigSource = await readRepoFile("apps/swarmx-dashboard/next.config.ts");
assert.equal(nextConfigSource.includes('source: "/api/:path*"'), false, "Next rewrites must not own /api/*");
assertIncludes(nextConfigSource, 'source: "/ws/:path*"', "WebSocket rewrite must remain separate from API proxy");

const composeSource = await readRepoFile("docker-compose.yml");
for (const requiredDefault of [
  'OLLAMA_MAX_LOADED_MODELS: "${OLLAMA_MAX_LOADED_MODELS:-2}"',
  'OLLAMA_NUM_PARALLEL: "${OLLAMA_NUM_PARALLEL:-1}"',
  'OLLAMA_KEEP_ALIVE: "${OLLAMA_KEEP_ALIVE:-0}"',
  'OLLAMA_FLASH_ATTENTION: "${OLLAMA_FLASH_ATTENTION:-0}"',
  'OLLAMA_KV_CACHE_TYPE: "${OLLAMA_KV_CACHE_TYPE:-f16}"',
]) {
  assertIncludes(composeSource, requiredDefault, `docker-compose.yml missing ${requiredDefault}`);
}

for (const docsFile of [
  "docs/CREATIVE_FACTORY_AUDIT_LEDGER.md",
  "docs/CREATIVE_FACTORY_RELEASE_STATUS.md",
  "docs/CONFIG_REFERENCE.md",
  "docs/VIDEO-GENERATION.md",
]) {
  const docsSource = await readRepoFile(docsFile);
  assert.equal(
    docsSource.includes(PUBLIC_VIDEO_TOKEN_ENV),
    false,
    `${docsFile} must not document browser-exposed video write tokens`,
  );
}

const dashboardSourceFiles = await listFilesRecursive("apps/swarmx-dashboard/src");
for (const file of dashboardSourceFiles.filter((path) => /\.(ts|tsx)$/.test(path))) {
  const source = await readRepoFile(file);
  assert.equal(
    source.includes(PUBLIC_VIDEO_TOKEN_ENV),
    false,
    `${file} must not read a public video write-token env var`,
  );
}

console.log("Creative Factory release invariants passed.");
