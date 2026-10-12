/**
 * The Workflows page's worktree manager, view side (ADR-463): the board, the confirm card that names exactly what it will remove, the
 * removal that re-checks each worktree before it goes, and the slots.
 * Pure and fast: a stand-in for git and /proc (tests/fixtures/wf-git.ts), no engine. Run with
 *   npx vitest run plugins/ruflo-console/tests/wf-worktrees-view.spec.ts --testTimeout=30000
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { newWfUi } from '../hooks/data/workflows-nav'
import { AHEAD_ARGV, REMOVE_ARGV, type WtRead } from '../hooks/data/wf-worktrees'
import type { Host } from '../hooks/host'
import { newState, type State } from '../hooks/state'
import type { Ctx } from '../hooks/views/common'
import { registerSlot, resetSlots, slotsFor, type SlotEnv } from '../hooks/views/wf-slots'
import { boardRows, clock, nameOf, ordered, refreshWorktrees, registerWorktreeSlots, removalSpec, resetWorktrees, storeFor, wireWfWorktrees } from '../hooks/views/wf-worktrees'
import { BASE_PROCS, block, flatWords, ioOf, kit, NOW, procLines, ROOT, wt, words, world, type World } from './fixtures/wf-git'

describe('the board and the confirm-gated removal', () => {
  let state: State
  let w: World
  let outcomes: number
  let prompts: string[]

  const hostOf = (): Host => ({ run: async (argv: readonly string[], ms: number) => ioOf(w).run(argv, ms), fs: { stat: ioOf(w).stat }, invalidate: () => void (outcomes += 1), submitPrompt: async (t: string) => void prompts.push(t) }) as unknown as Host
  const envOf = (): SlotEnv => ({ ctx: { kit, state, nowMs: NOW, columns: 120, pictures: new Map(), act: {} as never } as Ctx, runs: [], run: null, phase: null, agent: null, ui: newWfUi(), nowMs: NOW })

  beforeEach(() => {
    state = newState({})
    state.cwd = wt('current')
    w = world()
    outcomes = 0
    prompts = []
    clock.now = () => NOW
  })
  afterEach(() => {
    resetWorktrees(state)
    clock.now = () => Date.now()
  })

  it('says it is not wired, then not read, before it has anything to show', () => {
    expect(words(boardRows(envOf()))).toMatch(/not wired/)
    wireWfWorktrees(state, hostOf())
    expect(words(boardRows(envOf()))).toMatch(/not read yet/)
    expect(removalSpec(envOf())).toBeNull()
  })

  it('lists every worktree with its branch, counts, age and the reason it is kept, removable first', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)

    const text = flatWords(boardRows(envOf()))

    expect(text).toContain('9 worktrees')
    expect(text).toContain('origin/main as last fetched 2h ago (nothing is fetched here)')
    expect(text).toMatch(/\.claude\/worktrees\/old feat\/old.*↑0 ↓0 · clean · 5d · not attributed.*removable/)
    expect(text).toMatch(/dirty.*3 changed.*kept: 3 changed or untracked files/)
    expect(text).toMatch(/ahead.*↑2.*kept: 2 commits not in origin\/main/)
    expect(text).toMatch(/young.*kept: made less than a day ago/)
    expect(text).toMatch(/busy.*2 live.*kept: 2 live processes in it/)
    expect(text).toMatch(/current.*kept: this session is working in it/)
    expect(text).toMatch(/elsewhere\/wt.*kept: outside/)
    expect(text).toContain('cleanup: 1 worktree ready to remove')

    const order = ordered(storeFor(state).read as WtRead, storeFor(state).check, NOW).map(r => nameOf(ROOT, r.path))

    expect(order[0]).toBe('.claude/worktrees/old')
  })

  it('draws no more than the row ceiling and says how many it did not', async () => {
    const many = Array.from({ length: 30 }, (_, i) => block(i === 0 ? ROOT : wt(`w${i}`), `b${i}`)).join('\n\n')

    w = world({ list: many })
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)
    expect(words(boardRows(envOf()))).toMatch(/\+16 more worktrees not drawn/)
  })

  it('the confirm card names exactly the worktrees it will remove, as the commands it runs, with no --force', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)

    const spec = removalSpec(envOf())

    expect(spec).not.toBeNull()
    expect(spec?.shows).toBe(`git -C ${ROOT} worktree remove ${wt('old')}`)
    expect(spec?.shows).not.toContain('--force')
    expect(spec).toMatchObject({ declared: 'delete', args: [], label: 'remove 1 merged, clean worktree' })
    expect(spec?.note).toMatch(/branches stay/)
    expect(REMOVE_ARGV(ROOT, wt('old'))).toEqual(['git', '-C', ROOT, 'worktree', 'remove', wt('old')])
  })

  it('offers nothing before the live processes were checked (the timer read never checks them)', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, false, NOW)
    expect(removalSpec(envOf())).toBeNull()
    expect(words(boardRows(envOf()))).toMatch(/live processes: not checked/)
    expect(w.calls.some(argv => argv[0] === '/usr/bin/find')).toBe(false)
  })

  it('removes one worktree, re-checking first, then re-reads and says it is gone', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)
    await removalSpec(envOf())?.run?.()

    expect(w.removed).toEqual([wt('old')])
    expect(state.outcome).toMatchObject({ label: 'remove worktrees', ok: true, verified: 'yes', detail: '1 removed, 0 kept' })
    expect(state.outcome?.lines).toEqual(['removed .claude/worktrees/old'])
  })

  it('does not remove one that turned dirty, or gained a process, after the list was shown', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)

    const spec = removalSpec(envOf())

    w.dirty[wt('old')] = 1
    await spec?.run?.()
    expect(w.removed).toEqual([])
    expect(state.outcome).toMatchObject({ ok: false, detail: '0 removed, 1 kept' })
    expect(state.outcome?.lines?.[0]).toMatch(/kept .*old: 1 changed or untracked file/)

    w.dirty[wt('old')] = 0
    await refreshWorktrees(state, host, true, NOW)

    const again = removalSpec(envOf())

    w.procs += `\n${procLines([[99, 'cwd', wt('old')]])}`
    await again?.run?.()
    expect(w.removed).toEqual([])
    expect(state.outcome?.lines?.[0]).toMatch(/1 live process in it/)
  })

  it('does not remove one that became the session\'s own, or whose process listing went blind', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)

    const spec = removalSpec(envOf())

    w.procs = ''
    await spec?.run?.()
    expect(w.removed).toEqual([])
    expect(state.outcome?.lines?.[0]).toMatch(/process listing did not answer/)

    state.cwd = wt('old')
    w.procs = BASE_PROCS
    await spec?.run?.()
    expect(w.removed).toEqual([])
    expect(state.outcome?.lines?.[0]).toMatch(/this session is working in it/)
  })

  it('reports git\'s own refusal and removes nothing else', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)
    w.failRemove.add(wt('old'))
    await removalSpec(envOf())?.run?.()
    expect(state.outcome).toMatchObject({ ok: false, verified: 'n/a' })
    expect(state.outcome?.lines?.[0]).toMatch(/git said fatal: contains modified/)
  })

  it('keeps a failed read\'s rows on screen and says why', async () => {
    const host = hostOf()

    wireWfWorktrees(state, host)
    await refreshWorktrees(state, host, true, NOW)
    state.cwd = ''
    await refreshWorktrees(state, host, false, NOW + 1)
    expect(words(boardRows(envOf()))).toMatch(/the last read failed \(no usable working directory\): showing the read before it/)
    expect(storeFor(state).read?.rows.length).toBe(9)
  })
})

describe('the slots', () => {
  beforeEach(() => resetSlots())
  afterEach(() => resetSlots())

  it('register once on the seams with keys the page does not own, and a repeat is refused harmlessly', () => {
    registerWorktreeSlots()
    registerWorktreeSlots()
    expect(slotsFor('board').map(s => s.id)).toEqual(['worktrees'])
    expect(slotsFor('key').map(s => [s.id, s.key])).toEqual([['wt-read', 'w']])
    expect(slotsFor('action').map(s => [s.id, s.hotkey])).toEqual([['wt-clean', 'c']])
    expect(slotsFor('notice').map(s => s.id)).toEqual(['wt-timer'])
    expect(registerSlot({ kind: 'key', id: 'other', key: 'w', label: 'x', run: () => undefined })).toMatchObject({ ok: false })
  })

  it('the timer notice re-reads at most once a minute, only for the wired console, and never checks processes', async () => {
    const state = newState({})
    const calls: string[] = []
    const host = { run: async (argv: readonly string[]) => (calls.push(argv[0] === '/usr/bin/find' ? 'find' : 'git'), { stdout: '', stderr: '', exitCode: 128 }), fs: { stat: async () => undefined }, invalidate: () => undefined } as unknown as Host

    registerWorktreeSlots()
    state.cwd = '/repo'

    const notice = slotsFor('notice')[0]

    expect(notice?.between(null, [], NOW)).toEqual([])
    await Promise.resolve()
    expect(calls).toEqual([])

    wireWfWorktrees(state, host)
    expect(notice?.between(null, [], NOW)).toEqual([])
    await new Promise(done => setTimeout(done, 5))
    expect(calls).toEqual(['git'])
    notice?.between(null, [], NOW + 30_000)
    await new Promise(done => setTimeout(done, 5))
    expect(calls).toEqual(['git'])
    notice?.between(null, [], NOW + 60_000)
    await new Promise(done => setTimeout(done, 5))
    expect(calls).toEqual(['git', 'git'])
    resetWorktrees(state)
  })
})
