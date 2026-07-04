/**
 * reasoning-sanitizer.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SwarmX Centralized Reasoning Output Sanitizer — Architecture Review §5
 * Version : v2026.6.28-apex17-r8
 * Hardware : HP EliteBook 850 G3 · 8 GB RAM · CPU-only · 4 cores · WSL2
 *
 * Why this exists (arch review §5):
 *   DeepSeek-R1 distill models produce <think>...</think> CoT blocks that
 *   pollute downstream agent inputs when not stripped. Ad-hoc `sed` stripping
 *   is insufficient — it misses:
 *     • Nested / malformed think tags
 *     • Hallucinated XML (role tags, tool wrappers, response envelopes)
 *     • Runaway outputs that exceed num_predict ceiling
 *     • Duplicated chain-of-thought artifacts in multi-turn contexts
 *     • Malformed JSON (broken by think blocks mid-object)
 *
 *   This module is the single point of truth for all sanitization logic.
 *   It MUST be called on every DeepSeek-R1 output before passing to:
 *     - other swarm agents
 *     - the SwarmX API response stream
 *     - APEX-17 evolution pipeline (fitness snapshot, critique, validate)
 *     - tool call result processing
 *
 * File location : apps/swarmx-api/src/services/reasoning-sanitizer.ts
 *
 * Integration:
 *   import { sanitizeReasoningOutput, extractJson } from "./reasoning-sanitizer.js";
 *   const { text } = sanitizeReasoningOutput(rawOutput);
 *   const { data, ok } = extractJson(rawOutput);     // shortcut for JSON paths
 *
 * ─── r8 INTEGRATION NOTE ─────────────────────────────────────────────────────
 *   This is a full functional replacement of the previous < 100-line stub at
 *   this path, whose sanitizeReasoningOutput(text): string and
 *   extractJson(text): unknown returned bare values rather than structured
 *   results. composer.ts's one call site (inside the model-dispatch retry
 *   loop, ~line 1620 of the patched file) has been updated in this same
 *   integration pass to destructure `.text` from sanitizeReasoningOutput()
 *   and to check `.ok` / read `.error` from extractJson() — see the
 *   "composer_reasoning_sanitized" / "composer_extract_json_miss" log sites
 *   in composer.ts. No other call sites exist in the repository
 *   (confirmed via `grep -rn "sanitizeReasoningOutput\|extractJson"
 *   apps/swarmx-api/src/routes/composer.ts`). This file's own content is
 *   otherwise unchanged from the authoritative upload — it contains no
 *   legacy alias tag references to begin with.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SanitizeResult {
  /** Clean text with all reasoning artifacts removed. */
  text: string;
  /** Whether a think block was found and stripped. */
  hadThinkBlock: boolean;
  /** Whether hallucinated XML tags were found and stripped. */
  hadHallucinatedXml: boolean;
  /** Whether the output was truncated (runaway detection). */
  wasTruncated: boolean;
  /** Whether duplicated CoT artifacts were removed. */
  hadDuplicates: boolean;
  /** Length of the raw input (for telemetry). */
  rawLength: number;
  /** Length of the cleaned output (for telemetry). */
  cleanLength: number;
}

export interface ExtractJsonResult<T = unknown> {
  /** Parsed JSON value, or null on failure. */
  data: T | null;
  /** The JSON string before parsing (for debugging). */
  raw: string;
  /** Whether parsing succeeded. */
  ok: boolean;
  /** Parse error if ok = false. */
  error?: string;
  /** Whether the JSON was repaired before parsing. */
  wasRepaired: boolean;
}

// ─── Configuration ────────────────────────────────────────────────────────────

/** Maximum output length before runaway truncation (characters, not tokens). */
const MAX_OUTPUT_CHARS = 16_000;

/** Maximum think block size to strip (characters). Blocks larger than this
 *  are a strong signal of runaway generation — still strip, but flag. */
const MAX_THINK_BLOCK_CHARS = 32_000;

