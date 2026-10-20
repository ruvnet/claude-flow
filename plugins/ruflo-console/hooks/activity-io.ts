/**
 * The one write path for the Events and Timeline files (ADR-474), with the host's `fs` and `run` passed in so a test supplies its own.
 * Lines are queued in memory and written in batches (never one write per event): at most one write per file is in flight, each batch
 * is at most BATCH_MAX bytes, and a failure is remembered and retried later, never thrown. A write appends through the journal's fixed
 * argv (data/append-argv.ts: GNU `dd oflag=append` with no shell on Linux, a constant `sh -c` script with the path as `$1` on macOS/BSD; the
 * path is one element either way, and one dd block per batch into an O_APPEND file keeps two consoles' batches apart unless a write is split). A file past its cap is cut to its newest half through a temporary file and a rename.
 * The folder is created once, and nothing is written through a link.
 */
import { checkNoLinks } from './data/wf-file'
import { appendArgv } from './data/append-argv'
import { dirOf, newFileArgv, replaceFileArgv } from './data/wf-file'
import { writeFlavorReady } from './data/write-flavor'
import { keepNewestHalf, READ_MAX } from './data/activity-store'
import type { Host } from './host'

export type IoHost = Pick<Host, 'fs' | 'run'>

export const BATCH_MAX = 32 * 1024

/** The append argv is shared with the autopilot journal (data/append-argv.ts): one block per batch, so two consoles never tear a line. A batch is at most BATCH_MAX plus one line. */
export { appendArgv }

/** The folder's own `.gitignore` (`*`): `.claude-flow/.gitignore` from `ruflo init` does not list `console/`, and these files hold a person's history. */
export const IGNORE_BODY = '# the ruflo console\'s own history: local state, never committed\n*\n'
export const PENDING_MAX = 2_000
export const RETRY_MS = 30_000
const WRITE_TIMEOUT_MS = 10_000

type Channel = { path: string; cap: number; pending: string[]; isWriting: boolean; size: number | null; retryAtMs: number; error: string | null; isDirReady: boolean; clearAtMs: number; writes: number; rotations: number }

const channels = new Map<string, Channel>()
const ignored = new Set<string>()

export const channelOf = (path: string, cap: number): Channel => {
  const found = channels.get(path)

  if (found !== undefined) return found

  const made: Channel = { path, cap, pending: [], isWriting: false, size: null, retryAtMs: 0, error: null, isDirReady: false, clearAtMs: 0, writes: 0, rotations: 0 }

  channels.set(path, made)

  return made
}

/** For tests: forgets every channel. */
export const resetIo = (): void => {
  channels.clear()
  ignored.clear()
}

/** Queues one line; the oldest queued lines go when a failing disk lets the queue grow past PENDING_MAX. */
export function queueLine(path: string, cap: number, line: string): void {
  const channel = channelOf(path, cap)

  channel.pending.push(line)
  if (channel.pending.length > PENDING_MAX) channel.pending.splice(0, channel.pending.length - PENDING_MAX)
}

export const pendingOf = (path: string): number => channels.get(path)?.pending.length ?? 0
export const errorOf = (path: string): string | null => channels.get(path)?.error ?? null
export const forgetChannel = (path: string): void => void channels.delete(path)

const tmpOf = (path: string): string => `${path}.tmp`

/** Writes `<dir>/.gitignore` once per folder if there is none (the exclusive create fails, harmlessly, where one exists). Never throws. */
async function ensureIgnored(host: IoHost, dir: string): Promise<void> {
  if (ignored.has(dir)) return

  ignored.add(dir)
  await host.run(newFileArgv(`${dir}/.gitignore`, true, await writeFlavorReady()), WRITE_TIMEOUT_MS, IGNORE_BODY).catch(() => undefined)
}

