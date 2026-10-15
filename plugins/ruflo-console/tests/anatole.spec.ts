/**
 * Project Anatole in the console (ADR-453 §8, §9): the bounded reader with hostile files, the Security page section, the slash each button
 * sends, and the class each action has for Claude's console tools.
 *   npx vitest run plugins/ruflo-console/tests/anatole.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { ALERTS_TAIL, parseAlertLine, parseAlerts, parseAnatoleRules, parseAnatoleStatus, readAnatole } from '../hooks/data/anatole'
import { readSnapshot } from '../hooks/data/snapshot'
import type { ReaderFs } from '../hooks/data/files'
import { ANATOLE_RULES, anatolePalette, INSTALL_LINE, slashOf, wireAnatole } from '../hooks/anatole'
import { classOf } from '../hooks/model-tools'
import { newState } from '../hooks/state'
import { ruleRows } from '../hooks/views/anatole'
import type { Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const STATUS = { schemaVersion: 1, name: 'protector', modVersion: '0.1.0', mode: 'notify', calls: 40, blocked: 2, updatedAt: '2026-10-05T10:00:00Z', summary: 'ok', alerts: { open: 3, critical: 1, high: 1, medium: 1, low: 0, total: 5 }, baseline: { state: 'learning', maturity: 62, events: 120, sessions: 2 }, rules: { total: 13, block: 4, notify: 8, off: 1 }, degraded: false }
const alert = (extra: Record<string, unknown> = {}) => JSON.stringify({ id: 'a1', at: '2026-10-05T09:00:00Z', rule: 'PR-002', owasp: ['T11', 'LLM06'], severity: 'critical', action: 'blocked', tool: 'Bash', summary: 'curl piped into sh', fp: 'abcdef012345', state: 'open', session: 's', ...extra })
const files = (map: Record<string, string>): ReaderFs => ({
  read: async path => map[path.split('/').at(-1) ?? ''] ?? '',
  stat: async path => {
    const text = map[path.split('/').at(-1) ?? '']

    if (text === undefined) throw new Error('ENOENT')

    return { mtimeMs: 1, size: text.length, kind: 'file' }
  },
  list: async () => [],
})
const act = new Proxy(() => undefined, { get: () => act, apply: () => undefined }) as unknown as Actions

describe('the reader', () => {
  it('reads schema 1 status and clamps what a hostile file claims', () => {
    expect(parseAnatoleStatus(JSON.stringify(STATUS))).toMatchObject({ mode: 'notify', blocked: 2, open: { critical: 1, total: 3 }, baseline: { state: 'learning', maturity: 62 }, degraded: false })
    const evil = parseAnatoleStatus(JSON.stringify({ ...STATUS, mode: 'rm -rf', blocked: -5, summary: 'x\u001b[31m‮ok', baseline: { maturity: 1e9, state: 'weird' }, degraded: 'boom\u0007' }))

    expect(evil).toMatchObject({ mode: null, blocked: 0, baseline: { maturity: 100, state: 'learning' }, degraded: 'boom' })
    expect(evil?.summary).not.toMatch(/[\u0000-\u001f‮]/)
  })

  it('refuses other schema versions and junk', () => {
    for (const text of [JSON.stringify({ ...STATUS, schemaVersion: 2 }), '[]', 'nope', '', null]) expect(parseAnatoleStatus(text)).toBeNull()
  })

  it('keeps only valid rule ids and modes from rules.json', () => {
    expect(parseAnatoleRules(JSON.stringify({ schemaVersion: 1, mode: 'enforce', rules: { 'PR-002': { mode: 'off' }, 'PR-9': { mode: 'off' }, 'PR-003': { mode: 'wild' }, '../x': { mode: 'off' } } }))).toEqual({ mode: 'enforce', overrides: { 'PR-002': { mode: 'off', demoted: false } } })
  })

  it('drops alert lines whose ids could reach a command, and cleans their text', () => {
    expect(parseAlertLine(alert())).toMatchObject({ id: 'a1', rule: 'PR-002', fp: 'abcdef012345', owasp: ['T11', 'LLM06'] })

    for (const bad of [{ id: 'a; rm -rf /' }, { id: '' }, { rule: 'PR-2' }, { severity: 'doom' }, { state: 'x' }]) expect(parseAlertLine(alert(bad))).toBeNull()

    expect(parseAlertLine(alert({ fp: 'abc; id' }))?.fp).toBeNull()
    expect(parseAlertLine(alert({ owasp: ['T11', '$(x)'], summary: 'a\u001b[2Jb‮' }))?.owasp).toEqual(['T11'])
    expect(parseAlertLine(alert({ summary: 'a\u001b[2Jb‮' }))?.summary).toBe('ab')
  })

  it('takes the last 200 lines and counts the bad ones', () => {
    const lines = Array.from({ length: 250 }, (_, i) => alert({ id: `a${i}` }))

    lines[249] = '{not json'

    const { alerts, bad } = parseAlerts(lines.join('\n'))

    expect(alerts).toHaveLength(ALERTS_TAIL - 1)
    expect(bad).toBe(1)
    expect(alerts.at(-1)?.id).toBe('a248')
  })

  it('is absent when no file exists, refuses a link or an oversize file, and never throws', async () => {
    expect((await readAnatole(files({}), new Map(), '/p')).present).toBe(false)

    const big = await readAnatole(files({ 'status.json': JSON.stringify({ ...STATUS, pad: 'x'.repeat(70_000) }) }), new Map(), '/p')

    expect(big).toMatchObject({ present: true, status: null, refused: ['status.json'] })

    const link: ReaderFs = { ...files({ 'status.json': JSON.stringify(STATUS) }), stat: async () => ({ mtimeMs: 1, size: 10, kind: 'file', isLink: true }) }

    expect(await readAnatole(link, new Map(), '/p')).toMatchObject({ status: null, refused: expect.arrayContaining(['status.json']) })
  })
})

describe('the section', () => {
  const draw = async (map: Record<string, string>, columns = 130) => {
    const state = newState({})

    state.snapshot = await readSnapshot(files({}), new Map(), '/w', '/h', {}, 0)
    state.snapshot = { ...state.snapshot, anatole: await readAnatole(files(map), new Map(), '/w') }
    state.view = 'secure'

    return { state, text: viewText({ state, nowMs: Date.parse('2026-10-05T10:05:00Z'), columns, act }, 'secure') }
  }

  it('says how to install it, and nothing else, when the plugin never reported', async () => {
    const { text } = await draw({})

    expect(text).toContain('Project Anatole')
    expect(text).toContain('not installed')
    expect(text).not.toContain('PR-001')
  })

  it('shows status, the 13 rules, mode chips and the open alerts, labelled unauthenticated', async () => {
    const { text } = await draw({ 'status.json': JSON.stringify({ ...STATUS, degraded: 'timeout' }), 'rules.json': JSON.stringify({ schemaVersion: 1, rules: { 'PR-002': { mode: 'off' }, 'PR-004': { mode: 'notify', demoted: true } } }), 'alerts.jsonl': `${alert()}\n${alert({ id: 'a2', state: 'acked' })}\n` })

    for (const id of ANATOLE_RULES.map(rule => rule.id)) expect(text).toContain(id)
    expect(text).toMatch(/mode notify/)
    expect(text).toContain('learning 62%')
    expect(text).toContain('degraded: timeout')
    expect(text).toContain('unauthenticated')
    expect(text).toContain('changed from default')
    expect(text).toContain('auto-demoted')
    expect(text).toContain('2 hits · 50% acked')
    expect(text).toMatch(/Project Anatole open alerts: 1 critical · 1 high · 1 medium · 0 low/)
    expect(text).toContain('curl piped into sh')
  })

  it('is laid out in labelled blocks, each explanation on its own wrapped line (not squeezed beside a button)', async () => {
    const { text } = await draw({ 'status.json': JSON.stringify(STATUS), 'alerts.jsonl': alert({ summary: 'curl piped into sh (Bash)' }) })
    const at = (word: string): number => text.indexOf(word)

    // The blocks come in order, each under its own heading.
    expect(text).toMatch(/Status ─+/)
    expect(text).toMatch(/Rules ─+ 13 · \d+ block · \d+ notify · \d+ off/)
    expect(text).toMatch(/Actions ─+/)
    expect(text).toMatch(/Mode ─+ notify/)
    expect(text).toMatch(/Open alerts ─+ 1/)
    expect(at('Status')).toBeLessThan(at('Rules'))
    expect(at('Rules')).toBeLessThan(at('Actions'))
    expect(at('Actions')).toBeLessThan(at('Mode'))
    expect(at('Mode')).toBeLessThan(at('Open alerts'))
    // The explanations are separate lines, one per thing explained, and the current mode is described.
    expect(text).toContain('▶ run  scans the Claude configuration')
    expect(text).toContain('▶ replay  shows what the recorded events would have fired')
    expect(text).toContain('Raises alerts and never blocks anything.')
    expect(text).toContain('Reset baseline forgets everything learned and starts again. It asks first.')
    expect(text).not.toMatch(/\[ ▶ replay \][^\n]*scan the Claude configuration/)
    // Nothing runs into its neighbour: the severity word, the rule id, and the mode label and its first chip.
    expect(text).toMatch(/(critical|high) +PR-00\d blocked/)
    expect(text).toMatch(/ mode \[ off \]/)
    // An alert is two lines: what happened, then its detail.
    expect(text).toMatch(/PR-002 blocked[^\n]*\n[^\n]*Bash: curl piped into sh/)
  })

  it('describes whichever mode is current, and says plainly when there is nothing to act on', async () => {
    const enforce = await draw({ 'status.json': JSON.stringify({ ...STATUS, mode: 'enforce' }) })

    expect(enforce.text).toContain('Rules set to block deny the tool call')
    expect(enforce.text).toContain('✓ no open alerts')
    expect(enforce.text).toMatch(/Open alerts ─+ none/)
    expect((await draw({ 'status.json': JSON.stringify({ ...STATUS, mode: 'learn' }) })).text).toContain('Learning only (the default)')
  })

  it('computes a rule row from the shipped table, its override and the alert tail', async () => {
    const { state } = await draw({ 'rules.json': JSON.stringify({ schemaVersion: 1, rules: { 'PR-001': { mode: 'notify' } } }), 'alerts.jsonl': alert({ rule: 'PR-001' }) })
    const rows = ruleRows(state.snapshot!.anatole!)

    expect(rows).toHaveLength(13)
    expect(rows[0]).toMatchObject({ mode: 'notify', changed: true, hits: 1, ackedShare: 0 })
    expect(rows[1]).toMatchObject({ mode: 'block', changed: false, hits: 0, ackedShare: null })
  })

  it('keeps the shipped rule table in step with ADR-453 section 5', () => {
    expect(ANATOLE_RULES.map(rule => `${rule.id}:${rule.severity}:${rule.fallback}`)).toEqual(['PR-001:critical:block', 'PR-002:critical:block', 'PR-003:high:block', 'PR-004:high:notify', 'PR-005:high:notify', 'PR-006:critical:block', 'PR-007:medium:notify', 'PR-008:medium:notify', 'PR-009:medium:notify', 'PR-010:high:notify', 'PR-011:medium:notify', 'PR-012:medium:notify', 'PR-013:high:notify'])
  })
})

describe('the actions', () => {
  const sent: string[] = []
  const host = { invalidate: () => undefined, runSlash: async (command: string, args: string) => { sent.push(`${command} ${args}`); return { text: 'one\ntwo' } } }
  const state = newState({})

  wireAnatole(state, host as never)

  const specOf = (id: string, text = '') => {
    const entry = anatolePalette(state).find(candidate => candidate.id === id)

    if (entry?.run.kind === 'spec') return entry.run.spec

    return entry?.run.kind === 'text' ? entry.run.make(text) : null
  }

  it('sends exactly the slash string for each button, through host.runSlash', async () => {
    for (const [id, text, slash] of [['anatole-mode', 'learn', 'mode learn'], ['anatole-rule', 'PR-002 block', 'rule PR-002 block'], ['anatole-ack', 'a1', 'ack a1'], ['anatole-allow', 'abcdef012345', 'allow abcdef012345'], ['anatole-reset', '', 'reset-baseline'], ['anatole-run', '', 'run'], ['anatole-replay', '', 'replay']] as const) {
      const spec = specOf(id, text)

      expect(spec?.shows).toBe(`/protector ${slash}`)
      await spec?.run?.()
      expect(sent.at(-1)).toBe(`protector ${slash}`)
    }

    expect(slashOf.rule('PR-001', 'off')).toBe('rule PR-001 off')
  })

  it('refuses anything that is not a rule id, a mode or a fingerprint', () => {
    expect(specOf('anatole-mode', 'enforce; ls')).toBeNull()
    expect(specOf('anatole-rule', 'PR-002 explode')).toBeNull()
    expect(specOf('anatole-rule', 'PR-002 off extra')).toBeNull()
    expect(specOf('anatole-ack', 'a; b')).toBeNull()
    expect(specOf('anatole-allow', 'XYZ')).toBeNull()
  })

  it('puts run and replay answers in the Result panel, and a failure there too', async () => {
    await specOf('anatole-run')?.run?.()
    expect(state.lab.result).toMatchObject({ id: 'anatole-run', ok: true, lines: ['one', 'two'] })

    const broken = newState({})

    wireAnatole(broken, { invalidate: () => undefined, runSlash: async () => Promise.reject(new Error('no such command')) } as never)

    const entry = anatolePalette(broken).find(candidate => candidate.id === 'anatole-replay')

    await (entry?.run.kind === 'spec' ? entry.run.spec?.run?.() : undefined)
    expect(broken.lab.result).toMatchObject({ id: 'anatole-replay', ok: false })
  })

  it('classes them for Claude: reads at read, edits at write, enforce asks as install, reset is delete', () => {
    const cls = (id: string, text = '') => {
      const spec = specOf(id, text)

      return spec === null ? null : spec.isReadOnly === true ? 'read' : classOf({ label: spec.label, args: spec.args, ...(spec.note !== undefined && { note: spec.note }), ...(spec.shows !== undefined && { shows: spec.shows }), expect: spec.expect, ...(spec.declared !== undefined && { declared: spec.declared }) })
    }

    expect(cls('anatole-run')).toBe('read')
    expect(cls('anatole-replay')).toBe('read')

    for (const [id, text] of [['anatole-mode', 'off'], ['anatole-mode', 'learn'], ['anatole-mode', 'notify'], ['anatole-rule', 'PR-002 off'], ['anatole-rule', 'PR-002 block'], ['anatole-ack', 'a1'], ['anatole-allow', 'abcdef012345']] as const) expect(cls(id, text)).toBe('write')

    expect(cls('anatole-mode', 'enforce')).toBe('install')
    expect(cls('anatole-reset')).toBe('delete')
  })

  it('addresses each open alert by its own id', async () => {
    const own = newState({})

    wireAnatole(own, host as never)
    own.snapshot = { ...(await readSnapshot(files({}), new Map(), '/w', '/h', {}, 0)), anatole: await readAnatole(files({ 'alerts.jsonl': alert() }), new Map(), '/w') }

    expect(anatolePalette(own).map(entry => entry.id)).toEqual(expect.arrayContaining(['anatole-ack-a1', 'anatole-allow-abcdef012345']))
    expect(INSTALL_LINE).toContain('claude plugin install ruflo-protector@ruflo')
  })
})
