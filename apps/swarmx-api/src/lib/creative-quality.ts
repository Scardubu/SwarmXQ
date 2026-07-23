/**
 * apps/swarmx-api/src/lib/creative-quality.ts
 *
 * Shared creative-quality primitives consumed by both the single-video
 * orchestrator ([video-orchestrator.ts]) and the series episode
 * preproducer ([video-episode-preproducer.ts]).
 *
 * Historically each consumer maintained its own HOOK_BLOCKLIST. This
 * module unifies them so the constraint is single-sourced. Both callers
 * use startsWith semantics on a lowercased/trimmed hook — the two
 * helpers below differ only in whether all matches or the first match
 * is returned.
 */

/**
 * Phrases that must not appear at the start of a video hook.
 * Union of the historical orchestrator + preproducer lists, deduped
 * case-insensitively, stored lowercase, alphabetized.
 */
export const HOOK_BLOCKLIST: ReadonlyArray<string> = [
  "as i mentioned",
  "before we begin",
  "before we start",
  "don't forget to",
  "hi everyone",
  "i'm going to",
  "in this video",
  "in today's episode",
  "in today's video",
  "let's",
  "like i said",
  "make sure to",
  "my name is",
  "quick disclaimer",
  "stay tuned",
  "this video",
  "today we",
  "we're going to",
  "welcome back",
  "welcome to",
  "you're not going to believe",
];

/**
 * Return every blocklist phrase the hook opens with, in list order.
 * Used by video-orchestrator to log all violations for a single hook.
 */
export function findHookBlocklistViolations(hookContent: string): string[] {
  const normalized = hookContent.trim().toLowerCase();
  if (normalized.length === 0) return [];
  return HOOK_BLOCKLIST.filter((phrase) => normalized.startsWith(phrase));
}

/**
 * Return the first blocklist phrase the hook opens with, if any.
 * Used by video-episode-preproducer quality gate.
 */
export function matchesHookBlocklistPrefix(
  hook: string,
): { blocked: boolean; matched?: string } {
  const [first] = findHookBlocklistViolations(hook);
  return first !== undefined ? { blocked: true, matched: first } : { blocked: false };
}
