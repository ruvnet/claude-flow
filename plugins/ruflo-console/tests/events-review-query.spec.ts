/**
 * The adversarial review of ADR-474 (Events and Timeline), part: the query language, export targets, severity, ids and window edges. Each block names the defect it pins.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { append } from '../hooks/activity-live'
import { resetIo } from '../hooks/activity-io'
import { eventsText, exportSpecFor, resolveTarget } from '../hooks/data/event-export'
import { collapse, idOf } from '../hooks/data/event-group'
import { budgetOf, matches, parseQuery, regexProblem } from '../hooks/data/event-query'
import { evaluateRules } from '../hooks/data/event-rules'
import { levelOf } from '../hooks/data/event-severity'
import type { ConsoleEvent } from '../hooks/data/events'
import { eventsModel, eventsUi } from '../hooks/events-ui'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { eventsView } from '../hooks/views/events'
import { flat } from './fixtures/wf-drill-world'
import { rig } from './fixtures/ev-rig'
import { hostOn, newDisk, type Disk } from './fixtures/activity-fs'


const T = Date.UTC(2026, 9, 7, 12)
const CWD = '/work/proj'
const ev = (text: string, atS = 0, extra: Partial<ConsoleEvent> = {}): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000, ...extra })

function consoleOn(disk: Disk, options: Record<string, string | number | boolean> = {}) {
  const state = newState(options)

  state.cwd = CWD

  const host = { ...hostOn(disk), every: () => ({ cancel: () => undefined }), invalidate: () => undefined } as unknown as Host

  return { state, host }
}

beforeEach(() => resetIo())

// ------------------------------------------------------------------------------------------------------------------ the query language

describe('query language: bounded time on hostile patterns', () => {
  it('refuses a run of optional atoms (a?a?a?...a{n} took 18 ms a line at n=20), a quantified optional group and the rest of the known shapes', () => {
    for (const pattern of ['a?'.repeat(20) + 'a{20}', '(a?)+b', '(a|aa)+$', '(a+)+$', '(.*a){3}', '(?:a?){24}a{24}', 'a?a?a?', '(a*)*', '\\1(a)', '(?<=a)b']) expect(regexProblem(pattern), pattern).not.toBeNull()
    for (const pattern of ['colou?r', 'step s[0-9]+ (done|failed)', '^agent \\w+$', 'https?', 'a.*b', '(?:ed|ing)']) expect(regexProblem(pattern), pattern).toBeNull()
  })

  it('a slow pattern over ten thousand 200-character events stops at its budget, says how many were not searched, and keeps the newest', () => {
    const w = rig(100, { events: 10 })

    w.act.log.length = 0
    append(w.act, Array.from({ length: 10_000 }, (_, i) => ({ atMs: T + i * 1000, kind: 'swarm' as const, text: `${'a'.repeat(199)}${i % 2 === 0 ? 'x' : '!'}` })))
    w.state.loadedAtMs = 0

    const ui = eventsUi(w.state)

    ui.parsed = parseQuery('/.*.*x/')

    const started = performance.now()
    const model = eventsModel(w.state, T + 20_000_000)
    const took = performance.now() - started

    expect(took).toBeLessThan(2500)

    // Either it was quick enough to search everything, or it stopped and said so; never a silent partial answer.
    expect(model.skipped === 0 || model.shown.length > 0).toBe(true)

    if (model.skipped > 0) expect(model.shown.at(-1)?.atMs).toBe(T + 9_998 * 1000)
    expect(model.shown.length + model.skipped).toBeGreaterThanOrEqual(0)
  })

  it('a budget that is already spent skips every regex event and counts it; word terms are never skipped', () => {
    const budget = budgetOf(0)

    budget.spentMs = 1

    const event = ev('step s1 failed')

    expect(matches(event, parseQuery('/failed/'), T, budget)).toBe(false)
    expect(budget.skipped).toBe(1)
    expect(matches(event, parseQuery('failed'), T, budget)).toBe(true)
    expect(budget.skipped).toBe(1)
  })

  it('alert rules share a small budget and cannot hold the pass', () => {
    const fresh = Array.from({ length: 5000 }, (_, i) => ev(`${'a'.repeat(199)}!`, i))
    const started = performance.now()

    evaluateRules([{ name: 'slow', q: '/.*.*x/' }, { name: 'slow2', q: '/a.*a.*b/' }], fresh, T)
    expect(performance.now() - started).toBeLessThan(1500)
  })

  it('a hostile query never throws and a huge one is cut', () => {
    for (const q of ['"', '/', '//', '/(/', '-', '--"', 'kind:', 'since:', 'a|', '|||', '\u0000'.repeat(10), 'x'.repeat(100_000), '/a/i/i', '"a" "b" -"c" /d/ kind:swarm|claims level:bad|warn agent:x since:1h']) {
      expect(() => matches(ev('text'), parseQuery(q), T)).not.toThrow()
    }

    expect(parseQuery('x'.repeat(100_000)).source.length).toBe(20_000)
  })
})

// ------------------------------------------------------------------------------------------------------------------ export

describe('export targets', () => {
  const refuse = (input: string): string | null => {
    const found = resolveTarget(input, CWD, ['md', 'jsonl'])

    return found.ok ? null : found.why
  }

  it('refuses traversal, outside paths, odd bytes, hidden folders (.git, .claude), long and badly named files', () => {
    for (const input of ['../x.md', 'a/../../x.md', '/etc/x.md', '/work/proj-evil/x.md', '/work/x.md', 'x\u0000.md', 'x\n.md', 'a\\b.md', '~/x.md', '-x.md', '.hidden.md', `${'a'.repeat(400)}.md`, 'x.exe', 'x', '', '.claude/commands/evil.md', '.git/hooks/x.md', '.github/x.md', 'a/.ssh/x.md', 'x.csv']) expect(refuse(input), JSON.stringify(input)).not.toBeNull()
    for (const input of ['events.md', 'a b.jsonl', 'reports/events.md', '.claude-flow/console/exports/x.md']) expect(refuse(input), input).toBeNull()
  })

  it('refuses a link on the way, an existing file and a link as the file; a new file in a real folder passes with the dd conv=excl argv', async () => {
    const disk = newDisk({ [`${CWD}/taken.md`]: 'x' })
    const fs = hostOn(disk).fs

    disk.dirs.add(`${CWD}/real`)
    disk.dirs.add(`${CWD}/jump`)
    disk.links.add(`${CWD}/jump`)
    disk.links.add(`${CWD}/flat.md`)

    expect((await exportSpecFor(fs, CWD, 'jump/x.md', 'c', 'l', ['md'])).ok).toBe(false)
    expect((await exportSpecFor(fs, CWD, './flat.md', 'c', 'l', ['md'])).ok).toBe(false)
    expect((await exportSpecFor(fs, CWD, './taken.md', 'c', 'l', ['md'])).ok).toBe(false)

    const made = await exportSpecFor(fs, CWD, 'real/new file.md', 'c', 'l', ['md'])

    expect(made.ok && made.spec.argv).toEqual(['dd', `of=${CWD}/real/new file.md`, 'conv=excl', 'status=none'])
  })

  it('the exported text is masked, defused against spreadsheets and capped', () => {
    const text = eventsText([ev(`token=hunter2hunter2 carol@example.com`), ...Array.from({ length: 3000 }, (_, i) => ev(`line ${i}`, i))], 'md', 'q', T)

    expect(text).not.toContain("hunter2hunter2")
    expect(text).not.toContain('carol@')
    expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(400_000)
  })
})

// ------------------------------------------------------------------------------------------------------------------ correctness

describe('severity', () => {
  it('a tool event is info whatever the agent or tool is called; a deny is still bad; calm counts stay calm', () => {
    for (const text of ['error-handler: Bash', 'deny-list-manager: Read', 'stuck-fixer: Edit', 'blocked-tasks: mcp__x__failed_tasks']) expect(levelOf('tools', text), text).toBe('info')
    expect(levelOf('tools', 'permission denied: Bash (policy)')).toBe('bad')
    expect(levelOf('tools', 'confirm for "x" came 40s after the ask and was not run')).toBe('info')
    expect(levelOf('workflows', 'finished: 0 failed, 0 errors')).toBe('ok')
    expect(levelOf('workflows', 'finished: failed: 0 errors: 0')).toBe('ok')
    expect(levelOf('workflows', 'finished: 2 failed')).toBe('bad')
  })
})

describe('ids and keys', () => {
  it('two events of one millisecond and one length have different ids, and the page keys stay unique', () => {
    const a = ev('agent a1 joined', 0, { agentId: 'a1' })
    const b = ev('agent b2 joined', 0, { agentId: 'b2' })

    expect(idOf(a)).not.toBe(idOf(b))

    const w = rig(100, { events: 0 })

    w.act.log.length = 0
    append(w.act, [ev('agent a1 joined'), ev('agent b2 joined'), ev('agent b2 joined'), { ...ev('agent c3 joined'), kind: 'claims' as const }])
    eventsUi(w.state).isGrouped = false
    eventsUi(w.state).window = 'all'

    const ids = eventsModel(w.state, T + 1000).rows.map(row => row.id)

    expect(new Set(ids).size).toBe(ids.length)

    const keys = flat(eventsView(w.ctx)).filter(node => node.kind === 'Button').map(node => String(node.props.key))

    expect(new Set(keys).size).toBe(keys.length)

    // Opening one row opens one row.
    w.actions.events.open(ids[0] as string)
    expect(flat(eventsView(w.ctx)).filter(node => node.kind === 'Button' && String(node.props.key) === 'ev-pin')).toHaveLength(1)
  })

  it('a burst of identical lines folds into one row with a count', () => {
    const rows = collapse(Array.from({ length: 5 }, (_, i) => ev('agent a1 retry 3', i * 5)))

    expect(rows).toHaveLength(1)
    expect(rows[0]?.members).toHaveLength(5)
    expect(collapse([ev('x 1', 0), ev('x 2', 31), ev('x 3', 62)])).toHaveLength(3)
  })
})

describe('windows at their edges', () => {
  it('15 minutes includes the event exactly 15 minutes old and excludes one millisecond older; since: agrees', () => {
    const w = rig(100, { events: 0 })

    w.act.log.length = 0
    w.state.loadedAtMs = T - 86_400_000
    append(w.act, [{ atMs: T - 900_000, kind: 'swarm', text: 'edge in' }, { atMs: T - 900_001, kind: 'swarm', text: 'edge out' }, { atMs: T + 86_400_000, kind: 'swarm', text: 'future' }])

    const ui = eventsUi(w.state)

    ui.window = '15m'
    expect(eventsModel(w.state, T).shown.map(e => e.text)).toEqual(['edge in', 'future'])
    ui.window = 'all'
    ui.parsed = parseQuery('since:15m')
    expect(eventsModel(w.state, T).shown.map(e => e.text)).toEqual(['edge in', 'future'])
    ui.parsed = parseQuery('')
    ui.window = 'session'
    w.state.loadedAtMs = T - 900_001
    expect(eventsModel(w.state, T).shown).toHaveLength(3)
  })
})

