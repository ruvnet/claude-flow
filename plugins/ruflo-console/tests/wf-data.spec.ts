/**
 * The drill-down's pure halves (ADR-459): what a transcript says (pairing, caps, washing), the log's filters and window, the
 * navigation reducer and the cross-level search. No screen, no disk. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-data.spec.ts --testTimeout=30000
 */
import { describe, expect, it } from 'vitest'

import { cleanBlock, ENTRY_CAP, FIELD_CAP, journalResult, parseActivity } from '../hooks/data/wf-activity'
import { filterLines, logLines, mergeLines, nextFilter, tailWindow, LOG_ROWS } from '../hooks/data/wf-log'
import { flatHits, MAX_SHOWN, SCAN_CHARS, search } from '../hooks/data/wf-search'
import { crumbs, deeper, jump, move, newDrill, shallower, sync, toLevel, type Drill, type Here } from '../hooks/data/wf-trail'
import { buildRun, type WfAgent } from '../hooks/data/workflows'
import { back, line, sample, SECRET, use } from './fixtures/wf-drill'
import { journal, meta, result, started, T0 } from './fixtures/workflows'

describe('cleanBlock', () => {
  it('strips escapes and controls but keeps newlines, and masks credentials', () => {
    const out = cleanBlock(`a\u001b[31mred\u001b[0m\tb\nline2 ${SECRET} \u0007bell`)

    expect(out.text).toBe('ared  b\nline2 ‹masked›  bell')
    expect(out.text).not.toContain('\u001b')
    expect(out.text).not.toContain(SECRET)
  })

  it('cuts at the cap and says how long the original was', () => {
    // Words, not one long run: a 32-character alphanumeric run is masked as a key, by design.
    const words = (n: number): string => 'ab '.repeat(n / 3)

    expect(cleanBlock(words(FIELD_CAP))).toMatchObject({ isCut: false, total: FIELD_CAP })
    expect(cleanBlock(words(FIELD_CAP + 3))).toMatchObject({ isCut: true, total: FIELD_CAP + 3 })
    expect(cleanBlock(words(FIELD_CAP + 3)).text).toHaveLength(FIELD_CAP)
  })

  it('masks a token that straddles the cut instead of leaving its head visible', () => {
    const head = 'y'.repeat(20)
    const out = cleanBlock(`${head}${SECRET}`, 30)

    expect(out.text).not.toMatch(/sk-/)
  })
})

describe('parseActivity', () => {
  const parsed = parseActivity(sample())

  it('pairs a result with its call by id, counts a streamed call once, and marks an error', () => {
    expect(parsed.calls.map(call => [call.tool, call.status])).toEqual([['Bash', 'ok'], ['Edit', 'error'], ['Read', 'pending'], ['Write', 'pending']])
    expect(parsed.calls[0]?.output?.text).toContain('total 3')
    expect(parsed.calls[1]?.output?.text).toBe('boom\n[image]')
    expect(parsed.calls[2]?.output).toBeNull()
  })

  it('keeps the span of a call from its two timestamps', () => {
    expect(parsed.calls[0]?.atMs).toBe(T0 + 2000)
    expect(parsed.calls[0]?.endMs).toBe(T0 + 4000)
  })

  it('washes every free-text field: no escape and no credential in a message, an input or an output', () => {
    const all = JSON.stringify(parsed.entries)

    expect(all).not.toContain(SECRET)
    expect(all).not.toContain('abcdefghijklmnop')
    expect(all).not.toContain('\\u001b')
    expect(parsed.entries[0]).toMatchObject({ kind: 'message', role: 'user' })
  })

  it('skips meta lines and keeps thinking and the closing text as messages', () => {
    expect(parsed.entries.filter(entry => entry.kind === 'message').map(entry => (entry as { role: string }).role)).toEqual(['user', 'thinking', 'assistant'])
    expect(parsed.skipped).toBe(1)
  })

  it('collects the files tool inputs name, with what was done to each', () => {
    expect(parsed.files.map(file => [file.path, file.read, file.edit, file.write])).toEqual([['/wt/a.ts', 0, 1, 0], ['/wt/c.ts', 0, 0, 1], ['/wt/b.ts', 1, 0, 0]])
  })

  it('names a result whose call is before a tail, and drops the first line of a tail', () => {
    const tail = `{"type":"assistant","timesta\n${line('user', 3, [back('gone', 'late result')])}\n`
    const out = parseActivity(tail, true)

    expect(out.isTail).toBe(true)
    expect(out.entries).toHaveLength(1)
    expect(out.entries[0]).toMatchObject({ kind: 'message', role: 'result' })
  })

  it('keeps only the newest ENTRY_CAP entries and re-indexes them', () => {
    const many = Array.from({ length: ENTRY_CAP + 5 }, (_, i) => line('assistant', i, [{ type: 'text', text: `m${i}` }])).join('\n')
    const out = parseActivity(many)

    expect(out.entries).toHaveLength(ENTRY_CAP)
    expect(out.dropped).toBe(5)
    expect(out.entries[0]).toMatchObject({ index: 0, body: { text: 'm5' } })
  })

  it('drops a half-written last line and reads null as nothing', () => {
    expect(parseActivity(`${line('user', 0, 'hi')}\n{"type":"assis`).entries).toHaveLength(1)
    expect(parseActivity(null).entries).toEqual([])
  })
})

