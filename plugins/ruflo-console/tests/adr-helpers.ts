/** Shared by the ADR specs (ADR-480): a project copied to a temp folder, and a host whose `fs` and `run` act on real files there. */
import { spawnSync } from 'node:child_process'
import { afterAll } from 'vitest'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { newState, type State } from '../hooks/state'
import { loadAdrs } from '../hooks/adr'
import { parseAdr, type AdrDoc } from '../hooks/data/adr'
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A copy of tests/fixtures/adr-projects/<name> in a temp folder (the caller removes it). */
export function tempProject(fixtures: string, name: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'adr-project-'))

  cpSync(join(fixtures, name), dir, { recursive: true })
  mkdirSync(dir, { recursive: true })

  return dir
}

/** The engine's `fs` as the console sees it: `stat` does not follow a link (it says isLink), and a read follows nothing it was not given. */
export const fsOfRoot = (_root: string) => ({
  read: async (path: string) => readFileSync(path, 'utf8'),
  stat: async (path: string) => {
    try {
      const stat = lstatSync(path)

      return { kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'dir' : 'file', size: stat.size, mtimeMs: stat.mtimeMs, isLink: stat.isSymbolicLink() }
    } catch {
      return undefined
    }
  },
  list: async (path: string) => readdirSync(path, { withFileTypes: true }).map(entry => ({ name: entry.name, kind: entry.isSymbolicLink() ? 'symlink' : entry.isDirectory() ? 'dir' : 'file' })),
})

export function hostOfRoot(root: string) {
  const log = { toasts: [] as { text: string; level: string | undefined }[], runs: [] as string[][], invalidations: 0 }
  const host = {
    fs: fsOfRoot(root),
    run: async (argv: readonly string[], _timeoutMs: number, stdin?: string) => {
      log.runs.push([...argv])

      // The test runtime hands a child a socket for stdin, which `install -D /dev/stdin` cannot reopen (a pipe can be): the text goes through a file.
      const holder = mkdtempSync(join(tmpdir(), 'adr-stdin-'))
      const file = join(holder, 'in')

      writeFileSync(file, stdin ?? '')

      const result = spawnSync(argv[0] as string, argv.slice(1).map(arg => (arg === '/dev/stdin' ? file : arg)), { input: stdin ?? '', encoding: 'utf8' })

      rmSync(holder, { recursive: true, force: true })

      return { exitCode: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
    },
    toast: (text: string, _ms?: number, level?: string) => void log.toasts.push({ text, level }),
    invalidate: () => void (log.invalidations += 1),
    storeGet: async () => undefined,
    storeSet: async () => undefined,
    pluginRoot: '/plugin',
  }

  return { host, log }
}

const HERE = dirname(fileURLToPath(import.meta.url))

export const FIXTURES = join(HERE, 'fixtures', 'adr-projects')
export const RUFLO_ADRS = join(HERE, '..', '..', '..', 'v3', 'docs', 'adr')
export const TODAY = '2026-10-07'

const cleanups: string[] = []

/** Registers the removal of every folder made through this module for the spec file that calls it. */
export const cleanAfter = (): void => afterAll(() => {
  for (const dir of cleanups) rmSync(dir, { recursive: true, force: true })
})

export const keep = (dir: string): string => (cleanups.push(dir), dir)

export const project = (name: string): string => keep(tempProject(FIXTURES, name))

export const stateAt = (root: string): State => {
  const state = newState({})

  state.cwd = root
  state.isInteractive = true

  return state
}

export const loaded = async (name: string) => {
  const root = project(name)
  const state = stateAt(root)
  const world = hostOfRoot(root)

  await loadAdrs(state, world.host as never)

  return { root, state, world }
}

export const docsOf = (name: string, folder: string): AdrDoc[] => readdirSync(join(FIXTURES, name, folder)).filter(f => f.endsWith('.md') && !/^readme/i.test(f)).sort().map(f => parseAdr(f, readFileSync(join(FIXTURES, name, folder, f), 'utf8')))
