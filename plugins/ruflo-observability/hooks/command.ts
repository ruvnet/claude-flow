import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

const HELP = ['/observe-mod status', '/observe-mod scan <text>'].join('\n')

/** `/observe-mod` is answered locally and takes no model turn. */
export function answer(args: string, opts: ModOptions, stats: Stats): string {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return [
      `guard ${opts.guard ? 'on' : 'off'}`,
      `checked ${stats.checked} · blocked ${stats.blocked}${stats.lastBlock ? ` · last: ${stats.lastBlock}` : ''}`,
    ].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /observe-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse a write or call carrying that (${found.join(', ')}).` : 'Nothing secret-shaped found: the guard would let that through.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
