import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { attentionLine } from '../../ruflo-mods/hooks/attention'
import { readDisk, type ReaderFs } from '../hooks/data/files'
import { ruosRows } from '../hooks/data/harness-ruos'
import { parseRuos, reconcileReason, RUOS_CONTRACT, RUOS_MAX_BYTES, RUOS_STALE_MS } from '../hooks/data/ruos'
import { attentionOf, countsOf, markViewed } from '../hooks/data/sessions-attention'
import { queueOf, scanSessions, selectRow, sessionActions, workspaceOf } from '../hooks/sessions'
import { linesOf } from '../hooks/views/pane'
import { remoteRunRows } from '../hooks/views/remote-runs'
import { ctxOf, drawn, world } from './fixtures/sessions-world'
import { NOW } from './fixtures/sessions-fs'

const iso = (ms: number) => new Date(ms).toISOString()
const rawRun = (over: Record<string, unknown> = {}) => ({
  runId: 'run-1', agentId: 'agent-1', desktopId: 'desktop-1', jobId: 'job-1', jobs: 'jobs-api',
  state: 'running', connection: 'healthy', revision: 4, nextOffset: 17, startedAt: iso(NOW - 100_000), updatedAt: iso(NOW - 1000),
  binding: { missionId: 'm1', missionRevision: 2, worktree: '/work/project/.worktrees/task-1', commit: 'a'.repeat(40), sourceDigest: 'sha256:' + 'b'.repeat(64) },
  bindingDigest: 'sha256:' + 'c'.repeat(64), ...over,
})
const raw = (runs = [rawRun()], over: Record<string, unknown> = {}) => JSON.stringify({ contract: RUOS_CONTRACT, schemaVersion: 1, observedAt: iso(NOW - 1000), truncated: false, runs, ...over })
const observation = (over: Record<string, unknown> = {}) => parseRuos(raw([rawRun(over)]))!
afterEach(() => vi.useRealTimers())

describe('ruOS observation parsing', () => {
  it('reads only bounded public facts and never carries arbitrary output, secrets or approval claims', () => {
    const parsed = observation({ stdout: 'private output', apiKey: 'private value', approval: { allow: true } })
    expect(parsed.runs[0]).toMatchObject({ runId: 'run-1', revision: 4, nextOffset: 17, binding: { missionId: 'm1', commit: 'a'.repeat(40) } })
    expect(JSON.stringify(parsed)).not.toMatch(/private|approval|apiKey/)
    expect(ruosRows(parsed, '/work/project', NOW)[0]?.signals.approval).toBe(false)
  })

  it('rejects foreign, oversized, malformed and non-object observations', () => {
    for (const text of [null, '{}', '[]', 'broken', raw([], { contract: 'other' }), raw([], { schemaVersion: 2 }), ' '.repeat(RUOS_MAX_BYTES + 1)]) expect(parseRuos(text)).toBeNull()
  })

  it('does not guess identity, counters, backend or a duplicate id', () => {
    for (const over of [{ runId: '../other' }, { agentId: '' }, { desktopId: 'bad\nname' }, { revision: -1 }, { revision: 1.5 }, { nextOffset: Number.MAX_SAFE_INTEGER + 1 }, { jobs: 'shell' }, { jobId: 'x; rm' }]) expect(observation(over).runs).toEqual([])
    expect(parseRuos(raw([rawRun(), rawRun()]))?.runs).toEqual([])
    expect(parseRuos(raw(Array.from({ length: 51 }, (_, i) => rawRun({ runId: `r${i}` }))))).toMatchObject({ isTruncated: true, runs: expect.any(Array) })
    expect(parseRuos(raw(Array.from({ length: 51 }, (_, i) => rawRun({ runId: `r${i}` }))))?.runs).toHaveLength(50)
  })

  it('sanitizes presentation and drops forged source identities', () => {
    const parsed = observation({ state: 'invented', binding: { missionId: 'x;y', commit: 'main', sourceDigest: 'fake', worktree: '\u001b[31m/work/\u202eproject' } })
    expect(parsed.runs[0]).toMatchObject({ state: 'unknown', binding: { worktree: '/work/project' } })
    expect(parsed.runs[0]?.binding?.commit).toBeUndefined()
    expect(parsed.runs[0]?.binding?.sourceDigest).toBeUndefined()
  })

  it('refuses symlink observations before reading content', async () => {
    const read = vi.fn(async (_path: string) => raw())
    const fs: ReaderFs = { stat: async path => path.endsWith('/ruos/observation.json') ? { kind: 'file', isLink: true, size: 100, mtimeMs: NOW } : undefined, list: async () => [], read }
    const disk = await readDisk(fs, new Map(), '/work', null, null, false)
    expect(disk.project.ruos).toMatchObject({ text: null, reason: 'not-regular' })
    expect(read.mock.calls.some(args => args[0]?.endsWith('/ruos/observation.json'))).toBe(false)
  })
})

