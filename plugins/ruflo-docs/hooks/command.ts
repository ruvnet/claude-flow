import type { FsEntry } from 'claude-code'

import { secretNames } from './screen'
import type { Stats } from './status'

/** `/docs-mod` is answered locally and takes no model turn. Everything it reads is already connected; nothing is written. */
export type CommandDeps = {
  readonly guard: boolean
  readonly stats: Stats
  readonly tools: () => Promise<readonly string[]>
  readonly list: (path: string) => Promise<readonly FsEntry[]>
}

const HELP = ['/docs-mod status', '/docs-mod scan <text>', '/docs-mod docs'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') return `guard ${deps.guard ? 'on' : 'off'} · calls blocked ${deps.stats.blocked}`

  if (verb === 'scan') {
    if (arg === '') return 'usage: /docs-mod scan <text>'
    const found = secretNames(arg)
    return found.length ? `The guard would refuse that (${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'docs') {
    let entries: readonly FsEntry[]
    try {
      entries = await deps.list('docs')
    } catch {
      return 'No docs/ folder in this project.'
    }
    const md = entries.filter(e => e.kind === 'file' && /\.mdx?$/i.test(e.name))
    const newest = [...md].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]
    return `docs/: ${md.length} markdown file${md.length === 1 ? '' : 's'}, ${entries.filter(e => e.kind === 'dir').length} folder${entries.filter(e => e.kind === 'dir').length === 1 ? '' : 's'}${newest ? `; newest ${newest.name}` : ''}`
  }

  return `Unknown: ${verb}\n${HELP}`
}