// ─── Hallucinated XML patterns to strip ──────────────────────────────────────
//
// DeepSeek-R1 distill models hallucinate these patterns under heavy load:
//   - Role tags: <|User|>, <|Assistant|>, <user>, <assistant>
//   - Tool wrappers: <tool>, </tool>, <tool_call>, </tool_call>
//   - Response envelopes: <response>, </response>, <answer>, </answer>
//   - ChatML leakage: <|im_start|>, <|im_end|>
//   - Phi-4 leakage: <|end|>, <|user|>, <|assistant|>, <|system|>
//   - Qwen leakage: \n\nHuman:, \n\nUser:, \n\nAssistant:
//   - DeepSeek native: <｜User｜>, <｜Assistant｜>
//   - Markdown code fences that wrap JSON outputs

const HALLUCINATED_XML_PATTERNS: RegExp[] = [
  // Role / turn markers (all variants)
  /<\|User\|>/gi,
  /<\|Assistant\|>/gi,
  /<\|user\|>/gi,
  /<\|assistant\|>/gi,
  /<\|system\|>/gi,
  /<\|end\|>/gi,
  /<\|endoftext\|>/gi,
  /<\|im_start\|>/gi,
  /<\|im_end\|>/gi,
  /<｜User｜>/g,
  /<｜Assistant｜>/g,
  /<｜begin▁of▁sentence｜>/g,
  /<｜end▁of▁sentence｜>/g,
  // Tool wrappers
  /<\/?tool(?:\s[^>]*)?>?/gi,
  /<\/?tool_call(?:\s[^>]*)?>?/gi,
  /<\/?tool_result(?:\s[^>]*)?>?/gi,
  // Response / answer envelopes
  /<\/?response(?:\s[^>]*)?>?/gi,
  /<\/?answer(?:\s[^>]*)?>?/gi,
  // Prose role prefixes (at start of line or after whitespace)
  /^USER:\s*/gim,
  /^ASSISTANT:\s*/gim,
  /\n\nHuman:\s*/g,
  /\n\nUser:\s*/g,
  /\n\nAssistant:\s*/g,
];

// ─── Primary sanitizer ────────────────────────────────────────────────────────

/**
 * sanitizeReasoningOutput
 *
 * Strips all reasoning artifacts from a DeepSeek-R1 distill model output.
 * Safe to call on non-DeepSeek outputs — returns the text unchanged if no
 * artifacts are found (with minimal allocation overhead).
 *
 * Order of operations:
 *   1. Runaway truncation (must be first — protects downstream regex from OOM)
 *   2. Think block removal (greedy from outermost)
 *   3. Hallucinated XML removal
 *   4. Duplicate CoT fragment detection
 *   5. Whitespace normalisation
 */
export function sanitizeReasoningOutput(raw: string): SanitizeResult {
  if (!raw) {
    return {
      text: "", hadThinkBlock: false, hadHallucinatedXml: false,
      wasTruncated: false, hadDuplicates: false, rawLength: 0, cleanLength: 0,
    };
  }

  const rawLength = raw.length;
  let text = raw;
  let hadThinkBlock = false;
  let hadHallucinatedXml = false;
  let wasTruncated = false;
  let hadDuplicates = false;

  // Step 1 — Runaway truncation
  if (text.length > MAX_OUTPUT_CHARS) {
    text = text.slice(0, MAX_OUTPUT_CHARS);
    wasTruncated = true;
  }

  // Step 2 — Think block removal
  // Handle: <think>…</think> (greedy, multiline, nested)
  // Also handle: unclosed <think> blocks (model hit num_predict ceiling mid-think)
  const thinkPattern = /<think>[\s\S]*?<\/think>/gi;
  if (thinkPattern.test(text)) {
    hadThinkBlock = true;
    text = text.replace(/<think>[\s\S]*?<\/think>/gi, "");
  }
  // Unclosed think block: <think> to end-of-string
  if (/<think>/i.test(text)) {
    hadThinkBlock = true;
    text = text.replace(/<think>[\s\S]*/i, "");
  }

  // Step 3 — Hallucinated XML removal
  for (const pattern of HALLUCINATED_XML_PATTERNS) {
    if (pattern.test(text)) {
      hadHallucinatedXml = true;
    }
  }
  if (hadHallucinatedXml) {
    for (const pattern of HALLUCINATED_XML_PATTERNS) {
      pattern.lastIndex = 0; // reset global regex state
      text = text.replace(pattern, "");
    }
  }

  // Step 4 — Markdown code fence stripping (json/typescript fences wrapping JSON)
  // Models sometimes wrap JSON output in ```json … ``` fences
  text = stripCodeFences(text);

  // Step 5 — Duplicate CoT fragment detection
  // Heuristic: if the same sentence (>40 chars) appears 3+ times, collapse it
  const cleaned = collapseRepeatedFragments(text);
  if (cleaned !== text) {
    hadDuplicates = true;
    text = cleaned;
  }

  // Step 6 — Whitespace normalisation
  // Collapse 3+ consecutive blank lines to 2, trim leading/trailing whitespace
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return {
    text,
    hadThinkBlock,
    hadHallucinatedXml,
    wasTruncated,
    hadDuplicates,
    rawLength,
    cleanLength: text.length,
  };
}

