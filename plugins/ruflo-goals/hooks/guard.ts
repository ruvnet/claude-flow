import { hasSecret, textsOf } from './screen'
import { bare, namespaceOf } from './tools'
import type { ModOptions } from './options'

/** The namespaces the goals, research and dossier skills write to (legacy names included). */
const OWNED = /^(?:horizons?|research|goap|dossier|goals?)/i
/** Namespaces that can hold facts about a person: dossiers and research notes. */
const PEOPLE = /^(?:dossier|research)/i

const WRITERS = new Set(['memory_store', 'agentdb_hierarchical-store', 'agentdb_pattern-store', 'agentdb_batch', 'hooks_intelligence_pattern-store', 'task_create'])

// A US social security number; the one personal identifier with a shape tight enough to refuse on.
const GOV_ID = /\b\d{3}-\d{2}-\d{4}\b/

/** The reason a goals/research write is refused, or undefined when it may go. Never names or echoes the value. */
export function verdict(tool: string, input: unknown, opts: ModOptions): string | undefined {
  const name = bare(tool)
  if (!WRITERS.has(name)) return undefined
  const ns = namespaceOf(input)
  if (!OWNED.test(ns) && name !== 'task_create') return undefined
  const texts = textsOf(input)
  if (texts.some(hasSecret)) {
    return 'ruflo-goals: this write holds what looks like a secret (a key, token or password). Record where it lives, not the value.'
  }
  if (opts.personal && PEOPLE.test(ns) && texts.some(t => GOV_ID.test(t))) {
    return 'ruflo-goals: this dossier or research note holds what looks like a government ID number. Leave it out; keep sources and findings only.'
  }
  return undefined
}
