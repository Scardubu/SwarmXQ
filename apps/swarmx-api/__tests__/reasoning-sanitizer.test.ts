import { describe, test, expect } from "vitest";
import {
  sanitizeReasoningOutput,
  extractJson,
  StreamingSanitizer,
} from "../src/services/reasoning-sanitizer.js";

// ─── sanitizeReasoningOutput ──────────────────────────────────────────────────

describe("sanitizeReasoningOutput", () => {
  test("empty string returns empty text with all flags false", () => {
    const r = sanitizeReasoningOutput("");
    expect(r.text).toBe("");
    expect(r.hadThinkBlock).toBe(false);
    expect(r.hadHallucinatedXml).toBe(false);
    expect(r.wasTruncated).toBe(false);
    expect(r.hadDuplicates).toBe(false);
    expect(r.rawLength).toBe(0);
    expect(r.cleanLength).toBe(0);
  });

  test("clean text passes through unchanged", () => {
    const clean = "Here is a clear summary of the swarm state.";
    const r = sanitizeReasoningOutput(clean);
    expect(r.text).toBe(clean);
    expect(r.hadThinkBlock).toBe(false);
    expect(r.hadHallucinatedXml).toBe(false);
    expect(r.wasTruncated).toBe(false);
    expect(r.hadDuplicates).toBe(false);
  });

  test("single think block is stripped and hadThinkBlock is set", () => {
    const raw = "<think>Private CoT reasoning here.</think>\nFinal answer.";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).toBe("Final answer.");
    expect(r.hadThinkBlock).toBe(true);
    expect(r.hadHallucinatedXml).toBe(false);
  });

  test("multiple think blocks are all stripped", () => {
    const raw = "<think>first</think> visible <think>second</think> end";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).not.toContain("<think>");
    expect(r.text).not.toContain("</think>");
    expect(r.text).toContain("visible");
    expect(r.text).toContain("end");
    expect(r.hadThinkBlock).toBe(true);
  });

  test("think block with no content after it results in empty text", () => {
    const raw = "<think>model stopped here without answering</think>";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).toBe("");
    expect(r.hadThinkBlock).toBe(true);
  });

  test("markdown json code fence is stripped, interior content is kept", () => {
    const raw = "```json\n{\"status\":\"ok\"}\n```";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).toBe('{"status":"ok"}');
    expect(r.hadHallucinatedXml).toBe(false);
  });

  test("hallucinated <|User|> role tag is stripped", () => {
    const raw = "<|User|>What is the plan?<|Assistant|>Here it is.";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).not.toContain("<|User|>");
    expect(r.text).not.toContain("<|Assistant|>");
    expect(r.hadHallucinatedXml).toBe(true);
  });

  test("hallucinated <tool_call> wrapper is stripped", () => {
    const raw = "<tool_call>call_tool(x)</tool_call>The result is ready.";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).not.toContain("<tool_call>");
    expect(r.text).not.toContain("</tool_call>");
    expect(r.hadHallucinatedXml).toBe(true);
    expect(r.text).toContain("The result is ready.");
  });

  test("prose 'Assistant:' prefix is stripped from start of line", () => {
    const raw = "ASSISTANT: Here is the response.";
    const r = sanitizeReasoningOutput(raw);
    expect(r.text).not.toContain("ASSISTANT:");
    expect(r.hadHallucinatedXml).toBe(true);
  });

  test("string over 16 000 chars is truncated and wasTruncated is set", () => {
    const raw = "x".repeat(20_000);
    const r = sanitizeReasoningOutput(raw);
    expect(r.wasTruncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(16_000);
  });

  test("sentence repeated 3+ times is collapsed and hadDuplicates is set", () => {
    const rep = "The model generates repetitive artifacts on cpu hardware.";
    const text =
      `First unique filler sentence here. Second unique filler sentence here. ` +
      `Third unique filler sentence here. ${rep} Fourth unique sentence. ` +
      `${rep} Fifth unique sentence. ${rep}`;
    const r = sanitizeReasoningOutput(text);
    expect(r.hadDuplicates).toBe(true);
    // Third occurrence should be removed — at most 2 occurrences in result
    const occurrences = (r.text.match(
      new RegExp(rep.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
    ) ?? []).length;
    expect(occurrences).toBeLessThanOrEqual(2);
  });

  test("rawLength and cleanLength are reported correctly", () => {
    const raw = "<think>cot</think>answer";
    const r = sanitizeReasoningOutput(raw);
    expect(r.rawLength).toBe(raw.length);
    expect(r.cleanLength).toBe(r.text.length);
  });
});

