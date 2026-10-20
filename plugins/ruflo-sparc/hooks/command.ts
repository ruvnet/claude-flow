import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/sparc-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats; readonly tools: () => Promise<readonly string[]> }

const HELP = ['/sparc-mod status', '/sparc-mod scan <text>', '/sparc-mod phases'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    const seen = Object.entries(stats.seen).map(([k, n]) => `${k} ${n}`).join(' · ')
    return [`guard ${opts.guard ? 'on' : 'off'} · checked ${stats.checked} · blocked ${stats.blocked}`, seen === '' ? 'no sparc-artifact calls this session' : seen].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /sparc-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse that (looks like: ${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'phases') return ['S specification', 'P pseudocode', 'A architecture', 'R refinement', 'C completion', 'Artifacts go in memory namespaces starting with sparc; the guard screens them for secrets.'].join('\n')

  return `Unknown: ${verb}\n${HELP}`
}
