export type RuntimeGuidanceTone = "warning" | "critical";

export interface RuntimeGuidanceInput {
  apiOnline: boolean | null;
  ollamaOnline: boolean | null;
  pressureLevel?: string | undefined;
  availableMb?: number | null | undefined;
}

export interface RuntimeGuidance {
  tone: RuntimeGuidanceTone;
  title: string;
  detail: string;
  recoveryHint: string;
}

function formatAvailableMemory(availableMb: number | null | undefined): string {
  if (availableMb == null || !Number.isFinite(availableMb)) {
    return "";
  }

  return ` (${Math.round(availableMb).toLocaleString()} MB free)`;
}

/**
 * Derive one operator-facing explanation for current runtime state.
 *
 * API availability is authoritative: if the dashboard cannot reach the API it
 * cannot safely infer Ollama state. When the API is available, Ollama and RAM
 * state are reported independently so recovery guidance is actionable.
 */
export function getRuntimeGuidance({
  apiOnline,
  ollamaOnline,
  pressureLevel,
  availableMb,
}: RuntimeGuidanceInput): RuntimeGuidance | null {
  const memorySuffix = formatAvailableMemory(availableMb);
  const memoryConstrained = pressureLevel === "high" || pressureLevel === "critical";

  if (apiOnline === false) {
    return {
      tone: "critical",
      title: "SwarmX API unavailable",
      detail: "The dashboard cannot reach the local API, so live job and runtime state may be stale.",
      recoveryHint: "Confirm the API is running on port 3001, then refresh this dashboard.",
    };
  }

  if (ollamaOnline === false) {
    return {
      tone: "warning",
      title: "Ollama backend unavailable",
      detail:
        "The API is online, but model-backed work cannot advance until Ollama responds." +
        (memoryConstrained
          ? ` Memory pressure is also ${pressureLevel}${memorySuffix}.`
          : ""),
      recoveryHint: "Start or restore Ollama with `ollama serve`, then wait for the health indicator to recover.",
    };
  }

  if (memoryConstrained) {
    const isCritical = pressureLevel === "critical";
    return {
      tone: isCritical ? "critical" : "warning",
      title: `Memory pressure ${pressureLevel}${memorySuffix}`,
      detail: isCritical
        ? "Model calls are restricted to protect the host from an out-of-memory failure."
        : "Model work is serialized and may take longer while the host preserves headroom.",
      recoveryHint: "Finish or unload memory-heavy processes before starting another model-backed job.",
    };
  }

  return null;
}