describe('journalResult', () => {
  it('returns the agent\'s own result, washed, as text or pretty JSON, and null where there is none', () => {
    const text = journal(started('a1', 'x', 'P'), result('a1', { verdict: 'ok', key: SECRET }), result('a2', 'other'))
    const found = journalResult(text, 'a1')

    expect(found?.text).toContain('"verdict": "ok"')
    expect(found?.text).not.toContain(SECRET)
    expect(journalResult(text, 'a2')?.text).toBe('other')
    expect(journalResult(text, 'a9')).toBeNull()
    expect(journalResult(null, 'a1')).toBeNull()
  })
})

const agent = { id: 'a1', label: 'build:x' }

describe('the log', () => {
  const lines = logLines(parseActivity(sample()), agent)

  it('is one line per entry with a level, and an unanswered or failed call says so', () => {
    expect(lines.map(l => l.level)).toEqual(['user', 'thinking', 'tool', 'error', 'tool', 'tool', 'assistant'])
    expect(lines[3]?.text).toBe('Edit /wt/a.ts (failed)')
    expect(lines[4]?.text).toContain('no result in the part read')
  })

  it('filters by level: messages, tool calls (errors included), errors only', () => {
    expect(filterLines(lines, 'all')).toHaveLength(7)
    expect(filterLines(lines, 'text').map(l => l.level)).toEqual(['user', 'thinking', 'assistant'])
    expect(filterLines(lines, 'tool').map(l => l.level)).toEqual(['tool', 'error', 'tool', 'tool'])
    expect(filterLines(lines, 'error').map(l => l.level)).toEqual(['error'])
    expect(['all', 'text', 'tool', 'error'].map(f => nextFilter(f as 'all'))).toEqual(['text', 'tool', 'error', 'all'])
  })

  it('merges agents by time, keeping an untimed line after its own agent\'s', () => {
    const a = [{ entry: 0, agentId: 'a', agent: 'a', atMs: 5, level: 'user' as const, text: 'a5' }, { entry: 1, agentId: 'a', agent: 'a', level: 'user' as const, text: 'a-untimed' }]
    const b = [{ entry: 0, agentId: 'b', agent: 'b', atMs: 3, level: 'user' as const, text: 'b3' }, { entry: 1, agentId: 'b', agent: 'b', atMs: 9, level: 'user' as const, text: 'b9' }]

    expect(mergeLines([a, b]).map(l => l.text)).toEqual(['b3', 'a5', 'b9', 'a-untimed'])
  })

  it('windows the lines: follow pins the end, otherwise the selection stays on screen', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ entry: i, agentId: 'a', agent: 'a', level: 'tool' as const, text: `l${i}` }))
    const following = tailWindow(many, { sel: 0, follow: true })

    expect(following.rows).toHaveLength(LOG_ROWS)
    expect(following.rows.at(-1)?.text).toBe('l39')
    expect(following.at).toBe(LOG_ROWS - 1)
    expect(following.below).toBe(0)

    const held = tailWindow(many, { sel: 3, follow: false })

    expect(held.from).toBe(0)
    expect(held.rows[held.at]?.text).toBe('l3')
    expect(tailWindow(many, { sel: 99, follow: false }).rows.at(-1)?.text).toBe('l39')
    expect(tailWindow([], { sel: 0, follow: true })).toMatchObject({ total: 0, at: -1 })
  })
})

const here = (over: Partial<Here> = {}): Here => ({ column: 'phases', phaseAgents: 2, hasAgent: true, isRuflo: false, calls: 4, lines: 7, ...over })
const open = (over: Partial<Drill> = {}): Drill => ({ ...newDrill(), open: true, ...over })

