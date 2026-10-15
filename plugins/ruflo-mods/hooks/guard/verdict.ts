/**
 * Verdict arithmetic for `tool.check`: this mod only ever tightens.
 *
 * `deny` > `ask` > `allow`. The merged verdict is the stricter of the chain's
 * and ruflo's; on a tie the chain's stands untouched, so its `rule` (what
 * sec-default reads to hold a deny) is never rewritten or erased.
 */

export type Decision = 'allow' | 'ask' | 'deny'

export type Verdict = {
  readonly decision: Decision
  readonly reason?: string
  readonly rule?: string
}

const RANK: Record<Decision, number> = { allow: 0, ask: 1, deny: 2 }

export function isDecision(value: unknown): value is Decision {
  return value === 'allow' || value === 'ask' || value === 'deny'
}

/**
 * The stricter of two verdicts; `ours` absent means ruflo has no opinion.
 *
 * @param chain what `next(e)` resolved to (the engine's verdict and beneath)
 * @param ours ruflo's tightening, if any
 */
export function stricter<V extends Verdict>(chain: V, ours: Verdict | undefined): V | Verdict {
  if (!ours) return chain
  // A chain answer of an unknown shape is treated as the loosest verdict, so
  // ruflo's opinion still holds; it never makes ruflo's verdict looser.
  const chainRank = isDecision(chain.decision) ? RANK[chain.decision] : -1
  return RANK[ours.decision] > chainRank ? ours : chain
}
