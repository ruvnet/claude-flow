/**
 * Toast policy (ADR-477): levels, one-line washing, de-duplication, a per-source rate limit, the person's setting, and digests for
 * the console's Events page. One CANONICAL source, plugins/ruflo-mods/hooks/toast/policy.ts; every other plugin carries a byte-identical
 * copy at hooks/toast-policy.ts, written and checked by scripts/sync-toast-policy.mjs (a plugin ships alone through the marketplace and
 * cannot import a sibling at run time). Edit the canonical file, run `node scripts/sync-toast-policy.mjs`, never a copy.
 *
 * Dependency-free and engine-free: no `$`, no import. The engine is reached only through the functions a plugin hands in, so every
 * rule here is a plain function a test can drive with a fake clock. Nothing in this file throws to its caller: a refused toast, an
 * unreadable setting or a failed write is a result, never a crash.
 */

export type ToastLevel = 'info' | 'ok' | 'warn' | 'error'
/** all: every level; important: warn and error, plus a toast marked `always`; off: none (all are still recorded). */
export type ToastMode = 'all' | 'important' | 'off'
export type ToastPrefs = { mode: ToastMode; muted: readonly string[] }
/** Why a toast was or was not drawn. `shown` is the only one that drew. `coalesced` is an error held for one later line. */
export type Why = 'shown' | 'deduped' | 'rate-limited' | 'coalesced' | 'muted' | 'off' | 'filtered' | 'away' | 'refused'

export const TOAST_SOURCES = ['console', 'swarm', 'protector', 'mods'] as const
export const TOAST_MODES: readonly ToastMode[] = ['all', 'important', 'off']
export const LEVELS: readonly ToastLevel[] = ['info', 'ok', 'warn', 'error']
export const DEFAULT_PREFS: ToastPrefs = { mode: 'all', muted: [] }
export const PREFIX: Readonly<Record<ToastLevel, string>> = { info: '›', ok: '✓', warn: '⚠', error: '✗' }

/** A whole toast line, prefix included, is never longer than this. */
export const LINE_MAX = 120
/** An identical (source, text) is not drawn again inside this window. */
export const DEDUPE_MS = 60_000
/** A source draws at most RATE_MAX toasts in RATE_WINDOW_MS; an error past that is held and said once, with a count. */
export const RATE_MAX = 4
export const RATE_WINDOW_MS = 60_000
/** Digests kept per source (a ring), and how long the setting is believed before the file is read again. */
export const RING_MAX = 60
export const PREFS_TTL_MS = 4_000
export const CONSOLE_TTL_MS = 30_000
/** The setting (written by the console's Settings) and the folder of per-source digest files (read by the console). */
export const CONSOLE_DIR = '.claude-flow/console'
export const PREFS_FILE = `${CONSOLE_DIR}/toast-prefs.json`
export const TOAST_DIR = `${CONSOLE_DIR}/toasts`
export const MASK = '‹masked›'

// ------------------------------------------------------------------------------------------------------------ washing

