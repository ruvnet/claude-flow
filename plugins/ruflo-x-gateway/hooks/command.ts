import { secretsIn } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/xgw-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats; readonly tools: () => Promise<readonly string[]> }

const HELP = ['/xgw-mod status', '/xgw-mod scan <text>', '/xgw-mod tools'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    const seen = Object.entries(stats.seen).map(([k, n]) => `${k} ${n}`).join(' · ')
    return [`guard ${opts.guard ? 'on' : 'off'} · checked ${stats.checked} · blocked ${stats.blocked}`, seen === '' ? 'no x_federation calls this session' : seen].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /xgw-mod scan <text>'
    const found = secretsIn(arg)
    return found.length ? `The guard would refuse that (looks like: ${found.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }

  if (verb === 'tools') {
    const mine = (await deps.tools()).filter(t => t.includes('x_federation_')).map(t => t.slice(t.lastIndexOf('__') + 2))
    return mine.length ? mine.join('\n') : 'No x_federation tool is connected. Connect the ruflo MCP server and try again.'
  }

  return `Unknown: ${verb}\n${HELP}`
}
