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

export interface GatedText {
  text: string;
  flagged: boolean;
  gated: boolean;
}

export async function gateWithAIDefence(text: string): Promise<GatedText> {
  if (!text) return { text, flagged: false, gated: false };
  try {
    const mod = await import('@claude-flow/aidefence');
    const defender = mod.createAIDefence({ enableLearning: false });
    let flagged = false;
    try {
      const quick = defender.quickScan(text);
      flagged = !!quick?.threat;
    } catch {
      /* quickScan unavailable on this build */
    }
    try {
      if (!flagged && defender.hasPII(text)) flagged = true;
    } catch {
      /* hasPII unavailable */
    }
    if (flagged) {
      return { text: '[content redacted by AIDefence — threat or PII detected]', flagged: true, gated: true };
    }
    return { text, flagged: false, gated: true };
  } catch {
    // @claude-flow/aidefence is itself optional — pass through rather than
    // block the caller when it isn't installed.
    return { text, flagged: false, gated: false };
  }
}

/** Gate every string in an array, preserving order and length. */
export async function gateAll(texts: string[]): Promise<GatedText[]> {
  return Promise.all(texts.map((t) => gateWithAIDefence(t)));
}