const ESCAPES = new RegExp('\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\)|\\u009d[^\\u0007\\u009c]*[\\u0007\\u009c]|(?:\\u001b\\[|\\u009b)[0-9;?]*[ -/]*[@-~]', 'g')
/** White space of every kind (and the line and paragraph separators) becomes one space. */
const SPACES = new RegExp('[\\s\\u0085\\u2028\\u2029]+', 'g')
/** A control, zero-width, bidi or tag character is deleted, not spaced: `sk-ant-AAAA<NUL>BBBB` is one credential. */
const DROPPED = new RegExp('[\\u0000-\\u0008\\u000e-\\u001f\\u007f-\\u0084\\u0086-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u206f\\u3164\\ufe00-\\ufe0f\\ufeff\\uffa0\\ufff9-\\ufffb]|[\\u{e0000}-\\u{e0fff}]', 'gu')
const SECRETISH = new RegExp(
  [
    String.raw`\b(?:sk|pk|ghp|gho|ghs|github_pat|xox[abprs]|xapp|AKIA|ASIA|AIza)[-_A-Za-z0-9]{12,}`,
    String.raw`\b(?:glpat|npm|hf|dop_v1|shpat|whsec|rk_live|sk_live|ya29)[-_.][-_.A-Za-z0-9]{12,}`,
    String.raw`\bBearer\s+\S{8,}`,
    String.raw`\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.?[A-Za-z0-9_-]*`,
    String.raw`\b[A-Za-z0-9+_-]{32,}={0,2}`,
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`,
    String.raw`\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@`,
    String.raw`(?:key|token|secret|passw(?:or)?d|pwd|passphrase|credential|authorization|cookie)["']?\s*[=:]\s*(?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"|'[^']*'|\S+)`,
    String.raw`(?<![A-Za-z0-9])pass["']?\s*=\s*(?:"[^"]*"|'[^']*'|\S+)`,
    String.raw`(?:^|\s)--?(?:token|password|passwd|pwd|secret|api-?key|auth(?:orization)?|access-?key|client-?secret)(?:=|\s+)\S+`,
  ].join('|'),
  'gi',
)
const HOME_PATH = /\/(?:home|Users)\/[^/\s'"]+/g
const EMAIL = /\b[\w.+-]{1,64}@[A-Za-z0-9-]{1,63}(?:\.[A-Za-z0-9-]{1,63})+\b/g

/** One line of at most `max` characters: escapes and control characters gone, white space collapsed, credentials, e-mail addresses and home paths masked, an ellipsis where it was cut. Never throws; a non-string is ''. */
export function tidy(value: unknown, max: number = LINE_MAX): string {
  if (typeof value !== 'string') return ''

  const washed = value.slice(0, 4096).replace(ESCAPES, '').replace(SPACES, ' ').replace(DROPPED, '').trim()
  const masked = washed.replace(SECRETISH, MASK).replace(EMAIL, MASK).replace(HOME_PATH, '~')

  return masked.length > max ? `${masked.slice(0, Math.max(0, max - 1))}…` : masked
}

/** The line a toast draws: its level's prefix, a space, the washed text; the whole is at most LINE_MAX. '' when there is no text. */
export function lineOf(level: ToastLevel, text: unknown): string {
  const body = tidy(text, LINE_MAX - 2)

  return body === '' ? '' : `${PREFIX[level]} ${body}`
}

// ------------------------------------------------------------------------------------------------------------ the setting

const SOURCE_NAME = /^[a-z][a-z0-9-]{0,23}$/

/** The setting from its file's text: anything unreadable, or an unknown mode, is the default (all, nothing muted). At most 8 names are muted. */
export function parsePrefs(text: string | null | undefined): ToastPrefs {
  if (typeof text !== 'string' || text.length > 4096) return DEFAULT_PREFS

  try {
    const o: unknown = JSON.parse(text)

    if (typeof o !== 'object' || o === null || Array.isArray(o)) return DEFAULT_PREFS

    const r = o as { mode?: unknown; muted?: unknown }
    const mode = TOAST_MODES.find(candidate => candidate === r.mode) ?? 'all'
    const muted = Array.isArray(r.muted) ? [...new Set(r.muted.filter((name): name is string => typeof name === 'string' && SOURCE_NAME.test(name)))].slice(0, 8) : []

    return { mode, muted }
  } catch {
    return DEFAULT_PREFS
  }
}

export const encodePrefs = (prefs: ToastPrefs): string => `${JSON.stringify({ v: 1, mode: prefs.mode, muted: [...new Set(prefs.muted)].filter(name => SOURCE_NAME.test(name)).slice(0, 8) })}\n`

// ------------------------------------------------------------------------------------------------------------ digests

/** What is kept of every toast, drawn or not: masked, short, and flagged with what became of it. */
export type Digest = { t: number; source: string; level: ToastLevel; text: string; shown: boolean; why: Why; /** How many identical, consecutive ones this stands for (absent: one). */ n?: number }

const WHYS: readonly Why[] = ['shown', 'deduped', 'rate-limited', 'coalesced', 'muted', 'off', 'filtered', 'away', 'refused']

/** Adds a digest to a ring (newest last). An identical neighbour (source, text, outcome) is counted, not repeated. Mutates `ring`. */
export function pushDigest(ring: Digest[], d: Digest, cap: number = RING_MAX): void {
  const last = ring[ring.length - 1]

  if (last !== undefined && last.source === d.source && last.text === d.text && last.why === d.why && last.level === d.level) {
    last.n = (last.n ?? 1) + 1
    last.t = d.t
  } else ring.push({ ...d })

  if (ring.length > cap) ring.splice(0, ring.length - cap)
}

export const encodeRing = (ring: readonly Digest[]): string =>
  ring.map(d => `${JSON.stringify({ v: 1, t: Math.round(d.t), s: d.source, l: d.level, x: d.text, w: d.why, ...(d.n !== undefined && d.n > 1 && { n: d.n }) })}\n`).join('')

/** The digests in a ring file's text; a line that is not ours, or is cut off, is skipped. Text is washed again: a file is not trusted. */
export function decodeRing(text: string | null | undefined): Digest[] {
  if (typeof text !== 'string' || text === '') return []

  const out: Digest[] = []

  for (const line of text.slice(-300_000).split('\n')) {
    if (line.length < 2 || line.length > 600 || line[0] !== '{') continue

    try {
      const o = JSON.parse(line) as Record<string, unknown>
      const level = LEVELS.find(candidate => candidate === o.l)
      const why = WHYS.find(candidate => candidate === o.w)
      const source = typeof o.s === 'string' && SOURCE_NAME.test(o.s) ? o.s : undefined
      const body = tidy(o.x, LINE_MAX)

      if (o.v !== 1 || typeof o.t !== 'number' || !Number.isFinite(o.t) || level === undefined || why === undefined || source === undefined || body === '') continue
      out.push({ t: o.t, source, level, text: body, shown: why === 'shown', why, ...(typeof o.n === 'number' && o.n > 1 && o.n < 1e6 && { n: Math.floor(o.n) }) })
    } catch {
      /* a half-written line */
    }
  }

  return out
}

// ------------------------------------------------------------------------------------------------------------ the toaster

type Maybe<T> = T | Promise<T>

const isThenable = (value: unknown): value is Promise<unknown> => typeof value === 'object' && value !== null && typeof (value as { then?: unknown }).then === 'function'

/** `f` over a value that may be a promise: synchronous when the value is, and a failure becomes `fallback()`, never a throw. */
function chain<T, U>(value: Maybe<T>, f: (v: T) => Maybe<U>, fallback: () => Maybe<U>): Maybe<U> {
  try {
    return isThenable(value) ? ((value as Promise<T>).then(f, fallback) as Maybe<U>) : f(value as T)
  } catch {
    return fallback()
  }
}

export type ToastInput = {
  level?: ToastLevel
  text: string
  timeoutMs?: number
  /** Passes the `important` filter whatever its level (still muted by `off` and by a per-source mute). */
  always?: boolean
  /** Drawn only when the person is away: held back (and recorded) when `away()` answers false; drawn as usual when the host cannot say. */
  awayOnly?: boolean
}

export type ToasterDeps = {
  source: string
  /** Milliseconds; may be a promise (`$.clock.now()`). The whole toast is synchronous when this and `prefs` are. */
  now: () => Maybe<number>
  /** Draws the line (`$.ui.toast`). May throw: that is `refused`. */
  show: (line: string, options: { timeoutMs?: number }) => void
  prefs?: () => Maybe<ToastPrefs>
  /** Gets every digest, drawn or not. Fire and forget. */
  persist?: (digest: Digest) => unknown
  away?: () => boolean | undefined
  /** Schedules the release of held errors; without it they are released by the next toast or `release()`. */
  after?: (ms: number, fn: () => void) => unknown
  dedupeMs?: number
  rateMax?: number
  windowMs?: number
}

export type Toaster = {
  /** Decides, draws or holds, records. Resolves to what became of it; never rejects. */
  toast: (input: ToastInput) => Maybe<Why | 'empty'>
  /** Draws held errors once the window has room: `✗ <first> … and N more`. */
  release: () => Maybe<void>
}

export function createToaster(deps: ToasterDeps): Toaster {
  const dedupeMs = deps.dedupeMs ?? DEDUPE_MS
  const rateMax = deps.rateMax ?? RATE_MAX
  const windowMs = deps.windowMs ?? RATE_WINDOW_MS
  const seen = new Map<string, number>()
  let shownAt: number[] = []
  let held: { text: string; n: number; timeoutMs?: number } | null = null
  let isScheduled = false

  const record = (d: Digest): void => {
    try {
      const r = deps.persist?.(d)

      if (isThenable(r)) r.catch(() => undefined)
    } catch {
      /* a failed record never changes what was shown */
    }
  }

  const draw = (now: number, line: string, timeoutMs: number | undefined): boolean => {
    try {
      deps.show(line, timeoutMs === undefined ? {} : { timeoutMs })
      shownAt.push(now)

      return true
    } catch {
      return false
    }
  }

  const room = (now: number): boolean => {
    shownAt = shownAt.filter(at => now - at < windowMs)

    return shownAt.length < rateMax
  }

  const freeHeld = (now: number): void => {
    if (held === null || !room(now)) return

    const { text, n, timeoutMs } = held

    held = null
    draw(now, lineOf('error', n > 1 ? `${text} … and ${n - 1} more` : text), timeoutMs)
  }

  const arm = (now: number): void => {
    if (isScheduled || deps.after === undefined || held === null) return

    isScheduled = true

    const wait = Math.max(50, windowMs - (now - (shownAt[0] ?? now)) + 50)

    const lost = (): void => {
      isScheduled = false
    }

    try {
      const timer = deps.after(wait, () => {
        isScheduled = false
        void releaseNow()
      })

      if (isThenable(timer)) timer.catch(lost)
    } catch {
      lost()
    }
  }

  /** A held error is said only while the setting still lets this source draw: switching toasts off, or muting the source, drops what waits (it is already recorded). */
  const releaseAt = (now: number, prefs: ToastPrefs): void => {
    if (prefs.mode === 'off' || prefs.muted.includes(deps.source)) held = null
    freeHeld(now)
    arm(now)
  }

  /** The work of a call at a moment: the setting is read, then `then` runs with it; a setting that cannot be read is the default. */
  const withPrefs = <T>(then: (prefs: ToastPrefs) => T): Maybe<T> => {
    let asked: Maybe<ToastPrefs>

    try {
      asked = deps.prefs?.() ?? DEFAULT_PREFS
    } catch {
      return then(DEFAULT_PREFS)
    }

    return chain(asked, then, () => then(DEFAULT_PREFS))
  }

  /** A clock that fails (a refused `clock.now`) is the wall clock: the toast is still decided. */
  const atNow = <T>(then: (now: number) => Maybe<T>, fallback: () => T): Maybe<T> => {
    let clock: Maybe<number>

    try {
      clock = deps.now()
    } catch {
      clock = Date.now()
    }

    return chain(clock, then, () => chain(Date.now(), then, fallback))
  }

  const releaseNow = (): Maybe<void> => atNow(now => withPrefs(prefs => releaseAt(now, prefs)), () => undefined)

  const run = (now: number, prefsIn: ToastPrefs, input: ToastInput): Why | 'empty' => {
    const level = LEVELS.find(candidate => candidate === input.level) ?? 'info'
    const text = tidy(input.text, LINE_MAX - 2)

    if (text === '') return 'empty'

    const prefs = parsePrefs(JSON.stringify(prefsIn))
    let why: Why

    releaseAt(now, prefs)

    if (prefs.mode === 'off') why = 'off'
    else if (prefs.muted.includes(deps.source)) why = 'muted'
    else if (prefs.mode === 'important' && (level === 'info' || level === 'ok') && input.always !== true) why = 'filtered'
    else if (input.awayOnly === true && deps.away?.() === false) why = 'away'
    else {
      const last = seen.get(text)

      if (last !== undefined && now - last < dedupeMs) why = 'deduped'
      else if (room(now)) {
        why = draw(now, lineOf(level, text), input.timeoutMs) ? 'shown' : 'refused'
        if (why === 'shown') seen.set(text, now)
      } else if (level === 'error') {
        // An error is never dropped: it waits, and the next free slot says it once with a count.
        held = held === null ? { text, n: 1, ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }) } : { ...held, n: held.n + 1 }
        seen.set(text, now)
        why = 'coalesced'
        arm(now)
      } else why = 'rate-limited'
    }

    if (seen.size > 200) for (const [key, at] of seen) if (now - at >= dedupeMs) seen.delete(key)

    record({ t: now, source: deps.source, level, text, shown: why === 'shown', why })

    return why
  }

  return {
    toast: input => atNow(now => withPrefs(prefs => run(now, prefs, input)), () => 'refused' as const),
    release: releaseNow,
  }
}

