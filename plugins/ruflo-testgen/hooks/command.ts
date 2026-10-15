import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/testgen-mod` is answered locally and takes no model turn. */
export type CommandDeps = { readonly opts: ModOptions; readonly stats: Stats; readonly tools: () => Promise<readonly string[]> }

const HELP = ['/testgen-mod status', '/testgen-mod workers'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    const seen = Object.entries(stats.seen).map(([k, n]) => `${k} ${n}`).join(' · ')
    return [`observe-only · checked ${stats.checked}`, seen === '' ? 'no testgen calls this session' : seen].join('\n')
  }

  if (verb === 'workers') {
    const n = stats.seen['worker dispatch'] ?? 0
    return n === 0 ? 'No worker has been dispatched this session. The testgaps worker runs through hooks_worker-dispatch.' : `${n} worker dispatch${n === 1 ? '' : 'es'} this session.`
  }

  return `Unknown: ${verb}\n${HELP}`
}
