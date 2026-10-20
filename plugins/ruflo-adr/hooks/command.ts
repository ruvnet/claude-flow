import { scan } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/adr-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/adr-mod status', '/adr-mod scan <text>', '/adr-mod format'].join('\n')

export function answer(args: string, deps: CommandDeps): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'} · calls guarded ${stats.calls} · blocked ${stats.blocked}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /adr-mod scan <text>'
    const found = scan(arg)
    const parts = [found.secrets.length ? `secrets: ${found.secrets.join(', ')}` : '', found.injection.length ? `injection phrasing: ${found.injection.join(', ')}` : ''].filter(Boolean)
    return parts.length ? `The guard would refuse a write of that (${parts.join('; ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'format') return 'An ADR carries: Status (proposed, accepted, deprecated, superseded), Context, Decision, Consequences. Relations: supersedes, amends, depends-on, related. Create with /adr-create, index with /adr-index.'

  return `Unknown: ${verb}\n${HELP}`
}
