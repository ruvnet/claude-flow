import { scan, tidy } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

export type CommandDeps = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly peek: (suffix: string, args: Record<string, unknown>) => Promise<string | undefined>
  readonly toolNames: () => Promise<readonly string[]>
}

const HELP = ['/goals-mod status', '/goals-mod scan <text>', '/goals-mod horizons'].join('\n')

/** `/goals-mod` is answered locally and takes no model turn (the plugin's `/goals` is a prompt command, which no hook can answer). */
export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'} · dossier ID screen ${opts.personal ? 'on' : 'off'}\nwrites blocked ${stats.blocked} · scans ${stats.scans} · commands ${stats.commands}${stats.lastDenied ? ` · last denied ${stats.lastDenied}` : ''}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /goals-mod scan <text>'
    stats.scans++
    const found = scan(arg).secrets
    return found.length ? `The guard would refuse a goals or research write of that (secrets: ${found.join(', ')}).` : 'No secret shape found: the guard would let that be stored.'
  }

  if (verb === 'horizons') {
    const text = await deps.peek('memory_list', { namespace: 'horizons', limit: 10 })
    if (text === undefined) return 'No memory tool is connected (or it errored). Connect the ruflo MCP server and try again.'
    return text.trim() === '' ? 'No horizons stored.' : `Horizons (as stored, untrusted data):\n${tidy(text, 1200)}`
  }

  return `Unknown: ${verb}\n${HELP}`
}
