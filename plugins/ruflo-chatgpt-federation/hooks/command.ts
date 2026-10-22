import { PUBLIC_CHANNEL } from './guard'
import type { ModOptions } from './options'
import { secretsIn } from './screen'
import type { Stats } from './status'

export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats }

const HELP = ['/chatgpt-mod status', '/chatgpt-mod scan <text>', '/chatgpt-mod channel <id>'].join('\n')

/** `/chatgpt-mod` is answered locally and takes no model turn. Read-only: runs the guard's checks on what you give it. */
export function answer(args: string, { opts, stats }: CommandDeps): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (verb === '' || verb === 'help') return HELP
  if (verb === 'status') {
    const rules = Object.entries(stats.byRule).map(([k, n]) => `${k} ${n}`).join(', ')
    return [`guard ${opts.guard ? 'on' : 'off'} · payload cap ${opts.maxPayloadBytes} bytes`, `checked ${stats.checked} · blocked ${stats.blocked}${rules ? ` (${rules})` : ''}`].join('\n')
  }
  if (verb === 'scan') {
    if (arg === '') return 'usage: /chatgpt-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse publishing that (${found.join(', ')}).` : 'Nothing found: the guard would let that be published.'
  }
  if (verb === 'channel') {
    if (arg === '') return 'usage: /chatgpt-mod channel <id>'
    return PUBLIC_CHANNEL.test(arg) ? 'That is a public channel: publishing is allowed.' : 'Not a public pub:<name> channel: the guard would refuse a publish there.'
  }
  return `Unknown: ${verb}\n${HELP}`
}
