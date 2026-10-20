/**
 * What a workflow run cost, by run, phase and agent (ADR-462). Pure: text and records in, records out; the disk and the
 * host are in `wf-cost-live.ts`.
 *
 * Two inputs, both real files: an agent's transcript, which says how many tokens each request used in each bucket, and the
 * ruflo-cost-tracker's price book (`data/prices.json`), the same file its ledger prices from. `WfAgent.tokens` is NOT used here:
 * it is the context size of the agent's latest request, which no price can be applied to. A model with no entry in the book is
 * shown as tokens and "no price", never as $0; a bucket the book does not publish is billed at the input rate and says so.
 * USD only: the Claude entries of the book are all USD, and an entry in any other unit is ignored rather than added in.
 */
import type { WfRun } from './workflows'

/** The buckets a request bills in (the ledger's names): `input` is uncached input only. */
export type Usage = { input: number; cacheRead: number; write5m: number; write1h: number; output: number; messages: number; /** A cache write whose TTL split the transcript did not state: all billed as 5-minute writes. */ isUnsplit: boolean }

export const zeroUsage = (): Usage => ({ input: 0, cacheRead: 0, write5m: 0, write1h: 0, output: 0, messages: 0, isUnsplit: false })

export const tokensOf = (u: Usage): number => u.input + u.cacheRead + u.write5m + u.write1h + u.output

const addUsage = (to: Usage, from: Usage): void => {
  to.input += from.input
  to.cacheRead += from.cacheRead
  to.write5m += from.write5m
  to.write1h += from.write1h
  to.output += from.output
  to.messages += from.messages
  to.isUnsplit ||= from.isUnsplit
}

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const n = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)

/**
 * The usage in a transcript, per model. A request is written on several lines as it streams (the output count grows), so a
 * request is counted once by `message.id|requestId`, each bucket at its largest. `<synthetic>` and model-less lines are skipped.
 * `isTail` says the text begins mid-file: its first line is dropped, and the figures are a floor.
 */
export function usageOfTranscript(text: string | null, isTail = false): Map<string, Usage> {
  const out = new Map<string, Usage>()

  if (text === null) return out

  const body = isTail ? text.slice(text.indexOf('\n') + 1) : text
  const byRequest = new Map<string, { model: string; usage: Usage }>()

  for (const line of body.split('\n')) {
    if (line.length < 2 || line[0] !== '{' || !line.includes('"usage"')) continue

    let record: Record<string, unknown> | null = null

    try {
      record = asRecord(JSON.parse(line))
    } catch {
      continue
    }

    const message = asRecord(record?.message)
    const usage = asRecord(message?.usage)
    const model = typeof message?.model === 'string' ? message.model.slice(0, 80) : ''

    if (record === null || message === null || usage === null || message.role !== 'assistant' || model === '' || model === '<synthetic>') continue

    const key = `${typeof message.id === 'string' ? message.id : String(record.uuid ?? byRequest.size)}|${typeof record.requestId === 'string' ? record.requestId : ''}`
    const split = asRecord(usage.cache_creation)
    const written = n(usage.cache_creation_input_tokens)
    const next: Usage = { input: n(usage.input_tokens), cacheRead: n(usage.cache_read_input_tokens), write5m: split === null ? written : n(split.ephemeral_5m_input_tokens), write1h: split === null ? 0 : n(split.ephemeral_1h_input_tokens), output: n(usage.output_tokens), messages: 1, isUnsplit: split === null && written > 0 }
    const held = byRequest.get(key)

    if (held === undefined) byRequest.set(key, { model, usage: next })
    else {
      const u = held.usage

      held.model = model
      u.input = Math.max(u.input, next.input)
      u.cacheRead = Math.max(u.cacheRead, next.cacheRead)
      u.write5m = Math.max(u.write5m, next.write5m)
      u.write1h = Math.max(u.write1h, next.write1h)
      u.output = Math.max(u.output, next.output)
      u.isUnsplit ||= next.isUnsplit
    }
  }

  for (const { model, usage } of byRequest.values()) {
    const held = out.get(model) ?? zeroUsage()

    addUsage(held, usage)
    out.set(model, held)
  }

  return out
}

