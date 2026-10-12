import { scan, tidy } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

export type CommandDeps = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly peek: (suffix: string, args: Record<string, unknown>) => Promise<string | undefined>
  readonly toolNames: () => Promise<readonly string[]>
}

const HELP = ['/intelligence-mod status', '/intelligence-mod scan <text>', '/intelligence-mod stats'].join('\n')

/** `/intelligence-mod` is answered locally and takes no model turn (the plugin's `/intelligence` and `/neural` are prompt commands). */
export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'} · reset needs confirm ${opts.confirmReset ? 'on' : 'off'}\ncalls blocked ${stats.blocked} · scans ${stats.scans} · commands ${stats.commands}${stats.lastDenied ? ` · last denied ${stats.lastDenied}` : ''}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /intelligence-mod scan <text>'
    stats.scans++
    const found = scan(arg).secrets
    return found.length ? `The guard would refuse a learning write of that (secrets: ${found.join(', ')}).` : 'No secret shape found: the guard would let that be learned.'
  }

  if (verb === 'stats') {
    const text = await deps.peek('hooks_intelligence_stats', {})
    if (text === undefined) return 'No intelligence tool is connected (or it errored). Connect the ruflo MCP server and try again.'
    return text.trim() === '' ? 'No intelligence stats reported.' : tidy(text, 1200)
  }

  return `Unknown: ${verb}\n${HELP}`
}
