/**
 * The autopilot's journal (ADR-466 §2): an append-only JSONL file that is both the durable checkpoint (the loop's state is a fold of it)
 * and the audit log (every autonomous action is a line). Pure apart from nothing: reading is `parseJournal(text)`, writing is a line
 * from `encodeLine` appended through the fixed argv from `appendArgv` (the host's fs is read-only). Every free-text field is washed
 * (escapes, control/bidi/tag characters, credential mask) BEFORE it is encoded, so nothing hostile or secret is ever stored, drawn
 * or exported. A line that does not validate is counted and dropped, never thrown on.
 */
import { ESCAPES, HIDDEN, INVISIBLE } from './parse'
import { maskSecrets } from './workflows'
import { AUTOPILOT_DIR } from './ap-envelope'
import { appendArgv } from './append-argv'
import { hostFsArgv, posixTouch, type WriteFlavor } from './write-flavor'

export const JOURNAL_FILE = `${AUTOPILOT_DIR}/journal.jsonl`
/** A journal over this is read no further (the cap is drawn): the loop then compacts by checkpoint (data/ap-loop.ts `compactState`). */
export const JOURNAL_MAX_BYTES = 1_500_000
export const LINE_MAX = 2_000
/** Why a step is journaled failed when the mission would not take it: a step that never started, which adaptation must not learn from. */
export const REFUSED_WHY = 'the mission refused the hand-over'

export type Receipt = { id: string; at: number; path: string; from: string; to: string; direction: 'conservative' | 'aggressive'; evidence: string; prev: string; hash: string }
export type Anatole = 'on' | 'accepted-without'

export type JournalEvent = { at: number } & (
  | { t: 'start'; envHash: string; revision: number; anatole: Anatole }
  | { t: 'step.started'; id: string; task: string; cls: string; attempt: number; deadline: number; tier: string; par?: number }
  | { t: 'step.done'; id: string; verified: boolean }
  | { t: 'step.failed'; id: string; why: string }
  | { t: 'parked'; id: string; task: string; question: string }
  | { t: 'answered'; id: string; answer: 'once' | 'deny' }
  | { t: 'pause'; reason: string }
  | { t: 'resume' }
  | { t: 'stop'; reason: string }
  | { t: 'beat' }
  | { t: 'adapt'; receipt: Receipt }
  | { t: 'digest'; day: string }
)

export type EventType = JournalEvent['t']

/** Free text for the journal: escapes dropped, hidden characters spaced, credentials masked, capped. */
export const wash = (value: string, max = 240): string => maskSecrets(value.replace(ESCAPES, '').replace(INVISIBLE, '').replace(HIDDEN, ' ').replace(/\s+/g, ' ').trim()).slice(0, max)

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{0,95}$/

const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
const str = (value: unknown, max = 240): string | null => (typeof value === 'string' ? wash(value, max) : null)
const id = (value: unknown): string | null => (typeof value === 'string' && ID.test(value) ? value : null)

function receiptOf(value: unknown): Receipt | null {
  if (typeof value !== 'object' || value === null) return null

  const r = value as Record<string, unknown>
  const at = num(r.at)
  const hash = typeof r.hash === 'string' && /^[0-9a-f]{64}$/.test(r.hash) ? r.hash : null
  const prev = typeof r.prev === 'string' && /^([0-9a-f]{64}|genesis)$/.test(r.prev) ? r.prev : null
  const direction = r.direction === 'conservative' || r.direction === 'aggressive' ? r.direction : null
  const [rid, path, from, to, evidence] = [id(r.id), str(r.path, 60), str(r.from, 60), str(r.to, 60), str(r.evidence, 300)]

  return at === null || hash === null || prev === null || direction === null || rid === null || path === null || from === null || to === null || evidence === null ? null : { id: rid, at, path, from, to, direction, evidence, prev, hash }
}

