/**
 * The session workspace's safety and budgets (ADR-486): hostile and unreadable input, what never leaves the workspace, the 2 s and 100 ms budgets,
 * the adapters on their own, and the counts-only summary for ruflo-mods. The measured numbers are printed; the thresholds are the requirement's.
 *   npx vitest run plugins/ruflo-console/tests/sessions-safety.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { claudeAdapter } from '../hooks/data/harness-claude'
import { codexAdapter } from '../hooks/data/harness-codex'
import { LINE_CAP, scanRecords, shown } from '../hooks/data/harness-text'
import { rowOf } from '../hooks/data/sessions-index'
import type { Host } from '../hooks/host'
import { mirrorAttention, queueOf, scanSessions, selectRow, workspaceOf } from '../hooks/sessions'
import { viewText } from '../hooks/views/pane'
import { addClaude, CLAUDE, CODEX, fsOn, newDisk, NOW, uuid } from './fixtures/sessions-fs'
import { ctxOf, drawn, world } from './fixtures/sessions-world'

describe('hostile and unreadable input', () => {
  it('bounds a 5 MB garbage transcript, strips escapes and bidi, and masks a credential', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const row = rowOf(workspaceOf(w.state).index!, `claude:${CLAUDE}:${uuid(11)}`)!
    // eslint-disable-next-line no-control-regex
    const control = /[\u0000-\u001f\u007f-\u009f‪-‮]/

    expect(row.preview).not.toBeNull()
    expect(row.preview!.latest.length).toBeLessThanOrEqual(600)
    expect(row.preview!.latest).toContain('TOK11X')
    expect(row.preview!.latest).not.toMatch(control)
    expect(row.preview!.latest).not.toContain('pwned')
    expect(row.preview!.latest).not.toContain('sk-ant-api03')
    expect(w.disk.tails.length).toBeGreaterThan(0)
    expect(w.disk.reads.some(path => path.includes(uuid(11)))).toBe(false)
  })

  it('on a host with no tail read, lists a large transcript without reading it and says why', async () => {
    const w = world({ tail: false })

    await scanSessions(w.state, w.host, true, NOW)

    const row = rowOf(workspaceOf(w.state).index!, `claude:${CLAUDE}:${uuid(11)}`)!

    expect(row.preview).toBeNull()
    expect(row.noPreview).toContain('larger than this host can read')
    expect(w.disk.reads.some(path => path.includes(uuid(11)))).toBe(false)
  })

  it('skips a line over the cap and a non-object line without parsing them, and stops at the line limit', () => {
    const seen: string[] = []
    const stats = scanRecords(`${'x'.repeat(LINE_CAP + 10)}\n[1,2]\n{"a":1}\nnot json\n{"b":2}`, record => seen.push(Object.keys(record)[0]!))

    expect(seen).toEqual(['a', 'b'])
    expect(stats).toMatchObject({ skipped: 1, bad: 2 })
    expect(scanRecords('{}\n'.repeat(60_000), () => undefined).lines).toBe(30_000)
  })

  it('has no backtracking on file text: a pathological line is handled in linear time', () => {
    const started = performance.now()

    shown(`${'a '.repeat(200_000)}‮${'\u001b['.repeat(50_000)}`, 600)
    scanRecords(`{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{"command":"${'vitest '.repeat(50_000)}"}}]}}`, () => undefined)
    expect(performance.now() - started).toBeLessThan(1500)
  })

  it('keeps the earlier rows, marked stale, when discovery or a read fails', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const before = workspaceOf(w.state).index!.rows.filter(row => row.harness === 'claude').length

    w.disk.failList.add(`${CLAUDE}/projects`)
    await scanSessions(w.state, w.host, true, NOW + 5000)

    const after = workspaceOf(w.state).index!

    expect(after.reports.find(report => report.id === 'claude')?.state).toBe('failed')
    expect(after.rows.filter(row => row.harness === 'claude')).toHaveLength(before)
    expect(after.rows.filter(row => row.harness === 'claude').every(row => row.stale !== null)).toBe(true)
    expect(drawn(w.state, w.host)).toContain('FAILED, showing the last read')

    // A single file whose read now fails keeps its summary.
    w.disk.failList.clear()

    const path = addClaude(w.disk, { n: 1, folder: '-work-repo-a', cwd: '/work/repo-a', token: 'TOK1X', end: 'completed', ageMs: 60_000, cost: 1.25 })

    w.disk.files.get(path)!.mtimeMs = NOW + 1000
    w.disk.failRead.add(path)
    await scanSessions(w.state, w.host, true, NOW + 9000)

    const kept = rowOf(workspaceOf(w.state).index!, `claude:${CLAUDE}:${uuid(1)}`)!

    expect(kept.stale).toContain('read failed')
    expect(kept.preview?.latest).toContain('TOK1X')
  })
})

describe('what never leaves the workspace', () => {
  it('draws no transcript text into a text answer a model may read', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    selectRow(w.state, `claude:${CLAUDE}:${uuid(1)}`)

    const answer = viewText({ state: w.state, nowMs: NOW, columns: 140, act: ctxOf(w.state, w.host).act }, 'room')

    expect(answer).toContain('transcript text is not included in text answers')
    for (const token of Object.values(w.tokens)) expect(answer).not.toContain(token)
  })

  it('keeps transcript text out of the console state that is snapshotted or exported', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const dump = JSON.stringify(w.state, (_key, value: unknown) => (value instanceof Map ? [...value] : value instanceof Set ? [...value] : typeof value === 'function' ? undefined : value))

    for (const token of Object.values(w.tokens)) expect(dump).not.toContain(token)
    expect([...w.stored.values()].map(value => JSON.stringify(value)).join('')).not.toContain('TOK')
  })

  it('starts no process and makes no model call while scanning', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    await scanSessions(w.state, w.host, false, NOW + 1000)
    expect(w.spawned).toEqual([])
  })

  it('draws nothing when the workspace is off, and no transcript when only the preview is off', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    w.state.options.sessionPreview = false
    selectRow(w.state, `claude:${CLAUDE}:${uuid(1)}`)
    expect(drawn(w.state, w.host)).not.toContain('done TOK1X')
    expect(drawn(w.state, w.host)).toContain('The preview is off')
    w.state.options.sessionWorkspace = false
    expect(drawn(w.state, w.host)).toBe('')
  })
})

describe('budgets', () => {
  it('surfaces a new approval-class change and a new completion within 2 s of its being written', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const before = queueOf(w.state).length
    // A session finishes: its file grows and its mtime moves.
    const path = addClaude(w.disk, { n: 77, folder: '-work-repo-a', cwd: '/work/repo-a', token: 'TOK77X', end: 'completed', ageMs: 500 })
    const started = performance.now()

    await scanSessions(w.state, w.host, false, NOW + 600)

    const scanMs = performance.now() - started

    expect(path).toContain(uuid(77))
    expect(queueOf(w.state).some(item => item.rowKey === `claude:${CLAUDE}:${uuid(77)}` && item.kind === 'completed-unread')).toBe(true)
    expect(queueOf(w.state).length).toBe(before + 1)
    // The watcher ticks every 1000 ms: the worst case is a full tick plus the pass itself.
    const worst = 1000 + scanMs

    console.log(`surfacing: pass ${scanMs.toFixed(1)} ms, worst case ${worst.toFixed(1)} ms (budget 2000)`)
    expect(worst).toBeLessThan(2000)
  })

  it('reads nothing again for an unchanged session', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const reads = w.disk.reads.length + w.disk.tails.length

    await scanSessions(w.state, w.host, false, NOW + 1000)
    expect(w.disk.reads.length + w.disk.tails.length).toBe(reads)
  })

  it('moves the selection through the whole list in under 100 ms p95', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const rows = workspaceOf(w.state).index!.rows
    const times: number[] = []

    for (let i = 0; i < 1500; i += 1) {
      const key = rows[i % rows.length]!.key
      const started = performance.now()

      selectRow(w.state, key)
      drawn(w.state, w.host)
      times.push(performance.now() - started)
    }

    times.sort((a, b) => a - b)

    const p95 = times[Math.floor(times.length * 0.95)]!

    console.log(`selection: p50 ${times[Math.floor(times.length / 2)]!.toFixed(2)} ms, p95 ${p95.toFixed(2)} ms, max ${times.at(-1)!.toFixed(2)} ms over ${times.length} selections of ${rows.length} rows (budget 100)`)
    expect(p95).toBeLessThan(100)
    // The keypress did no I/O: nothing was read after the scan.
    const reads = w.disk.reads.length

    selectRow(w.state, rows[0]!.key)
    drawn(w.state, w.host)
    expect(w.disk.reads.length).toBe(reads)
  })
})

describe('adapters on their own', () => {
  it('reads Codex rollouts by their verified events', async () => {
    const w = world()
    const result = await codexAdapter().scan({ fs: fsOn(w.disk), claudeDir: null, codexDir: CODEX, nowMs: NOW, full: true })

    expect(result.state).toBe('ok')
    // The aborted rollout was interrupted by the person (Esc): idle, not failed.
    expect(result.rows.map(row => row.status).sort()).toEqual(['done', 'idle', 'working'])
    expect(result.rows.find(row => row.status === 'idle')?.preview?.latest).toBe('turn aborted: interrupted')
  })

  it('reads a sub-agent rollout’s own identity, not the parent’s session_meta that follows it', async () => {
    const disk = newDisk()
    const rec = (type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: new Date(NOW - 5000).toISOString(), type, payload })

    disk.files.set(`${CODEX}/sessions/2026/10/09/rollout-2026-10-09T10-00-00-${uuid(31)}.jsonl`, { content: [rec('session_meta', { id: uuid(31), cwd: '/work/repo-a' }), rec('session_meta', { id: uuid(32), cwd: '/elsewhere' }), rec('event_msg', { type: 'task_complete', last_agent_message: 'TOK31X' })].join('\n') + '\n', mtimeMs: NOW - 5000 })

    const result = await codexAdapter().scan({ fs: fsOn(disk), claudeDir: null, codexDir: CODEX, nowMs: NOW, full: true })

    expect(result.rows[0]).toMatchObject({ unassigned: null, cwd: '/work/repo-a', status: 'done' })
  })

  it('finds a Claude session started after the first pass without a full relist', async () => {
    const w = world()
    const adapter = claudeAdapter()
    const env = { fs: fsOn(w.disk), claudeDir: CLAUDE, codexDir: null, nowMs: NOW }

    await adapter.scan({ ...env, full: true })
    addClaude(w.disk, { n: 88, folder: '-work-repo-b', cwd: '/work/repo-b', token: 'TOK88X', end: 'question', ageMs: 100 })

    const next = await adapter.scan({ ...env, full: false })

    expect(next.rows.find(row => row.nativeId === uuid(88))?.signals.question).toBe(true)
  })
})

describe('the summary for ruflo-mods', () => {
  it('writes four counts and a time, nothing from a transcript, only in a ruflo project and only when a count changes', async () => {
    const w = world()
    const writes: { argv: readonly string[]; stdin: string }[] = []
    const host = { ...w.host, run: async (argv: readonly string[], _t: number, stdin = '') => (writes.push({ argv, stdin }), { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false }) } as unknown as Host

    await scanSessions(w.state, host, true, NOW)
    ;(w.state.snapshot as unknown as { isRufloProject: boolean }).isRufloProject = false
    await mirrorAttention(w.state, host, NOW)
    expect(writes.filter(entry => entry.stdin.includes('ruflo-console.attention'))).toHaveLength(0)
    ;(w.state.snapshot as unknown as { isRufloProject: boolean }).isRufloProject = true
    await mirrorAttention(w.state, host, NOW)

    const mine = writes.filter(entry => entry.stdin.includes('ruflo-console.attention'))

    expect(mine).toHaveLength(1)
    expect(JSON.parse(mine[0]!.stdin)).toMatchObject({ schema: 'ruflo-console.attention/1', approve: 1, question: 1 })
    expect(mine[0]!.stdin).not.toContain('TOK')
    expect(mine[0]!.argv.join(' ')).toContain('.claude-flow/console/attention.json')
    await mirrorAttention(w.state, host, NOW + 5000)
    expect(writes.filter(entry => entry.stdin.includes('ruflo-console.attention'))).toHaveLength(1)
  })
})

