import type { On, RenderElement, RenderInput, RenderNode, SessionStartInput } from 'claude-code'
import type { Plugin } from 'claude-code/testing'

import { CLI_OUT } from './ruflo-run'
import { CONFIGURE_HELP, MODEL_STATS } from './cost'

export const PLUGIN = 'ruflo-console'
export const CWD = '/work'
export const HOME = '/home/dev'
export const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: CWD }

export const paneAt = (bodyColumns = 100, bodyRows = 40, isFocused = true, surface: 'terminal' | 'desktop' = 'terminal'): RenderInput<'Pane'> =>
  ({
    component: 'Pane',
    surface,
    requestId: 'ruflo-console',
    viewport: { columns: 180, rows: 48, isFullscreen: true },
    props: { title: 'ruflo console', isFocused, bodyColumns, placement: 'dock', scroll: { offset: 0, bodyRows }, view: {} },
  }) as RenderInput<'Pane'>

export const BAND: RenderInput<'AbovePrompt'> = {
  component: 'AbovePrompt',
  surface: 'terminal',
  requestId: 'band',
  viewport: { columns: 120, rows: 40, isFullscreen: true },
  props: { hasSurvey: false, isWorking: false, maxRows: 6, bodyColumns: 120, scroll: { offset: 0, bodyRows: 6 }, view: {} },
} as RenderInput<'AbovePrompt'>

export const command = (args = '') => ({ command: 'ruflo', args, origin: { kind: 'composer' as const }, presentation: { isFullscreen: true, columns: 180 } })

/** The host hands hooks native paths (`C:\work\.claude-flow\x` on Windows); the fake file system keys on `/work/...`. */
export const normalizeFixturePath = (p: string): string => p.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

export type Answer = { exitCode: number; stdout: string; stderr: string } | { deny: string }

export type World = {
  files: Map<string, string>
  runs: string[][]
  /** Every path the mod asked fs.read for, refused or not. */
  reads: string[]
  /** Every path the mod asked fs.stat for, including cached and refused reads. */
  stats: string[]
  inputs: string[]
  /** The lines the console drew with `$.ui.toast` (ADR-477: after the shared policy). */
  toasts: string[]
  /** Prompts the mod submitted to the primary session (`$.prompt.submit`). */
  prompts: string[]
  /** Text the mod put in the prompt box (`$.prompt.fill`). */
  fills: string[]
  blits: string[]
  opened: string[]
  commands: string[]
  openArgs: { id: string; focus?: true; rows?: number }[]
  stored: Map<string, unknown>
  panes: { id: string; isShown: boolean; isFocused: boolean; title: string; isPlaced: boolean }[]
  /** Answers a CLI run by its argv; the default answers each probe from the captured run. */
  respond: (argv: readonly string[]) => Answer
  put: (path: string, text: string) => void
}

/** The captured CLI output each probe's argv gets. */
export function cliAnswer(argv: readonly string[]): Answer {
  const line = argv.join(' ')
  const out = (name: string): Answer => ({ exitCode: 0, stdout: CLI_OUT[name] ?? '', stderr: '' })

  if (line === 'claude plugin configure --help') return { exitCode: 0, stdout: CONFIGURE_HELP, stderr: '' }
  if (line.includes('hooks model-stats')) return { exitCode: 0, stdout: MODEL_STATS, stderr: '' }

  if (line.endsWith('--version')) return out('version')
  if (line.includes('memory stats')) return out('memory-stats')
  if (line.includes('memory list')) return out('memory-list')
  if (line.includes('metaharness score')) return out('mh-score')
  if (line.includes('metaharness_flywheel')) return out('mh-flywheel')
  if (line.includes('hooks_intelligence_stats')) return out('intel')
  if (line.includes('federation_bbs_peers')) return out('bbs-peers')
  if (line.includes('x_federation_channel_list')) return out('channels')
  if (line.includes('metaharness audit-list')) return out('mh-audit-list')
  if (line.includes('metaharness mcp-scan')) return out('mh-mcp-scan')
  if (line.includes('metaharness threat-model')) return out('mh-threat')
  if (line.includes('metaharness redblue run --mock-judge')) return out('mh-redblue-mock')
  if (line.includes('metaharness gepa --op render')) return out('mh-gepa-render')
  if (line.includes('doctor --component metaharness')) return out('mh-doctor')

  return { exitCode: 0, stdout: '{"success": true}', stderr: '' }
}