/** One line to an event, or null when it is not a valid event of a known type. */
export function parseLine(line: string): JournalEvent | null {
  if (line.length < 2 || line.length > LINE_MAX * 2 || line[0] !== '{') return null

  let r: Record<string, unknown>

  try {
    const parsed: unknown = JSON.parse(line)

    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null
    r = parsed as Record<string, unknown>
  } catch {
    return null
  }

  const at = num(r.at)

  if (at === null) return null

  switch (r.t) {
    case 'start': {
      const [envHash, revision] = [typeof r.envHash === 'string' && /^[0-9a-f]{64}$/.test(r.envHash) ? r.envHash : null, num(r.revision)]

      return envHash === null || revision === null || (r.anatole !== 'on' && r.anatole !== 'accepted-without') ? null : { t: 'start', at, envHash, revision, anatole: r.anatole }
    }

    case 'step.started': {
      const [sid, task, cls, attempt, deadline, tier, par] = [id(r.id), id(r.task), str(r.cls, 24), num(r.attempt), num(r.deadline), str(r.tier, 12), num(r.par)]

      return sid === null || task === null || cls === null || attempt === null || deadline === null || tier === null ? null : { t: 'step.started', at, id: sid, task, cls, attempt, deadline, tier, ...(par !== null && { par }) }
    }

    case 'step.done': {
      const sid = id(r.id)

      return sid === null || typeof r.verified !== 'boolean' ? null : { t: 'step.done', at, id: sid, verified: r.verified }
    }

    case 'step.failed': {
      const [sid, why] = [id(r.id), str(r.why)]

      return sid === null || why === null ? null : { t: 'step.failed', at, id: sid, why }
    }

    case 'parked': {
      const [pid, task, question] = [id(r.id), id(r.task), str(r.question, 300)]

      return pid === null || task === null || question === null ? null : { t: 'parked', at, id: pid, task, question }
    }

    case 'answered': {
      const pid = id(r.id)

      return pid === null || (r.answer !== 'once' && r.answer !== 'deny') ? null : { t: 'answered', at, id: pid, answer: r.answer }
    }

    case 'pause':
    case 'stop': {
      const reason = str(r.reason)

      return reason === null ? null : { t: r.t, at, reason }
    }

    case 'resume':
    case 'beat':
      return { t: r.t, at }

    case 'adapt': {
      const receipt = receiptOf(r.receipt)

      return receipt === null ? null : { t: 'adapt', at, receipt }
    }

    case 'digest': {
      const day = typeof r.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.day) ? r.day : null

      return day === null ? null : { t: 'digest', at, day }
    }

    default:
      return null
  }
}

/** Keys that hold hashes and ids: they are not text, and a long hex string would read as a key to the mask. */
const KEEP = new Set(['t', 'envHash', 'hash', 'prev', 'id', 'task', 'day', 'anatole', 'answer', 'direction'])

/** The line to append (with its newline). Free text is washed again here, so an event built from raw text is safe to write. */
export function encodeLine(event: JournalEvent): string {
  // One pass: the replacer washes each string as it is written (a parse of the washed text back into an object, to stringify it again, produced the same bytes).
  const line = JSON.stringify(event, (key, value: unknown) => (typeof value === 'string' && !KEEP.has(key) ? wash(value, 300) : value))

  return `${line.length > LINE_MAX ? JSON.stringify({ t: 'pause', at: event.at, reason: 'an event was too long to journal' }) : line}\n`
}

export type ParsedJournal = { events: JournalEvent[]; bad: number; /** True when the text was cut at the first line because the file passed the cap. */ isCapped: boolean }

/** A journal as events, in file order. A half-written last line and any hostile line are counted in `bad`. */
export function parseJournal(text: string | null): ParsedJournal {
  if (text === null) return { events: [], bad: 0, isCapped: false }

  const lines = text.split('\n').filter(line => line.trim() !== '')
  const events: JournalEvent[] = []

  for (const line of lines) {
    const event = parseLine(line)

    if (event !== null) events.push(event)
  }

  return { events, bad: lines.length - events.length, isCapped: false }
}

/** Fixed argv that appends stdin to the journal: the shared append (data/append-argv.ts), one dd block per batch on GNU and BSD alike. */
export { appendArgv }

/**
 * Fixed argv that creates an empty file (the kill switch flag, a new journal) and its folder, mode 0600. GNU: `install -D` from /dev/null,
 * unchanged. POSIX (BSD install has no -D): the guarded touch in write-flavor.ts: makes the folder, refuses a link or a non-regular
 * target, creates the file with `set -C` under umask 077 where none is, then `chmod 600`.
 */
export const touchArgv = (path: string, flavor: WriteFlavor): readonly string[] => (flavor === 'host-fs' ? hostFsArgv('touch', path) : flavor === 'gnu' ? ['install', '-D', '-m', '600', '/dev/null', path] : posixTouch(path))

/** How many valid `step.started` lines for this step id the text holds. Two sessions that both picked a task each write one; a step is handed over only when it is exactly one. */
export const startedCount = (text: string, stepId: string): number => parseJournal(text).events.filter(e => e.t === 'step.started' && e.id === stepId).length
