/**
 * Git worktrees as the Workflows page shows them (ADR-463): the list, what each one holds, who made it, and which of them may be
 * removed. Every fact comes from a read-only probe with a fixed argv (no shell string anywhere); a probe that fails or says
 * nothing is an unknown, and an unknown can never make a worktree removable. Pure apart from the injected `io`, so a test
 * stands in for git and for /proc.
 *
 * Probes (all read-only):
 *   git -C <dir> worktree list --porcelain                       the list (byte-capped; the first entry is the main worktree)
 *   git -C <wt> status --porcelain=v1                            dirty lines, untracked files included
 *   git -C <wt> rev-list --left-right --count origin/main...HEAD behind and ahead; ahead 0 means HEAD is inside origin/main
 *   git -C <main> log -1 --format=%ct origin/main                how old the local copy of origin/main is (nothing is fetched)
 *   find /proc ... -printf '%p\t%l\n'                            what every process has as cwd, exe and open fd (own processes only)
 * The one write, `git -C <main> worktree remove <path>` with no --force, lives in views/wf-worktrees.ts behind the confirm card.
 */
import { plain } from './parse'
import { cleanText } from './wf-clean'
import type { WfRun } from './workflows'

export type RunResult = { stdout: string; stderr: string; exitCode?: number | null }
export type WtIo = {
  run: (argv: readonly string[], timeoutMs: number) => Promise<RunResult>
  stat: (path: string) => Promise<{ mtimeMs?: number } | undefined>
}

/** The list is cut here, and the page says so. */
export const LIST_MAX_BYTES = 262_144
/** At most this many worktrees are probed per read; the page names how many were left out. */
export const MAX_PROBED = 40
/** Probes run this many at a time. */
export const BATCH = 6
/** A worktree younger than this is never offered for removal: a fresh one is trivially clean, merged and ahead 0. */
export const MIN_AGE_MS = 24 * 3_600_000
/** Removed per confirm; a longer list says how many are left for the next. */
export const REMOVE_MAX = 10
/** The process check must be this fresh to plan a removal, and must have seen at least MIN_PROCS working directories. */
export const PROCS_FRESH_MS = 120_000
export const MIN_PROCS = 3
/** The ignored listing is read up to here; the names are matched, never shown. */
export const IGNORED_MAX_BYTES = 1_000_000
/** Dirty lines are counted up to here. */
export const DIRTY_CAP = 200
/** The process listing is read up to here; a longer one makes the check refuse rather than guess. */
export const PROCS_MAX_BYTES = 4_000_000
/** The only places the console removes from: under the main worktree. */
export const REMOVABLE_DIRS = ['.claude/worktrees', '.git-worktrees'] as const

export const LIST_ARGV = (dir: string): readonly string[] => ['git', '-C', dir, 'worktree', 'list', '--porcelain']
// status is the one probe that can run a program from the repository's config (core.fsmonitor) and that refreshes the index (a write, and a lock another
// session's git may want): both are switched off, after '-C <dir>' so the directory stays the third word.
export const STATUS_ARGV = (dir: string): readonly string[] => ['git', '-C', dir, '--no-optional-locks', '-c', 'core.fsmonitor=false', 'status', '--porcelain=v1']
/** Ignored files and folders (a folder is one entry): 'git worktree remove' deletes these too, and they are where a .env or a key lives. */
export const IGNORED_ARGV = (dir: string): readonly string[] => ['git', '-C', dir, '--no-optional-locks', '-c', 'core.fsmonitor=false', 'ls-files', '--others', '--ignored', '--exclude-standard', '--directory']
export const AHEAD_ARGV = (dir: string): readonly string[] => ['git', '-C', dir, 'rev-list', '--left-right', '--count', 'origin/main...HEAD']
export const REF_ARGV = (dir: string): readonly string[] => ['git', '-C', dir, 'log', '-1', '--format=%ct', 'origin/main']
export const REMOVE_ARGV = (main: string, path: string): readonly string[] => ['git', '-C', main, 'worktree', 'remove', path]
export const PROCS_ARGV: readonly string[] = ['/usr/bin/find', '/proc', '-maxdepth', '3', '-regextype', 'posix-extended', '-regex', '/proc/[0-9]+/(cwd|exe|fd/[0-9]+)', '-lname', '/*', '-printf', '%p\\t%l\\n']

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/

/** An absolute path with no control character and no `..` part: the only kind that reaches a command. */
export const isSafePath = (path: string): boolean => path.length > 1 && path.length <= 1024 && path.startsWith('/') && !CONTROL.test(path) && !path.split('/').includes('..')

