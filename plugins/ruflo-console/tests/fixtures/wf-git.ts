/**
 * A stand-in for git and /proc for the worktree specs: a fixed list, per-path dirty and ahead counts, ages and a process listing.
 */
import { AHEAD_ARGV, IGNORED_ARGV, LIST_ARGV, parseProcs, PROCS_ARGV, REF_ARGV, STATUS_ARGV, type WtIo, type WtRead, type WtRow } from '../../hooks/data/wf-worktrees'
import type { Kit } from '../../hooks/views/common'

export const NOW = Date.parse('2026-10-06T12:00:00.000Z')
export const DAY = 86_400_000
export const ROOT = '/repo'
export const wt = (name: string): string => `${ROOT}/.claude/worktrees/${name}`

export type El = { kind: string; props: Record<string, unknown> }

export const kit = { Box: (props: Record<string, unknown>): El => ({ kind: 'Box', props }), Text: (props: Record<string, unknown>): El => ({ kind: 'Text', props }), Button: (props: Record<string, unknown>): El => ({ kind: 'Button', props }) } as unknown as Kit

export const flat = (node: unknown, out: El[] = []): El[] => {
  if (Array.isArray(node)) node.forEach(child => flat(child, out))
  else if (typeof node === 'object' && node !== null) {
    out.push(node as El)
    flat((node as El).props?.children, out)
  }

  return out
}

export const flatWords = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join(' ').replace(/\s+/g, ' ')
export const words = (tree: unknown): string => flat(tree).filter(el => el.kind === 'Text' && typeof el.props.children === 'string').map(el => el.props.children as string).join('\n')

export const block = (path: string, branch: string | null, extra: string[] = [], head = 'a'.repeat(40)): string => [`worktree ${path}`, `HEAD ${head}`, branch === null ? 'detached' : `branch refs/heads/${branch}`, ...extra].join('\n')

export type World = { dirty: Record<string, number>; ahead: Record<string, number | null>; created: Record<string, number | null>; procs: string; list: string; calls: (readonly string[])[]; removed: string[]; failRemove: Set<string>; hasRef: boolean; ignored: Record<string, string> }

export const procLines = (rows: [number, string, string][]): string => rows.map(([pid, kind, target]) => `/proc/${pid}/${kind}\t${target}`).join('\n')
export const BASE_PROCS = procLines([[1, 'cwd', '/'], [2, 'cwd', '/home/u'], [3, 'cwd', '/tmp']])

export function world(over: Partial<World> = {}): World {
  const names = ['old', 'dirty', 'ahead', 'young', 'busy', 'locked']

  return {
    dirty: { [wt('dirty')]: 3 },
    ahead: { [wt('ahead')]: 2 },
    created: Object.fromEntries(names.map(name => [wt(name), NOW - (name === 'young' ? 3_600_000 : 5 * DAY)])),
    procs: `${BASE_PROCS}\n${procLines([[10, 'cwd', wt('busy')], [11, 'fd/4', `${wt('busy')}/src/a.ts`]])}`,
    list: '',
    calls: [],
    removed: [],
    failRemove: new Set(),
    hasRef: true,
    ignored: {},
    ...over,
  }
}

export const LIST = [block(ROOT, 'main'), block(wt('current'), 'feat/current'), block(wt('old'), 'feat/old'), block(wt('dirty'), 'feat/dirty'), block(wt('ahead'), 'feat/ahead'), block(wt('young'), 'feat/young'), block(wt('busy'), 'feat/busy'), block(wt('locked'), 'feat/locked', ['locked reason']), block('/elsewhere/wt', 'feat/else')].join('\n\n') + '\n'

export function ioOf(w: World): WtIo {
  w.list = w.list === '' ? LIST : w.list

  return {
    run: async argv => {
      w.calls.push(argv)

      const dir = argv[2] ?? ''
      const key = argv.join(' ')

      if (key === PROCS_ARGV.join(' ')) return { stdout: w.procs, stderr: 'find: Permission denied', exitCode: 1 }
      if (key === LIST_ARGV(dir).join(' ')) return { stdout: w.list, stderr: '', exitCode: 0 }
      if (key === REF_ARGV(dir).join(' ')) return w.hasRef ? { stdout: `${Math.floor((NOW - 2 * 3_600_000) / 1000)}\n`, stderr: '', exitCode: 0 } : { stdout: '', stderr: 'unknown revision', exitCode: 128 }
      if (key === STATUS_ARGV(dir).join(' ')) return { stdout: Array.from({ length: w.dirty[dir] ?? 0 }, (_, i) => ` M f${i}`).join('\n'), stderr: '', exitCode: 0 }
      if (key === IGNORED_ARGV(dir).join(' ')) return { stdout: w.ignored[dir] ?? '', stderr: '', exitCode: 0 }
      if (key === AHEAD_ARGV(dir).join(' ')) return w.ahead[dir] === null ? { stdout: '', stderr: 'bad', exitCode: 128 } : { stdout: `0\t${w.ahead[dir] ?? 0}\n`, stderr: '', exitCode: 0 }
      if (key.startsWith(`git -C ${ROOT} worktree remove `)) {
        const path = argv[5] ?? ''

        if (w.failRemove.has(path)) return { stdout: '', stderr: 'fatal: contains modified or untracked files', exitCode: 128 }

        w.removed.push(path)
        w.list = w.list.split('\n\n').filter(entry => !entry.includes(`worktree ${path}\n`)).join('\n\n')

        return { stdout: '', stderr: '', exitCode: 0 }
      }

      return { stdout: '', stderr: 'unexpected argv', exitCode: 2 }
    },
    stat: async path => {
      const name = path.replace(/\/\.git$/, '')

      return w.created[name] === undefined || w.created[name] === null ? undefined : { mtimeMs: w.created[name] as number }
    },
  }
}

export const row = (over: Partial<WtRow> = {}): WtRow => ({ path: wt('x'), head: 'a'.repeat(40), branch: 'feat/x', isDetached: false, isBare: false, isLocked: false, isPrunable: false, isMain: false, isSafe: true, dirty: 0, ignoredSecrets: 0, ahead: 0, behind: 3, createdMs: NOW - 5 * DAY, maker: null, isCurrent: false, ...over })
export const readOf = (rows: WtRow[]): WtRead => ({ root: ROOT, rows, total: rows.length, isCut: false, refAtMs: NOW - 3_600_000, hasRef: true, atMs: NOW })
export const okCheck = (paths: string[], counts: Record<string, number> = {}, atMs = NOW) => parseProcs(`${BASE_PROCS}\n${procLines(Object.entries(counts).map(([path], i) => [50 + i, 'cwd', path] as [number, string, string]))}`, paths, atMs)

