/**
 * The session workspace's pass and its edges (ADR-486 §2.3, §2.4, §2.6): a refusal matched by its structure, a future baseline, a repaired
 * viewed store written back, a read capped at what the pass has left, no starvation under churn, one budget for every adapter, a failed
 * summary write that backs off, and a crowded Who-is-here that keeps the person's main session and busy agents.
 *   npx vitest run plugins/ruflo-console/tests/sessions-pass.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { claudeAdapter, claudeRow, summarizeClaude } from '../hooks/data/harness-claude'
import { codexAdapter } from '../hooks/data/harness-codex'
import { PASS_BYTES, passBudget } from '../hooks/data/harness-track'
import { attentionOf, viewedOf } from '../hooks/data/sessions-attention'
import type { SessionFs } from '../hooks/data/harness'
import type { Host } from '../hooks/host'
import * as sessions from '../hooks/sessions'
import { lanesOf } from '../hooks/views/frames'
import { viewText } from '../hooks/views/pane'
import { CLAUDE, CODEX, fsOn, newDisk, NOW, uuid, type Disk } from './fixtures/sessions-fs'
import { ctxOf, world } from './fixtures/sessions-world'

const id = uuid(1)
const iso = (ms: number) => new Date(ms).toISOString()
const line = (o: Record<string, unknown>) => JSON.stringify({ sessionId: id, cwd: '/w/p', ...o })
const use = (at: number, tid: string) => line({ type: 'assistant', timestamp: iso(at), message: { content: [{ type: 'tool_use', id: tid, name: 'Bash', input: { command: 'npm test' } }] } })
const result = (at: number, tid: string, content: string) => line({ type: 'user', timestamp: iso(at), message: { content: [{ type: 'tool_result', tool_use_id: tid, is_error: true, content }] } })
const claude = (text: string, mtimeMs: number, nowMs = NOW) => claudeRow({ path: 'p', nativeId: id, folder: 'f', size: text.length, mtimeMs }, { value: summarizeClaude(text, id), noPreview: null, stale: null }, '/h/.claude', nowMs)

const REFUSED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."

/** Counts every byte the host hands back, by read and by tail read. */
function counted(fs: SessionFs): { fs: SessionFs; bytes: () => number; reset: () => void; perPath: Map<string, number> } {
  let bytes = 0
  const perPath = new Map<string, number>()
  const note = (path: string, text: string) => {
    bytes += text.length
    perPath.set(path, (perPath.get(path) ?? 0) + 1)

    return text
  }
  const out: SessionFs = { ...fs, read: async path => note(path, await fs.read(path)) }

  if (fs.readTail !== undefined) {
    const tail = fs.readTail

    out.readTail = async (path, n) => note(path, await tail(path, n))
  }

  return { fs: out, bytes: () => bytes, reset: () => (bytes = 0), perPath }
}

const bigClaude = (n: number, size: number, at: number) => {
  const parts: string[] = []
  let used = 0

  for (let i = 0; used < size; i += 1) {
    const text = JSON.stringify({ type: 'assistant', sessionId: uuid(n), timestamp: iso(at), message: { content: [{ type: 'text', text: `${'y'.repeat(900)}${i}` }] } })

    parts.push(text)
    used += text.length + 1
  }

  return `${parts.join('\n')}\n`
}

describe('a refusal is matched by its structure, not a prefix', () => {
  it('still raises a genuine error whose text merely begins with the refusal words; the exact refusal shapes raise nothing', () => {
    const quoting = `The user doesn't want to proceed with this tool use — AssertionError: expected the dialog to close\n    at refusal.spec.ts:12:5`
    const genuine = claude([use(NOW - 120_000, 't'), result(NOW - 119_000, 't', quoting)].join('\n'), NOW - 119_000)

    expect(genuine.status).toBe('failed')
    expect(attentionOf([genuine], { baselineMs: 0, seen: {} }, null).map(item => item.kind)).toEqual(['failed'])

    for (const body of [`${REFUSED} STOP what you are doing and wait for the user to tell you how to proceed.`, `${REFUSED} STOP what you are doing and wait for the user to tell you how to proceed.\n\nNote: The user's next message may contain a correction.`, `${REFUSED} To tell you how to proceed, the user said:\nuse the other file`]) {
      expect(claude([use(NOW - 120_000, 'r'), result(NOW - 119_000, 'r', body)].join('\n'), NOW - 119_000).status).not.toBe('failed')
    }
  })
})

