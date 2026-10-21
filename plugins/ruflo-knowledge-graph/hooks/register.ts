import type { Hook, Register } from 'claude-code'

import { isOwn, shortName, verdict } from './guard'
import { readOptions, type ModOptions } from './options'
import { scan } from './screen'

const COMMAND = 'kg-mod'
const STATUS_PATH = '.claude-flow/kg-mod/status.json'
const RECENT = 5

type Dollar = Parameters<Hook<'session.start'>>[0]

/** Everything one session of the mod keeps: its settings, per-tool counters, what was refused and the project root. */
type Session = {
  readonly opts: ModOptions
  readonly calls: Record<string, number>
  blocked: number
  readonly recent: string[]
  root?: string
}

const total = (s: Session) => Object.values(s.calls).reduce((a, b) => a + b, 0)

function note(s: Session, line: string): void {
  s.recent.push(line)
  if (s.recent.length > RECENT) s.recent.splice(0, s.recent.length - RECENT)
}

/** The status file the console reads; `version` lets it refuse a shape it does not know. Counters only, never tool input. */
async function flush($: Dollar, s: Session): Promise<void> {
  if (s.root === undefined) return
  const body = { version: 1, updatedMs: await $.clock.now(), guard: s.opts.guard, ...s.opts.extra, calls: s.calls, total: total(s), blocked: s.blocked, recent: s.recent }
  try {
    await $.fs.write(`${s.root}/${STATUS_PATH}`, `${JSON.stringify(body, null, 2)}\n`)
  } catch {
    /* the status file is a courtesy */
  }
}

/** The connected tools this plugin owns, by short name. */
async function connected($: Dollar): Promise<string[]> {
  const tools = await $.tool.list()
  return tools.filter(t => t.mcp && isOwn(shortName(t.name))).map(t => shortName(t.name))
}

const HELP = ['/kg-mod status', '/kg-mod scan <text>', '/kg-mod recent', '/kg-mod tools'].join('\n')

async function answer($: Dollar, s: Session, args: string): Promise<string> {
  const [verb = '', ...rest] = args.trim().split(/\s+/)
  const arg = rest.join(' ')
  if (verb === '' || verb === 'help') return HELP
  if (verb === 'status') {
    const per = Object.entries(s.calls).map(([k, v]) => `${k} ${v}`).join(' · ')
    return [`guard ${s.opts.guard ? 'on' : 'off'}${Object.entries(s.opts.extra).map(([k, v]) => ` · ${k} ${String(v)}`).join('')}`, `${total(s)} call${total(s) === 1 ? '' : 's'}${per ? ` (${per})` : ''} · refused ${s.blocked}`].join('\n')
  }
  if (verb === 'recent') return s.recent.length ? s.recent.map(r => `- ${r}`).join('\n') : 'Nothing has gone through this session.'
  if (verb === 'tools') {
    const names = await connected($)
    return names.length ? names.join('\n') : 'None of this plugin\'s tools are connected. Connect the ruflo MCP server and try again.'
  }
  if (verb === 'scan') {
    if (arg === '') return 'usage: /kg-mod scan <text>'
    const found = scan(arg)
    return found.secrets.length ? `The guard would refuse that (${found.secrets.join(', ')}).` : 'Nothing found: the guard would let that through.'
  }
  return `Unknown: ${verb}\n${HELP}`
}

/**
 * Knowledge graph as a mod (ADR-445): a tighten-only guard on this plugin's own tools, a status file the console reads, and `/kg-mod`.
 * No network, no process, no model call.
 */
export const register: Register = (on, options) => {
  const s: Session = { opts: readOptions(options), calls: {}, blocked: 0, recent: [] }

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    s.root = (await $.session.root()) as string | undefined
    try {
      await $.command.register({ name: COMMAND, description: 'Knowledge graph mod: status, scan <text>, recent, tools' })
    } catch {
      /* a name taken by another plugin must not stop the mod */
    }
    await flush($, s)
    return result
  })

  on('tool.call', async ($, e, next) => {
    const name = shortName(e.tool)
    if (!isOwn(name, e)) return next(e)
    if (s.opts.guard) {
      const reason = verdict(name, e, s.opts, s.calls)
      if (reason !== undefined) {
        s.blocked++
        note(s, `refused ${name}`)
        await flush($, s)
        return { deny: reason }
      }
    }
    s.calls[name] = (s.calls[name] ?? 0) + 1
    note(s, name)
    await flush($, s)
    return next(e)
  })

  /** `/kg-mod`: the plugin's own commands are prompt commands, which no hook can answer. */
  on('command.run', { command: COMMAND }, async ($, e) => ({ text: await answer($, s, typeof e.args === 'string' ? e.args : '') }))
}
