/**
 * What an agent's transcript says it did (ADR-459): the tool-call timeline (a call paired with its result by id), the messages between
 * them, the files its tool inputs name, and the structured result the run's journal kept for it. Pure: text in, records out; the
 * reading of files is data/wf-drill-io.ts. Nothing is estimated: a call whose result is not in the text read stays `pending`, a field
 * longer than its cap is cut and says so, and a line that does not parse is dropped, never thrown on.
 *
 * Every string kept is washed on the way in (an ANSI sequence or control character is removed, anything shaped like a credential is
 * masked) so no cell, log line, export or notice built from these records can carry one. Newlines survive, so an input or an output
 * still reads as the lines it was; ids and paths are not masked (a 36 character session id would read as a key to the mask).
 */
import { maskSecrets, jsonLines } from './workflows'
import { INVISIBLE } from './parse'

/** Characters kept per field (an input, an output, a message). The page shows how many of how many, never a silent cut. */
export const FIELD_CAP = 6000
/** Entries kept per transcript: the newest, with the count of earlier ones said. */
export const ENTRY_CAP = 2000
export const FILE_CAP = 120

export type Capped = { text: string; /** Characters in the original. */ total: number; isCut: boolean }

// An escape sequence goes whole (stripping only the ESC byte would leave `[1m` in the text), then controls other than the newline, soft hyphen,
// zero-width and bidi characters. Written as \u escapes so no invisible character sits in this source.
const ANSI = new RegExp('\\u001b\\][^\\u0007\\u001b]*(?:\\u0007|\\u001b\\\\|(?=\\u001b)|$)|\\u009d[^\\u0007\\u009c\\u009d]*(?:[\\u0007\\u009c]|(?=\\u009d)|$)|(?:\\u001b\\[|\\u009b)[0-9;?]*[ -/]*[@-~]', 'g')
const HIDE = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f-\\u009f\\u00ad\\u034f\\u061c\\u115f\\u1160\\u17b4\\u17b5\\u180b-\\u180f\\u200b-\\u200f\\u202a-\\u202e\\u2060-\\u2064\\u2066-\\u2069\\u3164\\ufe00-\\ufe0d\\ufeff\\uffa0]|[\\u{e0000}-\\u{e0fff}]', 'gu')

/** Washed text for a block: escapes and controls out (the newline stays), credentials masked, cut to `cap` characters with the original length kept. */
export function cleanBlock(raw: string, cap = FIELD_CAP): Capped {
  // The mask runs over a little more than the cap, so a token that straddles the cut is masked whole before the cut is made.
  const head = raw.slice(0, cap + 256).replace(ANSI, '').replace(INVISIBLE, '').replace(/\r\n?/g, '\n').replace(/\t/g, '  ').replace(HIDE, ' ')
  const text = maskSecrets(head).slice(0, cap)

  return { text, total: raw.length, isCut: raw.length > cap }
}

/** A path for a cell: escapes, controls and hidden characters out, whitespace collapsed, cut; NOT masked (a 36 character id or a hash segment would read as a key, and a path is matched against another path). */
export const cleanPath = (raw: string, max = 300): string => {
  const line = raw.slice(0, max * 2).replace(ANSI, '').replace(HIDE, ' ').replace(/\s+/g, ' ').trim()

  return line.length <= max ? line : `${line.slice(0, max - 1)}…`
}

/** One washed line of at most `max` characters. */
export const cleanLine = (raw: string, max = 160): string => {
  const line = cleanBlock(raw, max * 3).text.replace(/\s+/g, ' ').trim()

  return line.length <= max ? line : `${line.slice(0, Math.max(0, max - 1))}…`
}

export type CallStatus = 'ok' | 'error' | 'pending'
export type MessageRole = 'user' | 'assistant' | 'thinking' | 'result'

export type MessageEntry = { kind: 'message'; index: number; role: MessageRole; atMs?: number; body: Capped }
export type CallEntry = { kind: 'call'; index: number; callIndex: number; id: string; tool: string; atMs?: number; endMs?: number; status: CallStatus; summary: string; input: Capped; output: Capped | null }
export type Entry = MessageEntry | CallEntry

export type TouchedFile = { path: string; read: number; edit: number; write: number }

export type Parsed = {
  entries: Entry[]
  calls: CallEntry[]
  files: TouchedFile[]
  /** True where the text began mid-file: the first line was dropped and calls made before it are not here. */
  isTail: boolean
  /** Entries before the newest ENTRY_CAP that were not kept. */
  dropped: number
  /** Lines that were not a record this reader reads (attachments, meta lines, a half-written last line). */
  skipped: number
}

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
const SUMMARY_KEYS = ['command', 'file_path', 'notebook_path', 'path', 'pattern', 'url', 'query', 'description', 'prompt', 'skill', 'subject'] as const
export const READ_TOOLS = new Set(['Read'])
export const EDIT_TOOLS = new Set(['Edit', 'MultiEdit', 'NotebookEdit'])
export const WRITE_TOOLS = new Set(['Write'])

export function summaryOf(input: unknown): string {
  const record = asRecord(input)

  if (record === null) return typeof input === 'string' ? cleanLine(input) : ''

  for (const key of SUMMARY_KEYS) if (typeof record[key] === 'string' && record[key] !== '') return cleanLine(record[key] as string)

  return ''
}

