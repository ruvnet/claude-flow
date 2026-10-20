import type { FsEntry } from 'claude-code'

import { secretNames } from './screen'
import type { Stats } from './status'

/** `/daa-mod` is answered locally and takes no model turn. Everything it reads is already connected; nothing is written. */
export type CommandDeps = {
  readonly guard: boolean
  readonly stats: Stats
  readonly tools: () => Promise<readonly string[]>
  readonly list: (path: string) => Promise<readonly FsEntry[]>
}

const HELP = ['/daa-mod status', '/daa-mod scan <text>', '/daa-mod tools'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') return `guard ${deps.guard ? 'on' : 'off'} · calls blocked ${deps.stats.blocked}`

  if (verb === 'scan') {
    if (arg === '') return 'usage: /daa-mod scan <text>'
    const found = secretNames(arg)
    return found.length ? `The guard would refuse that (${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'tools') {
    const names = (await deps.tools()).filter(n => /__daa_[a-z_]+$/.test(n)).map(n => n.slice(n.lastIndexOf('__') + 2)).sort()
    return names.length ? `${names.length} daa_* tools connected:\n${names.map(n => `- ${n}`).join('\n')}` : 'No daa_* tool is connected. Connect the ruflo MCP server and try again.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
