import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const HELP = ['/trader-mod status', '/trader-mod scan <text>'].join('\n')

/** `/trader-mod` is answered locally and takes no model turn. */
export function answer(args: string, opts: ModOptions, stats: Stats): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return [
      `guard ${opts.guard ? 'on' : 'off'} · live-order guard ${opts.liveGuard ? 'on' : 'off'}`,
      `checked ${stats.checked} · blocked ${stats.blocked} · live orders refused ${stats.liveBlocked}${stats.lastBlock ? ` · last: ${stats.lastBlock}` : ''}`,
    ].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /trader-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse a write or call carrying that (${found.join(', ')}).` : 'Nothing secret-shaped found: the guard would let that through.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