describe('the viewed store', () => {
  it('holds a future baseline to now, so later completions are not treated as history', () => {
    // Loaded five seconds ago, with a baseline a month ahead of the clock.
    const viewed = viewedOf({ baselineMs: NOW + 30 * 86_400_000, seen: {} }, NOW - 5000)

    expect(viewed.baselineMs).toBe(NOW - 5000)

    const done = claude([line({ type: 'assistant', timestamp: iso(NOW - 2000), message: { content: [{ type: 'text', text: 'ok' }] } }), line({ type: 'system', subtype: 'turn_duration', timestamp: iso(NOW - 1000) })].join('\n'), NOW - 1000)

    expect(attentionOf([done], viewed, null).map(item => item.kind)).toEqual(['completed-unread'])
  })

  it('writes the repaired value back once when the stored one held a future stamp or baseline, and not when it was clean', async () => {
    const load = (sessions as unknown as { loadViewed?: (state: unknown, host: unknown, nowMs: number) => Promise<void> }).loadViewed

    expect(typeof load).toBe('function')

    for (const [raw, writes] of [
      [{ baselineMs: NOW - 1000, seen: { 'a|failed': 8e15, 'b|failed': NOW - 5 } }, 1],
      [{ baselineMs: NOW + 86_400_000, seen: {} }, 1],
      [{ baselineMs: NOW - 1000, seen: { 'b|failed': NOW - 5 } }, 0],
    ] as const) {
      const w = world()
      const sets: unknown[] = []
      const host = { storeGet: async () => raw, storeSet: async (_key: string, value: unknown) => void sets.push(value) }

      await load!(w.state, host, NOW)
      expect(sets).toHaveLength(writes)
      if (writes === 1) expect(sets[0]).toEqual(sessions.workspaceOf(w.state).viewed)
    }
  })
})

describe('the pass read budget (ADR-486 §2.4)', () => {
  const grown = (tail: boolean) => {
    const disk = newDisk()

    // Stat says 1 MB; by the time each is read it holds 3 MB.
    for (let n = 1; n <= 8; n += 1) disk.files.set(`${CLAUDE}/projects/p${n}/${uuid(n)}.jsonl`, { content: bigClaude(n, 3_000_000, NOW - 1000), mtimeMs: NOW - 1000 - n, size: 1_000_000 })

    return counted(fsOn(disk, tail))
  }

  it('caps a read at what the pass has left when files grew between stat and read', async () => {
    const bounded = grown(true)

    await claudeAdapter().scan({ fs: bounded.fs, claudeDir: CLAUDE, codexDir: null, nowMs: NOW, full: true })
    expect(bounded.bytes()).toBeLessThanOrEqual(PASS_BYTES)

    // A host without a bounded read: one file's growth at most, never every file in flight at once.
    const whole = grown(false)

    await claudeAdapter().scan({ fs: whole.fs, claudeDir: CLAUDE, codexDir: null, nowMs: NOW, full: true })
    expect(whole.bytes()).toBeLessThanOrEqual(PASS_BYTES + 3_000_000)
  })

  it('reads every changed file within a few passes when more change than fit, instead of starving the oldest', async () => {
    const disk = newDisk()
    const paths: string[] = []

    for (let n = 1; n <= 7; n += 1) {
      const path = `${CLAUDE}/projects/p${n}/${uuid(n)}.jsonl`

      paths.push(path)
      disk.files.set(path, { content: bigClaude(n, 1_900_000, NOW - 1000), mtimeMs: NOW - 1000 - n })
    }

    const io = counted(fsOn(disk, false))
    const adapter = claudeAdapter()

    for (let pass = 0; pass < 4; pass += 1) {
      // Every file changes before every pass.
      for (const [n, path] of paths.entries()) {
        const file = disk.files.get(path)!

        file.content += `${JSON.stringify({ type: 'assistant', sessionId: uuid(n + 1), timestamp: iso(NOW), message: { content: [{ type: 'text', text: `pass ${pass}` }] } })}\n`
        file.mtimeMs += 1000
      }

      io.reset()
      await adapter.scan({ fs: io.fs, claudeDir: CLAUDE, codexDir: null, nowMs: NOW + pass * 1000, full: pass === 0 })
      expect(io.bytes()).toBeLessThanOrEqual(PASS_BYTES)
    }

    expect(paths.filter(path => (io.perPath.get(path) ?? 0) >= 2)).toHaveLength(7)
  })

  it('spends one budget across every adapter in a workspace pass', async () => {
    const disk: Disk = newDisk()

    for (let n = 1; n <= 5; n += 1) {
      disk.files.set(`${CLAUDE}/projects/p${n}/${uuid(n)}.jsonl`, { content: bigClaude(n, 1_900_000, NOW - 1000), mtimeMs: NOW - 1000 - n })

      const rec = (type: string, payload: Record<string, unknown>) => JSON.stringify({ timestamp: iso(NOW - 2000), type, payload })
      const parts = [rec('session_meta', { id: uuid(50 + n), cwd: '/work/repo-a' })]
      let used = 0

      while (used < 1_900_000) {
        const text = rec('event_msg', { type: 'task_complete', last_agent_message: 'z'.repeat(900) })

        parts.push(text)
        used += text.length + 1
      }

      disk.files.set(`${CODEX}/sessions/2026/10/09/rollout-2026-10-09T10-00-00-${uuid(50 + n)}.jsonl`, { content: `${parts.join('\n')}\n`, mtimeMs: NOW - 1000 - n })
    }

    const w = world({ disk, tokens: {} })
    const io = counted(w.host.fs as SessionFs)
    const host = { ...w.host, fs: io.fs } as unknown as Host

    await sessions.scanSessions(w.state, host, true, NOW)
    expect(io.bytes()).toBeLessThanOrEqual(PASS_BYTES)
    expect(sessions.workspaceOf(w.state).index!.rows.filter(row => row.harness !== 'ruflo')).toHaveLength(10)
  })
})

