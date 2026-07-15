/**
 * Regression tests for the reasoning-sanitizer service.
 * Run with: tsx scripts/reasoning-sanitizer-regression.ts
 */
import assert from "node:assert";
import {
  sanitizeReasoningOutput,
  extractJson,
} from "../src/services/reasoning-sanitizer.js";

// ── sanitizeReasoningOutput ───────────────────────────────────────────────────

{
  const r = sanitizeReasoningOutput("");
  assert.strictEqual(r.text, "");
  assert.strictEqual(r.hadThinkBlock, false);
  assert.strictEqual(r.rawLength, 0);
}

{
  // Clean text must pass through unchanged
  const clean = "Here is a summary of the swarm state.";
  const r = sanitizeReasoningOutput(clean);
  assert.strictEqual(r.text, clean);
  assert.strictEqual(r.hadThinkBlock, false);
  assert.strictEqual(r.hadHallucinatedXml, false);
}

{
  // Closed think block stripped
  const raw = "<think>Private CoT reasoning here.</think>\nFinal answer.";
  const r = sanitizeReasoningOutput(raw);
  assert.ok(!r.text.includes("<think>"), "think block must be removed");
  assert.strictEqual(r.hadThinkBlock, true);
  assert.ok(r.text.includes("Final answer."), "visible answer must remain");
}

{
  // Unclosed think block (model hit num_predict ceiling)
  const raw = "Some preamble.\n<think>CoT starts but never ends because model was cut off";
  const r = sanitizeReasoningOutput(raw);
  assert.ok(!r.text.includes("<think>"), "unclosed think block must be removed");
  assert.strictEqual(r.hadThinkBlock, true);
}

{
  // Hallucinated role tags stripped
  const raw = "<|im_start|>assistant\nHere is the result.</s>";
  const r = sanitizeReasoningOutput(raw);
  assert.ok(!r.text.includes("<|im_start|>"), "ChatML marker must be removed");
  assert.strictEqual(r.hadHallucinatedXml, true);
}

{
  // ASSISTANT: prefix stripped
  const raw = "ASSISTANT: The fleet has 3 active agents.";
  const r = sanitizeReasoningOutput(raw);
  assert.ok(!r.text.startsWith("ASSISTANT:"), "role prefix must be removed");
}

{
  // Runaway output truncated
  const runaway = "A".repeat(20_000);
  const r = sanitizeReasoningOutput(runaway);
  assert.ok(r.wasTruncated, "runaway output must be flagged as truncated");
  assert.ok(r.text.length < 20_000, "truncated text must be shorter than input");
}

// ── extractJson ───────────────────────────────────────────────────────────────

{
  // Clean JSON object
  const raw = '{"status":"ok","count":3}';
  const r = extractJson<{ status: string; count: number }>(raw);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data?.status, "ok");
  assert.strictEqual(r.data?.count, 3);
}

{
  // JSON wrapped in think block
  const raw = '<think>Let me produce the JSON now.</think>\n{"type":"agent_list","agents":[]}';
  const r = extractJson<{ type: string }>(raw);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data?.type, "agent_list");
}

{
  // JSON wrapped in markdown code fence
  const raw = "```json\n{\"value\":42}\n```";
  const r = extractJson<{ value: number }>(raw);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.data?.value, 42);
}

{
  // Completely non-JSON input returns ok=false
  const raw = "I cannot provide a JSON answer for this query.";
  const r = extractJson(raw);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.data, null);
}

console.log("PASS: reasoning-sanitizer — all assertions passed");
