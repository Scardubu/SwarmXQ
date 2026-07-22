/**
 * Gate 7: Creative Factory invariant gate.
 *
 * Thin entry-point that exercises all 22 release invariants defined in
 * creative-factory-release-check.ts and exits non-zero on the first
 * assertion failure.
 *
 * Run via: pnpm --filter @swarmx/api run test:factory:gate
 *       or: npx tsx apps/swarmx-api/scripts/creative-factory-invariant.ts
 */
await import("./creative-factory-release-check.ts");