describe('the trail', () => {
  it('opens where the page cursor is, then goes deeper level by level, telling the page which column key it needs', () => {
    const first = deeper(newDrill(), here({ column: 'phases' }))

    expect(first.drill).toMatchObject({ open: true, level: 'phases' })
    expect(deeper(newDrill(), here({ column: 'agents' })).drill.level).toBe('agents')

    const toAgents = deeper(first.drill, here())

    expect(toAgents).toMatchObject({ drill: { level: 'agents' }, ui: 'l' })
    expect(deeper(toAgents.drill, here()).drill).toMatchObject({ level: 'agent', sub: 'activity' })
  })

  it('says why it cannot go deeper instead of doing nothing: an empty phase, a ruflo agent, a tab with no depth, the deepest level', () => {
    expect(deeper(open({ level: 'phases' }), here({ phaseAgents: 0 })).said).toMatch(/No agent has started/)
    expect(deeper(open({ level: 'agents' }), here({ isRuflo: true })).said).toMatch(/ruflo agent keeps no transcript/)
    expect(deeper(open({ level: 'agents' }), here({ hasAgent: false })).said).toMatch(/no agent to open/)
    expect(deeper(open({ level: 'agent', sub: 'files' }), here()).said).toMatch(/no deeper level/)
    expect(deeper(open({ level: 'agent', sub: 'activity' }), here({ calls: 0 })).said).toMatch(/No call or message/)
    expect(deeper(open({ level: 'item' }), here()).said).toMatch(/deepest/)
  })

  it('goes back one level at a time and closes from Runs', () => {
    expect(shallower(open({ level: 'item' })).drill.level).toBe('agent')
    expect(shallower(open({ level: 'agent' }))).toMatchObject({ drill: { level: 'agents' }, ui: 'l' })
    expect(shallower(open({ level: 'agents' }))).toMatchObject({ drill: { level: 'phases' }, ui: 'h' })
    expect(shallower(open({ level: 'phases' })).drill.level).toBe('runs')
    expect(shallower(open({ level: 'runs' })).drill.open).toBe(false)
  })

  it('goes straight back to a named level, never forward', () => {
    expect(toLevel(open({ level: 'item' }), 'phases').drill.level).toBe('phases')
    expect(toLevel(open({ level: 'phases' }), 'item').drill.level).toBe('phases')
  })

  it('moves a call or a line within bounds, and selecting a line stops following', () => {
    expect(move(open({ level: 'agent', sub: 'activity', callSel: 3 }), 1, here()).drill.callSel).toBe(3)
    expect(move(open({ level: 'agent', sub: 'activity', callSel: 0 }), -1, here()).drill.callSel).toBe(0)
    expect(move(open({ level: 'agent', sub: 'activity', callSel: 1 }), 1, here()).drill.callSel).toBe(2)

    const fromEnd = move(open({ level: 'agent', sub: 'log', follow: true }), -1, here())

    expect(fromEnd.drill).toMatchObject({ follow: false, logSel: 5 })
    expect(move(open({ level: 'runs' }), 1, here()).ui).toBe(']')
    expect(move(open({ level: 'agents' }), -1, here()).ui).toBe('k')
  })

  it('starts the selections over when the cursor lands on another agent, keeping the filter', () => {
    const held = open({ at: 'r/a1', callSel: 4, logSel: 6, follow: false, filter: 'error' })

    expect(sync(held, 'r/a1')).toBe(held)
    expect(sync(held, 'r/a2')).toMatchObject({ at: 'r/a2', callSel: 0, logSel: 0, follow: true, filter: 'error' })
  })

  it('draws a breadcrumb down to where it is', () => {
    expect(crumbs(open({ level: 'agent', sub: 'log' })).map(c => c.label)).toEqual(['Runs', 'Phases', 'Agents', 'Agent · Log'])
    expect(crumbs(open({ level: 'agent' })).at(-1)?.isHere).toBe(true)
  })

  it('jumps to a hit: the cursor, the sub-tab, the call or the line, with the filter back to all', () => {
    const toLine = jump(open({ filter: 'error', scope: 'phase' }), { run: 1, phase: 2, agent: 3, line: 5 }, '')

    expect(toLine.ui).toEqual({ run: 1, phase: 2, agent: 3, column: 'agents', isInspecting: false })
    expect(toLine.drill).toMatchObject({ level: 'agent', sub: 'log', logSel: 5, filter: 'all', scope: 'agent', follow: false })
    expect(jump(open(), { run: 0, phase: 1, agent: -1 }, '').drill.level).toBe('phases')
    expect(jump(open(), { run: 0, phase: 1, agent: 2, sub: 'activity', call: 3 }, '').drill).toMatchObject({ level: 'agent', sub: 'activity', callSel: 3 })
  })
})

const T = T0 + 60_000