// ------------------------------------------------------------------------------------------------------------ the kit: the setting and the digests through files

/** The three file calls a plugin has (`$.fs.read`, `$.fs.write`, `$.fs.exists`), relative to the project. Each may be refused. */
export type ToastIo = { read: (path: string) => Promise<string>; write: (path: string, text: string) => Promise<void>; exists: (path: string) => Promise<boolean> }

export type KitDeps = Omit<ToasterDeps, 'prefs' | 'persist'> & {
  /** Without files the toaster draws by the defaults and records nothing on disk. */
  io?: ToastIo
  prefsTtlMs?: number
}

/**
 * A toaster whose setting is the console's file (read at most every few seconds; none means all, nothing muted) and whose digests go
 * to this source's own ring file under the console's folder, rewritten whole (a plugin has no append), one write in flight at a time.
 * Nothing is written unless that folder exists: it is the console's, and its own `.gitignore` covers it. Without the console a plugin
 * runs on the defaults and leaves no file.
 */
export function createToastKit(deps: KitDeps): Toaster {
  const { io } = deps
  const ttl = deps.prefsTtlMs ?? PREFS_TTL_MS
  let prefs: ToastPrefs = DEFAULT_PREFS
  let prefsAt = -Infinity
  const ring: Digest[] = []
  let isLoaded = false
  let isDirty = false
  let isWriting = false
  let isConsole = false
  let consoleAt = -Infinity

  /**
   * One write in flight at a time, the newest ring in it: digests that arrive meanwhile are written by the next pass, so a burst costs
   * a few writes, not one each, and the last digest is always on disk. No timer: a toast is never lost to a debounce that did not fire.
   */
  const flush = async (): Promise<void> => {
    if (io === undefined || isWriting) return

    isWriting = true

    try {
      while (isDirty) {
        isDirty = false

        if (!isLoaded) {
          isLoaded = true
          const old = decodeRing(await io.read(`${TOAST_DIR}/${deps.source}.jsonl`).catch(() => ''))

          ring.unshift(...old.filter(d => d.source === deps.source).slice(-RING_MAX))
          if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX)
        }

        await io.write(`${TOAST_DIR}/${deps.source}.jsonl`, encodeRing(ring))
      }
    } catch {
      /* the digest is a courtesy: a refused write is dropped */
    } finally {
      isWriting = false
    }
  }

  /** Whether the console's folder exists, believed for a while: no console, no digest. */
  const hasConsole = (now: number): Promise<boolean> => {
    if (now - consoleAt < CONSOLE_TTL_MS) return Promise.resolve(isConsole)

    consoleAt = now

    return (io as ToastIo).exists(CONSOLE_DIR).then(
      yes => (isConsole = yes),
      () => (isConsole = false),
    )
  }

  const readPrefs = (): Maybe<ToastPrefs> => {
    if (io === undefined) return DEFAULT_PREFS

    const at = (now: number): Maybe<ToastPrefs> => {
      if (now - prefsAt < ttl) return prefs

      prefsAt = now

      return io.read(PREFS_FILE).then(
        text => (prefs = parsePrefs(text)),
        () => (prefs = DEFAULT_PREFS),
      )
    }

    return chain(
      deps.now(),
      at,
      () => at(Date.now()),
    )
  }

  return createToaster({
    ...deps,
    prefs: readPrefs,
    persist: d => {
      if (io === undefined) return

      // The ring is seeded from the file on the first write; digests made before it are kept in order.
      return hasConsole(d.t).then(yes => {
        if (!yes) return

        pushDigest(ring, d)
        isDirty = true
        void flush()
      })
    },
  })
}
