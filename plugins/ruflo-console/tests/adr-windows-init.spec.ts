/**
 * #4433: on Windows "initialise ADRs" failed with `$.process.run(install) failed to start: ENOENT`, because the console wrote files by
 * running dd / install / sh and none of them is on a Windows PATH. The write goes through the host's file API there (host-fs). This is that
 * scenario end to end on an in-memory Windows-style project: a host whose `run` throws ENOENT proves nothing is spawned. Run with
 *   npx vitest run plugins/ruflo-console/tests/adr-windows-init.spec.ts
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { adrOf, initSpec, loadAdrs } from '../hooks/adr'
import { setWriteFlavor } from '../hooks/data/write-flavor'
import { newState } from '../hooks/state'

/** A project on disk as a Map: files by path, folders implied by the files under them. Windows reads `\` and `/` as the same separator, so keys are kept with `/`. */
function memoryHost() {
  const files = new Map<string, string>()
  const k = (path: string) => path.replace(/\\/g, '/')
  const isDir = (path: string) => [...files.keys()].some(file => file.startsWith(`${k(path)}/`))
  const run = vi.fn(async (argv: readonly string[]) => { throw new Error(`ruflo-console: $.process.run(${argv[0]}) failed to start: ENOENT`) })
  const host = {
    fs: {
      read: async (path: string) => (files.has(k(path)) ? (files.get(k(path)) as string) : Promise.reject(new Error('ENOENT'))),
      stat: async (path: string) => (files.has(k(path)) ? { kind: 'file', size: (files.get(k(path)) as string).length, mtimeMs: 1, isLink: false } : isDir(path) ? { kind: 'dir', size: 0, mtimeMs: 1, isLink: false } : Promise.reject(new Error('ENOENT'))),
      list: async (path: string) => {
        const names = new Set<string>()

        const base = k(path)

        for (const file of files.keys()) if (file.startsWith(`${base}/`)) names.add(file.slice(base.length + 1).split('/')[0] as string)
        if (names.size === 0) throw new Error('ENOENT')

        return [...names].map(name => ({ name, kind: files.has(`${k(path)}/${name}`) ? 'file' : 'dir' }))
      },
      write: async (path: string, text: string) => void files.set(k(path), text),
      exists: async (path: string) => files.has(k(path)) || isDir(path),
    },
    run,
    toast: () => undefined,
    invalidate: () => undefined,
    storeGet: async () => undefined,
  }

  return { host: host as never, files, run }
}

describe('ADRs: initialise on a Windows project', () => {
  beforeEach(() => setWriteFlavor('host-fs'))
  afterEach(() => setWriteFlavor(null))

  for (const cwd of ['C:/Users/me/app', 'C:\\Users\\me\\app']) {
    it(`creates the folder and the first record through the host's file API, spawning nothing (${cwd})`, async () => {
      const { host, files, run } = memoryHost()
      const state = newState({})

      state.cwd = cwd
      await loadAdrs(state, host)
      expect(adrOf(state).dir).toBeNull()
      expect(adrOf(state).why).not.toBe('no project folder is known')

      const spec = initSpec(state, host, '2026-10-23')

      expect(spec).not.toBeNull()
      await spec!.run!(undefined as never)

      const made = [...files.keys()].filter(path => /0001-record-architecture-decisions\.md$/.test(path))

      expect(made, JSON.stringify([...files.keys()])).toHaveLength(1)
      expect(files.get(made[0] as string)).toMatch(/Record architecture decisions/i)
      expect(run).not.toHaveBeenCalled()
      expect(adrOf(state).dir, `the page finds the folder it just made: ${adrOf(state).why}; files=${JSON.stringify([...files.keys()])}`).not.toBeNull()
    })
  }
})
