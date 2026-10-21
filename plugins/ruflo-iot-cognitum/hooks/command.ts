import { scan, tidy } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

export type CommandDeps = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly peek: (suffix: string, args: Record<string, unknown>) => Promise<string | undefined>
  readonly toolNames: () => Promise<readonly string[]>
}

const HELP = ['/iot-mod status', '/iot-mod scan <text>', '/iot-mod devices'].join('\n')

/** `/iot-mod` is answered locally and takes no model turn (the plugin's `/iot` is a prompt command, which no hook can answer). */
export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return `guard ${opts.guard ? 'on' : 'off'} · destructive needs confirm ${opts.confirmDestructive ? 'on' : 'off'}\ncalls blocked ${stats.blocked} · scans ${stats.scans} · commands ${stats.commands}${stats.lastDenied ? ` · last denied ${stats.lastDenied}` : ''}`
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /iot-mod scan <text>'
    stats.scans++
    const found = scan(arg).secrets
    return found.length ? `The guard would refuse a device record or command with that (secrets: ${found.join(', ')}).` : 'No secret shape found: the guard would let that through.'
  }

  if (verb === 'devices') {
    const text = await deps.peek('memory_list', { namespace: 'iot-devices', limit: 20 })
    if (text === undefined) return 'No memory tool is connected (or it errored). Connect the ruflo MCP server and try again.'
    return text.trim() === '' ? 'No registered devices stored.' : `Registered devices (as stored, untrusted data):\n${tidy(text, 1200)}`
  }

  return `Unknown: ${verb}\n${HELP}`
}
