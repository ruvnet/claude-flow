import { hasSecret, secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store', 'agentdb_batch'])
// Order placement on a neural-trader MCP server (`neural-trader mcp start`), however the plugin names the server.
// Covers the package's own names too: execute_trade, execute_multi_asset_trade, place_prediction_order_tool. Paper and simulated tools are not orders.
const ORDER = /^(?!.*(?:paper|simulat|dry))(?:execute|place|submit)(?:[_-][a-z]+)*[_-]?(?:trade|order|bet)s?(?:[_-]tool)?$|^live[_-]?(?:trade|order|execute)|^(?:close|cancel)[_-]?all/i

const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)
const serverOf = (name: string) => (name.startsWith('mcp__') ? name.slice(5, name.lastIndexOf('__')) : '')
const isTrader = (name: string) => /neural[-_]?trader/i.test(serverOf(name))

/** Whether the call states, in its own input, that it is a paper trade or carries an explicit confirm. */
function confirmed(input: unknown): boolean {
  const top = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const inner = typeof top.input === 'object' && top.input !== null ? (top.input as Record<string, unknown>) : {}
  return [top, inner].some(o => o.confirm === true || o.confirmed === true || o.paper === true || o.dryRun === true || o.dry_run === true)
}

/** This plugin's namespaces. A `memory_store` outside them is another plugin's write: still screened, but its refusal must not claim it. */
const OWN_NS = /^(?:trading|neural-trader|trader)/i
const namespaceOf = (input: unknown): string | undefined => {
  const top = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const inner = typeof top.input === 'object' && top.input !== null ? (top.input as Record<string, unknown>) : {}
  return [top.namespace, inner.namespace].find((n): n is string => typeof n === 'string')
}
const foreignStore = (tool: string, input: unknown): boolean => /(?:^|__)memory_store$/.test(tool) && !OWN_NS.test(namespaceOf(input) ?? '')
/** The refusal for a secret in another plugin's `memory_store`: what was found and which namespace, never an owner and never content. */
function foreignRefusal(input: unknown): string {
  const ns = namespaceOf(input)
  const label = (ns ?? '').replace(/[^\w.:-]/g, '').slice(0, 40)
  const where = !ns ? 'no namespace' : label && !hasSecret(ns) && !hasSecret(label) ? `namespace "${label}"` : 'a namespace not shown here'
  return `ruflo-neural-trader: a secret-shaped value (a key, token or password) was found in a memory write; the call targeted ${where}. Store a reference to where it lives, not the value.`
}

/**
 * The reason a call is refused, or undefined when it may go. Two rules: a memory write or trader call holding a secret is refused
 * (broker keys must not be stored or echoed), and a live order call without an explicit `confirm: true` (or `paper`/`dryRun`) is refused.
 * Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, opts: ModOptions, stats: Stats): string | undefined {
  const trader = isTrader(tool)
  if (!trader && !WRITERS.has(toolOf(tool))) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length > 0) {
    stats.lastBlock = found[0]
    if (!trader && foreignStore(tool, input)) return foreignRefusal(input)
    return 'ruflo-neural-trader: this call holds what looks like a secret (a broker key, token or password). Keep credentials in the environment and pass a reference, not the value.'
  }
  if (opts.liveGuard && trader && ORDER.test(toolOf(tool)) && !confirmed(input)) {
    stats.liveBlocked++
    stats.lastBlock = 'live order without confirm'
    return 'ruflo-neural-trader: a live order needs an explicit confirm: true in the call (or paper: true to simulate). Re-run the paper backtest and risk gate first.'
  }
  return undefined
}
