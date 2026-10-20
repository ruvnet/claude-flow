/**
 * The console's side of the toasts (ADR-477): the setting (store, mirror file, mute), what the other plugins leave under
 * .claude-flow/console/toasts/ and how it becomes Events, the console's own toasts reaching the log, and the mission notices that toast.
 * Run with
 *   npx vitest run plugins/ruflo-console/tests/toasts.spec.ts
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { activityOf, loadActivity, tick } from '../hooks/activity-live'
import { resetIo } from '../hooks/activity-io'
import type { Host } from '../hooks/host'
import { announceChanges, noticesBetween, TOASTED_KEYS, type Facts } from '../hooks/notices'
import { newState } from '../hooks/state'
import { encodePrefs, encodeRing, MASK, PREFS_FILE, TOAST_DIR, type Digest } from '../hooks/toast-policy'
import { eventOf, MAX_LOG, newSeen, prefsFromStore, pullToasts, recordToast, setToastMode, summaryOf, toggleToastMute, TOASTS_KEY } from '../hooks/toasts'
import { hostOn, newDisk, type Disk } from './fixtures/activity-fs'

const T = Date.UTC(2026, 9, 7, 12)
const CWD = '/work/proj'
const dg = (over: Partial<Digest> = {}): Digest => ({ t: T + 1000, source: 'mods', level: 'error', text: 'ruflo budget CRITICAL: $1.85 of $2.00', shown: true, why: 'shown', ...over })

/** A disk whose folder listing answers (the shared fixture lists nothing) and whose files carry a modification time. */
function diskHost(disk: Disk, mtimes: Map<string, number> = new Map()) {
  const base = hostOn(disk)

  return {
    ...base,
    fs: {
      ...base.fs,
      list: async (dir: string) => [...disk.files.keys()].filter(path => path.startsWith(`${dir}/`) && !path.slice(dir.length + 1).includes('/')).map(path => ({ name: path.slice(dir.length + 1), kind: 'file', mtimeMs: mtimes.get(path) ?? 1 })),
    },
  }
}

const ringPath = (source: string) => `${CWD}/${TOAST_DIR}/${source}.jsonl`
const consoleOn = (disk: Disk) => {
  const state = newState({})
  const stored = new Map<string, unknown>()

  state.cwd = CWD

  const host = { ...diskHost(disk), every: () => ({ cancel: () => undefined }), invalidate: () => undefined, storeSet: async (key: string, value: unknown) => void stored.set(key, value), storeGet: async (key: string) => stored.get(key) } as unknown as Host

  return { state, host, stored }
}

beforeEach(() => resetIo())

describe('the setting', () => {
  it('reads what the store held, and anything else is the default', () => {
    expect(prefsFromStore(encodePrefs({ mode: 'important', muted: ['swarm'] }))).toEqual({ mode: 'important', muted: ['swarm'] })
    for (const bad of [undefined, null, 5, {}, 'x', '{"mode":"loud"}']) expect(prefsFromStore(bad)).toEqual({ mode: 'all', muted: [] })
    expect(summaryOf({ mode: 'important', muted: ['swarm', 'mods'] })).toBe('important · muted: swarm, mods')
    expect(summaryOf({ mode: 'all', muted: [] })).toBe('all')
  })

  it('a change is held, saved to the store and mirrored to the file the other plugins read', async () => {
    const disk = newDisk()
    const { state, host, stored } = consoleOn(disk)

    setToastMode(state, host, 'important')
    toggleToastMute(state, host, 'swarm')
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(state.toastPrefs).toEqual({ mode: 'important', muted: ['swarm'] })
    expect(JSON.parse(String(stored.get(TOASTS_KEY)))).toEqual({ v: 1, mode: 'important', muted: ['swarm'] })
    expect(JSON.parse(disk.files.get(`${CWD}/${PREFS_FILE}`) as string)).toEqual({ v: 1, mode: 'important', muted: ['swarm'] })
    toggleToastMute(state, host, 'swarm')
    expect(state.toastPrefs.muted).toEqual([])
  })

  it('an unknown source or mode changes nothing', () => {
    const { state, host } = consoleOn(newDisk())

    toggleToastMute(state, host, 'evil')
    toggleToastMute(state, host, '../x')
    setToastMode(state, host, 'loud' as never)
    expect(state.toastPrefs).toEqual({ mode: 'all', muted: [] })
  })

  it('a failing store or disk never throws', async () => {
    const disk = newDisk()
    const { state, host } = consoleOn(disk)

    ;(host as unknown as { storeSet: () => Promise<void> }).storeSet = () => Promise.reject(new Error('no'))
    ;(host as unknown as { run: () => Promise<never> }).run = () => Promise.reject(new Error('no'))
    expect(() => setToastMode(state, host, 'off')).not.toThrow()
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(state.toastPrefs.mode).toBe('off')
  })
})

