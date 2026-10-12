import { frame, parse, screen } from './recall'
import { scan } from './screen'
import type { ModOptions } from './options'
import type { Stats } from './status'

/** `/agentdb-mod` is answered locally and takes no model turn. `read` is the same recall path the prompt hook uses. */
export type CommandDeps = {
  readonly opts: ModOptions
  readonly stats: Stats
  readonly read: (query: string) => Promise<{ readonly tool: string; readonly text: string } | undefined>
  readonly nowMs: () => Promise<number>
}

const HELP = ['/agentdb-mod status', '/agentdb-mod recall <text>', '/agentdb-mod scan <text>', '/agentdb-mod recent'].join('\n')

export async function answer(args: string, deps: CommandDeps): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  const { opts, stats } = deps

  if (verb === '' || verb === 'help') return HELP

  if (verb === 'status') {
    return [
      `recall ${opts.recall ? 'on' : 'off'} · guard ${opts.guard ? 'on' : 'off'} · source ${opts.source}${stats.lastTool ? ` · ${stats.lastTool}` : ''}`,
      `attached ${stats.attached} · skipped ${stats.skipped} · cached ${stats.cached} · timed out ${stats.timedOut} · dropped as unsafe ${stats.dropped} · writes blocked ${stats.blocked}${stats.lastMs === undefined ? '' : ` · last ${stats.lastMs} ms`}`,
    ].join('\n')
  }

  if (verb === 'scan') {
    if (arg === '') return 'usage: /agentdb-mod scan <text>'
    const found = scan(arg)
    const parts = [found.secrets.length ? `secrets: ${found.secrets.join(', ')}` : '', found.injection.length ? `injection phrasing: ${found.injection.join(', ')}` : ''].filter(Boolean)
    return parts.length ? `The guard would refuse a memory write of that (${parts.join('; ')}).` : 'Nothing found: the guard would let that be stored.'
  }

  if (verb === 'recent') {
    if (stats.recent.length === 0) return 'Nothing has been attached to a prompt this session.'
    return stats.recent.map(r => `- ${r.snippet} [${r.source}${r.score === undefined ? '' : ` ${r.score.toFixed(2)}`}]`).join('\n')
  }

  if (verb === 'recall') {
    if (arg === '') return 'usage: /agentdb-mod recall <text>'
    const got = await deps.read(arg)
    if (!got) return 'No memory tool is connected (or the source is set to none). Connect the ruflo MCP server and try again.'
    const screened = screen(parse(got.text, got.tool, await deps.nowMs()), opts.recallLimit)
    const note = screened.unsafe > 0 ? `\n(${screened.unsafe} result${screened.unsafe === 1 ? '' : 's'} dropped as unsafe.)` : ''
    return screened.items.length ? `${frame(screened.items)}${note}` : `Nothing relevant found.${note}`
  }

  return `Unknown: ${verb}\n${HELP}`
}
