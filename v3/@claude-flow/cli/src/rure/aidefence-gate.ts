/**
 * AIDefence content gate for ruRE (ADR-0001 §dual-use policy).
 *
 * Every string literal, comment, and identifier ruRE extracts comes from a
 * target the user may not control. Before any of it is returned to the
 * caller (and therefore to the model that synthesizes an explanation), it is
 * routed through this gate. Mirrors the lazy-load pattern used by
 * browser-intent-tools.ts's private gateWithAIDefence — @claude-flow/aidefence
 * is itself an optional dependency, so absence degrades to pass-through
 * rather than blocking analysis.
 */

/** Longest attacker-derived string returned or scanned; anything longer is clipped first. */
export const MAX_GATED_CHARS = 2048;

export function clipText(text: string): string {
  return text.length > MAX_GATED_CHARS ? `${text.slice(0, MAX_GATED_CHARS)}…[truncated ${text.length - MAX_GATED_CHARS} chars]` : text;
}

export interface GatedText {
  text: string;
  flagged: boolean;
  gated: boolean;
}

// Memoized: resolving a genuinely-absent optional module repeatedly on every
// call is wasteful, and a single shared attempt avoids any ambiguity from
// multiple concurrent dynamic-import resolutions of the same bare specifier
// (gateAll calls this for every string in a batch).
let aidefenceModulePromise: Promise<typeof import('@claude-flow/aidefence')> | null = null;
function loadAIDefenceModule(): Promise<typeof import('@claude-flow/aidefence')> {
  aidefenceModulePromise ??= import('@claude-flow/aidefence');
  return aidefenceModulePromise;
}

type Defender = ReturnType<typeof import('@claude-flow/aidefence')['createAIDefence']>;
let defenderPromise: Promise<Defender> | null = null;
function loadDefender(): Promise<Defender> {
  defenderPromise ??= loadAIDefenceModule().then((mod) => mod.createAIDefence({ enableLearning: false }));
  return defenderPromise;
}

export async function gateWithAIDefence(input: string): Promise<GatedText> {
  if (!input) return { text: input, flagged: false, gated: false };
  const text = clipText(input);
  try {
    const defender = await loadDefender();
    let flagged = false;
    // A scan that throws is NOT a clean result: report gated:false so callers can disclose it.
    const quick = defender.quickScan(text);
    flagged = !!quick?.threat;
    if (!flagged && defender.hasPII(text)) flagged = true;
    if (flagged) {
      return { text: '[content redacted by AIDefence — threat or PII detected]', flagged: true, gated: true };
    }
    return { text, flagged: false, gated: true };
  } catch {
    // @claude-flow/aidefence is optional, or its scan failed: pass the clipped text through
    // but say so (gated:false). Tool outputs surface this as screened:false.
    return { text, flagged: false, gated: false };
  }
}

/** Gate every string in an array, preserving order and length. Sequential —
 * gating is cheap, and this avoids firing the first-ever (memoized) module
 * resolution attempt from several calls at once. */
export async function gateAll(texts: string[]): Promise<GatedText[]> {
  const results: GatedText[] = [];
  for (const t of texts) results.push(await gateWithAIDefence(t));
  return results;
}