/** One entry of the price book, in USD per million tokens. A rate the book does not publish is `null`. */
export type Price = { id: string; match: string; re?: string; input: number; output: number; cacheRead: number | null; write5m: number | null; write1h: number | null; isApprox: boolean }
export type PriceBook = { asOf: string; models: Price[] }

const MAX_MODELS = 120
const rate = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)

/** The Claude, USD entries of a `prices.json`; an entry that is malformed is skipped, and a file that is not a book is null. */
export function parsePriceBook(text: string | null): PriceBook | null {
  let root: Record<string, unknown> | null = null

  try {
    root = text === null ? null : asRecord(JSON.parse(text))
  } catch {
    return null
  }

  if (root === null || !Array.isArray(root.models)) return null

  const models: Price[] = []

  for (const raw of root.models.slice(0, 400)) {
    const entry = asRecord(raw)
    const input = rate(entry?.input)
    const output = rate(entry?.output)

    if (entry === null || entry.provider !== 'claude' || entry.unit !== 'usd' || typeof entry.id !== 'string' || typeof entry.match !== 'string' || entry.match === '' || input === null || output === null) continue

    // A pattern from a file is compiled later; a long one is refused rather than risked.
    const re = typeof entry.re === 'string' && entry.re.length <= 120 ? entry.re : undefined

    models.push({ id: entry.id.slice(0, 60), match: entry.match.slice(0, 60).toLowerCase(), input, output, cacheRead: rate(entry.cache_read), write5m: rate(entry.cache_write_5m), write1h: rate(entry.cache_write_1h), isApprox: entry.approx === true, ...(re !== undefined && { re }) })
    if (models.length >= MAX_MODELS) break
  }

  return { asOf: typeof root.asOf === 'string' ? root.asOf.replace(/[^0-9A-Za-z:.-]/g, '').slice(0, 20) : 'unknown', models }
}

/** The ledger's lookup: the entry whose `re` matches, else whose `match` is in the id; the longest `match` wins. */
export function priceFor(book: PriceBook | null, model: string): Price | null {
  if (book === null || model === '') return null

  const id = model.toLowerCase().slice(0, 80)
  let best: Price | null = null

  for (const entry of book.models) {
    let isHit: boolean

    try {
      isHit = entry.re === undefined ? id.includes(entry.match) || id === entry.id : new RegExp(entry.re).test(id)
    } catch {
      isHit = false
    }

    if (isHit && (best === null || entry.match.length > best.match.length)) best = entry
  }

  return best
}

const per = (tokens: number, rateUsd: number): number => (tokens / 1e6) * rateUsd

/** Dollars for one model's usage at one price; a cache rate the book does not publish is billed at the input rate (an upper bound, as the ledger does). */
export function usdOf(usage: Usage, price: Price): number {
  const read = price.cacheRead ?? price.input
  const w5 = price.write5m ?? price.input
  const w1 = price.write1h ?? w5

  return per(usage.input, price.input) + per(usage.output, price.output) + per(usage.cacheRead, read) + per(usage.write5m, w5) + per(usage.write1h, w1)
}

/** A cost, with what it leaves out: tokens without a price are counted apart, never as $0. */
export type Costed = {
  /** The priced part. */
  usd: number
  pricedTokens: number
  unpricedTokens: number
  unpricedModels: string[]
  /** Some price was a family fallback, or a cache rate was assumed: the figure is an estimate either way, this says it is a rougher one. */
  isApprox: boolean
  /** The figure is a floor: a transcript was read from its tail only, or an agent's was not read. */
  isFloor: boolean
}

export const emptyCost = (): Costed => ({ usd: 0, pricedTokens: 0, unpricedTokens: 0, unpricedModels: [], isApprox: false, isFloor: false })

/** An agent's read usage: per model, and whether it is a tail. */
export type AgentUsage = { byModel: ReadonlyMap<string, Usage>; isTail: boolean }

