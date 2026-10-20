/**
 * Exports (ADR-474): events as markdown or JSONL, lane summaries as markdown or CSV. The path is checked (traversal, a link on the way,
 * an existing file, a bad extension), the text is masked, the size is capped, a CSV cell cannot be a formula, and the write is
 * one fixed argv behind the confirm card.
 */
import { describe, expect, it } from 'vitest'

import { eventsText, exportSpecFor, lanesText, MAX_EXPORT_BYTES, resolveTarget } from '../hooks/data/event-export'
import type { ConsoleEvent } from '../hooks/data/events'
import { newLaneStore, lanesIn, concurrency, loadRows } from '../hooks/data/timeline-model'
import { hostOn, newDisk } from './fixtures/activity-fs'

const T = Date.UTC(2026, 9, 7, 12)
const CWD = '/work/proj'
const ev = (text: string, atS = 0): ConsoleEvent => ({ kind: 'swarm', text, atMs: T + atS * 1000 })

describe('the target path', () => {
  it('a bare name goes under the exports folder; a relative path under the project', () => {
    expect(resolveTarget('run.md', CWD, ['md'])).toEqual({ ok: true, path: `${CWD}/.claude-flow/console/exports/run.md` })
    expect(resolveTarget('docs/run.jsonl', CWD, ['md', 'jsonl'])).toEqual({ ok: true, path: `${CWD}/docs/run.jsonl` })
  })

  it.each([
    ['../escape.md', 'with ..'],
    ['/etc/passwd.md', 'outside'],
    ['/work/other/x.md', 'outside'],
    ['~/x.md', 'expanded'],
    ['a\\b.md', 'backslash'],
    ['x.txt', 'end in'],
    ['x.csv', 'can be'],
    ['', 'give a file'],
    ['bad\nname.md', 'control'],
    ['a'.repeat(400) + '.md', '300'],
  ])('refuses %j', (input, why) => {
    const out = resolveTarget(input, CWD, ['md', 'jsonl'])

    expect(out.ok).toBe(false)
    expect(out.ok ? '' : out.why).toContain(why)
  })

  it('refuses an existing file, and a link in the way, before asking', async () => {
    const disk = newDisk({ [`${CWD}/taken.md`]: 'x' })

    expect(await exportSpecFor(hostOn(disk).fs, CWD, 'taken.md', 'x', 'x', ['md'])).toMatchObject({ ok: true })

    const placed = await exportSpecFor(hostOn(disk).fs, CWD, `${CWD}/taken.md`, 'x', 'x', ['md'])

    expect(placed.ok).toBe(false)
    expect(placed.ok ? '' : placed.why).toContain('already exists')

    disk.dirs.add(`${CWD}/.claude-flow`)
    disk.links.add(`${CWD}/.claude-flow`)

    const linked = await exportSpecFor(hostOn(disk).fs, CWD, 'new.md', 'x', 'x', ['md'])

    expect(linked.ok).toBe(false)
    expect(linked.ok ? '' : linked.why).toContain('link')
  })

  it('the spec is a fixed argv that fails rather than overwrite, with the text on stdin', async () => {
    const made = await exportSpecFor(hostOn(newDisk()).fs, CWD, 'out.md', 'hello', '3 events', ['md'])

    expect(made.ok).toBe(true)
    if (made.ok) {
      expect(made.spec.argv?.[0]).toBe('install')
      expect(made.spec.stdin).toBe('hello')
      expect(made.spec.declared).toBe('write')
    }

    const withDir = newDisk()

    withDir.dirs.add(`${CWD}/.claude-flow/console/exports`)

    const direct = await exportSpecFor(hostOn(withDir).fs, CWD, 'out.md', 'hello', 'x', ['md'])

    if (direct.ok) expect(direct.spec.argv).toContain('conv=excl')
  })
})

describe('the text', () => {
  it('masks secrets and paths in markdown and JSONL, and keeps the newest 2000', () => {
    const md = eventsText([ev('token=abcdef123456 at /home/bob/x')], 'md', 'q', T)
    const jsonl = eventsText([ev('Bearer abcdefghijklmnopqrstu failed')], 'jsonl', 'q', T)

    expect(md).not.toContain('abcdef123456')
    expect(md).not.toContain('bob')
    expect(jsonl).not.toContain('abcdefghijklmnopqrstu')
    expect(JSON.parse(jsonl.trim())).toMatchObject({ v: 1, level: 'bad' })
    expect(eventsText(Array.from({ length: 2500 }, (_, i) => ev(`e${i}`, i)), 'jsonl', 'q', T).trim().split('\n')).toHaveLength(2000)
  })

  it('a pipe in an event cannot break the markdown table, and the size is capped', () => {
    expect(eventsText([ev('a | b')], 'md', 'q', T)).toContain('a / b')
    expect(new TextEncoder().encode(eventsText(Array.from({ length: 2000 }, (_, i) => ev('x '.repeat(100) + i, i)), 'md', 'q', T)).length).toBeLessThanOrEqual(MAX_EXPORT_BYTES)
  })

  it('lane summaries: markdown with the concurrency figures, CSV with formulas defused', () => {
    const store = newLaneStore()

    loadRows(store, [{ k: 'span', lane: 'ruflo:1', group: 'ruflo', label: '=HYPERLINK("x")', fromMs: T, toMs: T + 60_000, busy: true }])

    const win = { fromMs: T - 60_000, toMs: T + 120_000 }
    const lanes = lanesIn(store, win, T + 120_000)
    const data = { lanes, concurrency: concurrency(lanes, win, store, 12), fromMs: win.fromMs, toMs: win.toMs, busiest: null }
    const csv = lanesText(data, 'csv', T)

    expect(csv.split('\n')[0]).toContain('busy_pct')
    expect(csv).toContain("'=HYPERLINK")
    expect(lanesText(data, 'md', T)).toContain('peak 1')
  })
})
