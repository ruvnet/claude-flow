/**
 * The ruRE sample and links (ADR-495): the text rule lets a path through that names a link inside the project, and the tools open the
 * top-level file they are given. The sample is walked on disk before a row runs; a link anywhere on it is refused and nothing is spawned.
 *   npx vitest run --dir plugins/ruflo-console/tests rure-symlink
 */
import { describe, expect, it, vi } from 'vitest'

import { devSpec, DEV } from '../hooks/devtools'
import { emptyFields } from '../hooks/data/devtools'
import { sampleLinkCheck } from '../hooks/data/rure-guard'
import type { Host } from '../hooks/host'
import { createRunner } from '../hooks/runner'
import { newState } from '../hooks/state'

type Entry = { isLink?: boolean; kind?: string } | undefined

const fsOf = (entries: Record<string, Entry>, seen: string[] = []) => ({
  stat: async (path: string) => {
    seen.push(path)

    return entries[path]
  },
})

describe('sampleLinkCheck', () => {
  it('lets a regular file through, and a path that is not there (the tool says so itself)', async () => {
    expect(await sampleLinkCheck(fsOf({ app: { kind: 'dir' }, 'app/tool': { kind: 'file' } }), 'app/tool')).toBeNull()
    expect(await sampleLinkCheck(fsOf({}), 'app/missing')).toBeNull()
  })

  it('refuses a sample that is a link', async () => {
    expect(await sampleLinkCheck(fsOf({ app: { kind: 'dir' }, 'app/tool': { isLink: true } }), 'app/tool')).toMatch(/app\/tool is a link/)
  })

  it('refuses a sample whose folder on the way is a link', async () => {
    const seen: string[] = []

    expect(await sampleLinkCheck(fsOf({ app: { isLink: true }, 'app/tool': { kind: 'file' } }, seen), 'app/tool')).toMatch(/^app is a link/)
    expect(seen).toEqual(['app'])
  })

  it('reads a link kind as a link too, and ignores `.` and empty parts', async () => {
    expect(await sampleLinkCheck(fsOf({ a: { kind: 'symlink' } }), './a//')).toMatch(/^a is a link/)
    expect(await sampleLinkCheck(fsOf({ a: { kind: 'link' } }), 'a')).toMatch(/^a is a link/)
  })

  it('a host that refuses stat answers like a missing part: the check narrows, it never widens', async () => {
    expect(await sampleLinkCheck({ stat: async () => Promise.reject(new Error('refused')) }, 'a/b')).toBeNull()
  })
})

describe('the ruRE rows carry the check', () => {
  const entry = (id: string) => DEV.find(item => item.id === id)!
  const fields = (sample: string) => ({ ...emptyFields(), sample, query: 'license' })

  it('every ruRE row has a preflight once a sample is set, and no other row does', () => {
    for (const item of DEV.filter(row => row.group.startsWith('rure-'))) expect(devSpec(item, fields('bin/tool'))?.preflight, item.id).toBeTypeOf('function')
    for (const item of DEV.filter(row => !row.group.startsWith('rure-'))) expect(devSpec(item, { ...emptyFields(), path: 'memory.rvf', ref: 'HEAD', label: 'l', url: 'https://example.com', target: '@e1', query: 'q', task: 't', cmd: 'c', id: 'i', note: 'n', session: 's', send: 'c' })?.preflight, item.id).toBeUndefined()
  })

  it('the preflight answers from the host fs', async () => {
    const spec = devSpec(entry('dt-re-bin'), fields('bin/tool'))!

    expect(await spec.preflight!({ fs: fsOf({ bin: { kind: 'dir' }, 'bin/tool': { isLink: true } }) } as unknown as Host)).toMatch(/bin\/tool is a link/)
    expect(await spec.preflight!({ fs: fsOf({ bin: { kind: 'dir' }, 'bin/tool': { kind: 'file' } }) } as unknown as Host)).toBeNull()
  })
})

describe('the runner on a link', () => {
  it('spawns nothing and shows the reason as the result', async () => {
    const run = vi.fn()
    const host = { invalidate: () => undefined, after: () => ({ cancel: () => undefined }), run, fs: fsOf({ bin: { kind: 'dir' }, 'bin/tool': { isLink: true } }) } as unknown as Host
    const state = newState({})
    const runner = createRunner(state, host, { freshRead: async () => undefined, setView: () => undefined, drill: () => undefined, command: () => undefined })

    runner.ask(devSpec(DEV.find(item => item.id === 'dt-re-bin')!, { ...emptyFields(), sample: 'bin/tool' })!, 'why')
    for (let turn = 0; turn < 10; turn++) await new Promise<void>(resolve => setTimeout(resolve, 0))

    expect(run).not.toHaveBeenCalled()
    expect(state.lab.result?.ok).toBe(false)
    expect(state.lab.result?.lines.join(' ')).toMatch(/bin\/tool is a link/)
    expect(state.isActing).toBe(false)
  })
})
