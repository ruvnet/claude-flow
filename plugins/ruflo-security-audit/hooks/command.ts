import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/secaudit-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats; readonly tools: () => Promise<readonly string[]> }

const HELP = ['/secaudit-mod status', '/secaudit-mod scan <text>', '/secaudit-mod namespaces'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    const seen = Object.entries(stats.seen).map(([k, n]) => `${k} ${n}`).join(' · ')
    return [`guard ${opts.guard ? 'on' : 'off'} · checked ${stats.checked} · blocked ${stats.blocked}`, seen === '' ? 'no audit-memory calls this session' : seen].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /secaudit-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse that (looks like: ${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'namespaces') return 'Guarded memory namespaces: any starting with security, audit, cve, vuln, findings or secaudit (writes through memory_store, agentdb_hierarchical-store, agentdb_pattern-store).'

  return `Unknown: ${verb}\n${HELP}`
}
