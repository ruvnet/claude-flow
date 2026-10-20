/** Agent types never hidden: the core roles ADR-451 pins, plus the engine's own. */
export const PINNED: ReadonlySet<string> = new Set([
  'coder', 'reviewer', 'tester', 'planner', 'researcher', 'general-purpose', 'explore', 'plan', 'claude', 'fork',
])

export const USED_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

/** Last-used time (ms) by agent type: the `$.store` ledger. */
export type Usage = Record<string, number>

export type Offer = { agent: string; source: string }

export type TrimContext = {
  /** Types the person named in `agentTrimKeep`, lower case. */
  keep: ReadonlySet<string>
  usage: Usage
  /** The latest prompt, lower case; a type it names is kept. */
  prompt: string
  now: number
}

/** `plugin:role` and `role` are the same role for pinning and naming. */
const bare = (agent: string) => agent.slice(agent.lastIndexOf(':') + 1).toLowerCase()

/** The usage ledger as stored: only finite, non-negative times under plain names survive. */
export function readUsage(value: unknown): Usage {
  const out: Usage = Object.create(null)
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return out
  for (const [name, at] of Object.entries(value)) if (typeof at === 'number' && Number.isFinite(at) && at >= 0) out[name] = at
  return out
}

/** Whether the type stays offered. Fail-open by construction: anything unclear is kept. */
export function isKept(offer: Offer, ctx: TrimContext): boolean {
  if (offer.source === 'built-in') return true
  const name = bare(offer.agent)
  if (!name || PINNED.has(name) || ctx.keep.has(name) || ctx.keep.has(offer.agent.toLowerCase())) return true
  const at = ctx.usage[offer.agent]
  if (typeof at === 'number' && ctx.now - at < USED_WINDOW_MS) return true
  return ctx.prompt.includes(offer.agent.toLowerCase()) || ctx.prompt.includes(name)
}