describe('digests become events', () => {
  it('an event names its source and glyph and says what became of a toast that did not draw', () => {
    expect(eventOf(dg())).toMatchObject({ kind: 'notices', src: 'toast', atMs: T + 1000, text: 'toast mods ✗ ruflo budget CRITICAL: $1.85 of $2.00' })
    expect(eventOf(dg({ why: 'muted', shown: false, n: 3 })).text).toContain('[muted] ×3')
    expect(eventOf(dg({ text: 'key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAA leaked' })).text).toContain(MASK)
  })

  it('only the other plugins\' ring files are read, only what is new, only since the console started, and each only when it changed', async () => {
    const disk = newDisk({
      [ringPath('mods')]: encodeRing([dg({ t: T - 5000, text: 'old, from a session before' }), dg({ text: 'budget' })]),
      [ringPath('swarm')]: encodeRing([dg({ source: 'swarm', level: 'warn', text: 'loop is stuck' })]),
      [ringPath('console')]: encodeRing([dg({ source: 'console', text: 'must not be read' })]),
      [`${CWD}/${TOAST_DIR}/notes.txt`]: 'not a ring',
    })
    const mtimes = new Map<string, number>()
    const seen = newSeen(T)

    const first = await pullToasts(diskHost(disk, mtimes), CWD, seen)

    expect(first.map(d => d.text)).toEqual(['budget', 'loop is stuck'])
    expect(await pullToasts(diskHost(disk, mtimes), CWD, seen)).toEqual([])

    disk.files.set(ringPath('mods'), (disk.files.get(ringPath('mods')) as string) + encodeRing([dg({ t: T + 2000, text: 'second' })]))
    mtimes.set(ringPath('mods'), 2)
    expect((await pullToasts(diskHost(disk, mtimes), CWD, seen)).map(d => d.text)).toEqual(['second'])
  })

  it('a file that claims another source, a hostile line and a missing folder are skipped without a throw', async () => {
    const disk = newDisk({ [ringPath('mods')]: encodeRing([dg({ source: 'swarm', text: 'impersonating' })]) + '{"v":1,"t":\n[[[\n' })

    expect(await pullToasts(diskHost(disk), CWD, newSeen(T))).toEqual([])
    expect(await pullToasts({ fs: { read: async () => '', stat: async () => undefined, list: async () => Promise.reject(new Error('gone')) } }, CWD, newSeen(T))).toEqual([])
  })

  it('the pass turns the console\'s own toasts and the others\' digests into events, written to the Events file (masked)', async () => {
    const disk = newDisk({ [ringPath('protector')]: encodeRing([dg({ source: 'protector', level: 'warn', why: 'muted', shown: false, text: 'Project Anatole noticed: PR-002' })]) })
    const { state, host } = consoleOn(disk)

    await loadActivity(state, host)
    activityOf(state).toast = newSeen(T)
    recordToast(state, dg({ source: 'console', level: 'warn', text: 'autopilot stopped: stopped by command', why: 'off', shown: false }))
    await tick(state, host, T + 60_000)

    const texts = activityOf(state).log.map(e => e.text)

    expect(texts).toContain('toast console ⚠ autopilot stopped: stopped by command [off]')
    expect(texts).toContain('toast protector ⚠ Project Anatole noticed: PR-002 [muted]')
    expect(state.toastLog).toEqual([])
  })

  it('the console\'s own log is bounded', () => {
    const { state } = consoleOn(newDisk())

    for (let i = 0; i < MAX_LOG + 50; i++) recordToast(state, dg({ text: `t${i}` }))
    expect(state.toastLog).toHaveLength(MAX_LOG)
    expect(state.toastLog.at(-1)?.text).toBe(`t${MAX_LOG + 49}`)
  })
})

describe('mission notices that toast', () => {
  const facts = (over: Partial<Facts> = {}): Facts => ({ approvals: 0, alerts: 0, mission: null, anatole: null, ...over })

  it('a task that fails mid-mission is a notice, once, for the same mission only', () => {
    const before = facts({ mission: { id: 'm1', done: 2, total: 5, failed: 0 } })

    expect(noticesBetween(before, facts({ mission: { id: 'm1', done: 2, total: 5, failed: 1 } }))).toEqual([{ level: 'bad', text: '🎯 mission task failed: 1 task failed, 2/5 done', key: 'mission-failed', go: 'missions' }])
    expect(noticesBetween(before, facts({ mission: { id: 'm2', done: 2, total: 5, failed: 1 } }))).toEqual([])
    expect(noticesBetween(facts({ mission: { id: 'm1', done: 2, total: 5, failed: 1 } }), facts({ mission: { id: 'm1', done: 3, total: 5, failed: 1 } }))).toEqual([])
    expect(noticesBetween(facts({ mission: { id: 'm1', done: 2, total: 5 } }), facts({ mission: { id: 'm1', done: 2, total: 5 } }))).toEqual([])
  })

  it('a finished and a failed mission are the two notices that toast; an approval is not', () => {
    expect([...TOASTED_KEYS].sort()).toEqual(['mission-done', 'mission-failed'])
  })

  it('announcing returns what was recorded, so a notice raised a minute ago is not toasted twice', () => {
    const state = newState({})
    const before = facts({ mission: { id: 'm1', done: 4, total: 5, failed: 0 } })

    state.snapshot = null

    expect(announceChanges(state, before, T)).toEqual([])
  })
})
