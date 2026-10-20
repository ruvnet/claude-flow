import { scan } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/ai-team-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/ai-team-mod status', '/ai-team-mod scan <text>'].join('\n')

export function answer(args: string, deps: CommandDeps): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'} · calls guarded ${stats.calls} · blocked ${stats.blocked}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /ai-team-mod scan <text>'
    const found = scan(arg)
    const parts = [found.secrets.length ? `secrets: ${found.secrets.join(', ')}` : '', found.injection.length ? `injection phrasing: ${found.injection.join(', ')}` : ''].filter(Boolean)
    return parts.length ? `The guard would refuse a write of that (${parts.join('; ')}).` : 'Nothing found: the guard would let that through.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