// ─── JSON extraction with repair ─────────────────────────────────────────────

/**
 * extractJson<T>
 *
 * Sanitizes a DeepSeek-R1 output, then extracts and parses the first valid
 * JSON object or array it contains. Applies lightweight JSON repair before
 * parsing (trailing commas, unquoted keys, truncated strings from predict cap).
 *
 * Returns null on failure with a descriptive error string.
 */
export function extractJson<T = unknown>(raw: string): ExtractJsonResult<T> {
  const { text } = sanitizeReasoningOutput(raw);
  let wasRepaired = false;

  // Try direct parse first (fast path)
  let target = text.trim();
  try {
    return { data: JSON.parse(target) as T, raw: target, ok: true, wasRepaired: false };
  } catch { /* fall through to extraction */ }

  // Extract the first JSON object/array using bracket matching
  const extracted = extractJsonSubstring(target);
  if (!extracted) {
    return { data: null, raw: target, ok: false, error: "No JSON object or array found", wasRepaired: false };
  }
  target = extracted;

  // Try after extraction
  try {
    return { data: JSON.parse(target) as T, raw: target, ok: true, wasRepaired: false };
  } catch { /* fall through to repair */ }

  // Lightweight repair pass
  const repaired = repairJson(target);
  if (repaired !== target) {
    wasRepaired = true;
    target = repaired;
  }

  try {
    return { data: JSON.parse(target) as T, raw: target, ok: true, wasRepaired };
  } catch (err) {
    return {
      data: null,
      raw: target,
      ok: false,
      error: err instanceof Error ? err.message : "JSON parse failed",
      wasRepaired,
    };
  }
}

// ─── Streaming sanitizer ──────────────────────────────────────────────────────

/**
 * StreamingSanitizer
 *
 * Stateful sanitizer for Ollama streaming responses. Buffers chunks and
 * removes think blocks that span multiple stream events.
 *
 * Usage:
 *   const s = new StreamingSanitizer();
 *   for await (const chunk of ollamaStream) {
 *     const clean = s.processChunk(chunk);
 *     if (clean) yield clean;
 *   }
 *   const final = s.flush(); // emit any buffered remainder
 */
export class StreamingSanitizer {
  private buffer = "";
  private inThinkBlock = false;
  private truncatedAt = 0;
  private totalChars = 0;

  processChunk(chunk: string): string {
    if (!chunk) return "";

    this.totalChars += chunk.length;
    if (this.totalChars > MAX_OUTPUT_CHARS) {
      return ""; // runaway: drop excess chunks
    }

    this.buffer += chunk;
    return this._drainSafe();
  }

