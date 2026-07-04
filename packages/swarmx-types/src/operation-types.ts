/**
 * packages/swarmx-types/src/operation-types.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Shared operation/timeout types — APEX-17 r8 integration
 * Version : v2026.6.28-apex17-r8
 *
 * WHY THIS FILE EXISTS:
 * apps/swarmx-api/src/services/adaptive-timeout-config.ts previously defined
 * its own local `OperationKey` and `PressureLevel` types. The new
 * model-orchestrator.ts (introduced in this same r8 integration pass) needs
 * the identical `OperationKey` vocabulary and the identical timeout-domain
 * pressure scale to stay consistent with adaptive-timeout-config.ts's
 * TIMEOUT_MATRIX and getModelOverrides(). Per this integration's explicit
 * instruction ("model-orchestrator.ts must use the same OperationKey +
 * PressureLevel definitions — do not define them twice"), both types are
 * extracted to this shared package so neither service redefines them.
 *
 * NAMING NOTE — why this is `TimeoutPressureLevel`, not `PressureLevel`:
 * packages/swarmx-types/src/index.ts ALREADY exports an unrelated
 * `PressureLevel = "normal" | "high" | "critical"` (3 values, no "low") that
 * backs the system:governor SSE event and the dashboard's pressure badge —
 * see RuntimeGovernorSnapshot in index.ts. That type predates this
 * integration, is wired into the dashboard already, and is governed by
 * different thresholds (models/registry.yaml + swarm-pressure-monitor.ts)
 * than adaptive-timeout-config.ts's 4-value scale ("low" | "normal" | "high"
 * | "critical", driven by its own PRESSURE_THRESHOLDS_MB). Re-using the bare
 * name `PressureLevel` for this distinct, 4-value, timeout-domain concept
 * would either (a) silently shadow the governor's type for any file that
 * imports both from the same barrel, or (b) force a breaking rename of the
 * already-shipped governor type — both out of scope and both violating this
 * integration's "no unrelated rewrites" constraint. `TimeoutPressureLevel` is
 * the honest, collision-free name for what this type actually represents.
 * Consumers that want the short local name `PressureLevel` can alias on
 * import: `import { TimeoutPressureLevel as PressureLevel } from
 * "@swarmx/types/operation-types";` — both adaptive-timeout-config.ts and
 * model-orchestrator.ts do exactly this.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/** Timeout-matrix / ctx-override pressure scale. NOT the same as the
 *  3-value system:governor PressureLevel exported from ./index.ts. */
export type TimeoutPressureLevel = "low" | "normal" | "high" | "critical";

/**
 * Every distinct operation type the timeout matrix and model-call overrides
 * are keyed by. Mirrors configs/routing.yaml's dispatch_rules signal classes
 * and models/registry.yaml's operator_taxonomy 1:1.
 *
 * Operator → Operation mapping (informational):
 *   Relay     → intent_classify, routing, health_probe
 *   Pilot     → fast_chat
 *   Architect → supervisor_planning, tool_execution
 *   Forge     → code_generation, tool_execution
 *   Oracle    → deep_reasoning
 *   Auditor   → critic_audit
 *   Lab       → evolver_observe, evolver_critique, evolver_mutate, evolver_validate
 */
export type OperationKey =
  | "intent_classify"       // Relay (route-phi4-lite-q4km-prod): routing decision only
  | "routing"               // Relay (route-phi4-lite-q4km-prod): classify + route
  | "fast_chat"             // Pilot (instruct-phi4-pro-q8-prod): short conversational
  | "tool_execution"        // Forge or Architect (phi4): single tool call
  | "supervisor_planning"   // Architect (plan-qwen25-pro-q5km-prod): multi-step plan
  | "code_generation"       // Forge (code-qwen25-pro-q5km-prod): implementation
  | "deep_reasoning"        // Oracle (reason-deepseekr1-pro-q5km-prod): analysis
  | "critic_audit"          // Auditor (critique-deepseekr1-pro-q5km-prod): review
  | "evolver_observe"       // Lab (synth-phi4-exp-q8-dev): Phase 1 fitness snapshot
  | "evolver_critique"      // Lab (synth-deepseekr1-exp-q5km-dev): Phase 2 critique
  | "evolver_mutate"        // Lab (synth-qwen25-exp-q5km-dev): Phase 3 mutation
  | "evolver_validate"      // Lab (synth-deepseekr1-exp-q5km-dev): Phase 4 validate
  | "health_probe";         // /api/version or /api/tags probe
