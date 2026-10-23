/**
 * The one place the console's disk writes are carried out, whatever the machine has. `writeVia(flavor, host, op)` runs one of the
 * enumerated operations: on Linux (`gnu`) and macOS/BSD (`posix`) it is exactly the fixed argv it always was (append-argv.ts, wf-file.ts,
 * write-flavor.ts), through `host.run` with the content on stdin; on Windows (`host-fs`), where none of dd, sh, install, mkdir or cp is on
 * the engine's PATH, it goes through the host's file API: `fs.read`, `fs.write` and `fs.exists`.
 *
 * What `host-fs` does, and where it differs:
 *  - The host's `fs.write` makes the folders and replaces the whole file, so a missing folder needs nothing ('create-dirs'), and an
 *    append is read-then-write of the whole text. Both the read and the write are refused past 4 MiB, so an append whose result would pass
 *    that is refused with a reason rather than cut; the callers that grow a file (the Events and Timeline files, the autopilot journal)
 *    rotate long before (2 MiB, 1 MiB, 1.5 MiB) exactly where they did with dd.
 *  - An append is not atomic: two consoles appending to one file at once can lose a batch (dd's O_APPEND kept both).
 *  - A target that is a link, or exists and is not a regular file (a folder), is refused as the sh scripts refuse it (exit 73).
 *  - An exclusive create or copy refuses a path where anything exists; it says so in the same words the pre-write check uses.
 *  - No file mode is set (Windows has none to set).
 *  - The host API has no O_EXCL. 'create-excl', 'create-dirs' and 'copy-no-clobber' are check-then-write: a file that appears between the
 *    `exists` check and the `fs.write` is overwritten (GNU `dd conv=excl` and the POSIX `set -C` fail instead). Callers run `checkNoLinks`
 *    first, so this takes a second writer creating that exact path inside the window.
 *  - Windows has no delete here: callers that removed a file (the autopilot KILL flag) rewrite it with a marker instead.
 * Never rejects on host-fs: a refusal is `{ exitCode: <non-zero>, stderr: <the reason> }`, like a command that exited non-zero.
 */
import { appendArgv } from './append-argv'
import { touchArgv } from './ap-journal'
import type { ReaderFs } from './files'
import { copyExclusiveArgv, newFileArgv, replaceFileArgv } from './wf-file'
import type { WriteFlavor } from './write-flavor'

/** The host file API refuses to read or write more than this. */
export const HOST_FS_MAX = 4 * 1024 * 1024

/** The host's fs as a write needs it: the reads of `ReaderFs`, and the write and exists calls (a test host may leave them out). */
export type WriterFs = ReaderFs & { write?: (path: string, text: string) => Promise<void>; exists?: (path: string) => Promise<boolean> }

export type WriteResult = { exitCode: number; stdout: string; stderr: string }

export type WriteHost = {
  fs: WriterFs
  run: (argv: readonly string[], timeoutMs: number, stdin?: string) => Promise<WriteResult>
}

export type WriteOp = {
  /**
   * append: add `text` to the file (created if none). create-excl: a new file, `text` in it, failing if anything is at the path, in a
   * folder that is there. create-dirs: the same, the folders made first. replace: the file becomes `text` (`hasDir`: its folder exists).
   * touch: an empty file where none is. copy-no-clobber: the file `from` copied to a new `path`.
   */
  kind: 'append' | 'create-excl' | 'create-dirs' | 'replace' | 'touch' | 'copy-no-clobber'
  path: string
  text?: string
  from?: string
  hasDir?: boolean
  timeoutMs?: number
}

export const ALREADY_EXISTS = 'already exists: the console does not overwrite a file; pick another name'

const bytesOf = (text: string): number => (typeof TextEncoder === 'function' ? new TextEncoder().encode(text).length : text.length * 3)
const refuse = (stderr: string, exitCode = 1): WriteResult => ({ exitCode, stdout: '', stderr })

/** The argv form of an op, for `gnu` and `posix` (the stdin is the op's text). */
export function argvOf(flavor: Exclude<WriteFlavor, 'host-fs'>, op: WriteOp): readonly string[] {
  switch (op.kind) {
    case 'append':
      return appendArgv(op.path, flavor)
    case 'create-excl':
      return newFileArgv(op.path, true, flavor)
    case 'create-dirs':
      return newFileArgv(op.path, false, flavor)
    case 'replace':
      return replaceFileArgv(op.path, op.hasDir ?? true, flavor)
    case 'touch':
      return touchArgv(op.path, flavor)
    case 'copy-no-clobber':
      return copyExclusiveArgv(op.from ?? '', op.path, flavor)
  }
}

/** Carries out one write, the way the machine's flavor says. */
export async function writeVia(flavor: WriteFlavor, host: WriteHost, op: WriteOp): Promise<WriteResult> {
  if (flavor !== 'host-fs') return host.run(argvOf(flavor, op), op.timeoutMs ?? 10_000, op.text)

  try {
    return await viaHostFs(host.fs, op)
  } catch (error) {
    return refuse((error instanceof Error ? error.message : 'the write was refused').slice(0, 160))
  }
}

async function viaHostFs(fs: WriterFs, op: WriteOp): Promise<WriteResult> {
  const write = fs.write

  if (write === undefined) return refuse('the host file API cannot write here')

  const exists = async (path: string): Promise<boolean> => (fs.exists !== undefined ? fs.exists(path) : (await fs.stat(path).catch(() => undefined)) !== undefined)
  const put = (path: string, text: string): Promise<void> => write(path, text)

  // The same refusal the sh scripts make: a link, or something that is not a regular file (a folder), is never written through.
  const target = await fs.stat(op.path).catch(() => undefined)

  if (target !== undefined && (target.isLink === true || (target.kind !== undefined && target.kind !== 'file'))) {
    return refuse('refused: the target is a link or not a regular file', 73)
  }

  const text = op.text ?? ''

  switch (op.kind) {
    case 'append': {
      const before = target === undefined && !(await exists(op.path)) ? '' : await fs.read(op.path)

      if (bytesOf(before) + bytesOf(text) > HOST_FS_MAX) return refuse('refused: the file would pass 4 MiB, which the host file API cannot write')
      await put(op.path, before + text)

      return refuse('', 0)
    }
    case 'create-excl':
    case 'create-dirs': {
      if (target !== undefined || (await exists(op.path))) return refuse(ALREADY_EXISTS)
      if (bytesOf(text) > HOST_FS_MAX) return refuse('refused: the file would pass 4 MiB, which the host file API cannot write')
      await put(op.path, text)

      return refuse('', 0)
    }
    case 'replace': {
      if (bytesOf(text) > HOST_FS_MAX) return refuse('refused: the file would pass 4 MiB, which the host file API cannot write')
      await put(op.path, text)

      return refuse('', 0)
    }
    case 'touch': {
      if (target === undefined && !(await exists(op.path))) await put(op.path, '')

      return refuse('', 0)
    }
    case 'copy-no-clobber': {
      const from = op.from ?? ''
      const source = await fs.stat(from).catch(() => undefined)

      if (source === undefined || source.isLink === true || (source.kind !== undefined && source.kind !== 'file')) return refuse('refused: the source is a link or not a regular file', 73)
      if (target !== undefined || (await exists(op.path))) return refuse(ALREADY_EXISTS)
      await put(op.path, await fs.read(from))

      return refuse('', 0)
    }
  }
}