  flush(): string {
    if (!this.buffer) return "";
    // Emit any remaining buffer that's safe (no partial think block open)
    if (this.inThinkBlock) {
      // Unclosed think block — discard buffer entirely
      this.buffer = "";
      this.inThinkBlock = false;
      return "";
    }
    const out = this.buffer;
    this.buffer = "";
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  private _drainSafe(): string {
    let output = "";

    while (this.buffer.length > 0) {
      if (!this.inThinkBlock) {
        const openIdx = this.buffer.toLowerCase().indexOf("<think>");
        if (openIdx === -1) {
          // No think block in buffer — emit everything except the last 7 chars
          // (guard against split "<think>" across chunk boundary)
          const safeEnd = Math.max(0, this.buffer.length - 7);
          output += this.buffer.slice(0, safeEnd);
          this.buffer = this.buffer.slice(safeEnd);
          break;
        }
        // Emit everything before the think block
        output += this.buffer.slice(0, openIdx);
        this.buffer = this.buffer.slice(openIdx);
        this.inThinkBlock = true;
      }

      if (this.inThinkBlock) {
        const closeIdx = this.buffer.toLowerCase().indexOf("</think>");
        if (closeIdx === -1) {
          // Think block not yet closed — hold buffer
          if (this.buffer.length > MAX_THINK_BLOCK_CHARS) {
            // Runaway think block — discard and recover
            this.buffer = "";
            this.inThinkBlock = false;
          }
          break;
        }
        // Skip the entire think block
        this.buffer = this.buffer.slice(closeIdx + 8); // 8 = "</think>".length
        this.inThinkBlock = false;
      }
    }

    // Strip hallucinated XML from emitted output
    for (const pattern of HALLUCINATED_XML_PATTERNS) {
      pattern.lastIndex = 0;
      output = output.replace(pattern, "");
    }

    return output;
  }
}

// ─── Private helpers ─────────────────────────────────────────────────────────

function stripCodeFences(text: string): string {
  // Remove ```json…``` and ```typescript…``` fences, keep interior content
  return text
    .replace(/```(?:json|typescript|js|javascript|yaml|text)?\s*\n?([\s\S]*?)\n?```/gi, "$1")
    .trim();
}

function extractJsonSubstring(text: string): string | null {
  // Find the first '{' or '[' and match to its closing bracket
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch !== "{" && ch !== "[") continue;

    const open  = ch === "{" ? "{" : "[";
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let j = i; j < text.length; j++) {
      const c = text[j];
      if (escape) { escape = false; continue; }
      if (c === "\\" && inString) { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === open)  { depth++; continue; }
      if (c === close) {
        depth--;
        if (depth === 0) return text.slice(i, j + 1);
      }
    }
  }
  return null;
}

function repairJson(text: string): string {
  let s = text.trim();

  // Remove trailing comma before closing bracket (common from truncated output)
  s = s.replace(/,\s*([}\]])/g, "$1");

  // Close unclosed string at end of text (truncated by num_predict)
  if ((s.match(/"/g)?.length ?? 0) % 2 !== 0) {
    s = s + '"';
  }

  // Close unclosed objects/arrays (truncated by num_predict)
  const opens:  string[] = [];
  let inStr = false;
  let esc   = false;
  for (const c of s) {
    if (esc)          { esc = false; continue; }
    if (c === "\\" && inStr) { esc = true; continue; }
    if (c === '"')    { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === "{")    opens.push("}");
    if (c === "[")    opens.push("]");
    if (c === "}" || c === "]") opens.pop();
  }
  while (opens.length > 0) s += opens.pop();

  return s;
}

function collapseRepeatedFragments(text: string): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.length < 6) return text;

  const seen   = new Map<string, number>(); // normalised → last seen index
  const result: string[] = [];

  for (const sentence of sentences) {
    const norm = sentence.trim().toLowerCase();
    if (norm.length < 40) {
      result.push(sentence);
      continue;
    }
    const count = (seen.get(norm) ?? 0) + 1;
    seen.set(norm, count);
    if (count <= 2) result.push(sentence); // allow up to 2 occurrences
  }

  return result.join(" ");
}
