/**
 * Saved views and pins (ADR-461): the file's schema and how it survives corruption, the cursor by name, pins, and the live
 * load/restore/write with the host faked. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-saved.spec.ts --testTimeout=30000
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { captureDrill, decodeSaved, emptySaved, encodeSaved, isPinned, MAX_FILTERS, MAX_PINS, pinsIn, restoreDrill, SAVED_MAX_BYTES, SAVED_VERSION, setFilter, setSearch, togglePin } from '../hooks/data/wf-saved'
import { newWfUi } from '../hooks/data/workflows-nav'
import { newState } from '../hooks/state'
import { forgetSpec, resetSavedLive, SAVE_GAP_MS, savedFor, savedPathOf, syncSavedViews, updateSaved } from '../hooks/wf-saved-live'
import { BASE, runOf } from './fixtures/wf-runs'

const KEY = 'sk-abcdefghijklmnopqrstuvwx'
const a = runOf('wf_a', BASE)
const b = runOf('wf_b', BASE)
const other = runOf('wf_o', BASE, {}, 'other-flow')

describe('decode', () => {
  it('reads defaults for no file, and names the problem for bad ones', () => {
    expect(decodeSaved(null)).toEqual({ saved: emptySaved(), problem: null, isForeign: false })
    expect(decodeSaved('{not json')).toMatchObject({ saved: emptySaved(), problem: expect.stringMatching(/not valid JSON/), isForeign: false })
    expect(decodeSaved('[1,2]').problem).toMatch(/not an object/)
    expect(decodeSaved('null').problem).toMatch(/not an object/)
    expect(decodeSaved(JSON.stringify({ version: 'x' })).problem).toMatch(/unknown version/)
  })

  it('leaves a file from a newer console alone', () => {
    const d = decodeSaved(JSON.stringify({ version: SAVED_VERSION + 1, drill: { runId: 'wf_a' } }))

    expect(d.isForeign).toBe(true)
    expect(d.saved).toEqual(emptySaved())
    expect(d.problem).toMatch(/newer console/)
  })

  it('keeps only valid fields, cleaned and capped', () => {
    const d = decodeSaved(
      JSON.stringify({
        version: 1,
        savedAtMs: 5,
        drill: { runId: '../bad id', runName: `n ${KEY}\u001b[2J`, phase: 'ab '.repeat(200), agent: 7, column: 'sideways', isInspecting: 'yes', tab: 'Bad Tab!' },
        filters: { state: 'failed', 'Bad Key': 'x', ok: 'y '.repeat(300), n: 4 },
        search: `find ${KEY}`,
        pins: [{ runId: 'wf_a', name: 'a', pinnedAtMs: 1 }, { runId: 'wf_a', name: 'dup' }, { runId: 'no good', name: 'n' }, { runId: 'wf_c' }, 'x'],
      }),
    )

    expect(d.problem).toBeNull()
    expect(d.saved.drill).toEqual({ runName: expect.not.stringContaining(KEY), phase: 'ab '.repeat(200).slice(0, 80), column: 'phases', isInspecting: false, tab: 'detail' })
    expect(JSON.stringify(d.saved)).not.toContain(KEY)
    // eslint-disable-next-line no-control-regex
    expect(/[\u0000-\u001f]/.test(JSON.stringify(d.saved))).toBe(false)
    expect(Object.keys(d.saved.filters).sort()).toEqual(['ok', 'state'])
    expect(d.saved.filters.ok).toHaveLength(80)
    expect(d.saved.pins).toEqual([{ runId: 'wf_a', name: 'a', pinnedAtMs: 1 }])
  })

  it('caps pins and filters', () => {
    const pins = Array.from({ length: 60 }, (_, i) => ({ runId: `wf_${i}`, name: `n${i}` }))
    const filters = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`f${i}`, 'v']))
    const d = decodeSaved(JSON.stringify({ version: 1, pins, filters }))

    expect(d.saved.pins).toHaveLength(MAX_PINS)
    expect(Object.keys(d.saved.filters)).toHaveLength(MAX_FILTERS)
  })

  it('round-trips what it encodes, and a corrupt tail loses nothing it did not have', () => {
    const saved = { ...emptySaved(), drill: captureDrill({ ...newWfUi(), phase: 1, agent: 0, column: 'agents', isInspecting: true }, [a], 'detail'), filters: { state: 'failed' }, search: 'review', pins: [{ runId: 'wf_a', name: 'demo-run', pinnedAtMs: 9 }] }
    const text = encodeSaved(saved, 1234)

    expect(text.length).toBeLessThan(SAVED_MAX_BYTES)
    expect(decodeSaved(text).saved).toEqual({ ...saved, savedAtMs: 1234 })
    expect(decodeSaved(text.slice(0, text.length - 12)).problem).toMatch(/not valid JSON/)
  })
})

describe('the cursor by name', () => {
  const ui = { ...newWfUi(), phase: 1, agent: 0, column: 'agents' as const, isInspecting: true }

  it('captures names, not indexes', () => {
    expect(captureDrill(ui, [a, b], 'detail')).toMatchObject({ runId: 'wf_a', runName: 'demo-run', phase: 'Review', agent: 'review:a', column: 'agents', isInspecting: true })
    expect(captureDrill(ui, [], 'detail')).toBeNull()
  })

  it('puts the cursor back on the same run even when the list shifted', () => {
    const drill = captureDrill(ui, [a, b], 'detail')
    const back = restoreDrill(drill, [other, b, a], newWfUi())

    expect(back).toMatchObject({ found: 'exact', ui: { run: 2, phase: 1, agent: 0, column: 'agents', isInspecting: true } })
  })

  it('falls to the newest run of the same name when the run is gone, and leaves the cursor when neither exists', () => {
    const drill = captureDrill(ui, [a], 'detail')

    expect(restoreDrill(drill, [other, b], newWfUi())).toMatchObject({ found: 'name', ui: { run: 1, phase: 1 } })
    expect(restoreDrill(drill, [other], { ...newWfUi(), run: 0 })).toMatchObject({ found: 'gone', ui: newWfUi() })
    expect(restoreDrill(null, [a], newWfUi())).toBeNull()
  })

  it('does not restore an inspector onto a phase or agent that is not there', () => {
    const drill = { ...captureDrill(ui, [a], 'detail'), phase: 'Gone', agent: 'nobody' }
    const back = restoreDrill(drill as never, [a], newWfUi())

    expect(back?.ui.phase).toBe(0)
    expect(back?.ui.agent).toBe(0)
  })
})

describe('pins and filters', () => {
  it('toggles a pin, refuses past the cap without dropping one, and lists where each run now is', () => {
    let s = emptySaved()

    s = togglePin(s, a, 7).saved
    expect(isPinned(s, 'wf_a')).toBe(true)
    expect(pinsIn(s, [b, a])).toMatchObject([{ index: 1, run: { id: 'wf_a' } }])
    expect(pinsIn(s, [b])).toMatchObject([{ index: null, run: null }])
    s = togglePin(s, a, 8).saved
    expect(s.pins).toEqual([])

    for (let i = 0; i < MAX_PINS; i += 1) s = togglePin(s, runOf(`wf_${i}`, BASE), i).saved

    const full = togglePin(s, runOf('wf_new', BASE), 99)

    expect(full.saved.pins).toHaveLength(MAX_PINS)
    expect(full.said).toMatch(/pinned already/)
    expect(full.saved.pins.some(p => p.runId === 'wf_0')).toBe(true)
  })

  it('sets and clears a filter and the search, under the file\'s rules', () => {
    let s = setFilter(emptySaved(), 'state', 'failed')

    expect(s.filters).toEqual({ state: 'failed' })
    expect(setFilter(s, 'Bad Key', 'x')).toEqual(s)
    expect(setFilter(s, 'state', '').filters).toEqual({})
    expect(setSearch(s, `  q ${KEY}`).search).not.toContain(KEY)
    for (let i = 0; i < 20; i += 1) s = setFilter(s, `f${i}`, 'v')
    expect(Object.keys(s.filters)).toHaveLength(MAX_FILTERS)
  })
})

describe('live: load, restore, write', () => {
  const CWD = '/work/proj'
  const PATH = savedPathOf(CWD)

  function world(files: Record<string, string> = {}) {
    const writes: { argv: readonly string[]; stdin: string | undefined }[] = []
    let exit = 0
    const fs = {
      read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
      stat: async (path: string) => (files[path] === undefined ? Promise.reject(new Error('ENOENT')) : { mtimeMs: 1, size: files[path].length, kind: 'file' }),
      list: async () => [],
    }
    const host = { fs, run: async (argv: readonly string[], _t: number, stdin?: string) => (writes.push({ argv, stdin }), { exitCode: exit, stdout: '', stderr: '' }) } as never
    const state = newState({})

    state.cwd = CWD
    state.view = 'workflows'
    state.wf.read = { runs: [a, b], root: '/x', capBytes: 1, skipped: 0, more: 0 }

    return { writes, host, state, files, fail: () => void (exit = 1) }
  }

  beforeEach(() => resetSavedLive())

  it('puts the cursor back from the file once, then writes a move after the gap', async () => {
    const w = world({ [PATH]: encodeSaved({ ...emptySaved(), drill: captureDrill({ ...newWfUi(), run: 1, phase: 1 }, [a, b], 'detail') }, 1) })

    await syncSavedViews(w.state, w.host, 10_000)
    expect(w.state.wf.ui).toMatchObject({ run: 1, phase: 1 })
    expect(savedFor(CWD).restored).toBe('exact')
    expect(w.writes).toHaveLength(0)

    await syncSavedViews(w.state, w.host, 10_100)
    expect(w.writes).toHaveLength(0) // nothing moved

    w.state.wf.ui = { ...w.state.wf.ui, run: 0, phase: 0 }
    await syncSavedViews(w.state, w.host, 10_200)
    expect(w.writes).toHaveLength(1)
    expect(w.writes[0]?.argv).toEqual(['install', '-D', '-m', '0644', '/dev/stdin', '--', PATH]) // no folder yet
    expect(decodeSaved(w.writes[0]?.stdin ?? '').saved.drill).toMatchObject({ runId: 'wf_a', phase: 'Build' })

    w.files[`${CWD}/.claude-flow/console`] = ''
    w.state.wf.ui = { ...w.state.wf.ui, phase: 1 }
    await syncSavedViews(w.state, w.host, 10_200 + SAVE_GAP_MS - 1)
    expect(w.writes).toHaveLength(1) // inside the gap
    await syncSavedViews(w.state, w.host, 10_200 + SAVE_GAP_MS)
    expect(w.writes).toHaveLength(2)
    expect(w.writes[1]?.argv).toEqual(['dd', `of=${PATH}`, 'status=none']) // the folder exists now
  })

  it('never writes over a file from a newer console, nor changes it', async () => {
    const w = world({ [PATH]: JSON.stringify({ version: 99 }) })

    await syncSavedViews(w.state, w.host, 1000)
    w.state.wf.ui = { ...w.state.wf.ui, phase: 1 }
    updateSaved(CWD, s => setSearch(s, 'x'))
    await syncSavedViews(w.state, w.host, 99_000)
    expect(w.writes).toHaveLength(0)
    expect(savedFor(CWD).isForeign).toBe(true)
    expect(savedFor(CWD).saved.search).toBe('')
  })

  it('survives a corrupt file, and a file too large to read, replacing them on the next change', async () => {
    const bad = world({ [PATH]: '{{{' })

    await syncSavedViews(bad.state, bad.host, 1000)
    expect(savedFor(CWD).problem).toMatch(/not valid JSON/)
    await syncSavedViews(bad.state, bad.host, 2000)
    expect(bad.writes.length).toBe(1)

    resetSavedLive()

    const huge = world({ [PATH]: ' '.repeat(SAVED_MAX_BYTES + 10) })

    await syncSavedViews(huge.state, huge.host, 1000)
    expect(savedFor(CWD).problem).toMatch(/over 64 kB/)
  })

  it('keeps a change when the write fails, and retries it after the gap', async () => {
    const w = world()

    await syncSavedViews(w.state, w.host, 1000)
    w.fail()
    w.state.wf.ui = { ...w.state.wf.ui, phase: 1 }
    await syncSavedViews(w.state, w.host, 5000)
    expect(savedFor(CWD)).toMatchObject({ isDirty: true, error: expect.stringMatching(/exited 1/) })
    await syncSavedViews(w.state, w.host, 5000 + SAVE_GAP_MS)
    expect(w.writes).toHaveLength(2)
  })

  it('does not touch the page when the host throws', async () => {
    const w = world()
    const boom = { fs: { read: async () => { throw new Error('x') }, stat: async () => { throw new Error('x') }, list: async () => [] }, run: async () => { throw new Error('refused') } } as never

    await expect(syncSavedViews(w.state, boom, 1000)).resolves.toBeUndefined()
    await expect(syncSavedViews(w.state, boom, 9000)).resolves.toBeUndefined()
  })

  it('forgetting is a confirm-gated delete of that one file, then stops auto-saving until something is pinned', async () => {
    const w = world()

    await syncSavedViews(w.state, w.host, 1000)
    updateSaved(CWD, s => togglePin(s, a, 1).saved)

    const spec = forgetSpec(CWD)

    expect(spec).toMatchObject({ argv: ['rm', '-f', '--', PATH], declared: 'delete' })
    spec.onOutput?.('')
    expect(savedFor(CWD).saved).toEqual(emptySaved())
    w.state.wf.ui = { ...w.state.wf.ui, phase: 1 }
    await syncSavedViews(w.state, w.host, 50_000)
    expect(w.writes).toHaveLength(0)
    updateSaved(CWD, s => togglePin(s, b, 2).saved)
    await syncSavedViews(w.state, w.host, 60_000)
    expect(w.writes).toHaveLength(1)
  })
})
