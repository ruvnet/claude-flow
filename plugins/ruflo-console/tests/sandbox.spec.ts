/**
 * The Sandbox page (ADR-442): Plugins sits in TOOLS and Sandbox in NETWORK, every page in exactly one group; the tmux entries are fixed
 * argv arrays that can only name ruflo-sb-* sessions, type with -l and never reach a shell; a missing tmux makes the rows n/a; the page
 * has its three sections; the guide exists and points at real things. Run with
 *   npx vitest run plugins/ruflo-console/tests/sandbox.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { emptyFields, fieldValue, type DevFields } from '../hooks/data/devtools'
import { DEV, DEV_GROUPS, devPalette, devSpec, devWhy, withTmux } from '../hooks/devtools'
import { topicById } from '../hooks/help-topics'
import { VIEW_TOPIC } from '../hooks/help-docs'
import { groupOf, NAV_GROUPS } from '../hooks/nav-state'
import { paneLines, probeTmux, RVM_LINES, SANDBOX, sandboxLines } from '../hooks/sandbox'
import { newState, VIEWS } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { GROUPS } from '../hooks/views/menu'
import { sandboxView } from '../hooks/views/sandbox'

const fields = (over: Partial<DevFields>): DevFields => ({ ...emptyFields(), ...over })
const entry = (id: string) => DEV.find(candidate => candidate.id === id)!
const argvOf = (id: string, over: Partial<DevFields>) => devSpec(entry(id), fields(over))?.argv ?? null

describe('the nav groups', () => {
  it('has Plugins in TOOLS and Sandbox in NETWORK; Skills and the Plugin Catalog stay in NETWORK', () => {
    expect(groupOf('plugins')).toBe('TOOLS')
    expect(groupOf('sandbox')).toBe('NETWORK')
    expect(groupOf('skills')).toBe('NETWORK')
    expect(groupOf('market')).toBe('NETWORK')
  })

  it('puts every page but the menu in exactly one group, at most six to a row', () => {
    const all = NAV_GROUPS.flatMap(group => group.rows.flat())

    expect(new Set(all).size).toBe(all.length)
    expect([...all].sort()).toEqual(VIEWS.filter(view => view.id !== 'menu').map(view => view.id).sort())
    for (const group of NAV_GROUPS) for (const row of group.rows) expect(row.length).toBeLessThanOrEqual(6)
  })

  it('draws the same grouping on the main menu: Plugins & Mods on the TOOLS card, Sandbox on NETWORK & EXTEND', () => {
    const goes = (title: string) => GROUPS.find(group => group.title === title)!.sections.flatMap(section => section.items.map(item => item.go))

    expect(goes('TOOLS')).toContain('plugins')
    expect(goes('NETWORK & EXTEND')).not.toContain('plugins')
    expect(goes('NETWORK & EXTEND')).toContain('sandbox')
  })

  it('gives Sandbox no key, since every letter is a page key or reserved', () => {
    expect(VIEWS.find(view => view.id === 'sandbox')?.key).toBe('')
  })
})

describe('the tmux entries', () => {
  const tmux = SANDBOX.filter(candidate => candidate.group === 'tmux')
  const FULL = fields({ session: 'demo', send: 'echo hi; ls' })

  it('are fixed argv arrays that start with tmux, hold no shell, and are the same for the same fields', () => {
    expect(tmux.map(candidate => candidate.id)).toEqual(['dt-sb-list', 'dt-sb-new', 'dt-sb-send', 'dt-sb-capture', 'dt-sb-kill'])

    for (const candidate of tmux) {
      const spec = devSpec(candidate, FULL)

      expect(spec?.args, candidate.id).toEqual([])
      expect(spec?.argv?.[0], candidate.id).toBe('tmux')
      expect(spec?.argv?.some(word => /^(sh|bash|zsh|-c)$/.test(word)), candidate.id).toBe(false)
      expect(devSpec(candidate, FULL)?.argv).toEqual(spec?.argv)
    }
  })

  it('name a session only as an exact ruflo-sb-<name>, so the console can touch nothing else', () => {
    expect(argvOf('dt-sb-new', { session: 'demo' })).toEqual(['tmux', 'new-session', '-d', '-s', 'ruflo-sb-demo'])
    expect(argvOf('dt-sb-kill', { session: 'demo' })).toEqual(['tmux', 'kill-session', '-t', '=ruflo-sb-demo'])
    expect(argvOf('dt-sb-capture', { session: 'demo' })).toEqual(['tmux', 'capture-pane', '-p', '-t', '=ruflo-sb-demo:', '-S', '-40'])

    for (const id of ['dt-sb-new', 'dt-sb-send', 'dt-sb-capture', 'dt-sb-kill']) {
      for (const bad of ['', '-x', '_a', 'a b', 'a.b', 'a:b', 'a;b', '../x', 'a'.repeat(41), 'a\nb', '=x', '*']) expect(argvOf(id, { session: bad, send: 'ls' }), `${id} ${bad}`).toBeNull()
    }

    expect(fieldValue('session', 'a'.repeat(40))).not.toBeNull()
    expect(fieldValue('session', 'Ab_c-9')).not.toBeNull()
  })

  it('types with -l then presses Enter as a separate tmux command; the text is one element', () => {
    const argv = argvOf('dt-sb-send', FULL) ?? []

    expect(argv).toEqual(['tmux', 'send-keys', '-t', '=ruflo-sb-demo:', '-l', 'echo hi; ls', ';', 'send-keys', '-t', '=ruflo-sb-demo:', 'Enter'])
    expect(argv.indexOf('-l')).toBeLessThan(argv.indexOf('Enter'))
  })

  it('follows the terminal prose rule for the text, and refuses text ending in ; (tmux would split it into two commands)', () => {
    for (const bad of ['', '   ', '-rf /', 'a\nb', 'a\u0007b', 'x'.repeat(201), 'ls;']) expect(argvOf('dt-sb-send', fields({ session: 'demo', send: bad })), JSON.stringify(bad)).toBeNull()

    expect(argvOf('dt-sb-send', fields({ session: 'demo', send: 'x'.repeat(200) }))).not.toBeNull()
    expect(devWhy(entry('dt-sb-send'), fields({ session: 'demo', send: 'ls;' }))).toMatch(/send field.*not ending in ;/)
    expect(devWhy(entry('dt-sb-new'), fields({}))).toMatch(/session field is empty/)
  })

  it('tags each row by what it does: read, writes, a SHELL COMMAND, deletes', () => {
    expect(tmux.map(candidate => candidate.cost)).toEqual(['read', 'writes', 'writes', 'read', 'deletes'])
    expect(devSpec(entry('dt-sb-send'), FULL)?.note).toMatch(/SHELL COMMAND/)
    expect(devSpec(entry('dt-sb-kill'), FULL)?.note).toMatch(/DELETES/)
    expect(devSpec(entry('dt-sb-list'), FULL)?.isReadOnly).toBe(true)
    expect(devSpec(entry('dt-sb-send'), FULL)?.isReadOnly).toBeUndefined()
  })

  it('go n/a with the reason when tmux is missing, and out of the palette; unknown counts as present', () => {
    const state = newState({})
    const ids = () => devPalette(state).map(candidate => candidate.id)

    expect(ids()).toContain('dt-sb-new')
    state.devtools.tmux = 'missing'
    expect(ids()).not.toContain('dt-sb-new')
    expect(ids()).toContain('dt-cow-status')

    for (const candidate of tmux) {
      const na = withTmux(candidate, 'missing')

      expect(devSpec(na, FULL), candidate.id).toBeNull()
      expect(devWhy(na, FULL), candidate.id).toMatch(/^n\/a: tmux is not installed/)
    }
  })

  it('probes tmux once when the page opens: present on exit 0, missing on a failure or a throw', async () => {
    const run = async (result: () => Promise<{ exitCode: number }>) => {
      const state = newState({})
      const host = { run: result, invalidate: () => undefined }

      await probeTmux(state, host as never)

      return state.devtools.tmux
    }

    expect(await run(async () => ({ exitCode: 0 }))).toBe('present')
    expect(await run(async () => ({ exitCode: 127 }))).toBe('missing')
    expect(await run(() => Promise.reject(new Error('ENOENT')))).toBe('missing')
  })

  it('lists only ruflo-sb-* sessions, says so when none, and reads a pane without trailing blanks', () => {
    const out = 'work|2|1791089365\nruflo-sb-demo|1|1791089365\nother|1|1\nruflo-sb-two|3|1791089365\n'

    expect(sandboxLines(out, '', true)).toEqual(['demo · 1 window · started 2026-10-04 04:49Z', 'two · 3 windows · started 2026-10-04 04:49Z'])
    expect(sandboxLines('work|1|1\n', '', true)[0]).toMatch(/no sandbox sessions yet/)
    expect(sandboxLines('', 'no server running on /tmp/tmux-1000/default', false)[0]).toMatch(/no sandbox sessions yet \(tmux has no server running\)/)
    expect(paneLines('$ ls\nfile\n\n\n', '', true)).toEqual(['$ ls', 'file'])
    expect(paneLines('', "can't find session: ruflo-sb-x", false)[0]).toMatch(/^✗/)
  })
})

describe('the RVF and RVM sections', () => {
  it('RVF reuses the Dev Tools agenticow rows: the cow group is still there and is the same entries', () => {
    expect(DEV.filter(candidate => candidate.group === 'cow').map(candidate => candidate.id)).toEqual(expect.arrayContaining(['dt-cow-status', 'dt-cow-diff', 'dt-cow-lineage', 'dt-cow-checkpoint', 'dt-cow-branch', 'dt-cow-rollback', 'dt-cow-promote']))
  })

  it('RVM is information only: every row is n/a with the reason, and the lines cite what the ADRs say', () => {
    const rvm = SANDBOX.filter(candidate => candidate.group === 'rvm')

    expect(rvm.length).toBeGreaterThan(0)

    for (const candidate of rvm) {
      expect(candidate.na, candidate.id).toMatch(/no rvm command or MCP tool/)
      expect(devSpec(candidate, fields({})), candidate.id).toBeNull()
    }

    expect(RVM_LINES.join(' ')).toMatch(/authority: none/)
    expect(RVM_LINES.join(' ')).toMatch(/never changes RVM/)
    expect(DEV_GROUPS.map(group => group.id)).toEqual(expect.arrayContaining(['tmux', 'rvm']))
  })
})

type El = { props: Record<string, unknown> }

describe('the page', () => {
  const kit = { Box: (props: Record<string, unknown>): El => ({ props }), Text: (props: Record<string, unknown>): El => ({ props }), Button: (props: Record<string, unknown>): El => ({ props }), Input: (props: Record<string, unknown>): El => ({ props }) }
  const flat = (el: unknown): El[] => {
    const node = el as El

    if (typeof node !== 'object' || node === null) return []

    const kids = node.props.children

    return [node, ...(Array.isArray(kids) ? kids.flatMap(flat) : typeof kids === 'object' ? flat(kids) : [])]
  }
  const draw = (tmux: 'unknown' | 'present' | 'missing' = 'present') => {
    const state = newState({})

    state.view = 'sandbox'
    state.devtools.tmux = tmux

    return flat(sandboxView({ kit, state, nowMs: Date.now(), columns: 110, pictures: new Map(), act: new Proxy({}, { get: () => () => undefined }) as never, cards: true } as unknown as Ctx))
  }
  const words = (nodes: El[]): string => nodes.map(node => String(node.props.children ?? node.props.label ?? node.props.title ?? '')).join('\n')

  it('has the three sections, the tmux fields and the rows with their tags, and says tmux is not a security boundary', () => {
    const nodes = draw()
    const text = words(nodes)

    expect(text).toMatch(/tmux sandboxes/)
    expect(text).toMatch(/RVF sandboxes/)
    expect(text).toMatch(/RVM/)
    expect(text).toMatch(/not a security boundary/)
    expect(text).toMatch(/ROLLBACK to throw them away or PROMOTE to keep them/)
    expect(text).toMatch(/never changes RVM/)
    expect(nodes.filter(node => typeof node.props.key === 'string' && /^dt-(sb|cow|rvm)-/.test(node.props.key as string) === false && String(node.props.key).startsWith('dt-field-tmux-')).map(node => node.props.key)).toEqual(['dt-field-tmux-session', 'dt-field-tmux-send'])
    expect(nodes.some(node => node.props.key === 'dt-sb-send')).toBe(true)
    expect(nodes.some(node => node.props.key === 'dt-cow-branch')).toBe(true)
    expect(text).toMatch(/\$0/)
    expect(text).toMatch(/del/)
  })

  it('says n/a with the reason on the tmux rows when tmux is missing, and no button for them', () => {
    const nodes = draw('missing')

    expect(words(nodes)).toMatch(/tmux is not installed on this machine/)
    expect(nodes.some(node => node.props.key === 'dt-sb-send')).toBe(false)
    expect(nodes.some(node => node.props.key === 'dt-cow-branch')).toBe(true)
    expect(nodes.some(node => node.props.key === 'dt-rvm-status')).toBe(false)
  })
})

describe('the guide', () => {
  it('exists, is the one help opens from the page, and points at pages that exist', () => {
    const topic = topicById('sandbox')!
    const views = new Set<string>(VIEWS.map(view => view.id))

    expect(VIEW_TOPIC.sandbox).toBe('sandbox')
    expect(topic.group).toBe('Network')
    expect(topic.related).toContain('devtools')

    for (const step of topic.steps) if (step.go !== undefined && 'view' in step.go) expect(views.has(step.go.view)).toBe(true)

    const text = topic.steps.map(step => step.text).join(' ')

    expect(text).toMatch(/NEW/)
    expect(text).toMatch(/SEND/)
    expect(text).toMatch(/BRANCH/)
    expect(text).toMatch(/ROLLBACK/)
    expect(text).toMatch(/PROMOTE/)
    expect(text).toMatch(/RVM/)
    expect(topic.tips?.join(' ')).toMatch(/not a security boundary/)
  })

  it('says where Plugins and Sandbox live in the guides that name them', () => {
    expect(topicById('plugins')!.steps.map(step => step.text).join(' ')).toMatch(/TOOLS group of the nav/)
    expect(topicById('keys')!.steps.map(step => step.text).join(' ')).toMatch(/Sandbox has no key/)
    expect(topicById('devtools')!.steps.map(step => step.text).join(' ')).toMatch(/Sandbox page/)
  })
})