function runsOf(): { runs: ReturnType<typeof buildRun>[]; byAgent: Map<WfAgent, ReturnType<typeof parseActivity>> } {
  const run = buildRun({
    id: 'wf_s',
    journal: journal(started('a1', 'build:parser', 'Build'), started('a2', 'review:parser', 'Review'), result('a2', 'looks fine')),
    agents: new Map([
      ['a1', { meta: meta('build:parser', 'Build'), transcript: null, isTail: false, path: '/c/projects/p/s/subagents/workflows/wf_s/agent-a1.jsonl' }],
      ['a2', { meta: meta('review:parser', 'Review'), transcript: null, isTail: false, path: '/c/projects/p/s/subagents/workflows/wf_s/agent-a2.jsonl' }],
    ]),
    record: null,
    script: null,
    nowMs: T,
  })
  const [a1, a2] = run.phases.flatMap(phase => phase.agents)

  return { runs: [run], byAgent: new Map([[a1 as WfAgent, parseActivity(sample())], [a2 as WfAgent, parseActivity(`${line('user', 0, 'review the parser')}\n${line('assistant', 1, [use('r1', 'Grep', { pattern: 'parser' })])}\n`)]]) }
}

describe('search', () => {
  const { runs, byAgent } = runsOf()
  const input = { runs, parsed: (a: WfAgent) => byAgent.get(a) ?? null, tasks: [{ mission: 'ship the parser', id: 'T-1', title: 'Write the parser tests', status: 'running' }] }

  it('does nothing under two characters', () => {
    expect(search(input, 'p')).toMatchObject({ isSearched: false })
    expect(search(input, ' ')).toMatchObject({ isSearched: false })
  })

  it('groups hits by level and gives each the exact place it jumps to', () => {
    const out = search(input, 'parser')

    expect(out.counts.agent).toBe(2)
    expect(out.groups.agent[0]).toMatchObject({ title: 'build:parser', target: { run: 0, phase: 0, agent: 0 } })
    expect(out.groups.tool[0]).toMatchObject({ title: 'Grep parser', target: { run: 0, phase: 1, agent: 0, sub: 'activity', call: 0 } })
    expect(out.groups.text[0]).toMatchObject({ target: { run: 0, phase: 1, agent: 0, sub: 'log', line: 0 } })
    expect(out.groups.mission[0]).toMatchObject({ title: 'Write the parser tests' })
    expect(out.groups.mission[0]?.target).toBeUndefined()
  })

  it('finds a run by name, a phase by title, a call by its input, and text in an output', () => {
    expect(search(input, 'wf_s').groups.run).toHaveLength(1)
    expect(search(input, 'review').groups.phase[0]).toMatchObject({ title: 'Review', target: { phase: 1, agent: -1 } })
    expect(search(input, 'ls -la').groups.tool[0]).toMatchObject({ target: { sub: 'activity', call: 0 } })
    expect(search(input, 'total 3').groups.text[0]).toMatchObject({ target: { sub: 'log', line: 2 } })
  })

  it('never finds what the washing masked, and matches without regard to case', () => {
    expect(flatHits(search(input, SECRET))).toEqual([])
    expect(search(input, 'BASH').groups.tool).toHaveLength(1)
  })

  it('counts an agent whose transcript is not in memory as unread instead of guessing', () => {
    const out = search({ ...input, parsed: () => null }, 'parser')

    expect(out.unread).toBe(2)
    expect(out.scanned).toBe(0)
    expect(out.groups.tool).toEqual([])
    expect(out.groups.agent).toHaveLength(2)
  })

  it('shows at most MAX_SHOWN a group but counts them all, and stops at the scan cap', () => {
    const many = { ...input, parsed: () => parseActivity(Array.from({ length: 20 }, (_, i) => line('assistant', i, [{ type: 'text', text: `needle ${i}` }])).join('\n')) }
    const out = search(many, 'needle')

    expect(out.counts.text).toBe(40)
    expect(out.groups.text).toHaveLength(MAX_SHOWN)
    expect(out.isCapped).toBe(false)
    expect(SCAN_CHARS).toBeGreaterThan(1_000_000)
  })

  it('stops scanning at the character cap and says so', () => {
    const huge = parseActivity(Array.from({ length: 2000 }, (_, i) => line('assistant', i, [{ type: 'text', text: 'ab '.repeat(2000) }])).join('\n'))
    const out = search({ ...input, parsed: a => (a === [...byAgent.keys()][0] ? huge : null) }, 'zzz')

    expect(out.isCapped).toBe(true)
    expect(out.chars).toBeGreaterThan(SCAN_CHARS)
    expect(out.chars).toBeLessThanOrEqual(SCAN_CHARS + 6000)
  })
})
