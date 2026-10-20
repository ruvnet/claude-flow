/**
 * The Dev Tools view's pure parts: the fields a person types into, each checked before it becomes an argv element,
 * and the readers that turn what the ruflo CLI printed into lines worth reading. `mcp exec` wraps most tools' answers
 * as `{"content":[{"type":"text","text":"<JSON>"}],"isError":…}`, so the readers unwrap that first.
 */
import { jsonAfter } from './cli'
import { plain, recordOf } from './parse'
import { labLines } from '../mh-lab'

export type DevField = 'ref' | 'path' | 'label' | 'url' | 'target' | 'query' | 'task' | 'cmd' | 'id' | 'note' | 'session' | 'send'

export type DevFields = Record<DevField, string>

export const DEV_FIELDS: readonly DevField[] = ['ref', 'path', 'label', 'url', 'target', 'query', 'task', 'cmd', 'id', 'note', 'session', 'send']

export const emptyFields = (): DevFields => ({ ref: 'HEAD', path: '', label: '', url: '', target: '', query: '', task: '', cmd: '', id: '', note: '', session: '', send: '' })

const CONTROL = /[\u0000-\u001f\u007f]/

/** Free text: trimmed, 1-`max` characters, no control characters, not starting with `-` (it could read as a flag). */
function prose(text: string, max: number): string | null {
  const value = text.trim()

  return value === '' || value.length > max || value.startsWith('-') || CONTROL.test(value) ? null : value
}

/** A path under the project: relative, no `..` segment, no empty segment, a plain charset (the CLI resolves it). */
function pathOf(text: string): string | null {
  const value = text.trim()

  if (!/^[A-Za-z0-9._][A-Za-z0-9._/-]{0,159}$/.test(value)) return null

  return value.split('/').every(segment => segment !== '' && segment !== '..') ? value : null
}

