import { hasSecret, secretsIn, textsOf } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const WRITERS = new Set(['memory_store', 'agentdb_pattern-store', 'agentdb_hierarchical-store'])
const OWN = new Set(['create_production', 'separate_stems', 'master', 'extract_midi'])

const toolOf = (name: string) => (name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name)
const serverOf = (name: string) => (name.startsWith('mcp__') ? name.slice(5, name.lastIndexOf('__')) : '')
/** The cogmusic server, however the plugin names it (`cogmusic` or `plugin_ruflo-music_cogmusic`). */
const isCogmusic = (name: string) => serverOf(name).includes('cogmusic') && OWN.has(toolOf(name))

/** This plugin's namespaces. A `memory_store` outside them is another plugin's write: still screened, but its refusal must not claim it. */
const OWN_NS = /^music/i
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
  return `ruflo-music: a secret-shaped value (a key, token or password) was found in a memory write; the call targeted ${where}. Store a reference to where it lives, not the value.`
}

/**
 * The reason a call is refused, or undefined when it may go. Prompts and lyrics leave the machine for music.cognitum.one, and memory
 * writes persist, so neither may carry a key, token or password. Names the rule, never echoes the value.
 */
export function verdict(tool: string, input: unknown, _opts: ModOptions, stats: Stats): string | undefined {
  const sends = isCogmusic(tool)
  if (!sends && !WRITERS.has(toolOf(tool))) return undefined
  stats.checked++
  const found = textsOf(input).flatMap(secretsIn)
  if (found.length === 0) {
    if (sends && toolOf(tool) === 'create_production') stats.productions++
    return undefined
  }
  stats.lastBlock = found[0]
  if (!sends && foreignStore(tool, input)) return foreignRefusal(input)
  return sends
    ? 'ruflo-music: this prompt or lyrics hold what looks like a secret (a key, token or password); they would be sent to the music service. Remove it and try again.'
    : 'ruflo-music: this memory write holds what looks like a secret (a key, token or password). Store a reference to where it lives, not the value.'
}
