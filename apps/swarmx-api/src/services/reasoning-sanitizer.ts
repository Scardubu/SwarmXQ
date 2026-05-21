const THINK_BLOCK_RE = /<think>[\s\S]*?<\/think>/gi;
const XML_WRAPPER_RE = /<\/?(?:response|assistant|tool|analysis)>/gi;
const CODE_FENCE_RE = /^```(?:json|JSON)?\s*([\s\S]*?)\s*```$/;

function stripCodeFence(text: string): string {
  const match = text.match(CODE_FENCE_RE);
  return match?.[1]?.trim() ?? text;
}

function normalizeReasoningText(text: string): string {
  return stripCodeFence(
    text
      .replace(/\r\n/g, "\n")
      .replace(THINK_BLOCK_RE, "")
      .replace(XML_WRAPPER_RE, "")
      .trim(),
  );
}

export function sanitizeReasoningOutput(text: string): string {
  return normalizeReasoningText(text);
}

function findJsonCandidate(text: string): string | null {
  const normalized = normalizeReasoningText(text);
  const fenced = stripCodeFence(normalized);

  for (const source of [fenced, normalized]) {
    const arrayStart = source.indexOf("[");
    const objectStart = source.indexOf("{");
    const startCandidates = [arrayStart, objectStart].filter((index) => index >= 0);
    if (startCandidates.length === 0) continue;

    const start = Math.min(...startCandidates);
    const opening = source[start];
    const closing = opening === "[" ? "]" : "}";
    const end = source.lastIndexOf(closing);
    if (end > start) {
      return source.slice(start, end + 1).trim();
    }
  }

  return null;
}

export function extractJson(text: string): unknown {
  const candidate = findJsonCandidate(text);
  if (!candidate) {
    return null;
  }

  try {
    return JSON.parse(candidate);
  } catch {
    return null;
  }
}