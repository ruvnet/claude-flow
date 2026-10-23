/**
 * A hive that exists shows up. The missing-file backoff (MISSING_RECHECK_MS) must not hide a hive.json written after the first read:
 * the next refresh past the window reads it, and a hive started from the console is read fresh when the CLI returns.
 *   npx vitest run plugins/ruflo-console/tests/hive-appears.spec.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MISSING_RECHECK_MS, PROJECT, type ReaderFs, type ReadCache } from '../hooks/data/files'
import { readSnapshot } from '../hooks/data/snapshot'
import { createController } from '../hooks/controller'
import type { Host } from '../hooks/host'
import { newState } from '../hooks/state'
import { startSpec } from '../hooks/starts'
import { HIVE_STATE } from './fixtures/hive'

const CWD = 'C:/Users/me/project'
const HIVE_PATH = `${CWD}/${PROJECT.hive}`
const TEXT = JSON.stringify(HIVE_STATE)

/** A disk where only the hive file may exist, and from when. */
function disk(): { fs: ReaderFs; put: () => void } {
  let exists = false

  return {
    put: () => void (exists = true),
    fs: {
      stat: async path => (path === HIVE_PATH && exists ? { mtimeMs: 1, size: TEXT.length, kind: 'file' } : Promise.reject(new Error('ENOENT'))),
      read: async path => (path === HIVE_PATH && exists ? TEXT : Promise.reject(new Error('ENOENT'))),
      list: async () => Promise.reject(new Error('ENOENT')),
    },
  }
}

describe('the hive file first seen missing', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  it('is found by the first refresh after the recheck window, not before', async () => {
    const { fs, put } = disk()
    const cache: ReadCache = new Map()

    expect((await readSnapshot(fs, cache, CWD, null, null, Date.now())).hive).toBeNull()
    vi.advanceTimersByTime(2_000)
    put()
    expect((await readSnapshot(fs, cache, CWD, null, null, Date.now())).hive).toBeNull()
    vi.advanceTimersByTime(MISSING_RECHECK_MS)

    const snapshot = await readSnapshot(fs, cache, CWD, null, null, Date.now())

    expect(snapshot.hive?.queen).toBe(HIVE_STATE.queen.agentId)
  })
})

describe('a hive started from the console', () => {
  it('is verified against a fresh read even when the file was first seen missing seconds ago', async () => {
    const { fs, put } = disk()
    const host = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'fs') return fs
          if (key === 'run') return async () => { put(); return { exitCode: 0, stdout: '{"success":true}', stderr: '' } }
          if (key === 'after' || key === 'every') return () => ({ cancel: () => undefined })
          if (key === 'settings') return async () => null

          return () => Promise.resolve(undefined)
        },
      },
    ) as unknown as Host
    const state = newState({})

    state.cwd = CWD
    state.home = null
    state.configDir = null

    const control = createController(state, host)

    await control.refresh()
    expect(state.snapshot?.hive).toBeNull()

    const spec = startSpec('hive', Date.now())

    control.runner.ask({ ...spec!, argv: ['ruflo', 'hive-mind', 'init'] }, 'test')
    await control.runner.confirm()

    expect(state.outcome?.verified).toBe('yes')
    expect(state.outcome?.ok).toBe(true)
    expect(state.snapshot?.hive).not.toBeNull()
  })
})

describe('a start whose CLI returns before state.json lands', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }))
  afterEach(() => vi.useRealTimers())

  /** `landsAfterMs` null: never. `exitCode` is the CLI's. Counts stats of the hive file. */
  function setup(landsAfterMs: number | null, exitCode = 0) {
    const { fs, put } = disk()
    const seen = { stats: 0 }
    const counted: ReaderFs = {
      ...fs,
      stat: async path => {
        if (path === HIVE_PATH) seen.stats += 1

        return fs.stat(path)
      },
    }
    const host = new Proxy(
      {},
      {
        get: (_target, key) => {
          if (key === 'fs') return counted
          if (key === 'run') return async () => { if (landsAfterMs !== null) setTimeout(put, landsAfterMs); return { exitCode, stdout: exitCode === 0 ? '{"success":true}' : '', stderr: exitCode === 0 ? '' : 'boom' } }
          if (key === 'after') return (ms: number, fn: () => void) => { const id = setTimeout(fn, ms); return { cancel: () => clearTimeout(id) } }
          if (key === 'every') return () => ({ cancel: () => undefined })
          if (key === 'settings') return async () => null

          return () => Promise.resolve(undefined)
        },
      },
    ) as unknown as Host
    const state = newState({})

    state.cwd = CWD
    state.home = null
    state.configDir = null

    return { state, host, seen }
  }

  async function start(state: ReturnType<typeof newState>, host: Host) {
    const control = createController(state, host)

    await control.refresh()
    control.runner.ask({ ...startSpec('hive', Date.now())!, argv: ['ruflo', 'hive-mind', 'init'] }, 'test')

    const done = control.runner.confirm()

    await vi.advanceTimersByTimeAsync(5_000)
    await done
  }

  it('reports success when the file lands 500 ms after the run returns', async () => {
    const { state, host } = setup(500)

    await start(state, host)
    expect(state.outcome?.verified).toBe('yes')
    expect(state.outcome?.ok).toBe(true)
  })

  it('reports the expected text after exactly one retry when it never lands', async () => {
    const { state, host, seen } = setup(null)

    await start(state, host)
    expect(state.outcome?.verified).toBe('no')
    expect(state.outcome?.detail).toMatch(/expected a queen in \.claude-flow\/hive-mind\/state\.json/)
    // initial refresh + first verify read + one retry read: bounded to one retry.
    expect(seen.stats).toBe(3)
  })

  it('does not retry when the run itself failed', async () => {
    const { state, host, seen } = setup(500, 1)

    await start(state, host)
    expect(state.outcome?.ok).toBe(false)
    expect(seen.stats).toBe(2)
  })
})
