/**
 * The workflows view's data, keys and drawing under vitest (ADR-458): journals, metas and transcripts with real shapes and
 * invented content, the reader against an in-memory disk, and the page through a recording kit.
 *   npx vitest run plugins/ruflo-console/tests/workflows.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { newState } from '../hooks/state'
import type { ReadCache } from '../hooks/data/files'
import { allRuns, newWfUi, pick, startOn, walk } from '../hooks/data/workflows-nav'
import { readWorkflowRuns, slugOf, TRANSCRIPT_CAP, type WorkflowFs } from '../hooks/data/workflows-read'
import { buildRun, currentPhase, fmtElapsed, fmtTokens, jsonLines, modelName, parseAgentMeta, parseJournal, parseRunRecord, parseScriptMeta, parseTranscript, STALE_MS, type RunInput } from '../hooks/data/workflows'
import { swarmRun } from '../hooks/data/wf-swarm'
import type { Ctx, Kit } from '../hooks/views/common'
import { workflowsView } from '../hooks/views/workflows'
import { journal, meta, record, result, SCRIPT, started, T0, transcript } from './fixtures/workflows'

const NOW = T0 + 100_000

type El = { kind: string; props: Record<string, unknown> }
const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) } as unknown as Kit

function walkEls(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) node.forEach(child => walkEls(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    walkEls((node as El).props?.children, out)
  }

  return out
}

const lines = (tree: unknown): string[] => {
  const rows: string[] = []
  const visit = (node: unknown): void => {
    const el = node as El

    if (el.kind === 'Box' && el.props.flexDirection === 'row') rows.push(walkEls(el.props.children).filter(n => n.kind === 'Text' && typeof n.props.children === 'string').map(n => n.props.children as string).join(''))
    else if (el.kind === 'Box') (Array.isArray(el.props.children) ? el.props.children : [el.props.children]).forEach(visit)
    else if (el.kind === 'Text' && typeof el.props.children === 'string') rows.push(el.props.children)
  }

  visit(tree)

  return rows
}

const ctxOf = (columns: number): Ctx => ({ kit, state: newState({}), nowMs: NOW, columns, pictures: new Map(), act: {} as never })

function liveInput(over: Partial<RunInput> = {}): RunInput {
  return {
    id: 'wf_live',
    journal: journal(started('a1', 'build:memmap', 'Build'), started('a2', 'build:recall', 'Build'), result('a2', 'finished the recall view'), started('a3', 'tune:memmap', 'Tune')),
    agents: new Map([
      ['a1', { meta: meta('build:memmap', 'Build', { spawnedWithWorktree: true, worktreePath: '/w/a1' }), transcript: transcript([{ at: 5, id: 'm1', input: 2, write: 100_000, read: 20_000, output: 100, tool: 'Bash' }, { at: 40, id: 'm2', input: 2, write: 500, read: 125_000, output: 50 }]), isTail: false, path: '/d/agent-a1.jsonl' }],
      ['a2', { meta: meta('build:recall', 'Build'), transcript: transcript([{ at: 3, id: 'n1', input: 1, write: 10, read: 10, output: 5 }, { at: 30, id: 'n2', input: 1, write: 10, read: 20, output: 9 }]), isTail: false, path: '/d/agent-a2.jsonl' }],
    ]),
    record: null,
    script: SCRIPT,
    nowMs: NOW,
    ...over,
  }
}

describe('parsers', () => {
  it('journal: keeps launch order, merges results, ignores unknown events and a half-written line', () => {
    const text = journal(started('a1', 'x', 'Build'), JSON.stringify({ type: 'progress', agentId: 'a1' }), result('a1', { branch: 'b' }), '{"type":"started","agentId":"a9","lab')
    const parsed = parseJournal(text)

    expect(parsed.isLaunched).toBe(true)
    expect(parsed.agents).toEqual([{ agentId: 'a1', label: 'x', phase: 'Build', hasResult: true, resultPreview: 'structured result (1 fields)' }])
    expect(parseJournal(null)).toEqual({ isLaunched: false, agents: [] })
  })

  it('meta: worktree flag and phase; garbage is an empty fact', () => {
    expect(parseAgentMeta(meta('d', 'Build', { spawnedWithWorktree: true, worktreePath: '/w' }))).toMatchObject({ hasWorktree: true, worktreePath: '/w', phase: 'Build', description: 'd' })
    expect(parseAgentMeta('not json')).toEqual({ hasWorktree: false })
    expect(parseAgentMeta(null)).toEqual({ hasWorktree: false })
  })

  it('transcript: counts a streamed message once, takes the latest request, first and last time, model, tools', () => {
    const facts = parseTranscript(transcript([{ at: 5, id: 'm1', input: 2, write: 100, read: 10, output: 8, tool: 'Bash' }, { at: 40, id: 'm2', input: 3, write: 5, read: 200, output: 7, model: 'claude-opus-5-5' }]))

    expect(facts).toMatchObject({ tokens: 3 + 5 + 200 + 7, model: 'claude-opus-5-5', firstMs: T0, lastMs: T0 + 40_000, toolCalls: 2, lastTool: 'Bash', messages: 2 })
  })

  it('transcript tail: the cut first line is dropped, nothing throws', () => {
    const full = transcript([{ at: 5, id: 'm1', input: 1, write: 1, read: 1, output: 1 }, { at: 9, id: 'm2', input: 2, write: 2, read: 2, output: 2 }])
    const cut = full.slice(40)

    expect(parseTranscript(cut, true).tokens).toBe(8)
    expect(parseTranscript('', false)).toEqual({ toolCalls: 0, messages: 0 })
    expect(jsonLines('{"a":1}\n{"b"')).toEqual([{ a: 1 }])
  })

  it('run record and script: phases, per-agent figures; the script is read as text, only its meta block', () => {
    const rec = parseRunRecord(record())

    expect(rec?.agents.map(a => [a.agentId, a.state, a.tokens])).toEqual([['ra1', 'done', 181_212], ['ra2', 'failed', 1200], ['ra3', 'done', 90_000]])
    expect(rec?.phases[0]).toEqual({ title: 'Build', detail: 'one writer per feature' })
    expect(parseRunRecord('{broken')).toBeNull()
    expect(parseScriptMeta(SCRIPT)).toEqual({ name: 'demo-run', phases: [{ title: 'Build', detail: 'one writer per feature' }, { title: 'Tune' }, { title: 'Review', detail: 'adversarial' }] })
    expect(parseScriptMeta(null)).toEqual({ phases: [] })
  })

  it('formats', () => {
    expect(fmtTokens(145_400)).toBe('145.4k')
    expect(fmtTokens(1_250_000)).toBe('1.3M')
    expect(fmtTokens(812)).toBe('812')
    expect(fmtTokens(undefined)).toBe('n/a')
    expect(fmtTokens(5000, true)).toBe('≥5.0k')
    expect(fmtElapsed(15_000)).toBe('15s')
    expect(fmtElapsed(192_000)).toBe('3m12s')
    expect(fmtElapsed(3_900_000)).toBe('1h05m')
    // A day or more reads in days, as ago() does (a 68-day-old agent once read "1638h18m").
    expect(fmtElapsed(68 * 86_400_000 + 6 * 3_600_000 + 18 * 60_000)).toBe('68d06h')
    expect(modelName('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(modelName('claude-opus-5')).toBe('Opus 5')
    expect(modelName('gpt-x')).toBe('gpt-x')
  })
})

describe('buildRun', () => {
  it('a live run: states from journal, tokens/time from transcripts, phases from the script, worktree badge from meta', () => {
    const run = buildRun(liveInput())
    const byLabel = Object.fromEntries(run.phases.flatMap(p => p.agents).map(a => [a.label, a]))

    expect(run.phases.map(p => [p.title, p.done, p.total])).toEqual([['Build', 1, 2], ['Tune', 0, 1], ['Review', 0, 0]])
    expect(byLabel['build:memmap']).toMatchObject({ state: 'running', hasWorktree: true, worktreePath: '/w/a1', model: 'claude-sonnet-5-5', tokens: 2 + 500 + 125_000 + 50, elapsedMs: 100_000 })
    expect(byLabel['build:recall']).toMatchObject({ state: 'done', elapsedMs: 30_000, resultPreview: 'finished the recall view' })
    expect(byLabel['tune:memmap']).toMatchObject({ state: 'running' })
    expect(byLabel['tune:memmap']?.tokens).toBeUndefined()
    expect(run).toMatchObject({ state: 'running', running: 2, done: 1, failed: 0, total: 3, hasRecord: false, isTokensPartial: true })
    expect(run.totalTokens).toBe(125_552 + 40)
    expect(currentPhase(run.phases)).toBe(0)
  })

  it('an agent with no result and no recent sign of life is stale, not running', () => {
    const run = buildRun(liveInput({ nowMs: T0 + 40_000 + STALE_MS + 1, lastActivityMs: T0 + 40_000 }))

    expect(run.phases[0]?.agents.find(a => a.label === 'build:memmap')?.state).toBe('stale')
    expect(run.state).toBe('stalled')
  })

  it('a finished run: the record wins over any transcript, status and totals come from it', () => {
    const run = buildRun({ id: 'wf_rec', journal: null, agents: new Map(), record: record(), script: null, nowMs: NOW })

    expect(run).toMatchObject({ name: 'demo-run', state: 'completed', hasRecord: true, totalTokens: 400_000, durationMs: 90_000, running: 0, done: 2, failed: 1, total: 3 })
    expect(run.phases.map(p => [p.title, p.done, p.failed, p.total])).toEqual([['Build', 1, 1, 2], ['Review', 1, 0, 1]])
    expect(run.phases[0]?.agents[1]?.model).toBe('claude-opus-5-5')
    expect(currentPhase(run.phases)).toBe(0)
  })

  it('stale starts after 15 minutes without a sign of life, not before', () => {
    const at = (idle: number) => buildRun(liveInput({ nowMs: T0 + 40_000 + idle, lastActivityMs: T0 + 40_000 })).phases[0]?.agents.find(a => a.label === 'build:memmap')?.state

    expect(STALE_MS).toBe(15 * 60_000)
    expect(at(14 * 60_000)).toBe('running')
    expect(at(16 * 60_000)).toBe('stale')
  })

  it('a tail-read transcript makes tokens a floor and gives no start time', () => {
    const run = buildRun(liveInput({ agents: new Map([['a1', { meta: null, transcript: transcript([{ at: 5, id: 'm1', input: 1, write: 1, read: 1, output: 1 }, { at: 9, id: 'm2', input: 1, write: 1, read: 1, output: 1 }]), isTail: true, path: '/p' }]]), journal: journal(started('a1', 'big', 'Build')) }))
    const agent = run.phases[0]?.agents[0]

    expect(agent).toMatchObject({ isTokensPartial: true })
    expect(agent?.startedMs).toBeUndefined()
    expect(agent?.elapsedMs).toBeUndefined()
  })

  it('an empty or phase-less journal still builds', () => {
    expect(buildRun({ id: 'x', journal: journal(), agents: new Map(), record: null, script: null, nowMs: NOW })).toMatchObject({ total: 0, phases: [], state: 'finished', totalTokens: null })
    expect(buildRun({ id: 'x', journal: '{"type":"started","agentId":"z","label":"l"}\n', agents: new Map(), record: null, script: null, nowMs: NOW }).phases[0]?.title).toBe('—')
  })
})

describe('ruflo swarm as a run', () => {
  const agents = [
    { id: 'agent-1-aaaaaa', type: 'coder', status: 'busy', createdAtMs: NOW - 20_000 },
    { id: 'agent-2-bbbbbb', type: 'coder', status: 'idle' },
    { id: 'agent-3-cccccc', type: 'tester', status: 'stopped' },
  ]
  const swarm = { id: 'swarm-1', topology: 'hierarchical', status: 'running', agentIds: [] }

  it('groups by agent type, never invents tokens or model', () => {
    const run = swarmRun({ ...swarm, agentIds: agents.map(agent => agent.id) }, agents, NOW)

    expect(run).toMatchObject({ kind: 'ruflo-swarm', state: 'active', running: 1, idle: 1, done: 1, total: 3, totalTokens: null })
    expect(run?.phases.map(p => [p.title, p.total])).toEqual([['coder', 2], ['tester', 1]])
    expect(run?.phases[0]?.agents[0]).toMatchObject({ elapsedMs: 20_000, hasWorktree: false })
    expect(run?.phases[0]?.agents[0]?.tokens).toBeUndefined()
    expect(swarmRun(null, [], NOW)).toBeNull()
  })

  it('an empty swarm (right after swarm init) is still its own run with 0 agents; the store is a separate "agents on disk" run', () => {
    const fresh = { ...swarm, maxAgents: 3, updatedAt: new Date(NOW - 60_000).toISOString() }

    expect(swarmRun(fresh, agents, NOW)).toMatchObject({ id: 'swarm-1', name: 'ruflo swarm · hierarchical', state: 'active', total: 0, listed: 0 })
    expect(swarmRun(fresh, [], NOW)).toMatchObject({ id: 'swarm-1', state: 'active', total: 0 })
    expect(allRuns([], fresh, [], NOW).map(run => run.id)).toEqual(['swarm-1'])
    expect(allRuns([], fresh, agents, NOW).map(run => [run.id, run.name, run.total])).toEqual([
      ['swarm-1', 'ruflo swarm · hierarchical', 0],
      ['ruflo-swarm', 'ruflo agents on disk', 3],
    ])
  })

  it('a listed id is counted once, and one the store lacks makes the header say "listed, found"', () => {
    const run = swarmRun({ ...swarm, agentIds: ['agent-2-bbbbbb', 'agent-2-bbbbbb', 'agent-gone'], updatedAt: new Date(NOW - 60_000).toISOString() }, agents, NOW) as NonNullable<ReturnType<typeof swarmRun>>

    expect(run).toMatchObject({ total: 1, listed: 2 })
    expect(lines(workflowsView(ctxOf(110), { runs: [run], root: '/r', capBytes: TRANSCRIPT_CAP, skipped: 0, more: 0 }, newWfUi(), { ask: () => undefined, show: () => undefined })).join('\n')).toContain('updated 1m ago · 2 listed, 1 found')
  })

  it('a swarm that lists its agents is a run of those only, with the record\'s status and age (stale "running" is stalled)', () => {
    const weekOld = { ...swarm, agentIds: ['agent-2-bbbbbb'], updatedAt: new Date(NOW - 7 * 86_400_000).toISOString() }
    // Stale needs evidence: the one member is idle and was created days ago.
    const quiet = agents.map(agent => ({ ...agent, createdAtMs: NOW - 3 * 86_400_000 }))
    const run = swarmRun(weekOld, quiet, NOW)

    expect(run).toMatchObject({ id: 'swarm-1', name: 'ruflo swarm · hierarchical', state: 'stalled', isStale: true, total: 1, idle: 1, updatedMs: NOW - 7 * 86_400_000 })
    expect(swarmRun({ ...weekOld, updatedAt: new Date(NOW - 60_000).toISOString() }, quiet, NOW)?.state).toBe('active')
    expect(swarmRun({ ...weekOld, agentIds: ['agent-1-aaaaaa'] }, quiet, NOW)?.state).toBe('active')
    expect(swarmRun({ ...weekOld, status: 'terminated' }, quiet, NOW)?.state).toBe('finished')

    const shown = lines(workflowsView(ctxOf(110), { runs: [run as NonNullable<typeof run>], root: '/r', capBytes: TRANSCRIPT_CAP, skipped: 0, more: 0 }, newWfUi(), { ask: () => undefined, show: () => undefined })).join('\n')

    expect(shown).toContain('1 agents · 0 busy · 1 idle · 0 stopped · 0 failed · updated 7d ago · stale')
    expect(shown).toContain('stalled')
  })

  it('an agent row keeps "n/a tok" and its age apart, in days', () => {
    const old = [{ id: 'agent-r-jckxxx', type: 'researcher', status: 'idle', createdAtMs: NOW - 68 * 86_400_000 - 6 * 3_600_000 }]
    const run = swarmRun(null, old, NOW) as NonNullable<ReturnType<typeof swarmRun>>
    const shown = lines(workflowsView(ctxOf(110), { runs: [run], root: '/r', capBytes: TRANSCRIPT_CAP, skipped: 0, more: 0 }, newWfUi(), { ask: () => undefined, show: () => undefined })).join('\n')

    expect(shown).toMatch(/n\/a tok +68d06h/)
    expect(shown).not.toMatch(/tok\d/)
  })

  it('allRuns puts whatever is live first: a swarm by its record\'s state, so a stale "running" one is not live', () => {
    const idle = buildRun({ id: 'wf_old', journal: null, agents: new Map(), record: record(), script: null, nowMs: NOW })
    const listing = { ...swarm, agentIds: agents.map(agent => agent.id) }
    const quiet = agents.map(agent => ({ ...agent, status: 'idle', createdAtMs: NOW - 3 * 86_400_000 }))

    expect(allRuns([idle], { ...listing, updatedAt: new Date(NOW - 60_000).toISOString() }, agents, NOW).map(r => r.kind)).toEqual(['ruflo-swarm', 'workflow'])
    expect(allRuns([idle], { ...listing, updatedAt: new Date(NOW - 7 * 86_400_000).toISOString() }, quiet, NOW).map(r => [r.id, r.state])).toEqual([['wf_old', expect.any(String)], ['swarm-1', 'stalled']])
    expect(allRuns([idle], null, [], NOW).map(r => r.id)).toEqual(['wf_old'])
  })
})

describe('keys', () => {
  const runs = [buildRun(liveInput())]

  it('j/k move in the focused column, h/l switch, Enter inspects, indexes never leave the list', () => {
    let ui = startOn(newWfUi(), runs[0] ?? null)

    expect(ui).toMatchObject({ phase: 0, column: 'phases' })
    ui = walk(ui, runs, 'j')
    expect(ui.phase).toBe(1)
    ui = walk(walk(walk(walk(ui, runs, 'j'), runs, 'j'), runs, 'j'), runs, 'j')
    expect(ui.phase).toBe(2)
    ui = walk(walk(ui, runs, 'k'), runs, 'k')
    expect(pick(ui, runs).phase?.title).toBe('Build')
    ui = walk(ui, runs, 'l')
    expect(ui.column).toBe('agents')
    ui = walk(walk(ui, runs, 'j'), runs, 'j')
    expect(ui.agent).toBe(1)
    ui = walk(ui, runs, 'enter')
    expect(ui.isInspecting).toBe(true)
    expect(pick(ui, runs).agent?.label).toBe('build:recall')
    expect(walk(ui, runs, 'escape').isInspecting).toBe(false)
    expect(walk(walk(ui, runs, 'enter'), runs, 'h').column).toBe('phases')
  })

  it('l on an empty phase stays; Enter with nothing under the cursor does nothing; [ ] clamp', () => {
    let ui = { ...newWfUi(), phase: 2 }

    expect(walk(ui, runs, 'l').column).toBe('phases')
    expect(walk(ui, runs, 'enter').isInspecting).toBe(false)
    ui = walk(ui, runs, ']')
    expect(ui.run).toBe(0)
    expect(pick(newWfUi(), []).run).toBeNull()
    expect(walk(newWfUi(), [], 'j')).toEqual(newWfUi())
  })

  it('a shrunk list pulls the cursor back', () => {
    expect(pick({ ...newWfUi(), run: 5, phase: 9, agent: 9 }, runs).ui).toMatchObject({ run: 0, phase: 2, agent: 0 })
  })
})

describe('reader', () => {
  const root = '/home/u/.claude/projects/-work-proj'
  const session = '11111111-2222-3333-4444-555555555555'
  const runDir = `${root}/${session}/subagents/workflows/wf_live`

  const memoryFs = (files: Record<string, string>, sizes: Record<string, number> = {}, mtime = 1_000): WorkflowFs => {
    const under = (dir: string) => [...new Set(Object.keys({ ...files, ...sizes }).filter(p => p.startsWith(`${dir}/`)).map(p => p.slice(dir.length + 1).split('/')[0] as string))]

    return {
      read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
      stat: async path => (files[path] !== undefined ? { mtimeMs: mtime, size: sizes[path] ?? files[path].length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
      list: async dir => {
        const names = under(dir)

        return names.length === 0 ? Promise.reject(new Error('ENOENT')) : names.map(name => ({ name, mtimeMs: mtime, size: sizes[`${dir}/${name}`] ?? files[`${dir}/${name}`]?.length }))
      },
    }
  }

  const base = (): Record<string, string> => ({
    [`${runDir}/journal.jsonl`]: journal(started('a1', 'build:x', 'Build')),
    [`${runDir}/agent-a1.meta.json`]: meta('build:x', 'Build', { spawnedWithWorktree: true }),
    [`${runDir}/agent-a1.jsonl`]: transcript([{ at: 5, id: 'm1', input: 1, write: 1, read: 1, output: 1 }]),
    [`${root}/${session}/workflows/scripts/demo-wf_live.js`]: SCRIPT,
  })

  const read = (fs: WorkflowFs) => readWorkflowRuns(fs, new Map() as ReadCache, { configDir: '/home/u/.claude', cwd: '/work/proj', nowMs: T0 + 10_000 })

  it('the slug is the folder name Claude Code uses', () => {
    expect(slugOf('/home/ruvultra/projects/ruflo')).toBe('-home-ruvultra-projects-ruflo')
  })

  it('finds a live run, its script phases and its agent figures', async () => {
    const found = await read(memoryFs(base()))

    expect(found.root).toBe(root)
    expect(found.runs).toHaveLength(1)
    expect(found.runs[0]?.name).toBe('demo-run')
    expect(found.runs[0]?.phases.map(p => p.title)).toEqual(['Build', 'Tune', 'Review'])
    expect(found.runs[0]?.phases[0]?.agents[0]).toMatchObject({ state: 'running', hasWorktree: true, tokens: 4, transcriptPath: `${runDir}/agent-a1.jsonl` })
  })

  it('a finished run is not transcript-read: its record is enough', async () => {
    const files = { ...base(), [`${root}/${session}/workflows/wf_live.json`]: record() }
    const found = await read(memoryFs(files))

    expect(found.runs[0]).toMatchObject({ hasRecord: true, state: 'completed', totalTokens: 400_000 })
    expect(found.skipped).toEqual([])
  })

  it('a finished run never opens a transcript', async () => {
    const files = { ...base(), [`${root}/${session}/workflows/wf_live.json`]: record() }
    const opened: string[] = []
    const inner = memoryFs(files)

    await read({ ...inner, read: async path => (opened.push(path), inner.read(path)) })
    expect(opened.filter(path => path.endsWith('.jsonl') && !path.endsWith('journal.jsonl'))).toEqual([])
  })

  it('an oversized transcript is tail-read where the host can, else left unread and counted', async () => {
    const big = { [`${runDir}/agent-a1.jsonl`]: TRANSCRIPT_CAP + 1 }
    const files = base()
    const plain = await read(memoryFs(files, big))

    expect(plain.skipped).toEqual([`${runDir}/agent-a1.jsonl`])
    expect(plain.runs[0]?.phases[0]?.agents[0]?.tokens).toBeUndefined()

    const tail = await read({ ...memoryFs(files, big), readTail: async () => `cut-off-line\n${files[`${runDir}/agent-a1.jsonl`]}` })

    expect(tail.skipped).toEqual([])
    expect(tail.runs[0]?.phases[0]?.agents[0]).toMatchObject({ tokens: 4, isTokensPartial: true })
  })

  it('no config directory, no project folder: an honest empty answer', async () => {
    expect((await readWorkflowRuns(memoryFs({}), new Map() as ReadCache, { configDir: null, cwd: '/x', nowMs: 0 })).runs).toEqual([])
    expect((await read(memoryFs({}))).runs).toEqual([])
  })

  it('limits the runs shown and says how many more exist', async () => {
    const files: Record<string, string> = {}

    for (let i = 0; i < 8; i += 1) files[`${root}/${session}/subagents/workflows/wf_r${i}/journal.jsonl`] = journal()

    const found = await readWorkflowRuns(memoryFs(files), new Map() as ReadCache, { configDir: '/home/u/.claude', cwd: '/work/proj', nowMs: 0, maxRuns: 3 })

    expect(found.runs).toHaveLength(3)
    expect(found.more).toBe(5)
  })
})

describe('view', () => {
  const hooks = { ask: () => undefined, show: () => undefined }
  const live = buildRun(liveInput())
  const model = (runs = [live]) => ({ runs, root: '/r', capBytes: TRANSCRIPT_CAP, skipped: 0, more: 0 })

  it('draws phases left with done/total and the current marker, agents right with mark, model, worktree, tokens, time', () => {
    const out = lines(workflowsView(ctxOf(110), model(), startOn(newWfUi(), live), hooks))
    const text = out.join('\n')

    expect(text).toContain('demo-run')
    expect(text).toContain('3 agents · 2 running · 1 done · 0 failed')
    expect(out.find(l => l.includes('1 Build'))).toMatch(/❯.*1 Build\s+1\/2.*│.*build:memmap\s+Sonnet 5\.5\s+worktree\s+125\.6k tok\s+1m40s/)
    expect(out.find(l => l.includes('2 Tune'))).toMatch(/2 Tune\s+0\/1/)
    expect(text).toContain('derived from the journal and transcripts')
  })

  it('draws at most 14 rows a column however many agents the run names, wide or narrow', () => {
    const many = buildRun({ ...liveInput(), journal: journal(...Array.from({ length: 500 }, (_, i) => started(`x${i}`, `agent ${i}`, 'Build'))), agents: new Map() })

    for (const columns of [110, 50]) {
      const out = lines(workflowsView(ctxOf(columns), model([many]), startOn(newWfUi(), many), hooks))

      expect(out.filter(l => /◐ agent/.test(l)).length).toBe(14)
      expect(out.join('\n')).toContain('+486 more')
    }
  })

  it('scrolls so the cursor row is always drawn, however far down it is', () => {
    const many = buildRun({ ...liveInput(), journal: journal(...Array.from({ length: 500 }, (_, i) => started(`x${i}`, `agent ${i}`, 'Build'))), agents: new Map() })

    for (const columns of [110, 50]) {
      const ui = { ...startOn(newWfUi(), many), column: 'agents' as const, agent: 300 }
      const out = lines(workflowsView(ctxOf(columns), model([many]), ui, hooks))

      expect(out.some(l => l.includes('▸') && l.includes('agent 300'))).toBe(true)
      expect(out.filter(l => /agent \d/.test(l)).length).toBe(14)
    }
  })

  it('strips control characters from labels, masks credential-shaped text in a result preview, and survives an absurd start time', () => {
    const run = buildRun({
      ...liveInput(),
      journal: journal(started('z1', '\u001b[31mevil\u001b[0m label', 'Build'), result('z1', 'token=abc123 and sk-abcdefghijklmnop1234 ok see src/some/long/path/to/a/file/name/here.ts')),
      agents: new Map(),
      record: record({ workflowProgress: [{ type: 'workflow_agent', agentId: 'z1', startedAt: 1e20, state: 'done' }] }),
    })
    const agent = run.phases[0]?.agents[0]

    expect(agent?.label).not.toMatch(/\u001b/)
    expect(agent?.resultPreview).not.toMatch(/abc123|sk-abcdef/)
    expect(agent?.resultPreview).toContain('src/some/long/path/to/a/file/name/here.ts')

    const ui = { ...startOn(newWfUi(), run), column: 'agents' as const, isInspecting: true }

    expect(() => lines(workflowsView(ctxOf(110), model([run]), ui, hooks))).not.toThrow()
  })

  it('narrow screens drop the model and badge instead of overflowing', () => {
    const out = lines(workflowsView(ctxOf(50), model(), startOn(newWfUi(), live), hooks))

    expect(out.join('\n')).not.toContain('Sonnet 5.5')
    expect(out.join('\n')).toContain('1 Build')
  })

  it('inspect shows the transcript path and open fires the hook; a workflow is stopped from the control tab where it is on, else Claude Code', () => {
    const shown: string[] = []
    const ui = { ...startOn(newWfUi(), live), column: 'agents' as const, isInspecting: true }
    const tree = workflowsView(ctxOf(110), model(), ui, { ask: () => undefined, show: path => shown.push(path) })
    const buttons = walkEls(tree).filter(n => n.kind === 'Button')

    expect(lines(tree).join('\n')).toContain('/d/agent-a1.jsonl')
    expect(lines(tree).join('\n')).toContain('control tab')
    expect(buttons.map(b => b.props.label)).toEqual(['Open transcript'])
    ;(buttons[0]?.props.onPress as () => void)()
    expect(shown).toEqual(['/d/agent-a1.jsonl'])
  })

  it('a ruflo agent offers stop and spawn through the confirm hook with fixed argv', () => {
    const swarm = swarmRun({ id: 's', topology: 'hierarchical', status: 'running', agentIds: ['agent-9-zzzzzz'] }, [{ id: 'agent-9-zzzzzz', type: 'coder', status: 'busy' }], NOW) as NonNullable<ReturnType<typeof swarmRun>>
    const asked: string[][] = []
    const ui = { ...newWfUi(), column: 'agents' as const, isInspecting: true }
    const tree = workflowsView(ctxOf(110), model([swarm]), ui, { ask: spec => asked.push([...spec.args]), show: () => undefined })
    const buttons = walkEls(tree).filter(n => n.kind === 'Button')

    expect(buttons.map(b => b.props.label)).toEqual(['Stop agent', 'Spawn another coder'])
    buttons.forEach(b => (b.props.onPress as () => void)())
    expect(asked[0]).toEqual(['agent', 'stop', 'agent-9-zzzzzz'])
    expect(asked[1]?.slice(0, 4)).toEqual(['agent', 'spawn', '--type', 'coder'])
    expect(lines(tree).join('\n')).toContain('n/a (ruflo records neither per agent)')
  })

  it('empty and loading states are honest', () => {
    expect(lines(workflowsView(ctxOf(100), null, newWfUi(), hooks)).join('\n')).toContain('reading workflow runs')
    expect(lines(workflowsView(ctxOf(100), { ...model([]), runs: [] }, newWfUi(), hooks)).join('\n')).toContain('No workflow runs for this project')
    expect(lines(workflowsView(ctxOf(100), { ...model([]), runs: [], root: null }, newWfUi(), hooks)).join('\n')).toContain('No Claude Code config directory')
  })
})