function urlOf(text: string): string | null {
  const value = text.trim()

  if (!/^https?:\/\/[^\s"'<>`\\]{1,300}$/.test(value)) return null

  try {
    const url = new URL(value)

    return url.protocol === 'http:' || url.protocol === 'https:' ? value : null
  } catch {
    return null
  }
}

const RULES: Record<DevField, { test: (text: string) => string | null; rule: string }> = {
  ref: { test: text => (/^[A-Za-z0-9@][A-Za-z0-9._/~^@{}-]{0,99}$/.test(text.trim()) ? text.trim() : null), rule: 'a git ref: HEAD, HEAD~3, main..HEAD, a branch or a sha (letters, digits . _ / ~ ^ @ { } -, not starting with -)' },
  path: { test: pathOf, rule: 'a path under the project: relative, letters, digits . _ / -, no .. segment, at most 160' },
  label: { test: text => (/^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/.test(text.trim()) ? text.trim() : null), rule: 'a label: letters, digits . _ -, at most 40, not starting with . or -' },
  url: { test: urlOf, rule: 'an http(s) URL with no spaces or quotes, at most 300' },
  target: { test: text => (/^@e\d{1,5}$/.test(text.trim()) ? text.trim() : null), rule: 'an element ref from a snapshot: @e1, @e12 …' },
  query: { test: text => (/^[A-Za-z0-9@][A-Za-z0-9 ._@/-]{0,63}$/.test(text.trim()) ? text.trim() : null), rule: 'a search: 1-64 letters, digits, spaces, . _ @ / -, not starting with -' },
  task: { test: text => prose(text, 200), rule: 'what you want to do, in words: 1-200 characters, no control characters, not starting with -' },
  cmd: { test: text => prose(text, 200), rule: 'one command line: 1-200 characters, no newline or control character, not starting with -' },
  id: { test: text => (/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/.test(text.trim()) ? text.trim() : null), rule: 'an id: letters, digits _ . : -, at most 64, not starting with -' },
  note: { test: text => prose(text, 200), rule: 'a note: 1-200 characters, no control characters, not starting with -' },
  session: { test: text => (/^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/.test(text.trim()) ? text.trim() : null), rule: 'a sandbox name: letters, digits _ -, at most 40, not starting with _ or - (the console adds the ruflo-sb- prefix)' },
  // tmux splits an argument that ends in a semicolon into two commands, so a command line ending in one is refused, not typed.
  send: { test: text => { const value = prose(text, 200); return value === null || value.endsWith(';') ? null : value }, rule: 'one command line to type: 1-200 characters, no control character, not starting with -, not ending in ;' },
}

/** A field's checked value, or null; `build` makes the argv only when every named field passes. */
export const need = (fields: DevFields, names: readonly DevField[], build: (values: Record<DevField, string>) => readonly string[]): readonly string[] | null => {
  const values = {} as Record<DevField, string>

  for (const name of names) {
    const value = fieldValue(name, fields[name])

    if (value === null) return null
    values[name] = value
  }

  return build(values)
}

/** A field's text as it may enter an argv, or null when it breaks the field's rule. */
export const fieldValue = (field: DevField, text: string): string | null => RULES[field].test(text)

/** The rule a field's text must follow, in the footer's words. */
export const fieldRule = (field: DevField): string => RULES[field].rule

/** `ruflo mcp exec -t <tool> -p <json>`: one argv element of JSON, numbers and booleans kept as they are. */
export const tool = (name: string, params: Record<string, unknown>): readonly string[] => ['mcp', 'exec', '-t', name, '-p', JSON.stringify(params)]

/** The JSON a run printed, with `mcp exec`'s content wrapper taken off; `isError` when the tool said it failed. */
export function unwrap(stdout: string): { value: unknown; isError: boolean } | null {
  const json = jsonAfter(stdout)
  const record = recordOf(json)

  if (json === null) return null
  if (record === null || !Array.isArray(record.content)) return { value: json, isError: record?.isError === true || record?.success === false }

  const texts = record.content.map(recordOf).flatMap(part => (part !== null && typeof part.text === 'string' ? [part.text] : []))
  const parsed = texts.map(text => {
    try {
      return JSON.parse(text) as unknown
    } catch {
      return text
    }
  })
  const value = parsed.length === 1 ? parsed[0] : parsed
  const inner = recordOf(value)

  return { value, isError: record.isError === true || inner?.success === false || (inner !== null && typeof inner.error === 'string' && Object.keys(inner).length <= 2) }
}

const list = (value: unknown): string => (Array.isArray(value) ? value.map(item => plain(String(item), 40)).join(', ') : '')

/** guidance_brain recommend: each matching domain with its tools and risk, then the loop's steps and their tools. */
export function brainLines(value: unknown): string[] {
  const record = recordOf(value)

  if (record === null) return []

  const out: string[] = []
  const domains = (Array.isArray(record.domains) ? record.domains : []).map(recordOf)

  if (typeof record.task === 'string') out.push(`for: ${plain(record.task, 140)}`)
  if (domains.length === 0 && Array.isArray(record.domains)) out.push('no capability domain matched: try other words')

  for (const domain of domains) {
    if (domain === null) continue
    out.push(`▸ ${plain(String(domain.name ?? domain.id ?? ''), 40)} · ${plain(String(domain.risk ?? 'n/a'), 20)} · ${plain(String(domain.authority ?? 'n/a'), 20)}`)
    out.push(`    tools: ${list(domain.registeredTools) || '(none registered)'}`)
  }

  const loop = (Array.isArray(record.implementationLoop) ? record.implementationLoop : []).map(recordOf)

  if (loop.length > 0) out.push('then the loop:')

  for (const step of loop) {
    if (step === null) continue
    out.push(`  ${plain(String(step.name ?? step.id ?? ''), 14).padEnd(10)} ${list(step.preferredTools) || '—'}`)
  }

  for (const rule of (Array.isArray(record.guardrails) ? record.guardrails : []).slice(0, 4)) out.push(`! ${plain(String(rule), 150)}`)

  return out
}

/** What a Dev Tools run printed, as clean lines: the wrapper unwrapped, the brain read for its picks, errors said first. */
export function devLines(id: string, stdout: string, stderr = ''): string[] {
  const answer = unwrap(stdout)

  if (answer === null) return labLines(id, stdout, stderr)

  const { value, isError } = answer
  const record = recordOf(value)
  const error = record !== null && typeof record.error === 'string' ? record.error : null

  if (isError && error !== null) {
    const rest = Object.fromEntries(Object.entries(record ?? {}).filter(([key]) => key !== 'error' && key !== 'success'))

    return [`✗ ${plain(error, 200)}`, ...(Object.keys(rest).length > 0 ? labLines(id, JSON.stringify(rest), stderr) : [])].slice(0, 40)
  }
  if (typeof value === 'string') return labLines(id, value, stderr)

  const brain = id.startsWith('dt-brain') ? brainLines(value) : []

  return brain.length > 0 ? brain.slice(0, 40) : labLines(id, JSON.stringify(value), stderr)
}

/** True when what a run printed says the tool failed, though the CLI exited 0. */
export const isToolError = (stdout: string): boolean => unwrap(stdout)?.isError === true
