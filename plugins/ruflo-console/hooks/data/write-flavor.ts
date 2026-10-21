/**
 * Which file-writing argv the host's tools take, and the POSIX forms of those writes. The host's `fs` is read-only, so the console writes
 * through fixed argv with the content on stdin. The GNU forms (`dd oflag=append`, `dd conv=excl`, `install -D`) are what Linux has always
 * run; BSD `dd` and `install` (macOS) refuse every one of them ("dd: unknown open flag append", "dd: unknown conversion excl", `install`
 * usage, exit 64), so there the same writes go through `sh -c` with one of the constant scripts below and the path as `$1`.
 *
 * There is no generic shell builder: only the enumerated operations are exported, each with its own constant script, and the path is
 * only ever expanded quoted ("$1"), so no character in it is interpreted. Every script first refuses a target that is a link or is not a
 * regular file (a FIFO, a device, a folder): exit 73 with the reason on stderr. That check and the open are two steps, so a link raced in
 * between them is followed; this is the same check-then-write window as `checkNoLinks`, which every caller runs first.
 *
 * Ordering: the flavor is detected once per process from `uname -s` (`startWriteFlavorDetection`, called at session start before the
 * controller exists). Every write path awaits `writeFlavorReady()` before it builds an argv, and the builders take the flavor as a required
 * argument, so no write can be built with a guessed flavor. Detection has its own deadline (DETECT_DEADLINE_MS), independent of the host's
 * timeout, so a runner that never settles cannot hold a write (the kill switch flag included) forever. Where `uname` fails, answers
 * nothing or misses the deadline, the engine's own `process.platform` decides (darwin and the BSDs: posix; anything else: gnu), because
 * the GNU argv is known to fail on macOS. A leaf: no imports.
 */
export type WriteFlavor = 'gnu' | 'posix'

let detection: Promise<WriteFlavor> | null = null

/** How long detection may take before the platform fallback answers. */
export const DETECT_DEADLINE_MS = 3_000

/** The engine's own platform (`process.platform` where the runtime exposes it), to a flavor: darwin and *bsd are posix, the rest gnu. */
export function flavorOfPlatform(platform: unknown = (globalThis as { process?: { platform?: unknown } }).process?.platform): WriteFlavor {
  return typeof platform === 'string' && (platform === 'darwin' || platform.endsWith('bsd')) ? 'posix' : 'gnu'
}

type Run = (argv: readonly string[], timeoutMs: number) => Promise<{ exitCode: number | null; stdout: string }>

/**
 * Starts the one detection of this process (later calls return the same promise). `run` is the host's command runner. Never rejects, and
 * settles within `deadlineMs` whatever the runner does.
 */
export function startWriteFlavorDetection(run: Run, deadlineMs: number = DETECT_DEADLINE_MS, fallback: () => WriteFlavor = flavorOfPlatform): Promise<WriteFlavor> {
  if (detection !== null) return detection

  const asked = Promise.resolve()
    .then(() => run(['uname', '-s'], deadlineMs))
    .then(
      result => (result.exitCode === 0 && result.stdout.trim() !== '' ? flavorOfKernel(result.stdout) : fallback()),
      () => fallback(),
    )
  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<WriteFlavor>(resolve => {
    timer = setTimeout(() => resolve(fallback()), deadlineMs)
  })

  detection = Promise.race([asked, deadline]).finally(() => clearTimeout(timer))

  return detection
}

/** The flavor every write awaits before it builds its argv: the detection's answer, or `gnu` where none was started (a test host, a build without a session). */
export const writeFlavorReady = (): Promise<WriteFlavor> => detection ?? Promise.resolve('gnu')

/** Tests: a known flavor (or, with null, back to "never detected"). */
export const setWriteFlavor = (flavor: WriteFlavor | null): void => {
  detection = flavor === null ? null : Promise.resolve(flavor)
}

/** `uname -s` output to a flavor: Linux keeps the GNU argv; every other kernel (Darwin, the BSDs) takes the sh scripts. */
export const flavorOfKernel = (kernel: string): WriteFlavor => (kernel.trim() === 'Linux' ? 'gnu' : 'posix')

/** Refuses a target that is a link (dangling or not) or exists and is not a regular file. */
const GUARD = 'if [ -L "$1" ] || { [ -e "$1" ] && [ ! -f "$1" ]; }; then echo "refused: the target is a link or not a regular file" >&2; exit 73; fi;'
/** Makes the folder the file sits in (`install -D` did this on GNU). */
const MKDIR = 'mkdir -p -- "$(dirname -- "$1")" || exit 1;'

/**
 * The whole set of POSIX write scripts. umask 022 makes a created file 0644 (as `install -m 0644`); the touch uses 077 and chmod 600.
 * `set -C` (noclobber) makes the shell open with O_CREAT|O_EXCL, so an exclusive create fails on a file that is already there.
 */
export const POSIX_SCRIPTS = Object.freeze({
  append: `umask 022; ${GUARD} exec dd bs=1M iflag=fullblock status=none >> "$1"`,
  createExclusive: `umask 022; ${GUARD} set -C; exec cat > "$1"`,
  createExclusiveWithDirs: `umask 022; ${MKDIR} ${GUARD} set -C; exec cat > "$1"`,
  replace: `umask 022; ${GUARD} exec cat > "$1"`,
  replaceWithDirs: `umask 022; ${MKDIR} ${GUARD} exec cat > "$1"`,
  touch: `umask 077; ${MKDIR} ${GUARD} if [ ! -f "$1" ]; then set -C; : > "$1" || exit 1; fi; exec chmod 600 "$1"`,
  /** "$1" the new file, "$2" the regular file it copies (refused if a link or not regular); umask 077: the copy is 0600, like the journal. */
  copyExclusive: `umask 077; ${GUARD} if [ -L "$2" ] || [ ! -f "$2" ]; then echo "refused: the source is a link or not a regular file" >&2; exit 73; fi; set -C; exec cat < "$2" > "$1"`,
} as const)

type PosixOp = keyof typeof POSIX_SCRIPTS

/** The only sh argv: a script from the set above by key, then the target as "$1" (and, for a copy, its source as "$2"). */
const posix = (op: PosixOp, path: string, source?: string): readonly string[] => ['sh', '-c', POSIX_SCRIPTS[op], 'sh', path, ...(source === undefined ? [] : [source])]

/** Appends stdin; one `dd` block of up to 1 MiB per batch through an O_APPEND open (`>>`). */
export const posixAppend = (path: string): readonly string[] => posix('append', path)
/** Creates a new file from stdin; fails if anything is at the path. */
export const posixCreateExclusive = (path: string): readonly string[] => posix('createExclusive', path)
/** Makes the folders, then creates a new file from stdin; fails if anything is at the path. */
export const posixCreateExclusiveWithDirs = (path: string): readonly string[] => posix('createExclusiveWithDirs', path)
/** Replaces a regular file (or creates it) from stdin. */
export const posixReplace = (path: string): readonly string[] => posix('replace', path)
/** Makes the folders, then replaces (or creates) a regular file from stdin. */
export const posixReplaceWithDirs = (path: string): readonly string[] => posix('replaceWithDirs', path)
/** Makes the folders and an empty 0600 file where none is (an existing regular file keeps its content and is set to 0600). */
export const posixTouch = (path: string): readonly string[] => posix('touch', path)
/** Copies the regular file `source` to a new file `path`; fails if anything is at `path` (BSD cp has no --no-clobber; `cp -n` exits 0 when it skips). */
export const posixCopyExclusive = (source: string, path: string): readonly string[] => posix('copyExclusive', path, source)
