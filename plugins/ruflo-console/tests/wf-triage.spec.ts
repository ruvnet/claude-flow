/**
 * Workflows triage, cost board and guards (ADR-462): the classes and the re-run text, then the whole path over an in-memory disk: a read of
 * the runs, the cost read after it (price book, transcripts, byte budget, dirty probe), the page the person sees, and the notices. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-triage.spec.ts --testTimeout=30000
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { classifyAgent, failedOf, firstErrorLine, rerunText, resultsOfJournal, triageRun, triageStrip } from '../hooks/data/wf-triage'
import { buildRun, type WfAgent, type WfRun } from '../hooks/data/workflows'
import type { WorkflowFs } from '../hooks/data/workflows-read'
import type { Host } from '../hooks/host'
import { newState, type State } from '../hooks/state'
import { isUnder, MAX_DIRTY_PROBES, READ_BUDGET, refreshWfGuards, resetWfGuards, guards } from '../hooks/wf-cost-live'
import { refreshWorkflows } from '../hooks/wf-live'
import { workflowsActions } from '../hooks/wf-actions'
import type { Actions, Ctx, Kit } from '../hooks/views/common'
import { registerWfTriage } from '../hooks/views/wf-triage'
import { workflowsPage } from '../hooks/views/wf-page'
import { resetSlots, slotsFor } from '../hooks/views/wf-slots'
import { journal, meta, record, result, started, T0, transcript } from './fixtures/workflows'

const agent = (over: Partial<WfAgent>): WfAgent => ({ id: 'a', label: 'build:a', phase: 'Build', state: 'done', hasWorktree: false, ...over })

describe('classifyAgent', () => {
  it('reads a pending agent as pending and a silent one as stale', () => {
    expect(classifyAgent(agent({ state: 'running' })).kind).toBe('pending')
    expect(classifyAgent(agent({ state: 'queued' })).kind).toBe('pending')
    expect(classifyAgent(agent({ state: 'stale' })).kind).toBe('stale')
  })

  it('reads a failed agent as an error with its first error line, or a timeout where the result says so', () => {
    const failed = classifyAgent(agent({ state: 'failed' }), 'working...\nTypeError: x is not a function\n    at foo')

    expect(failed).toMatchObject({ kind: 'error', firstError: 'TypeError: x is not a function' })
    expect(classifyAgent(agent({ state: 'failed' }), 'request timed out after 600s').kind).toBe('timeout')
    expect(classifyAgent(agent({ state: 'failed' }), 'ETIMEDOUT connecting').kind).toBe('timeout')
    expect(classifyAgent(agent({ state: 'failed' }))).toMatchObject({ kind: 'error', why: expect.stringContaining('no result text') })
  })

  it('reads a finished agent as an error only if its result OPENS with one, not if it mentions one', () => {
    expect(classifyAgent(agent({}), 'Error: build failed\nmore').kind).toBe('error')
    expect(classifyAgent(agent({}), 'RangeError: bad\nmore').kind).toBe('error')
    expect(classifyAgent(agent({}), 'Error handling is missing in two places; I added it.').kind).toBe('ok')
    expect(classifyAgent(agent({}), 'I fixed an Error: it was in the parser').kind).toBe('ok')
    expect(classifyAgent(agent({}), 'Done. The TypeError: case is handled.').kind).toBe('ok')
  })

  it('reads a finished agent with nothing to show as empty, never a long answer that happens to say so', () => {
    expect(classifyAgent(agent({}), 'No changes needed.').kind).toBe('empty')
    expect(classifyAgent(agent({}), 'nothing to do').kind).toBe('empty')
    expect(classifyAgent(agent({}), '{}').kind).toBe('empty')
    expect(classifyAgent(agent({ toolCalls: 0 }), '').kind).toBe('empty')
    expect(classifyAgent(agent({ toolCalls: 12 }), '').kind).toBe('ok')
    expect(classifyAgent(agent({}), '').kind).toBe('ok')
    expect(classifyAgent(agent({}), `No changes needed ${'x'.repeat(80)}`).kind).toBe('ok')
  })

  it('masks a credential and strips control characters from the error line', () => {
    const line = firstErrorLine('Error: failed with token sk-abcdefghijklmnopqrstuvwxyz0123456789 \u001b[31mred')

    expect(line).not.toMatch(/sk-abc|\u001b/)
    expect(line).toContain('‹masked›')
  })

  it('uses the reader\'s preview where the journal was not read', () => {
    expect(classifyAgent(agent({ state: 'failed', resultPreview: 'Error: boom' })).firstError).toBe('Error: boom')
  })
})

describe('the journal and the strip', () => {
  it('reads each agent\'s result text, a structured one by its error field', () => {
    const results = resultsOfJournal(journal(started('a', 'x', 'P'), result('a', 'plain text'), result('b', { error: 'it broke', other: 1 }), result('c', { n: 1 })))

    expect(results.get('a')).toBe('plain text')
    expect(results.get('b')).toBe('it broke')
    expect(results.get('c')).toBe('{"n":1}')
    expect(resultsOfJournal(null).size).toBe(0)
  })

  it('counts failed, empty, stale, ok and pending and says so in one line', () => {
    expect(triageStrip({ ok: 9, empty: 1, error: 1, timeout: 1, stale: 1, pending: 3 })).toBe('2 failed · 1 empty · 1 stale · 9 ok · 3 running or waiting')
    expect(triageStrip({ ok: 4, empty: 0, error: 0, timeout: 0, stale: 0, pending: 0 })).toBe('4 ok')
    expect(triageStrip({ ok: 0, empty: 0, error: 0, timeout: 0, stale: 0, pending: 0 })).toBe('no agents to triage')
  })
})

const finished = (): WfRun =>
  buildRun({
    id: 'wf_rec',
    journal: journal(started('ra1', 'build:a', 'Build'), started('ra2', 'build:b', 'Build'), started('ra3', 'review:a', 'Review'), result('ra1', 'No changes needed.'), result('ra2', 'Error: boom')),
    agents: new Map(),
    record: record({ workflowProgress: [{ type: 'workflow_agent', label: 'build:a', phaseTitle: 'Build', agentId: 'ra1', state: 'done' }, { type: 'workflow_agent', label: 'build:b', phaseTitle: 'Build', agentId: 'ra2', state: 'failed' }, { type: 'workflow_agent', label: 'review:a', phaseTitle: 'Review', agentId: 'ra3', state: 'failed' }] }),
    script: null,
    nowMs: T0 + 100_000,
  })

describe('rerunText', () => {
  it('names the documented resume verb and splits agents that run again from those whose error is cached', () => {
    const run = finished()
    const results = resultsOfJournal(journal(result('ra1', 'No changes needed.'), result('ra2', 'Error: boom')))
    const triage = triageRun(run, results)
    const text = rerunText(run, failedOf(triage), true) ?? []

    expect(triage.counts).toMatchObject({ empty: 1, error: 2 })
    expect(text[0]).toBe('Workflow({ scriptPath: "<the script that started this run>", resumeFromRunId: "wf_rec" })')
    expect(text.join('\n')).toMatch(/runs again, no result recorded: review:a \(Review\)/)
    expect(text.join('\n')).toMatch(/stays cached.*build:b \(Build\)/)
  })

  it('tells the person to stop a running run first (the Control tab asks and calls TaskStop with the run task id: verified on 2.1.289), and says when the journal was not read', () => {
    const run = { ...finished(), running: 1 }
    const text = rerunText(run, failedOf(triageRun(run, null)), false) ?? []

    expect(text[0]).toMatch(/Stop the run first \(the Control tab's Stop asks first and calls TaskStop with the run's task id: verified to stop the whole run on Claude Code 2\.1\.289; it cannot stop a single agent/)
    expect(text[0]).not.toMatch(/unverified/)
    expect(text.join('\n')).toMatch(/journal was not read/)
  })

  it('gives no text for a swarm, an odd run id, or nothing failed', () => {
    const run = finished()
    const failed = failedOf(triageRun(run, null))

    expect(rerunText({ ...run, kind: 'ruflo-swarm' }, failed, true)).toBeNull()
    expect(rerunText({ ...run, id: 'wf_x"; echo pwned' }, failed, true)).toBeNull()
    expect(rerunText(run, [], true)).toBeNull()
  })

  it('caps the list at ten agents and says how many more', () => {
    const run = finished()
    const many = Array.from({ length: 13 }, (_, i) => ({ agent: agent({ id: `x${i}`, label: `l${i}`, state: 'failed' }), triage: { kind: 'error' as const, why: 'w' }, isCached: false }))
    const text = (rerunText(run, many, true) ?? []).join('\n')

    expect(text).toContain('+3 more')
    expect(text).not.toContain('l10')
  })
})

describe('isUnder', () => {
  it('accepts a path inside the root and refuses traversal, control characters and other roots', () => {
    expect(isUnder('/c/projects/a/b.jsonl', '/c/projects')).toBe(true)
    expect(isUnder('/c/projects/../x', '/c/projects')).toBe(false)
    expect(isUnder('/c/projectsX/a', '/c/projects')).toBe(false)
    expect(isUnder('/c/projects/a\u0000b', '/c/projects')).toBe(false)
    expect(isUnder('/c/projects/a', null)).toBe(false)
  })
})

// --- the whole path, over an in-memory disk ---------------------------------------------------------------------------------------------------------

const NOW = T0 + 100_000
const CONFIG = '/home/u/.claude'
const ROOT = `${CONFIG}/projects/-work-proj`
const SESSION = '11111111-2222-3333-4444-555555555555'
const RUN = `${ROOT}/${SESSION}/subagents/workflows/wf_rec`
const TRACKER = '/opt/tracker'
const BOOK = JSON.stringify({ asOf: '2026-10-03', models: [{ id: 'claude-opus-5-5', provider: 'claude', match: 'opus-5', unit: 'usd', input: 4, output: 20, cache_read: 0.2 }, { id: 'claude-sonnet-5-5', provider: 'claude', match: 'sonnet-5', unit: 'usd', input: 2, output: 10, cache_read: 0.2 }] })

type El = { kind: string; props: Record<string, unknown> }
const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) } as unknown as Kit
const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}
const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')

function memoryFs(files: Record<string, string>, sizes: Record<string, number> = {}): WorkflowFs {
  const under = (dir: string) => [...new Set(Object.keys(files).filter(path => path.startsWith(`${dir}/`)).map(path => path.slice(dir.length + 1).split('/')[0] as string))]

  return {
    read: async path => files[path] ?? Promise.reject(new Error('ENOENT')),
    stat: async path => (files[path] !== undefined ? { mtimeMs: T0, size: sizes[path] ?? files[path].length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
    list: async dir => {
      const names = under(dir)

      return names.length === 0 ? Promise.reject(new Error('ENOENT')) : names.map(name => ({ name, mtimeMs: T0, size: sizes[`${dir}/${name}`] ?? files[`${dir}/${name}`]?.length }))
    },
  }
}

const opus = (id: string) => transcript([{ at: 1, id, model: 'claude-opus-5-5', input: 0, write: 0, read: 0, output: 1_000_000 }])
const sonnet = (id: string) => transcript([{ at: 1, id, input: 0, write: 0, read: 0, output: 1_000_000 }])

type Over = { options?: Record<string, unknown>; fs?: (files: Record<string, string>) => WorkflowFs; installed?: boolean; omit?: string[] }

const world = (extra: Record<string, string> = {}, over: Over = {}) => {
  const files: Record<string, string> = {
    [`${ROOT}/${SESSION}/workflows/wf_rec.json`]: record(),
    [`${RUN}/journal.jsonl`]: journal(started('ra1', 'build:a', 'Build'), started('ra2', 'build:b', 'Build'), started('ra3', 'review:a', 'Review'), result('ra1', 'done well'), result('ra2', 'Error: token sk-abcdefghijklmnopqrstuvwxyz0123456789 broke \u001b[31m')),
    [`${RUN}/agent-ra1.meta.json`]: meta('build:a', 'Build'),
    [`${RUN}/agent-ra2.meta.json`]: meta('build:b', 'Build'),
    [`${RUN}/agent-ra3.meta.json`]: meta('review:a', 'Review'),
    [`${RUN}/agent-ra1.jsonl`]: sonnet('m1'),
    [`${RUN}/agent-ra3.jsonl`]: opus('m3'),
    [`${TRACKER}/data/prices.json`]: BOOK,
    ...extra,
  }

  for (const path of over.omit ?? []) delete files[path]

  const state = newState({})
  const ran: string[][] = []
  const fs = over.fs?.(files) ?? memoryFs(files)
  const host = { fs, invalidate: () => undefined, run: async (argv: string[]) => (ran.push(argv), { exitCode: 0, stdout: ' M file.ts\n', stderr: '' }) } as unknown as Host

  state.view = 'workflows'
  state.configDir = CONFIG
  state.cwd = '/work/proj'
  state.isInteractive = false
  Object.assign(state.options, over.options ?? {})
  if (over.installed !== false) state.snapshot = { plugins: { installed: [{ id: 'ruflo-cost-tracker@ruflo', name: 'ruflo-cost-tracker', marketplace: 'ruflo', version: '0.27.0', scope: 'user', installPath: TRACKER }] }, swarm: null, agents: [] } as unknown as State['snapshot']

  return { state, host, files, ran }
}

function pageText(state: State, host: Host, columns = 110): string {
  const runner = { ask: () => undefined }
  const act = { workflows: workflowsActions(state, host, runner as never) } as unknown as Actions
  const ctx: Ctx = { kit, state, nowMs: NOW, columns, pictures: new Map(), act }

  return words(workflowsPage(ctx))
}

beforeEach(() => {
  resetSlots()
  resetWfGuards()
  registerWfTriage()
})

describe('the slots', () => {
  it('registers a Triage board, a Cost board and a guard notice slot, in that order', () => {
    expect(slotsFor('board').map(slot => slot.id)).toEqual(['wf-triage', 'wf-cost'])
    expect(slotsFor('notice').map(slot => slot.id)).toEqual(['wf-guard'])
  })
})

describe('the cost read and the page', () => {
  it('prices a finished run by agent, phase and run from its transcripts and the tracker\'s book, with n/a for the agent that left none', async () => {
    const { state, host } = world()

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)

    const cost = guards.costs.get('wf_rec')

    expect(guards.book?.asOf).toBe('2026-10-03')
    expect(cost?.agents.get('ra1')?.usd).toBeCloseTo(10, 6)
    expect(cost?.agents.get('ra3')?.usd).toBeCloseTo(20, 6)
    expect(cost?.agents.has('ra2')).toBe(false)
    expect(cost?.total).toMatchObject({ isFloor: true })
    expect(cost?.total.usd).toBeCloseTo(30, 6)
    expect(guards.coverage).toMatchObject({ read: 2, total: 3, left: 0 })

    const page = pageText(state, host)

    expect(page).toContain('≥$30.00')
    expect(page).toContain('2 of 3 agents read')
    expect(page).toContain('Build')
    expect(page).toContain('≥$10.00')
    expect(page).toContain('billed tokens')
    expect(page).toContain('book as of 2026-10-03')
  })

  it('says why there is no price where the cost tracker is not installed, and shows tokens, not dollars', async () => {
    const { state, host } = world({}, { installed: false })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)

    expect(guards.book).toBeNull()
    expect(guards.bookWhy).toMatch(/not installed/)

    const page = pageText(state, host)

    expect(page).toMatch(/prices\s+none: the ruflo-cost-tracker plugin is not installed/)
    expect(page).toContain('no price')
    expect(page).not.toMatch(/\$\d/)
  })

  it('says the cost is not read yet before the first cost read, instead of drawing a number', async () => {
    const { state, host } = world()

    await refreshWorkflows(state, host, true, NOW)

    expect(pageText(state, host)).toContain('cost is read after the run board')
  })

  it('reads nothing while the page is not in front, or the pane is closed', async () => {
    const { state, host, ran } = world({}, { options: { wfAlertRules: 'dirty' } })

    await refreshWorkflows(state, host, true, NOW)
    state.view = 'overview'
    await refreshWfGuards(state, host, true, NOW)
    expect(guards.readAtMs).toBe(0)

    state.view = 'workflows'
    state.isInteractive = true
    state.pane.isOpen = true
    state.pane.isShown = false
    await refreshWfGuards(state, host, false, NOW)
    expect(guards.readAtMs).toBe(0)
    expect(ran).toEqual([])
  })

  it('holds the byte budget: transcripts beyond it wait for the next refresh and are shown as left', async () => {
    const ids = Array.from({ length: 9 }, (_, i) => `r${i}`)
    const files: Record<string, string> = { [`${RUN}/journal.jsonl`]: journal(...ids.map(id => started(id, id, 'Build'))) }
    const sizes: Record<string, number> = {}

    for (const id of ids) {
      files[`${RUN}/agent-${id}.meta.json`] = meta(id, 'Build')
      files[`${RUN}/agent-${id}.jsonl`] = sonnet(`m-${id}`)
      sizes[`${RUN}/agent-${id}.jsonl`] = 2_900_000
    }

    const { state, host } = world(files, { fs: all => memoryFs(all, sizes), omit: [`${ROOT}/${SESSION}/workflows/wf_rec.json`, `${RUN}/agent-ra1.meta.json`, `${RUN}/agent-ra2.meta.json`, `${RUN}/agent-ra3.meta.json`, `${RUN}/agent-ra1.jsonl`, `${RUN}/agent-ra3.jsonl`] })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)

    expect(2_900_000 * 8).toBeLessThanOrEqual(READ_BUDGET)
    expect(2_900_000 * 9).toBeGreaterThan(READ_BUDGET)
    expect(guards.coverage).toMatchObject({ read: 8, total: 9, left: 1 })

    // The parsed ones are remembered: the next refresh reads the one that waited.
    await refreshWfGuards(state, host, true, NOW + 3000)
    expect(guards.coverage).toMatchObject({ read: 9, left: 0 })
  })

  it('reads an oversized transcript from its end and marks the cost a floor', async () => {
    const path = `${RUN}/agent-ra1.jsonl`
    const { state, host } = world({}, { fs: files => ({ ...memoryFs(files, { [path]: 4_000_000 }), readTail: async () => `cut-off line\n${sonnet('tail')}` }) })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)

    expect(guards.costs.get('wf_rec')?.agents.get('ra1')).toMatchObject({ isFloor: true })
  })
})

describe('triage on the page', () => {
  it('shows the strip, the first error line and the re-run text, with the credential masked and no escape sequence', async () => {
    const { state, host } = world()

    await refreshWorkflows(state, host, true, NOW)

    const page = pageText(state, host)

    expect(page).toContain('1 failed')
    expect(page).toMatch(/build:b.*error.*Error: token/)
    expect(page).toContain('resumeFromRunId: "wf_rec"')
    expect(page).toMatch(/stays cached.*build:b/)
    expect(page).not.toMatch(/sk-abc|\u001b/)
    expect(page).toContain('timeout is a text match')
  })
})

describe('a narrow pane', () => {
  it('still draws both sections and never leaves a sentence cut off by an ellipsis in the notes', async () => {
    const { state, host } = world()

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)

    const page = pageText(state, host, 50)

    expect(page).toContain('1 failed')
    expect(page).toContain('Cost')
    expect(page).not.toMatch(/(stays cached|timeout is a text|up to 3\.0 MB)[^\n]*…/)
    expect(page).toContain('resumeFromRunId')
  })
})


const guardNotes = (state: State) => state.notices.filter(notice => notice.key.startsWith('wf-guard:'))
const RA3 = `${RUN}/agent-ra3.jsonl`

describe('guard notices', () => {
  it('announces nothing for what is already true at the first cost read, yet keeps it on the Cost board', async () => {
    const { state, host } = world({}, { options: { wfBudgetRunUsd: 25 } })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)
    await refreshWorkflows(state, host, true, NOW + 1000)

    expect(guardNotes(state)).toHaveLength(0)
    expect(pageText(state, host)).toMatch(/now: workflow demo-run spent ≥\$30\.00, over your \$25\.00 run ceiling \(nothing was stopped\)/)
  })

  it('raises the run ceiling once when a run CROSSES it, saying nothing was stopped, and not again while it stays over', async () => {
    const { state, host, files } = world({}, { options: { wfBudgetRunUsd: 25 }, omit: [RA3] })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)
    await refreshWorkflows(state, host, true, NOW + 1000)
    expect(guardNotes(state)).toHaveLength(0)
    expect(guards.costs.get('wf_rec')?.total.usd).toBeCloseTo(10, 6)

    files[RA3] = opus('m3')
    await refreshWfGuards(state, host, true, NOW + 3000)
    await refreshWorkflows(state, host, true, NOW + 4000)

    expect(guardNotes(state)).toHaveLength(1)
    expect(guardNotes(state)[0]).toMatchObject({ level: 'warn', go: 'workflows' })
    expect(guardNotes(state)[0]?.text).toMatch(/spent ≥\$30\.00, over your \$25\.00 run ceiling \(nothing was stopped\)/)

    await refreshWorkflows(state, host, true, NOW + 200_000)
    expect(guardNotes(state)).toHaveLength(1)
  })

  it('stays quiet at a ceiling above the spend', async () => {
    const { state, host, files } = world({}, { options: { wfBudgetRunUsd: 31 }, omit: [RA3] })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)
    files[RA3] = opus('m3')
    await refreshWfGuards(state, host, true, NOW + 3000)
    await refreshWorkflows(state, host, true, NOW + 4000)
    expect(guardNotes(state)).toHaveLength(0)
  })

  it('probes worktrees read-only with a fixed argv, only inside the project, and raises dirty for an agent that ENDED dirty', async () => {
    const inside = '/work/proj/.claude/worktrees/a1'
    const { state, host, ran, files } = world({}, { options: { wfAlertRules: 'dirty' } })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)
    expect(ran).toEqual([])
    expect(guardNotes(state)).toHaveLength(0)

    Object.assign(files, { [`${RUN}/agent-ra1.meta.json`]: meta('build:a', 'Build', { spawnedWithWorktree: true, worktreePath: inside }), [`${RUN}/agent-ra2.meta.json`]: meta('build:b', 'Build', { spawnedWithWorktree: true, worktreePath: '/elsewhere/wt' }), [`${RUN}/agent-ra3.meta.json`]: meta('review:a', 'Review', { spawnedWithWorktree: true, worktreePath: '/work/proj/../etc' }) })
    await refreshWorkflows(state, host, true, NOW + 3000)
    await refreshWfGuards(state, host, true, NOW + 3000)

    expect(ran).toEqual([['git', '--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', inside, 'status', '--porcelain=v1', '--untracked-files=no']])
    expect(guards.dirty?.get('wf_rec/ra1')).toBe(true)
    expect(MAX_DIRTY_PROBES).toBe(12)

    await refreshWorkflows(state, host, true, NOW + 4000)
    expect(guardNotes(state).map(notice => notice.text).join('\n')).toMatch(/build:a.*uncommitted worktree/)
  })

  it('does not run any git probe where the dirty rule is off', async () => {
    const { state, host, ran } = world({ [`${RUN}/agent-ra1.meta.json`]: meta('build:a', 'Build', { spawnedWithWorktree: true, worktreePath: '/work/proj/wt' }) })

    await refreshWorkflows(state, host, true, NOW)
    await refreshWfGuards(state, host, true, NOW)
    expect(ran).toEqual([])
    expect(guards.dirty).toBeNull()
  })
})
