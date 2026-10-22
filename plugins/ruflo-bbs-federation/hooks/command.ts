import { badPeerUrl } from './guard'
import type { ModOptions } from './options'
import { secretsIn } from './screen'
import type { Stats } from './status'

export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/bbs-mod status', '/bbs-mod scan <text>', '/bbs-mod peer <url>'].join('\n')

/** `/bbs-mod` is answered locally and takes no model turn. Read-only: it only runs the guard's own checks on text you give it. */
export function answer(args: string, { opts, stats }: CommandDeps): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (verb === '' || verb === 'help') return HELP
  if (verb === 'status') {
    const rules = Object.entries(stats.byRule).map(([k, n]) => `${k} ${n}`).join(', ')
    return [
      `guard ${opts.guard ? 'on' : 'off'} · wildcard bind ${opts.allowWildcardBind ? 'allowed' : 'refused'}`,
      `checked ${stats.checked} · blocked ${stats.blocked}${rules ? ` (${rules})` : ''}`,
    ].join('\n')
  }
  if (verb === 'scan') {
    if (arg === '') return 'usage: /bbs-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse publishing that (${found.join(', ')}).` : 'Nothing found: the guard would let that be published.'
  }
  if (verb === 'peer') {
    if (arg === '') return 'usage: /bbs-mod peer <url>'
    const why = badPeerUrl(arg)
    return why === undefined ? 'The guard would accept that peer url.' : `The guard would refuse that peer url: it ${why}.`
  }
  return `Unknown: ${verb}\n${HELP}`
}
