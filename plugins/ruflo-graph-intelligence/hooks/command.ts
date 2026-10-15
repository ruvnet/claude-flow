import { scan } from './screen'
import { isGraphTool } from './guard'
import type { ModOptions } from './options'
import type { Stats } from './status'

export type CommandDeps = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly peek: (suffix: string, args: Record<string, unknown>) => Promise<string | undefined>
  readonly toolNames: () => Promise<readonly string[]>
}

const HELP = ['/graph-mod status', '/graph-mod scan <text>', '/graph-mod tools'].join('\n')

/** `/graph-mod` is answered locally and takes no model turn. */
export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'}\ncalls blocked ${stats.blocked} · scans ${stats.scans} · commands ${stats.commands}${stats.lastDenied ? ` · last denied ${stats.lastDenied}` : ''}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /graph-mod scan <text>'
    stats.scans++
    const found = scan(arg).secrets
    return found.length ? `The guard would refuse a graph call with that (secrets: ${found.join(', ')}).` : 'No secret shape found: the guard would let that through.'
  }

  if (verb === 'tools') {
    const names = (await deps.toolNames()).filter(isGraphTool)
    return names.length ? `Connected graph-intelligence tools:\n${names.map(n => `- ${n}`).join('\n')}` : 'No graph-intelligence tool is connected (the engine ships as a library; register its MCP tools to use it).'
  }

  return `Unknown: ${verb}\n${HELP}`
}