describe('connection state and attention', () => {
  it('accepts the producer healthy connection and stopping state without inventing a failure or completion', () => {
    for (const state of ['starting', 'running', 'stopping']) {
      const obs = observation({ state, connection: 'healthy' })
      expect(obs.runs[0]).toMatchObject({ state, connection: 'healthy' })
      expect(reconcileReason(obs.runs[0]!, obs, NOW)).toBeNull()
      const rows = ruosRows(obs, '/work/project', NOW)
      expect(rows[0]).toMatchObject({ status: 'working', signals: { failed: false, turnEndedAtMs: null } })
      expect(attentionOf(rows, { baselineMs: NOW - 100_000, seen: {} }, null)).toEqual([])
    }
    const disconnected = observation({ state: 'stopping', connection: 'disconnected' })
    expect(ruosRows(disconnected, '/work/project', NOW)[0]?.status).toBe('unknown')
    expect(disconnected.runs[0]?.state).toBe('stopping')
  })

  it('shows a disconnected running job as unknown with reconciliation, never failed or done', () => {
    const obs = observation({ connection: 'disconnected' })
    const rows = ruosRows(obs, '/work/project', NOW)
    expect(obs.runs[0]?.state).toBe('running')
    expect(rows[0]).toMatchObject({ status: 'unknown', signals: { failed: false, turnEndedAtMs: null }, mission: 'm1', worktree: 'task-1' })
    const items = attentionOf(rows, { baselineMs: NOW - 100_000, seen: {} }, null)
    expect(items.map(item => item.kind)).toEqual(['reconcile'])
    expect(items[0]?.detail).toContain('may still be running')
    expect(countsOf(items)).toMatchObject({ reconcile: 1, failed: 0, 'needs-approval': 0 })
    expect(attentionOf(rows, markViewed({ baselineMs: NOW - 100_000, seen: {} }, items), null)).toEqual(items)
  })

  it('keeps known terminal evidence when the transport later disconnects', () => {
    const rows = ruosRows(observation({ state: 'completed', connection: 'disconnected', exitCode: 0 }), '/work/project', NOW)
    expect(rows[0]).toMatchObject({ status: 'done', signals: { failed: false } })
    expect(rows[0]?.signals.reconcile).toBeUndefined()
  })

  it('missing or stale observations do not acquire freshness from the frame clock', () => {
    for (const over of [{ updatedAt: null }, { updatedAt: iso(NOW + 120_000) }, { updatedAt: iso(NOW - RUOS_STALE_MS - 1) }, { connection: 'unknown' }, { jobId: null }]) {
      const obs = observation(over)
      expect(reconcileReason(obs.runs[0]!, obs, NOW)).not.toBeNull()
    }
    const obs = observation()
    expect(reconcileReason(obs.runs[0]!, obs, NOW)).toBeNull()
    expect(reconcileReason(obs.runs[0]!, obs, NOW + RUOS_STALE_MS + 1)).toContain('stale')
    expect(obs.observedAtMs).toBe(NOW - 1000)
  })

  it('reconnecting clears reconciliation without creating a new session identity', () => {
    const before = ruosRows(observation({ connection: 'disconnected' }), '/work/project', NOW)
    const after = ruosRows(observation({ revision: 5, nextOffset: 18 }), '/work/project', NOW)
    expect(before[0]?.key).toBe(after[0]?.key)
    expect(attentionOf(after, { baselineMs: 0, seen: {} }, null)).toEqual([])
    expect(after[0]?.status).toBe('working')
  })
})