// ─── extractJson ──────────────────────────────────────────────────────────────

describe("extractJson", () => {
  test("direct JSON object parse succeeds", () => {
    const r = extractJson<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    expect(r.data?.a).toBe(1);
    expect(r.wasRepaired).toBe(false);
  });

  test("direct JSON array parse succeeds", () => {
    const r = extractJson<number[]>("[1,2,3]");
    expect(r.ok).toBe(true);
    expect(r.data).toEqual([1, 2, 3]);
  });

  test("JSON object embedded in surrounding text is extracted", () => {
    const r = extractJson<{ status: string }>('prefix text {"status":"ok"} trailing');
    expect(r.ok).toBe(true);
    expect(r.data?.status).toBe("ok");
  });

  test("trailing comma before closing bracket is repaired", () => {
    const r = extractJson<{ a: number[] }>('{"a":[1,2,]}');
    expect(r.ok).toBe(true);
    expect(r.data?.a).toEqual([1, 2]);
    expect(r.wasRepaired).toBe(true);
  });

  test("truncated JSON without closing bracket returns ok=false, data=null", () => {
    // extractJsonSubstring returns null when there is no closing bracket —
    // the repair phase is never reached; this documents that expected behavior.
    const r = extractJson<{ name: string }>('{"name":"unterminated');
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
  });

  test("non-JSON text returns ok=false and data=null", () => {
    const r = extractJson("This is not JSON at all.");
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.error).toBeDefined();
  });

  test("generic type parameter propagates to data field", () => {
    interface Payload { n: number }
    const r = extractJson<Payload>('{"n":42}');
    expect(r.ok).toBe(true);
    // TypeScript: r.data is Payload | null
    expect(r.data?.n).toBe(42);
  });

  test("think block in raw input is stripped before parse attempt", () => {
    const raw = "<think>cot</think>{\"ok\":true}";
    const r = extractJson<{ ok: boolean }>(raw);
    expect(r.ok).toBe(true);
    expect(r.data?.ok).toBe(true);
  });
});

// ─── StreamingSanitizer ───────────────────────────────────────────────────────

describe("StreamingSanitizer", () => {
  test("clean chunk content is preserved — no think blocks stripped", () => {
    // processChunk holds back the last 7 bytes as a guard against split <think> tags;
    // flush() emits the remainder. Check the combined output contains the key content.
    const s = new StreamingSanitizer();
    const out = s.processChunk("Clean text without any think tags.");
    const final = s.flush();
    const combined = out + final;
    expect(combined).toContain("Clean text");
    expect(combined).not.toContain("<think>");
  });

  test("think block spanning two chunks is stripped", () => {
    const s = new StreamingSanitizer();
    // First chunk opens the think block; second closes it and has visible content
    const c1 = s.processChunk("Before. <think>internal");
    const c2 = s.processChunk(" reasoning</think> After.");
    const fin = s.flush();
    const combined = c1 + c2 + fin;
    expect(combined).not.toContain("<think>");
    expect(combined).not.toContain("</think>");
    expect(combined).toContain("After.");
  });

  test("full content is emitted when combining processChunk output and flush", () => {
    const s = new StreamingSanitizer();
    const partial = s.processChunk("Part one. Part two.");
    const remainder = s.flush();
    // processChunk holds last 7 bytes; flush emits them — check the combined result
    expect(partial + remainder).toContain("Part one");
  });

  test("flush discards buffer when think block is unclosed", () => {
    const s = new StreamingSanitizer();
    s.processChunk("visible <think>unclosed reasoning...");
    const fin = s.flush();
    expect(fin).toBe("");
  });
});