const SECRETISH_NAME = /^(?:\.env(?:\..+)?|\.npmrc|\.netrc|\.pgpass|\.secrets?|secrets?(?:\..+)?|credentials(?:\..+)?|id_(?:rsa|dsa|ecdsa|ed25519)|.+\.(?:pem|key|p12|pfx|jks|keystore|secret))\/?$/i

/** How many entries of an ignored listing (git ls-files --ignored) are named like a secret or a key (.env*, *.pem, id_rsa, credentials…). Null input is unknown. */
export const countIgnoredSecrets = (listing: string | null): number | null =>
  listing === null ? null : listing.slice(0, IGNORED_MAX_BYTES).split('\n').filter(line => SECRETISH_NAME.test(line.slice(line.lastIndexOf('/', line.length - 2) + 1))).length

export type WtEntry = { path: string; head: string; branch: string | null; isDetached: boolean; isBare: boolean; isLocked: boolean; isPrunable: boolean; isMain: boolean; isSafe: boolean }

/** `git worktree list --porcelain` as entries. Blocks end at a blank line; unknown keys are ignored; the first entry is the main worktree. */
export function parseWorktrees(text: string): { entries: WtEntry[]; isCut: boolean } {
  const isCut = text.length > LIST_MAX_BYTES
  const entries: WtEntry[] = []

  for (const block of text.slice(0, LIST_MAX_BYTES).split(/\n\s*\n/)) {
    const lines = block.split('\n')
    const first = lines.find(line => line.startsWith('worktree '))

    if (first === undefined) continue

    const path = first.slice(9)
    const has = (key: string): string | undefined => lines.find(line => line === key || line.startsWith(`${key} `))
    const branch = has('branch')?.slice(7) ?? null

    entries.push({
      path,
      head: /^[0-9a-f]{7,64}$/.test(has('HEAD')?.slice(5) ?? '') ? (has('HEAD')?.slice(5) as string) : '',
      branch: branch === null ? null : cleanText(branch.replace(/^refs\/heads\//, '')).slice(0, 120),
      isDetached: has('detached') !== undefined,
      isBare: has('bare') !== undefined,
      isLocked: has('locked') !== undefined,
      isPrunable: has('prunable') !== undefined,
      isMain: entries.length === 0,
      isSafe: isSafePath(path),
    })
  }

  return { entries, isCut }
}

/** What the process listing says about the worktrees it was asked about. `ok` is false when it looked blind (see MIN_PROCS). */
export type ProcCheck = { atMs: number; ok: boolean; seen: number; counts: Map<string, number>; paths: Set<string>; why: string | null }

/** `/proc/<pid>/<cwd|exe|fd/n>\t<target>` lines against a set of worktree paths: how many distinct processes sit in each. A target may end ` (deleted)`. */
export function parseProcs(stdout: string, paths: readonly string[], nowMs: number): ProcCheck {
  const per = new Map<string, Set<string>>()
  let seen = 0

  if (stdout.length > PROCS_MAX_BYTES) return { atMs: nowMs, ok: false, seen: 0, counts: new Map(), paths: new Set(paths), why: 'the process listing was too long to read' }

  for (const line of stdout.split('\n')) {
    const tab = line.indexOf('\t')
    const match = tab < 0 ? null : /^\/proc\/(\d+)\/(cwd|exe|fd\/\d+)$/.exec(line.slice(0, tab))

    if (match === null) continue

    const [, pid = '', kind = ''] = match
    const target = line.slice(tab + 1).replace(/ \(deleted\)$/, '')

    if (kind === 'cwd') seen += 1

    for (const path of paths) {
      if (target === path || target.startsWith(`${path}/`)) (per.get(path) ?? per.set(path, new Set()).get(path))?.add(pid)
    }
  }

  const ok = seen >= MIN_PROCS

  return { atMs: nowMs, ok, seen, counts: new Map([...per].map(([path, pids]) => [path, pids.size])), paths: new Set(paths), why: ok ? null : `the process check saw ${seen} working director${seen === 1 ? 'y' : 'ies'} (needs ${MIN_PROCS}): it may be blind here` }
}

/** Processes in this worktree: a number, or null when the check was not made, was blind, or did not cover the path. */
export const inUseOf = (check: ProcCheck | null, path: string): number | null => (check === null || !check.ok || !check.paths.has(path) ? null : (check.counts.get(path) ?? 0))

export type Maker = { run: string; agent: string; isRunning: boolean; how: 'recorded' | 'by name' }

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1)

/** The workflow run and agent that made a worktree: the agent's own recorded path, else a directory or branch named `agent-<id>`. Null is "not attributed". */
export function makerOf(entry: Pick<WtEntry, 'path' | 'branch'>, runs: readonly WfRun[]): Maker | null {
  const named = `${baseName(entry.path)} ${entry.branch ?? ''}`

  for (const run of runs) {
    for (const phase of run.phases) {
      for (const agent of phase.agents) {
        const how = agent.worktreePath === entry.path ? 'recorded' : agent.id.length >= 8 && new RegExp(`(^|[ /-])agent-${agent.id.replace(/[^A-Za-z0-9]/g, '')}($| )`).test(named) ? 'by name' : null

        if (how !== null) return { run: run.name, agent: agent.label, isRunning: agent.state === 'running', how }
      }
    }
  }

  return null
}

export type WtRow = WtEntry & {
  /** Dirty lines (untracked files count), up to DIRTY_CAP; null when the probe failed. */
  dirty: number | null
  /** Ignored files named like a secret (they would go with the directory); null when the probe failed. */
  ignoredSecrets: number | null
  ahead: number | null
  behind: number | null
  createdMs: number | null
  maker: Maker | null
  isCurrent: boolean
}

export type WtRead = { root: string; rows: WtRow[]; total: number; isCut: boolean; refAtMs: number | null; hasRef: boolean; atMs: number }

const oneLine = async (io: WtIo, argv: readonly string[], timeoutMs: number): Promise<string | null> => {
  const result = await io.run(argv, timeoutMs).catch(() => null)

  return result === null || result.exitCode !== 0 ? null : result.stdout
}

/** Whether `cwd` is this worktree or inside it: the one a session is working in. */
export const isCurrentDir = (cwd: string, path: string): boolean => cwd === path || cwd.startsWith(`${path}/`)

async function probeOne(io: WtIo, entry: WtEntry, cwd: string, runs: readonly WfRun[]): Promise<WtRow> {
  const base: WtRow = { ...entry, dirty: null, ignoredSecrets: null, ahead: null, behind: null, createdMs: null, maker: makerOf(entry, runs), isCurrent: isCurrentDir(cwd, entry.path) }

  if (!entry.isSafe || entry.isBare || entry.isPrunable) return base

  const [status, counts, ignored, link] = await Promise.all([oneLine(io, STATUS_ARGV(entry.path), 30_000), oneLine(io, AHEAD_ARGV(entry.path), 15_000), oneLine(io, IGNORED_ARGV(entry.path), 30_000), io.stat(`${entry.path}/.git`).catch(() => undefined)])
  const pair = counts === null ? null : /^(\d+)\s+(\d+)\s*$/.exec(counts)

  return {
    ...base,
    dirty: status === null ? null : Math.min(DIRTY_CAP, status.split('\n').filter(line => line.trim() !== '').length),
    ignoredSecrets: countIgnoredSecrets(ignored),
    behind: pair === null ? null : Number(pair[1]),
    ahead: pair === null ? null : Number(pair[2]),
    createdMs: typeof link?.mtimeMs === 'number' && link.mtimeMs > 0 ? link.mtimeMs : null,
  }
}

/** Reads the worktrees of the repository `cwd` is in. `only` probes that one path (the re-check before each removal). Throws with a plain reason when git does not answer. */
export async function readWorktrees(io: WtIo, input: { cwd: string; nowMs: number; runs: readonly WfRun[]; only?: string }): Promise<WtRead> {
  if (!isSafePath(input.cwd)) throw new Error('no usable working directory')

  const listed = await oneLine(io, LIST_ARGV(input.cwd), 20_000)

  if (listed === null) throw new Error('git did not list the worktrees (not a repository, or git is missing)')

  const { entries, isCut } = parseWorktrees(listed)
  const main = entries[0]

  if (main === undefined || !main.isSafe) throw new Error('git listed no usable main worktree')

  const refText = await oneLine(io, REF_ARGV(main.path), 15_000)
  const refSeconds = refText === null ? NaN : Number(refText.trim())
  const picked = input.only === undefined ? entries : entries.filter(entry => entry.path === input.only)
  const probed = picked.slice(0, MAX_PROBED)
  const rows: WtRow[] = []

  for (let i = 0; i < probed.length; i += BATCH) rows.push(...(await Promise.all(probed.slice(i, i + BATCH).map(entry => probeOne(io, entry, input.cwd, input.runs)))))

  return { root: main.path, rows, total: input.only === undefined ? entries.length : picked.length, isCut, refAtMs: Number.isFinite(refSeconds) && refSeconds > 0 ? refSeconds * 1000 : null, hasRef: Number.isFinite(refSeconds), atMs: input.nowMs }
}

/** The process check for these paths; never throws: a probe that fails is a blind check. */
export async function checkProcs(io: WtIo, paths: readonly string[], nowMs: number): Promise<ProcCheck> {
  const result = await io.run(PROCS_ARGV, 30_000).catch(() => null)

  if (result === null || result.stdout === '') return { atMs: nowMs, ok: false, seen: 0, counts: new Map(), paths: new Set(paths), why: 'the process listing did not answer' }

  return parseProcs(result.stdout, paths, nowMs)
}

/** Whether a worktree sits in a place the console may remove from: under the main worktree's `.claude/worktrees` or `.git-worktrees`. */
export const isRemovableDir = (root: string, path: string): boolean => {
  const base = root.replace(/\/+$/, '')

  return isSafePath(path) && REMOVABLE_DIRS.some(dir => path.startsWith(`${base}/${dir}/`) && path.length > base.length + dir.length + 2)
}

/** Why a worktree is kept, in words; null means it may be removed. The order is the order of the worst reasons first. */
export function whyKept(row: WtRow, read: Pick<WtRead, 'root' | 'hasRef'>, check: ProcCheck | null, nowMs: number): string | null {
  const inUse = inUseOf(check, row.path)

  if (row.isMain) return 'the main worktree'
  if (row.isCurrent) return 'this session is working in it'
  if (!row.isSafe) return 'its path is not one the console will pass to a command'
  if (row.isBare || row.isPrunable) return row.isBare ? 'bare' : 'its directory is gone: git worktree prune, not remove'
  if (row.isLocked) return 'locked'
  if (!isRemovableDir(read.root, row.path)) return `outside ${REMOVABLE_DIRS.join(' and ')} under the main worktree`
  if (row.dirty === null) return 'not known whether it has changes'
  if (row.dirty > 0) return `${row.dirty >= DIRTY_CAP ? `${DIRTY_CAP}+` : row.dirty} changed or untracked file${row.dirty === 1 ? '' : 's'}`
  if (row.ignoredSecrets === null) return 'not known whether it has ignored files such as a .env'
  if (row.ignoredSecrets > 0) return `${row.ignoredSecrets} ignored file${row.ignoredSecrets === 1 ? '' : 's'} named like a secret (.env, a key): removing the directory would delete ${row.ignoredSecrets === 1 ? 'it' : 'them'}`
  if (!read.hasRef || row.ahead === null) return 'origin/main is not known here, so merged cannot be told'
  if (row.ahead > 0) return `${row.ahead} commit${row.ahead === 1 ? '' : 's'} not in origin/main`
  if (row.createdMs === null) return 'its age is not known'
  if (nowMs - row.createdMs < MIN_AGE_MS) return 'made less than a day ago'
  if (row.maker?.isRunning === true) return `agent ${row.maker.agent} is still running`
  if (inUse === null) return check === null ? 'live processes not checked yet' : (check.why ?? 'live processes not checked for this one')
  if (inUse > 0) return `${inUse} live process${inUse === 1 ? '' : 'es'} in it`

  return null
}

export type RemovalPlan = { targets: WtRow[]; kept: { path: string; why: string }[]; more: number; blocked: string | null }

/** The worktrees a confirm would remove (clean, inside origin/main, not current, no live process, old enough), and why each other is kept. */
export function planRemoval(read: WtRead | null, check: ProcCheck | null, nowMs: number): RemovalPlan {
  if (read === null) return { targets: [], kept: [], more: 0, blocked: 'worktrees not read yet' }
  if (check === null || !check.ok || nowMs - check.atMs > PROCS_FRESH_MS) return { targets: [], kept: [], more: 0, blocked: check === null ? 'live processes not checked: press the read button first' : (check.why ?? 'the live-process check is older than 2 minutes: read again') }

  const kept: { path: string; why: string }[] = []
  const all: WtRow[] = []

  for (const row of read.rows) {
    const why = whyKept(row, read, check, nowMs)

    if (why === null) all.push(row)
    else kept.push({ path: row.path, why })
  }

  return { targets: all.slice(0, REMOVE_MAX), kept, more: Math.max(0, all.length - REMOVE_MAX), blocked: all.length === 0 ? 'nothing is both merged and clean' : null }
}

/** What a read could say of itself in one sentence, with the counts a person scans for. */
export const readSummary = (read: WtRead): string => `${read.total} worktree${read.total === 1 ? '' : 's'}${read.rows.length < read.total ? ` (${read.rows.length} probed)` : ''}${read.isCut ? ` (list cut at ${LIST_MAX_BYTES / 1024} KB)` : ''}`

/** A failed read in plain words. */
export const failureOf = (error: unknown): string => cleanText(plain(error instanceof Error ? error.message : String(error), 100)) || 'the read was refused'