export function costOfUsage(agent: AgentUsage, book: PriceBook | null): Costed {
  const out = emptyCost()

  out.isFloor = agent.isTail

  for (const [model, usage] of agent.byModel) {
    const price = priceFor(book, model)
    const tokens = tokensOf(usage)

    if (price === null) {
      out.unpricedTokens += tokens
      if (!out.unpricedModels.includes(model)) out.unpricedModels.push(model)
    } else {
      out.usd += usdOf(usage, price)
      out.pricedTokens += tokens
      out.isApprox ||= price.isApprox || price.cacheRead === null
    }
  }

  return out
}

export function sumCosts(parts: readonly Costed[], missing = 0): Costed {
  const out = emptyCost()

  for (const part of parts) {
    out.usd += part.usd
    out.pricedTokens += part.pricedTokens
    out.unpricedTokens += part.unpricedTokens
    out.isApprox ||= part.isApprox
    out.isFloor ||= part.isFloor
    for (const model of part.unpricedModels) if (!out.unpricedModels.includes(model)) out.unpricedModels.push(model)
  }

  out.isFloor ||= missing > 0

  return out
}

export type RunCost = {
  runId: string
  /** The agents whose transcripts were read, by agent id. An agent not in the map has no figure: n/a, not $0. */
  agents: ReadonlyMap<string, Costed>
  phases: ReadonlyMap<string, Costed>
  total: Costed
  /** Agents of the run with a figure, and how many the run has. */
  covered: number
  count: number
}

/** The run's cost from what was read. `usage` is keyed `<runId>/<agentId>`. */
export function costRun(run: WfRun, usage: ReadonlyMap<string, AgentUsage>, book: PriceBook | null): RunCost {
  const agents = new Map<string, Costed>()
  const phases = new Map<string, Costed>()

  for (const phase of run.phases) {
    const known: Costed[] = []

    for (const agent of phase.agents) {
      const read = usage.get(`${run.id}/${agent.id}`)

      if (read === undefined) continue

      const cost = costOfUsage(read, book)

      agents.set(agent.id, cost)
      known.push(cost)
    }

    phases.set(phase.title, sumCosts(known, phase.agents.length - known.length))
  }

  const total = sumCosts([...agents.values()], run.total - agents.size)

  return { runId: run.id, agents, phases, total, covered: agents.size, count: run.total }
}

/** $0.043 · $1.28 · $12.40 · <$0.001 */
export function fmtUsd(usd: number): string {
  return usd <= 0 ? '$0' : usd < 0.001 ? '<$0.001' : usd < 0.1 ? `$${usd.toFixed(3)}` : usd < 100 ? `$${usd.toFixed(2)}` : `$${Math.round(usd)}`
}

/** A sum of nothing read: no token seen and some part missing. It is not $0, it is unknown. */
export const isUnread = (cost: Costed): boolean => cost.pricedTokens === 0 && cost.unpricedTokens === 0 && cost.isFloor

/** A cost as a cell says it: `≥` for a floor, `≈` for a rough price, "no price" where tokens had none, "n/a" where nothing was read. */
export function fmtCosted(cost: Costed | undefined): string {
  if (cost === undefined || isUnread(cost)) return 'n/a'
  if (cost.pricedTokens === 0 && cost.unpricedTokens > 0) return 'no price'
  if (cost.pricedTokens === 0) return '$0'

  return `${cost.isFloor || cost.unpricedTokens > 0 ? '≥' : cost.isApprox ? '≈' : ''}${fmtUsd(cost.usd)}${cost.unpricedTokens > 0 ? ' + unpriced' : ''}`
}

/** Billed tokens of a cost: every bucket of every request, which is not the page's context-size figure. */
export const billedTokens = (cost: Costed): number => cost.pricedTokens + cost.unpricedTokens

/** Spend per run for the guards: a run whose tokens were partly unpriced or unread is a floor. A run with no priced token has no figure. */
export function spendOf(costs: Iterable<RunCost>): Map<string, { usd: number; isFloor: boolean }> {
  const out = new Map<string, { usd: number; isFloor: boolean }>()

  for (const cost of costs) if (cost.total.pricedTokens > 0) out.set(cost.runId, { usd: cost.total.usd, isFloor: cost.total.isFloor || cost.total.unpricedTokens > 0 })

  return out
}