/**
 * Seats an in-memory world beneath the plugin: files under CWD and HOME, a process table, the store, the panes, and
 * records of what the mod asked for. `refuseAll` refuses every one of those affordances, as an administrator may.
 */
export function worldOf(on: On, files: Readonly<Record<string, string>>, options: { refuseAll?: boolean; commands?: readonly string[]; home?: Readonly<Record<string, string>>; env?: Readonly<Record<string, string>> } = {}): World {
  let tick = 1_000
  const all = new Map<string, string>([...Object.entries(files).map(([path, text]) => [normalizeFixturePath(`${CWD}/${path}`), text] as const), ...Object.entries(options.home ?? {}).map(([path, text]) => [normalizeFixturePath(`${HOME}/${path}`), text] as const)])
  const mtimes = new Map<string, number>([...all.keys()].map(path => [path, tick]))
  const world: World = {
    files: all,
    runs: [],
    reads: [],
    stats: [],
    inputs: [],
    toasts: [],
    prompts: [],
    fills: [],
    blits: [],
    opened: [],
    commands: [],
    openArgs: [],
    stored: new Map(),
    panes: [],
    respond: cliAnswer,
    put: (path, text) => {
      tick += 1_000
      all.set(normalizeFixturePath(`${CWD}/${path}`), text)
      mtimes.set(normalizeFixturePath(`${CWD}/${path}`), tick)
    },
  }
  const refuse = options.refuseAll === true

  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('fs.read', ($, e) => {
    const path = normalizeFixturePath(e.path)

    world.reads.push(path)

    return refuse || !all.has(path) ? { deny: `ENOENT: ${path}` } : { value: all.get(path) as string }
  })
  on('fs.stat', ($, e) => {
    const path = normalizeFixturePath(e.path)

    world.stats.push(path)

    const text = all.get(path)

    // A folder that holds a file stats as a directory, as a real one does (the ADRs page asks before it lists).
    if (!refuse && text === undefined && [...all.keys()].some(key => key.startsWith(`${path}/`))) return { value: { kind: 'dir' as const, size: 0, mtimeMs: 1, isLink: false } }

    return refuse || text === undefined ? { deny: `ENOENT: ${path}` } : { value: { kind: 'file' as const, size: text.length, mtimeMs: mtimes.get(path) ?? 0, isLink: false } }
  })
  on('fs.list', ($, e) => {
    const prefix = `${normalizeFixturePath(e.path ?? CWD)}/`
    const below = [...all.keys()].filter(path => path.startsWith(prefix)).map(path => path.slice(prefix.length))
    const files = below.filter(name => !name.includes('/'))
    // A folder holding a file shows as a directory entry of its own, as a real listing does.
    const dirs = [...new Set(below.filter(name => name.includes('/')).map(name => name.split('/')[0] as string))]
    const entries = [...files.map(name => ({ name, kind: 'file' as const })), ...dirs.map(name => ({ name, kind: 'dir' as const }))]

    return refuse || entries.length === 0 ? { deny: 'ENOENT' } : { value: entries.map(entry => ({ ...entry, size: 1, mtimeMs: 1, isLink: false })) }
  })
  on('prompt.submit', ($, e) => (world.prompts.push(e.text), { text: e.text }))
  on('prompt.fill', ($, e) => (world.fills.push(e.text), { isFilled: true }))
  on('command.list', () => ({ value: (options.commands ?? []).map(name => ({ name, description: '', source: 'plugin' as const })) as never }))
  on('process.run', ($, e) => {
    if (refuse) return { deny: 'process.run withheld' }

    world.runs.push([...e.argv])
    if (e.init?.stdin !== undefined) world.inputs.push(e.init.stdin)

    const answer = world.respond(e.argv)

    return 'deny' in answer ? { deny: answer.deny } : { value: { ...answer, isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('env.get', ($, e) => (refuse ? { deny: 'env withheld' } : { value: e.name === 'HOME' ? HOME : options.env?.[e.name] }))
  on('settings.read', () => (refuse ? { deny: 'settings withheld' } : { value: { enabledPlugins: { 'ruflo-core@ruflo': true } } as never }))
  on('session.usage', () => (refuse ? { deny: 'usage withheld' } : { value: { context: { tokens: 50_000, window: 200_000, percent: 25 }, rateLimits: [], cost: { usd: 0.4213 } } as never }))
  on('tool.list', () => (refuse ? { deny: 'tools withheld' } : { value: [{ name: 'mcp__plugin_ruflo-core_ruflo__swarm_init' }, { name: 'mcp__plugin_ruflo-core_ruflo__claims_board' }, { name: 'Read' }] as never }))
  on('store.get', ($, e) => (refuse ? { deny: 'store withheld' } : { value: world.stored.get(e.key) }))
  on('store.set', ($, e) => {
    if (refuse) return { deny: 'store withheld' }

    world.stored.set(e.key, e.value)

    return { value: undefined }
  })
  on('command.register', ($, e) => {
    if (refuse) return { deny: 'commands withheld' }

    world.commands.push(e.name)

    return { value: { command: e.name } }
  })
  on('ui.open', ($, e) => {
    if (refuse) return { deny: 'panes withheld' } as never

    world.opened.push(e.id)
    world.openArgs.push({ id: e.id, ...(e.focus !== undefined && { focus: e.focus }), ...(e.rows !== undefined && { rows: e.rows }) })
    world.panes = [{ id: e.id, title: e.title ?? e.id, isShown: true, isFocused: e.focus === true, isPlaced: true }]

    return { value: { isPlaced: true } } as never
  })
  on('ui.close', ($, e) => {
    world.panes = world.panes.filter(pane => pane.id !== e.id)

    return { value: undefined } as never
  })
  on('ui.panes', () => (refuse ? { deny: 'panes withheld' } : { value: world.panes as never }))
  on('ui.blit', ($, e) => {
    world.blits.push(e.key)

    return { value: {} }
  })
  on('ui.toast', ($, e) => (world.toasts.push(e.text), { value: undefined }))
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return world
}

/** A stand-in for ruflo-mods' `$.ruflo` noun, answering a fixed snapshot and recording segments. */
export function fakeRuflo(segments: (string | null)[] = []): Plugin {
  const route = { agent: 'tester', confidence: 0.6, matched: true, reason: 'keyword: test' }

  return {
    name: 'fake-ruflo',
    tier: 'user',
    register: on => {
      on('engine.create', async ($, e, next) => {
        const beneath = await next(e)
        const added = {
          ruflo: {
            segment: async (input: { id: string; text: string | null }) => void segments.push(input.text),
            lastRoute: async () => route,
            snapshot: async () => ({ owned: ['route', 'post-edit'], routed: 4, lastRoute: route, policy: 'observe', tightened: 1, observed: 2, edits: 3, budget: { level: 'WARNING', usd: 3.9, limit: 5 }, segments: [] }),
          },
        }

        return { ...added, ...beneath }
      })
    },
  }
}

export function stringsOf(node: RenderNode | RenderElement | null | undefined): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return []
  if (typeof node === 'string' || typeof node === 'number') return [String(node)]

  const props = (node as { props?: Record<string, unknown> }).props
  const own = node.type === 'Button' && typeof props?.label === 'string' ? [props.label] : []
  const children = (node as { children?: readonly RenderNode[] }).children ?? []

  return [...own, ...children.flatMap(child => stringsOf(child))]
}

export const textOf = (node: RenderNode | RenderElement | null | undefined): string => stringsOf(node).join('\n')

export function elementsOf(node: RenderNode | RenderElement | null | undefined, type: string): RenderElement[] {
  if (node === null || node === undefined || typeof node !== 'object') return []

  const children = (node as { children?: readonly RenderNode[] }).children ?? []

  return [...(node.type === type ? [node as RenderElement] : []), ...children.flatMap(child => elementsOf(child, type))]
}

/** The keys of a page's own text fields: the nav's search field is on every page, so it is left out. */
export const inputKeys = (tree: Parameters<typeof elementsOf>[0]): string[] => elementsOf(tree, 'Input').map(keyOf).filter(key => key !== 'nav-find')

export const keyOf = (element: RenderElement): string => String((element as { key?: unknown }).key ?? (element as { props?: { key?: unknown } }).props?.key ?? '')
