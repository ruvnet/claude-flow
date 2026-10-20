/**
 * The incremental half of every file-backed adapter (ADR-486): each candidate is stat-ed (a link is refused, a vanished file is dropped), and
 * it is read again only when its size or mtime changed. A read that fails keeps the earlier summary and says so (stale), never a blank row.
 * One pass reads at most PASS_BYTES; what does not fit waits for the next pass, which is how 20 busy sessions stay inside a tick.
 */
import { readCost, readWindow } from './harness-text'
import type { SessionFs } from './harness'

export type Candidate = { path: string; nativeId: string; folder: string; size: number; mtimeMs: number }
/**
 * `readSeq`: when this file was last read, in reads across the process, so the least recently read changed file goes first next pass.
 * `pending` and `firstSeen`: a file that has never been read (it did not fit a pass) is remembered with when it was first seen, so never-read
 * files are read first come, first served, and a stream of newer files cannot keep an older one waiting.
 */
export type Held<S> = { mtimeMs: number; size: number; value: S | null; noPreview: string | null; stale: string | null; whole: boolean; readSeq?: number; pending?: boolean; firstSeen?: number }
export type Memory<S> = Map<string, Held<S>>
/**
 * One workspace pass's read allowance, shared by every adapter in it (ADR-486 §2.4: a pass reads at most 12 MB, not 12 MB per harness).
 * `turn` serialises reads across adapters, so a reservation and its charge are never interleaved with another adapter's; `stopped` ends the
 * pass's reads once one read came back larger than it reserved (the file grew since its stat), so that overrun is never compounded.
 */
export type PassBudget = { left: number; stopped: boolean; turn: Promise<void> }

export const PASS_BYTES = 12_000_000
export const passBudget = (): PassBudget => ({ left: PASS_BYTES, stopped: false, turn: Promise.resolve() })
const CONCURRENCY = 8
let readSeq = 0
let seenSeq = 0

/** Waits for the pass's previous read (from any adapter) to finish; the returned function lets the next one go. */
async function myTurn(budget: PassBudget): Promise<() => void> {
  const before = budget.turn
  let release: () => void = () => undefined

  budget.turn = new Promise<void>(resolve => (release = resolve))
  await before

  return release
}

const WHY: Record<string, string> = { 'too-large': 'transcript is larger than this host can read', refused: 'the host refused the read', missing: 'file is gone', 'not-regular': 'not a regular file' }

/**
 * Stats every candidate (concurrently), then reads the changed ones one at a time against the shared budget: one at a time so a file that grew
 * since its stat can overrun the pass by at most its own growth (none where the host bounds reads), and least recently read first, so files
 * that change on every pass cannot starve the rest; each changed file is read within ceil(changed / per-pass) passes.
 */
export async function settle<S>(fs: SessionFs, memory: Memory<S>, cands: readonly Candidate[], summarize: (text: string, whole: boolean, cand: Candidate) => S, budget: PassBudget = passBudget()): Promise<{ cand: Candidate; held: Held<S> }[]> {
  const slots: ({ cand: Candidate; held: Held<S> } | null | undefined)[] = cands.map(() => undefined)
  const toRead: { i: number; cand: Candidate; before: Held<S> | undefined }[] = []

  const look = async (cand: Candidate, i: number): Promise<void> => {
    let stat: Awaited<ReturnType<SessionFs['stat']>>

    try {
      stat = await fs.stat(cand.path)
    } catch {
      stat = undefined
    }

    if (stat === undefined) {
      memory.delete(cand.path)
      slots[i] = null

      return
    }

    const before = memory.get(cand.path)
    const now = { ...cand, size: stat.size ?? cand.size, mtimeMs: stat.mtimeMs ?? cand.mtimeMs }

    if (stat.isLink === true || (stat.kind !== undefined && stat.kind !== 'file')) {
      const held: Held<S> = { mtimeMs: now.mtimeMs, size: now.size, value: null, noPreview: WHY['not-regular'] as string, stale: null, whole: false }

      memory.set(cand.path, held)
      slots[i] = { cand: now, held }

      return
    }

    if (before !== undefined && before.pending !== true && before.mtimeMs === now.mtimeMs && before.size === now.size && before.stale === null) {
      slots[i] = { cand: now, held: before }

      return
    }

    toRead.push({ i, cand: now, before })
  }

  for (let i = 0; i < cands.length; i += CONCURRENCY) await Promise.all(cands.slice(i, i + CONCURRENCY).map((cand, j) => look(cand, i + j).catch(() => (slots[i + j] = null))))

  // A file seen for the first time gets its place in the never-read line now (newest of this batch first; every earlier batch before it).
  const firstSeenOf = new Map<string, number>()

  for (const job of [...toRead].filter(job => job.before === undefined).sort((a, b) => b.cand.mtimeMs - a.cand.mtimeMs)) firstSeenOf.set(job.cand.path, (seenSeq += 1))

  const firstSeen = (job: (typeof toRead)[number]) => job.before?.firstSeen ?? firstSeenOf.get(job.cand.path) ?? 0
  const neverRead = (job: (typeof toRead)[number]) => job.before?.readSeq === undefined

  // Never-read files first, first come first served; then the rest, least recently read first.
  toRead.sort((a, b) => Number(neverRead(b)) - Number(neverRead(a)) || (neverRead(a) ? firstSeen(a) - firstSeen(b) : (a.before?.readSeq ?? 0) - (b.before?.readSeq ?? 0)))

  for (const job of toRead) {
    const { i, cand, before } = job
    const { size, mtimeMs } = cand
    const cost = readCost(fs, size)
    const release = await myTurn(budget)
    let window: Awaited<ReturnType<typeof readWindow>> | null = null

    try {
      if (!budget.stopped && cost <= budget.left) {
        // Reserved before the read, against the one shared budget, while no other adapter is reading.
        budget.left -= cost

        try {
          window = await readWindow(fs, cand.path, size, budget.left + cost)
        } catch {
          window = { text: null, reason: 'refused' }
        }

        const bytes = window.text === null ? 0 : window.bytes

        // Charged what was actually read: the unused reservation goes back. A read larger than its reservation (the file grew since its
        // stat, on a host with no bounded read) is charged and ends this pass's reads, so one file's growth is the most a pass can overrun.
        budget.left += cost - bytes
        if (bytes > cost) budget.stopped = true
      }
    } finally {
      release()
    }

    if (window === null) {
      // Remembered with its place in line, so a later pass reads it before newer files: the row says it has not been read yet.
      const held: Held<S> = before === undefined || before.pending === true ? { mtimeMs, size, value: null, noPreview: 'not read yet: the pass reached its read budget', stale: null, whole: false, pending: true, firstSeen: firstSeen(job) } : { ...before, stale: before.stale ?? 'newer than the last read' }

      memory.set(cand.path, held)
      slots[i] = { cand, held }
      continue
    }

    let held: Held<S>

    readSeq += 1
    if (window.text !== null) held = { mtimeMs, size, value: summarize(window.text, window.whole, cand), noPreview: null, stale: null, whole: window.whole, readSeq }
    else if (before?.value !== undefined && before.value !== null) held = { ...before, mtimeMs, size, stale: `read failed: ${WHY[window.reason] ?? window.reason}`, readSeq }
    else held = { mtimeMs, size, value: null, noPreview: WHY[window.reason] ?? window.reason, stale: null, whole: false, readSeq }

    memory.set(cand.path, held)
    slots[i] = { cand, held }
  }

  return slots.filter((slot): slot is { cand: Candidate; held: Held<S> } => slot !== null && slot !== undefined)
}
