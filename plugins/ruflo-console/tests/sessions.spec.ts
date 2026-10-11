/**
 * The session workspace (ADR-486), against a synthetic machine of 20 mixed sessions (tests/fixtures/sessions-fs.ts): what each adapter finds
 * and refuses, identity and the unassigned bucket, the attention queue, "read means viewed", and that a selection only ever shows its own session.
 *   npx vitest run plugins/ruflo-console/tests/sessions.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { attentionOf, markViewed } from '../hooks/data/sessions-attention'
import { rowOf } from '../hooks/data/sessions-index'
import { commitViewed, queueOf, scanSessions, selectRow, sessionActions, workspaceOf } from '../hooks/sessions'
import type { State } from '../hooks/state'
import { CLAUDE, newDisk, NOW, uuid } from './fixtures/sessions-fs'
import { drawn, mission, world } from './fixtures/sessions-world'

describe('discovery and identity', () => {
  it('finds each adapter’s sessions, puts the ambiguous ones in the unassigned bucket and never reads a link', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const index = workspaceOf(w.state).index!
    const by = (id: string) => index.rows.filter(row => row.harness === id)

    expect(by('claude').length).toBe(14)
    expect(by('codex').length).toBe(3)
    expect(by('ruflo').length).toBe(3)
    expect(index.rows.length).toBe(20)
    expect(index.unassigned).toBe(3)
    expect(index.groups.at(-1)?.unassigned).toBe(true)
    expect(index.groups.at(-1)?.rows.map(row => row.nativeId).sort()).toEqual([uuid(9), uuid(9), uuid(10)].sort())
    // The duplicated id yields two rows with two different keys: selecting one can never select the other.
    expect(new Set(index.rows.map(row => row.key)).size).toBe(index.rows.length)
    // A link is a row with no content; a linked project folder is not entered at all.
    expect(rowOf(index, `claude:${CLAUDE}:${uuid(12)}`)).toMatchObject({ preview: null, noPreview: 'not a regular file' })
    expect(w.disk.reads.some(path => path.includes(uuid(12)) || path.includes('-linked'))).toBe(false)
    expect(index.rows.some(row => row.folder === '-linked')).toBe(false)
  })

  it('groups by repository and worktree from the recorded path alone, and by mission for ruflo’s own', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const labels = workspaceOf(w.state).index!.groups.map(group => group.label)

    expect(labels).toContain('/work/repo-a')
    expect(labels).toContain('/work/repo-a › feat-x')
    expect(rowOf(workspaceOf(w.state).index!, 'ruflo:ruflo:mission-m1')).toMatchObject({ mission: 'm1', external: false })
  })

  it('marks sessions Ruflo did not start as outside, and only those the console holds as its own', async () => {
    const w = world()

    w.state.terminal.sessions = { claude: uuid(1) }
    await scanSessions(w.state, w.host, true, NOW)

    const index = workspaceOf(w.state).index!

    expect(rowOf(index, `claude:${CLAUDE}:${uuid(1)}`)?.external).toBe(false)
    expect(rowOf(index, `claude:${CLAUDE}:${uuid(2)}`)?.external).toBe(true)
  })

  it('declares only what was verified, and says why not for the rest', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const caps = Object.fromEntries(workspaceOf(w.state).index!.reports.map(report => [report.id, report.capabilities]))

    for (const id of ['claude', 'codex']) {
      expect(caps[id]).toMatchObject({ discovery: { supported: true }, preview: { supported: true }, approvals: { supported: false }, resume: { supported: false }, fork: { supported: false }, messaging: { supported: false }, stop: { supported: false } })
      expect(caps[id]!.approvals.why.length).toBeGreaterThan(10)
    }

    expect(caps.ruflo).toMatchObject({ approvals: { supported: true }, resume: { supported: false } })
  })

  it('reports an adapter whose store is absent as not detected, and never throws', async () => {
    const empty = world({ disk: newDisk() })

    await scanSessions(empty.state, empty.host, true, NOW)

    const reports = workspaceOf(empty.state).index!.reports

    expect(reports.find(report => report.id === 'claude')?.state).toBe('not-detected')
    expect(reports.find(report => report.id === 'codex')?.state).toBe('not-detected')
  })
})

describe('the Room layout', () => {
  it('keeps the queue open and the Sessions list folded until a jump opens it', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    w.state.sections.delete('room/sessions')

    const closed = drawn(w.state, w.host)

    expect(closed).toContain('Needs you')
    expect(closed).toContain('Sessions')
    expect(closed).not.toContain('Claude Code:')
    sessionActions(w.state, w.host).jump(queueOf(w.state).find(item => item.rowKey !== null)!.id)
    expect(drawn(w.state, w.host)).toContain('Claude Code:')
  })
})

describe('the attention queue', () => {
  it('raises the four kinds in order, from sessions Ruflo did not start too, and nothing for an unassigned row', async () => {
    const w = world()

    w.state.pending = { label: 'create the mission', args: [], expect: 'x', askedAtMs: NOW - 4000 } as unknown as State['pending']
    await scanSessions(w.state, w.host, true, NOW)

    const queue = queueOf(w.state)
    const kinds = queue.map(item => item.kind)

    expect(kinds[0]).toBe('needs-approval')
    expect(queue.filter(item => item.kind === 'needs-approval').map(item => item.harness).sort()).toEqual(['console', 'ruflo'])
    expect(queue.find(item => item.kind === 'question')?.rowKey).toBe(`claude:${CLAUDE}:${uuid(3)}`)
    // Codex's aborted rollout was an Esc ("interrupted"): the person's choice, not a failure.
    expect(queue.filter(item => item.kind === 'failed').map(item => item.harness).sort()).toEqual(['claude', 'ruflo'])
    expect(queue.filter(item => item.kind === 'completed-unread').length).toBeGreaterThanOrEqual(4)
    expect(kinds).toEqual([...kinds].sort((a, b) => ['needs-approval', 'question', 'failed', 'completed-unread'].indexOf(a) - ['needs-approval', 'question', 'failed', 'completed-unread'].indexOf(b)))
    // No item names any of the three unassigned rows.
    const unassigned = new Set(workspaceOf(w.state).index!.rows.filter(row => row.unassigned !== null).map(row => row.key))

    expect(queue.some(item => item.rowKey !== null && unassigned.has(item.rowKey))).toBe(false)
  })

  it('treats completions older than the baseline as history, not unread', async () => {
    const w = world()

    workspaceOf(w.state).viewed = { baselineMs: NOW + 1, seen: {} }
    await scanSessions(w.state, w.host, true, NOW)
    expect(queueOf(w.state).some(item => item.kind === 'completed-unread')).toBe(false)
  })

  it('keeps an approval until the harness stops reporting it, however often it is looked at', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    selectRow(w.state, 'ruflo:ruflo:mission-m1')
    drawn(w.state, w.host)
    commitViewed(w.state, w.host, NOW)
    expect(queueOf(w.state).some(item => item.id === 'ruflo:ruflo:mission-m1|needs-approval')).toBe(true)
    // The harness reports it resolved: it goes.
    ;(w.state.snapshot as unknown as { missions: { missions: ReturnType<typeof mission>[] } }).missions.missions[0]!.state = 'running'
    await scanSessions(w.state, w.host, true, NOW)
    expect(queueOf(w.state).some(item => item.id === 'ruflo:ruflo:mission-m1|needs-approval')).toBe(false)
  })
})

describe('read means viewed', () => {
  const completedKey = `claude:${CLAUDE}:${uuid(1)}`
  const pendingFor = (w: ReturnType<typeof world>) => queueOf(w.state).some(item => item.rowKey === completedKey && item.kind === 'completed-unread')

  it('clears a completion only after its preview text was drawn, and persists the viewed state', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    expect(pendingFor(w)).toBe(true)
    // Selecting alone, or committing with nothing drawn, clears nothing.
    selectRow(w.state, completedKey)
    expect(commitViewed(w.state, w.host, NOW)).toBe(false)
    expect(pendingFor(w)).toBe(true)
    // A frame drew the excerpt: the commit clears it, and the store holds it.
    expect(drawn(w.state, w.host)).toContain('TOK1X')
    expect(commitViewed(w.state, w.host, NOW)).toBe(true)
    expect(pendingFor(w)).toBe(false)
    expect(JSON.stringify(w.stored.get('ruflo-console/sessions-viewed'))).toContain(completedKey)
    // Nothing else was cleared by it.
    expect(queueOf(w.state).some(item => item.kind === 'completed-unread')).toBe(true)
  })

  it('does not clear when the preview is off, drawn for a model, a placeholder, in another view, or in a hidden pane', async () => {
    const off = world()

    off.state.options.sessionPreview = false
    await scanSessions(off.state, off.host, true, NOW)
    selectRow(off.state, completedKey)
    expect(drawn(off.state, off.host)).not.toContain('done TOK1X')
    expect(commitViewed(off.state, off.host, NOW)).toBe(false)

    const textual = world()

    await scanSessions(textual.state, textual.host, true, NOW)
    selectRow(textual.state, completedKey)
    drawn(textual.state, textual.host, { text: true })
    expect(commitViewed(textual.state, textual.host, NOW)).toBe(false)

    // A row with no preview (the link) draws a placeholder, which is not content.
    const linked = world()

    await scanSessions(linked.state, linked.host, true, NOW)
    selectRow(linked.state, `claude:${CLAUDE}:${uuid(12)}`)
    expect(drawn(linked.state, linked.host)).toContain('No preview')
    expect(workspaceOf(linked.state).shown.size).toBe(0)

    const away = world()

    await scanSessions(away.state, away.host, true, NOW)
    selectRow(away.state, completedKey)
    drawn(away.state, away.host)
    away.state.view = 'swarm'
    expect(commitViewed(away.state, away.host, NOW)).toBe(false)
    away.state.view = 'room'
    away.state.pane.isShown = false
    expect(commitViewed(away.state, away.host, NOW)).toBe(false)
  })

  it('brings a cleared failure back only when the session moves on to something newer', () => {
    const row = { key: 'k', unassigned: null, stale: null, title: 't', harness: 'claude', status: 'failed', updatedMs: 100, signals: { question: false, approval: false, failed: true, turnEndedAtMs: null } } as unknown as Parameters<typeof attentionOf>[0][number]
    const first = attentionOf([row], { baselineMs: 0, seen: {} }, null)
    const viewed = markViewed({ baselineMs: 0, seen: {} }, first)

    expect(first).toHaveLength(1)
    expect(attentionOf([row], viewed, null)).toHaveLength(0)
    expect(attentionOf([{ ...row, updatedMs: 200 }], viewed, null)).toHaveLength(1)
  })
})

describe('a selection only ever shows its own session', () => {
  it('draws each row’s own words and none of the other rows’, for every row', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)

    const index = workspaceOf(w.state).index!
    const all = Object.values({ ...w.tokens, m1: 'TOKM1X', m2: 'TOKM2X' })
    let checked = 0

    for (const row of index.rows) {
      selectRow(w.state, row.key)

      const text = drawn(w.state, w.host)
      const preview = text.slice(text.indexOf('Preview'))
      const own = all.filter(token => (row.preview?.latest ?? '').includes(token) || row.title.includes(token) || (row.preview?.files ?? []).some(file => file.includes(token)))

      for (const token of all) if (!own.includes(token)) expect(preview, `${row.key} must not show ${token}`).not.toContain(token)
      if (row.unassigned !== null) for (const token of all) expect(preview).not.toContain(token)
      checked += 1
    }

    expect(checked).toBe(20)
  })

  it('draws the latest response, tool, edited files, test result and cost label of a session', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    selectRow(w.state, `claude:${CLAUDE}:${uuid(1)}`)

    const text = drawn(w.state, w.host)

    expect(text).toContain('done TOK1X')
    expect(text).toContain('files: /work/repo-a/src/a.ts')
    expect(text).toContain('tests: passed: Tests 12 passed (12)')
    expect(text).toContain('$1.25 reported')
    expect(text).toContain('started outside Ruflo')
    selectRow(w.state, `claude:${CLAUDE}:${uuid(5)}`)
    expect(drawn(w.state, w.host)).toContain('cost n/a')
  })

  it('shows the open action as unavailable, with the harness’s reason', async () => {
    const w = world()

    await scanSessions(w.state, w.host, true, NOW)
    selectRow(w.state, `claude:${CLAUDE}:${uuid(1)}`)
    expect(drawn(w.state, w.host)).toContain('open: unavailable (opening a session is a model turn')
    sessionActions(w.state, w.host).open(`claude:${CLAUDE}:${uuid(1)}`)
    expect(workspaceOf(w.state).note).toContain('open is unavailable for claude')
  })
})