describe('the shared budget under concurrent adapters', () => {
  it('lets at most one file’s growth overrun the pass, whichever adapters are reading at once', async () => {
    const disk = newDisk()
    const GROWN = 4_000_000

    // Each stat-ed at 1 byte; each holds 4 MB by the time it is read.
    disk.files.set(`${CLAUDE}/projects/p1/${uuid(1)}.jsonl`, { content: bigClaude(1, GROWN, NOW - 1000).slice(0, GROWN), mtimeMs: NOW - 1000, size: 1 })
    disk.files.set(`${CODEX}/sessions/2026/10/09/rollout-2026-10-09T10-00-00-${uuid(2)}.jsonl`, { content: 'x'.repeat(GROWN), mtimeMs: NOW - 1000, size: 1 })

    // A read takes real time, as a disk does, so both adapters are mid-read together.
    const slow = fsOn(disk, false)
    const read = slow.read

    slow.read = async path => (await new Promise(resolve => setTimeout(resolve, 20)), read(path))

    const io = counted(slow)
    const budget = passBudget()

    // 11 MB of this pass is already spent.
    budget.left = 1_000_000

    const env = { fs: io.fs, claudeDir: CLAUDE, codexDir: CODEX, nowMs: NOW, full: true, budget }

    await Promise.all([claudeAdapter().scan(env), codexAdapter().scan(env)])
    expect(io.bytes()).toBeLessThanOrEqual(1_000_000 + GROWN)
  })

  it('reads a file that was never read within a bounded number of passes, however many newer files keep arriving', async () => {
    const disk = newDisk()
    const adapter = claudeAdapter()
    const io = counted(fsOn(disk, false))
    let n = 0
    let oldest = ''

    for (let pass = 0; pass < 3; pass += 1) {
      // Seven new 1.9 MB sessions per pass, each batch newer than the last: only six fit a pass.
      for (let k = 0; k < 7; k += 1) {
        n += 1

        const path = `${CLAUDE}/projects/p${n}/${uuid(n)}.jsonl`

        if (n === 1) oldest = path
        disk.files.set(path, { content: bigClaude(n, 1_900_000, NOW - 1000), mtimeMs: NOW - 100_000 + pass * 10_000 + k })
      }

      await adapter.scan({ fs: io.fs, claudeDir: CLAUDE, codexDir: null, nowMs: NOW, full: true })
    }

    expect(io.perPath.get(oldest) ?? 0).toBeGreaterThanOrEqual(1)
  })
})

describe('the ruflo-mods summary write', () => {
  it('backs off after a failed write: 30 s, then doubling, instead of retrying every tick', async () => {
    const w = world()
    const writes: number[] = []
    let at = NOW
    const host = { ...w.host, run: async (_argv: readonly string[], _t: number, stdin = '') => (stdin.includes('ruflo-console.attention') && writes.push(at), { exitCode: 1, stdout: '', stderr: 'disk full', isStdoutTruncated: false, isStderrTruncated: false }) } as unknown as Host

    await sessions.scanSessions(w.state, host, true, NOW)
    ;(w.state.snapshot as unknown as { isRufloProject: boolean }).isRufloProject = true

    for (const offset of [0, 1000, 2000, 3000, 31_000, 62_000, 92_000]) {
      at = NOW + offset
      await sessions.mirrorAttention(w.state, host, at)
    }

    expect(writes.map(when => when - NOW)).toEqual([0, 31_000, 92_000])
  })
})

describe('a crowded Who is here', () => {
  it('keeps the person’s main session and busy agents in the rows shown, and says how many more there are', () => {
    const w = world()
    const DAY = 86_400_000

    for (let i = 0; i < 6; i += 1) w.state.toolsByAgent.set(`subagent-${i}-abcdef`, [{ atMs: NOW - 60_000, tool: 'Read' }])
    w.state.toolsByAgent.set('main', [{ atMs: NOW - 1000, tool: 'Edit' }])

    const agents = [...Array.from({ length: 10 }, (_, i) => ({ id: `idle-${i}`, type: 'coder', name: `idle-${i}`, status: 'idle', createdAtMs: NOW - 3_600_000 })), { id: 'hot', type: 'tester', name: 'hot-agent', status: 'busy', createdAtMs: NOW - 20 * DAY }]

    w.state.snapshot = { ...(w.state.snapshot as object), agents } as unknown as typeof w.state.snapshot

    const shown = lanesOf(w.state, NOW).slice(0, 8).map(lane => lane.label)

    expect(shown[0]).toBe('claude (main)')
    expect(shown).toContain('hot-agent')

    const room = viewText({ state: w.state, nowMs: NOW, columns: 120, act: ctxOf(w.state, w.host).act }, 'room')

    expect(room).toContain('claude (main)')
    expect(room).toContain('hot-agent')
    expect(room.split('Who is here')[1]).toMatch(/\+\d+ more/)
  })
})
