import type { FsEntry } from 'claude-code'

import { secretNames } from './screen'
import type { Stats } from './status'

/** `/deepseek-mod` is answered locally and takes no model turn. Everything it reads is already connected; nothing is written. */
export type CommandDeps = {
  readonly guard: boolean
  readonly stats: Stats
  readonly tools: () => Promise<readonly string[]>
  readonly list: (path: string) => Promise<readonly FsEntry[]>
}

const HELP = ['/deepseek-mod status', '/deepseek-mod scan <text>'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') return `guard ${deps.guard ? 'on' : 'off'} · calls blocked ${deps.stats.blocked}`

  if (verb === 'scan') {
    if (arg === '') return 'usage: /deepseek-mod scan <text>'
    const found = secretNames(arg)
    return found.length ? `The guard would refuse that (${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