describe('console and mod integration', () => {
  it('reads the actual RunStore producer through healthy, disconnected and completed states with the same job and cursor', async () => {
    // The producer is plain JavaScript in a sibling plugin. Resolve it at runtime to test its actual emitted bytes.
    const source = '../../ruflo-ruos/scripts/lib/run-store.mjs'
    const { RunStore } = await import(source)
    const cwd = mkdtempSync(join(tmpdir(), 'ruflo-console-contract-'))
    let now = NOW
    try {
      const store = new RunStore(cwd, () => new Date(now))
      const runId = 'r-console-contract-001'
      const desktopId = 'd'.repeat(32)
      const binding = { missionId: `msn_${'a'.repeat(24)}`, missionRevision: 2, worktree: '/work/project/.worktrees/task-1', commit: 'b'.repeat(40), sourceDigest: `sha256:${'c'.repeat(64)}` }
      store.reserve({ runId, agentId: 'coder-1', agentType: 'coder', desktopId, jobs: 'jobs-api', transport: 'fleet-mcp', jobId: 'server_job_7', state: 'running', connection: 'healthy', startedAt: iso(now), commandSha256: 'e'.repeat(64), exitCode: null, timeoutSecs: 60, stopAt: null, binding })
      const read = () => parseRuos(readFileSync(join(cwd, '.claude-flow/ruos/observation.json'), 'utf8'))!
      let observed = read()
      expect(observed.runs[0]).toMatchObject({ runId, desktopId, jobId: 'server_job_7', state: 'running', connection: 'healthy', revision: 1, nextOffset: 0, binding })
      expect(reconcileReason(observed.runs[0]!, observed, now)).toBeNull()
      const identity = ruosRows(observed, cwd, now)[0]!.key

      now += 1000
      store.checkpoint(runId, { expectedOffset: 0, nextOffset: 6, chunk: Buffer.from('hello ') })
      store.update(runId, { connection: 'disconnected' })
      observed = read()
      expect(observed.runs[0]).toMatchObject({ runId, jobId: 'server_job_7', state: 'running', connection: 'disconnected', revision: 3, nextOffset: 6 })
      expect(ruosRows(observed, cwd, now)[0]!.key).toBe(identity)
      expect(attentionOf(ruosRows(observed, cwd, now), { baselineMs: NOW - 1, seen: {} }, null).map(item => item.kind)).toEqual(['reconcile'])
      expect(JSON.stringify(observed)).not.toContain('hello ')

      now += 1000
      store.update(runId, { state: 'completed', connection: 'healthy', exitCode: 0 })
      observed = read()
      expect(observed.runs[0]).toMatchObject({ runId, jobId: 'server_job_7', state: 'completed', connection: 'healthy', revision: 4, nextOffset: 6, exitCode: 0 })
      const complete = ruosRows(observed, cwd, now)
      expect(complete[0]).toMatchObject({ key: identity, status: 'done' })
      expect(attentionOf(complete, { baselineMs: NOW - 1, seen: {} }, null).map(item => item.kind)).toEqual(['completed-unread'])
    } finally {
      rmSync(cwd, { recursive: true, force: true })
    }
  })

  it('surfaces remote work beside session-bound missions without starting any process', async () => {
    vi.useFakeTimers({ now: NOW })
    const w = world({ disk: {} })
    w.state.snapshot!.ruos = observation({ connection: 'disconnected' })
    await scanSessions(w.state, w.host, true, NOW)
    expect(queueOf(w.state).some(item => item.kind === 'reconcile')).toBe(true)
    expect(workspaceOf(w.state).index?.rows.some(row => row.key === 'ruflo:ruflo:mission-m1')).toBe(true)
    expect(workspaceOf(w.state).index?.rows.some(row => row.key === 'ruflo:ruos:run-run-1')).toBe(true)
    selectRow(w.state, 'ruflo:ruos:run-run-1')
    expect(drawn(w.state, w.host)).toContain('remote process may still be running')
    expect(w.spawned).toEqual([])
    const lines: string[] = []
    remoteRunRows(ctxOf(w.state, w.host, { columns: 50 })).forEach(element => linesOf(element, lines))
    expect(lines.join('\n')).toContain('Remote runs')
    expect(lines.join('\n')).toContain('recorded running')
  })

  it('prepares a visible attach draft with exact observed identity and never submits or launches', async () => {
    vi.useFakeTimers({ now: NOW })
    const w = world({ disk: {} })
    w.state.snapshot!.ruos = observation({ connection: 'disconnected' })
    await scanSessions(w.state, w.host, true, NOW)
    const fillPrompt = vi.fn(async (_text: string) => true)
    sessionActions(w.state, { ...w.host, fillPrompt }).prepareRemote('ruflo:ruos:run-run-1')
    await Promise.resolve()
    expect(fillPrompt).toHaveBeenCalledOnce()
    expect(fillPrompt.mock.calls[0]?.[0]).toContain('run-1 on desktop desktop-1 at observed revision 4')
    expect(fillPrompt.mock.calls[0]?.[0]).toContain('Do not launch a replacement')
    expect(w.spawned).toEqual([])
    w.state.isStandalone = true
    sessionActions(w.state, { ...w.host, fillPrompt }).prepareRemote('ruflo:ruos:run-run-1')
    expect(fillPrompt).toHaveBeenCalledOnce()
  })

  it('the mod displays optional reconciliation counts as advisory, preserving older summaries', () => {
    const summary = (reconcile?: unknown) => JSON.stringify({ schema: 'ruflo-console.attention/1', approve: 0, question: 0, failed: 0, unread: 0, atMs: NOW, ...(reconcile === undefined ? {} : { reconcile }) })
    expect(attentionLine(summary(), NOW)).not.toContain('to reconcile')
    expect(attentionLine(summary(2), NOW)).toContain('2 remote runs to reconcile · 0 failed')
    expect(attentionLine(summary(2), NOW)).toContain('unauthenticated')
    expect(attentionLine(summary('yes'), NOW)).toBeUndefined()
  })
})