async function rotate(host: IoHost, channel: Channel): Promise<void> {
  const stat = await host.fs.stat(channel.path).catch(() => undefined)

  if (stat === undefined) return

  const size = stat.size ?? channel.size ?? 0
  const kept = size > READ_MAX ? '' : keepNewestHalf(await host.fs.read(channel.path).catch(() => ''), channel.cap)
  await host.run(['rm', '-f', '--', tmpOf(channel.path)], WRITE_TIMEOUT_MS)

  // The flavor is awaited before the first flavored write; the rm, mv and mkdir argv are the same on GNU and BSD, so they need none.
  const written = await host.run(newFileArgv(tmpOf(channel.path), true, await writeFlavorReady()), WRITE_TIMEOUT_MS, kept)

  if (written.exitCode !== 0) return

  const moved = await host.run(['mv', '-f', '--', tmpOf(channel.path), channel.path], WRITE_TIMEOUT_MS)

  if (moved.exitCode === 0) {
    channel.size = kept.length
    channel.rotations++
  }
}

/** One pass for one file: writes what is queued if nothing is in flight and no recent failure is waiting out. Never throws. */
export async function flush(host: IoHost, cwd: string, path: string, nowMs: number = Date.now()): Promise<void> {
  const channel = channels.get(path)

  if (channel === undefined || channel.pending.length === 0 || channel.isWriting || nowMs < channel.retryAtMs) return

  channel.isWriting = true

  const batch: string[] = []
  let bytes = 0

  while (channel.pending.length > 0 && bytes + (channel.pending[0] as string).length <= BATCH_MAX) {
    const line = channel.pending.shift() as string

    batch.push(line)
    bytes += line.length
  }

  if (batch.length === 0) batch.push(channel.pending.shift() as string)

  try {
    const clear = await checkNoLinks(host.fs, path, { cwd: cwd.replace(/\/+$/, '') }, { allowExisting: true })

    if (!clear.ok) throw new Error(clear.why)

    if (!channel.isDirReady) {
      const made = await host.run(['mkdir', '-p', '--', dirOf(path)], WRITE_TIMEOUT_MS)

      if (made.exitCode !== 0) throw new Error(`the folder could not be made (exit ${made.exitCode})`)
      channel.isDirReady = true
    }

    await ensureIgnored(host, dirOf(path))

    if (channel.size === null) channel.size = (await host.fs.stat(path).catch(() => undefined))?.size ?? 0

    const result = await host.run(appendArgv(path, await writeFlavorReady()), WRITE_TIMEOUT_MS, batch.join(''))

    if (result.exitCode !== 0) throw new Error(`the write exited ${result.exitCode}`)

    channel.size += bytes
    channel.writes++
    channel.error = null

    if (channel.size > channel.cap) await rotate(host, channel)
  } catch (error) {
    channel.pending.unshift(...batch)
    channel.error = (error instanceof Error ? error.message : 'the write was refused').slice(0, 80)
    channel.retryAtMs = nowMs + RETRY_MS
  } finally {
    channel.isWriting = false
  }
}

/** Replaces a small state file whole (the prefs): checked for links, written in place. Returns the problem, or null. */
export async function replaceFile(host: IoHost, cwd: string, path: string, content: string): Promise<string | null> {
  try {
    const clear = await checkNoLinks(host.fs, path, { cwd: cwd.replace(/\/+$/, '') }, { allowExisting: true })

    if (!clear.ok) return clear.why.slice(0, 80)

    const hasDir = (await host.fs.stat(dirOf(path)).catch(() => undefined)) !== undefined
    const result = await host.run(replaceFileArgv(path, hasDir, await writeFlavorReady()), WRITE_TIMEOUT_MS, content)

    if (result.exitCode === 0) await ensureIgnored(host, dirOf(path))

    return result.exitCode === 0 ? null : `the write exited ${result.exitCode}`
  } catch (error) {
    return error instanceof Error ? error.message.slice(0, 80) : 'the write was refused'
  }
}
