import type { FsEntry } from 'claude-code'

import { secretNames } from './screen'
import type { Stats } from './status'

/** `/ddd-mod` is answered locally and takes no model turn. Everything it reads is already connected; nothing is written. */
export type CommandDeps = {
  readonly guard: boolean
  readonly stats: Stats
  readonly tools: () => Promise<readonly string[]>
  readonly list: (path: string) => Promise<readonly FsEntry[]>
}

const HELP = ['/ddd-mod status', '/ddd-mod scan <text>', '/ddd-mod contexts'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') return `guard ${deps.guard ? 'on' : 'off'} · calls blocked ${deps.stats.blocked}`

  if (verb === 'scan') {
    if (arg === '') return 'usage: /ddd-mod scan <text>'
    const found = secretNames(arg)
    return found.length ? `The guard would refuse that (${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'contexts') {
    const found: string[] = []
    for (const base of ['src', 'src/contexts', 'src/modules']) {
      let entries: readonly FsEntry[]
      try {
        entries = await deps.list(base)
      } catch {
        continue
      }
      if (entries.some(e => e.kind === 'dir' && e.name === 'domain') && base === 'src') found.push('src (single domain)')
      for (const dir of entries.filter(e => e.kind === 'dir' && e.name !== 'domain').slice(0, 40)) {
        try {
          if ((await deps.list(`${base}/${dir.name}`)).some(e => e.kind === 'dir' && e.name === 'domain')) found.push(`${base}/${dir.name}`)
        } catch {
          /* unreadable: not a context */
        }
      }
    }
    return found.length ? `${found.length} bounded context${found.length === 1 ? '' : 's'} (a folder with a domain/ layer):\n${found.map(f => `- ${f}`).join('\n')}` : 'No bounded context found under src/, src/contexts or src/modules.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
