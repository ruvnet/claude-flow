import type { ToolInfo } from 'claude-code'

import type { ModOptions } from './options'
import { secretsIn } from './screen'
import type { Stats } from './status'
import { isOwned, shortName } from './tools'

/** `/ruvector-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats; readonly tools: () => Promise<readonly ToolInfo[]> }

const HELP = ['/ruvector-mod status', '/ruvector-mod scan <text>', '/ruvector-mod tools'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'} · calls seen ${stats.seen} · blocked ${stats.blocked}${stats.lastBlocked ? ` · last blocked ${stats.lastBlocked}` : ''}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /ruvector-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse a call carrying that (${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'tools') {
    const names = (await deps.tools()).filter(t => t.mcp && isOwned(t.name)).map(t => shortName(t.name))
    return names.length ? `${names.length} connected: ${[...new Set(names)].sort().join(', ')}` : 'None of this plugin\'s tools is connected. Connect the MCP server and try again.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
