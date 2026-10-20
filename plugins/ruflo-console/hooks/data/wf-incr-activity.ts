/**
 * `parseActivity`'s answer, folded line by line (ADR-473; the machinery is data/wf-incr.ts). The state is bounded: the newest
 * ENTRY_CAP entries are kept, with the count of the ones before them; ids of calls that left the ring are remembered (up to ID_CAP,
 * oldest first) so a late result for one is still absorbed, as the whole-text parse absorbs it, instead of turning into a message.
 */
import { cleanBlock, cleanLine, ENTRY_CAP, EDIT_TOOLS, FILE_CAP, pathOf, READ_TOOLS, resultText, stamp, summaryOf, WRITE_TOOLS, type CallEntry, type Entry, type MessageRole, type Parsed, type TouchedFile } from './wf-activity'
import { Incremental, type Rec, type Tentative } from './wf-incr'

/** Call ids kept after their entry left the ring. Past this a result for a call this old reads as one whose call is before the part read. */
export const ID_CAP = 50_000

const asRecord = (value: unknown): Rec | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Rec) : null)

export class ActivityIncr extends Incremental<Parsed> {
  /** The newest entries; `index` and `callIndex` hold the position since the start of the text and are made relative when the answer is built. */
  private ring: Entry[] = []
  /** Entries and calls that left the ring from its front. */
  private base = 0
  private callsBase = 0
  private calls = 0
  private byId = new Map<string, number>()
  private files = new Map<string, TouchedFile>()
  private skipped = 0
  /** While a line is applied tentatively: how to take each change back. */
  private log: (() => void)[] | null = null

  protected restart(): void {
    this.ring = []
    this.base = this.callsBase = this.calls = this.skipped = 0
    this.byId = new Map()
    this.files = new Map()
  }

  weight(): number {
    let chars = 0

    for (const entry of this.ring) chars += entry.kind === 'call' ? entry.input.text.length + (entry.output?.text.length ?? 0) : entry.body.text.length

    return chars + this.byId.size * 48
  }

  private message(role: MessageRole, atMs: number | undefined, raw: string): void {
    if (raw.trim() === '') return

    this.ring.push({ kind: 'message', index: this.base + this.ring.length, role, body: cleanBlock(raw), ...(atMs !== undefined && { atMs }) })
    this.log?.push(() => void this.ring.pop())
  }

  protected fold(line: Rec): void {
    const body = asRecord(line.message)

    if ((line.type !== 'user' && line.type !== 'assistant') || body === null || line.isMeta === true) {
      this.skipped += 1
      this.log?.push(() => void (this.skipped -= 1))

      return
    }

    const at = stamp(line)
    const content = body.content

    if (typeof content === 'string') {
      this.message(line.type, at, content)

      return
    }

    if (!Array.isArray(content)) return

    for (const raw of content) {
      const block = asRecord(raw)

      if (block === null) continue

      if (block.type === 'text' && typeof block.text === 'string') this.message(line.type, at, block.text)
      else if (block.type === 'thinking' && typeof block.thinking === 'string') this.message('thinking', at, block.thinking)
      else if (block.type === 'tool_use' && typeof block.id === 'string') this.call(block, block.id, at)
      else if (block.type === 'tool_result') this.result(block, at)
    }
  }

  private call(block: Rec, id: string, at: number | undefined): void {
    // A streamed message repeats its blocks over several lines: a call is counted once, by its id.
    if (this.byId.has(id)) return

    const tool = cleanLine(typeof block.name === 'string' ? block.name : 'tool', 40)
    const seq = this.base + this.ring.length
    const entry: CallEntry = { kind: 'call', index: seq, callIndex: this.calls, id, tool, status: 'pending', summary: summaryOf(block.input), input: cleanBlock(JSON.stringify(block.input ?? {}, null, 2) ?? '{}'), output: null, ...(at !== undefined && { atMs: at }) }
    const path = pathOf(block.input)

    this.calls += 1
    this.byId.set(id, seq)
    this.ring.push(entry)
    this.log?.push(() => {
      this.ring.pop()
      this.byId.delete(id)
      this.calls -= 1
    })

    if (path !== undefined && (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool) || WRITE_TOOLS.has(tool))) {
      const held = this.files.get(path)
      const next: TouchedFile = { path, read: held?.read ?? 0, edit: held?.edit ?? 0, write: held?.write ?? 0 }

      if (READ_TOOLS.has(tool)) next.read += 1
      else if (EDIT_TOOLS.has(tool)) next.edit += 1
      else next.write += 1

      this.files.set(path, next)
      this.log?.push(() => (held === undefined ? this.files.delete(path) : this.files.set(path, held)))
    }
  }

  private result(block: Rec, at: number | undefined): void {
    const seq = typeof block.tool_use_id === 'string' ? this.byId.get(block.tool_use_id) : undefined
    const out = resultText(block.content)

    if (seq === undefined) {
      this.message('result', at, out === '' ? '(a result whose call is before the part read)' : out)

      return
    }

    const held = seq >= this.base ? this.ring[seq - this.base] : undefined

    // A call that left the ring still takes its result (it is no longer shown): nothing to set, and no message either.
    if (held === undefined || held.kind !== 'call') return

    const before = { output: held.output, status: held.status, endMs: held.endMs }

    held.output = cleanBlock(out === '' ? '(empty)' : out)
    held.status = block.is_error === true ? 'error' : 'ok'
    if (at !== undefined) held.endMs = at

    this.log?.push(() => {
      held.output = before.output
      held.status = before.status

      if (before.endMs === undefined) delete held.endMs
      else held.endMs = before.endMs
    })
  }

  protected tentative(rec: Rec): Tentative {
    const log: (() => void)[] = []

    this.log = log
    this.fold(rec)
    this.log = null

    return () => {
      for (let i = log.length - 1; i >= 0; i--) (log[i] as () => void)()
    }
  }

  /** Keeps the newest ENTRY_CAP entries and the newest ID_CAP ids; what leaves is counted. */
  protected override settle(): void {
    const over = this.ring.length - ENTRY_CAP

    if (over > 0) {
      for (let i = 0; i < over; i++) if ((this.ring[i] as Entry).kind === 'call') this.callsBase += 1

      this.ring.splice(0, over)
      this.base += over
    }

    for (const id of this.byId.keys()) {
      if (this.byId.size <= ID_CAP) break

      this.byId.delete(id)
    }
  }

  protected build(isTail: boolean): Parsed {
    const extra = Math.max(0, this.ring.length - ENTRY_CAP)
    let callsBefore = this.callsBase

    for (let i = 0; i < extra; i++) if ((this.ring[i] as Entry).kind === 'call') callsBefore += 1

    const entries: Entry[] = []
    const calls: CallEntry[] = []

    for (let i = extra; i < this.ring.length; i++) {
      const entry = this.ring[i] as Entry

      if (entry.kind === 'call') {
        const copy: CallEntry = { ...entry, index: i - extra, callIndex: entry.callIndex - callsBefore }

        entries.push(copy)
        calls.push(copy)
      } else entries.push({ ...entry, index: i - extra })
    }

    const files = [...this.files.values()].sort((a, b) => b.edit + b.write - (a.edit + a.write) || a.path.localeCompare(b.path)).slice(0, FILE_CAP)

    return { entries, calls, files, isTail, dropped: this.base + extra, skipped: this.skipped }
  }
}