export function pathOf(input: unknown): string | undefined {
  const record = asRecord(input)
  const value = record?.file_path ?? record?.notebook_path

  return typeof value === 'string' && value !== '' ? cleanPath(value) : undefined
}

/** A tool result's text: a string, or the text blocks of an array (an image is named, not drawn). */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map(block => {
      const b = asRecord(block)

      return b?.type === 'text' && typeof b.text === 'string' ? b.text : b?.type === 'image' ? '[image]' : ''
    })
    .filter(part => part !== '')
    .join('\n')
}

export const stamp = (line: Record<string, unknown>): number | undefined => {
  const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN

  return Number.isFinite(at) ? at : undefined
}

/** A transcript's lines: user and assistant records carry `message.content` as a string or as typed blocks. */
export function parseActivity(text: string | null, isTail = false): Parsed {
  const lines = jsonLines(isTail && text !== null ? text.slice(text.indexOf('\n') + 1) : text)
  const entries: Entry[] = []
  const byId = new Map<string, CallEntry>()
  const files = new Map<string, TouchedFile>()
  let skipped = 0
  let calls = 0

  const message = (role: MessageRole, atMs: number | undefined, raw: string): void => {
    if (raw.trim() === '') return

    entries.push({ kind: 'message', index: entries.length, role, body: cleanBlock(raw), ...(atMs !== undefined && { atMs }) })
  }

  for (const line of lines) {
    const body = asRecord(line.message)

    if ((line.type !== 'user' && line.type !== 'assistant') || body === null || line.isMeta === true) {
      skipped += 1
      continue
    }

    const at = stamp(line)
    const content = body.content

    if (typeof content === 'string') {
      message(line.type, at, content)
      continue
    }

    if (!Array.isArray(content)) continue

    for (const raw of content) {
      const block = asRecord(raw)

      if (block === null) continue

      if (block.type === 'text' && typeof block.text === 'string') message(line.type, at, block.text)
      else if (block.type === 'thinking' && typeof block.thinking === 'string') message('thinking', at, block.thinking)
      else if (block.type === 'tool_use' && typeof block.id === 'string') {
        // A streamed message repeats its blocks over several lines: a call is counted once, by its id.
        if (byId.has(block.id)) continue

        const tool = cleanLine(typeof block.name === 'string' ? block.name : 'tool', 40)
        const entry: CallEntry = { kind: 'call', index: entries.length, callIndex: calls, id: block.id, tool, status: 'pending', summary: summaryOf(block.input), input: cleanBlock(JSON.stringify(block.input ?? {}, null, 2) ?? '{}'), output: null, ...(at !== undefined && { atMs: at }) }
        const path = pathOf(block.input)

        calls += 1
        byId.set(block.id, entry)
        entries.push(entry)

        if (path !== undefined && (READ_TOOLS.has(tool) || EDIT_TOOLS.has(tool) || WRITE_TOOLS.has(tool))) {
          const held = files.get(path) ?? { path, read: 0, edit: 0, write: 0 }

          if (READ_TOOLS.has(tool)) held.read += 1
          else if (EDIT_TOOLS.has(tool)) held.edit += 1
          else held.write += 1

          files.set(path, held)
        }
      } else if (block.type === 'tool_result') {
        const call = typeof block.tool_use_id === 'string' ? byId.get(block.tool_use_id) : undefined
        const out = resultText(block.content)

        if (call === undefined) message('result', at, out === '' ? '(a result whose call is before the part read)' : out)
        else {
          call.output = cleanBlock(out === '' ? '(empty)' : out)
          call.status = block.is_error === true ? 'error' : 'ok'
          if (at !== undefined) call.endMs = at
        }
      }
    }
  }

  const dropped = Math.max(0, entries.length - ENTRY_CAP)
  const kept = dropped === 0 ? entries : entries.slice(dropped)
  const ordered = [...files.values()].sort((a, b) => b.edit + b.write - (a.edit + a.write) || a.path.localeCompare(b.path)).slice(0, FILE_CAP)

  // Re-index after a drop, so `index` and `callIndex` are positions in what is kept.
  let nextCall = 0
  const reindexed: Entry[] = kept.map((entry, i) => (entry.kind === 'call' ? { ...entry, index: i, callIndex: nextCall++ } : { ...entry, index: i }))

  return { entries: reindexed, calls: reindexed.filter((entry): entry is CallEntry => entry.kind === 'call'), files: ordered, isTail, dropped, skipped }
}

/** The structured result the run's journal kept for one agent: a string as written, anything else as pretty JSON, washed and capped. Null where the journal has none. */
export function journalResult(journal: string | null, agentId: string): Capped | null {
  let found: unknown

  for (const event of jsonLines(journal)) if (event.type === 'result' && event.agentId === agentId) found = event.result

  if (found === undefined) return null

  return cleanBlock(typeof found === 'string' ? found : (JSON.stringify(found, null, 2) ?? ''))
}

export const durationOf = (call: CallEntry): number | undefined => (call.atMs !== undefined && call.endMs !== undefined ? Math.max(0, call.endMs - call.atMs) : undefined)

/** `1.2s` · `340ms`: a call's span, n/a where one end has no timestamp. */
export const fmtSpan = (ms: number | undefined): string => (ms === undefined ? 'n/a' : ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`)
