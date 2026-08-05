import type { RuntimeGuidance } from "./runtime-guidance";

export function formatSubmissionBlockReason(guidance: RuntimeGuidance | null): string | null {
  if (!guidance) {
    return null;
  }

  return `${guidance.title}. ${guidance.recoveryHint}`;
}