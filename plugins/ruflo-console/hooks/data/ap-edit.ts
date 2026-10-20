/**
 * The envelope editor's pure half (ADR-470 §2.1): adding and removing one entry of a list field (folders, repos, network hosts, secret
 * variable names, verify commands) on a DRAFT. Nothing here has a rule of its own: an edit is accepted only if the result raises no
 * error that the draft did not already have, under `validateEnvelope`, the SAME validator the sealed file is opened with (verify argv
 * rules, host, repo, variable and path rules, protected folders, limits). So an edit can never produce a draft the loader would refuse,
 * and a rule added to the validator later reaches the editor with no change here. The draft is only a proposal: Start still asks.
 */
import { hashOf, narrowed, validateEnvelope, widened, type Envelope } from './ap-envelope'

export const LIST_KEYS = ['paths', 'repos', 'network', 'secretEnv', 'verify'] as const
export type ListKey = (typeof LIST_KEYS)[number]
export type Draft = Record<string, unknown>
export type Edited = { ok: true; value: Draft } | { ok: false; why: string }

const clone = (draft: Draft): Draft => JSON.parse(JSON.stringify(draft)) as Draft

const errorsOf = (draft: Draft): string[] => {
  const checked = validateEnvelope(draft)

  return checked.ok ? [] : checked.errors
}

/** What is typed for one entry, as the value stored in the draft; a string is the reason it cannot be read. */
export function entryOf(key: ListKey, raw: string): { value: string | string[] } | { why: string } {
  const text = raw.trim()

  if (text === '') return { why: 'type an entry first' }
  if (text.length > 300) return { why: 'too long (300 characters at most)' }

  if (key !== 'verify') return { value: key === 'network' ? text.toLowerCase() : text }

  // A verify command is a program and its arguments, split on spaces. Quoting is not interpreted (there is no shell), so a quote mark would be passed literally: refused rather than misread.
  if (/["'`\\]/.test(text)) return { why: 'no quotes or backslashes: a verify command is a program and its arguments split on spaces (a part cannot contain a space)' }

  return { value: text.split(/\s+/) }
}

const sameEntry = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The draft with one entry added, or why not. The validator's own first new error is the reason. */
export function addEntry(draft: Draft, key: ListKey, raw: string): Edited {
  const entry = entryOf(key, raw)

  if ('why' in entry) return { ok: false, why: entry.why }

  const next = clone(draft)
  const have = Array.isArray(next[key]) ? (next[key] as unknown[]) : []

  if (have.some(item => sameEntry(item, entry.value))) return { ok: false, why: 'already in the list' }

  next[key] = [...have, entry.value]

  const before = new Set(errorsOf(draft))
  const fresh = errorsOf(next).filter(error => !before.has(error))

  return fresh.length > 0 ? { ok: false, why: fresh[0] as string } : { ok: true, value: next }
}

/** The draft with entry `index` of the list removed, or why not (removing the last folder would leave a draft the loader refuses). */
export function removeEntry(draft: Draft, key: ListKey, index: number): Edited {
  const have = Array.isArray(draft[key]) ? (draft[key] as unknown[]) : []

  if (!Number.isInteger(index) || index < 0 || index >= have.length) return { ok: false, why: 'no such entry' }

  const next = clone(draft)

  next[key] = have.filter((_, i) => i !== index)

  const before = new Set(errorsOf(draft))
  const fresh = errorsOf(next).filter(error => !before.has(error))

  return fresh.length > 0 ? { ok: false, why: fresh[0] as string } : { ok: true, value: next }
}

/** Rows saying how the draft differs from the approved envelope: what it adds (needs the confirm), what it takes away, or that it is the same. */
export function diffRows(approved: Envelope | null, draft: Draft): string[] {
  const checked = validateEnvelope(draft)

  if (!checked.ok) return ['the draft is not valid yet: no comparison']
  if (approved === null) return ['no approved envelope yet: Start would be the first approval']

  const grew = widened(approved, checked.envelope)
  const shrank = narrowed(approved, checked.envelope)

  if (hashOf(approved) === hashOf(checked.envelope)) return ['same as the approved envelope']
  if (grew.length === 0 && shrank.length === 0) return ['differs from the approved envelope only in its name (a new Start would still ask)']

  return [...grew.map(line => `+ ${line}`), ...shrank.map(line => `- ${line}`)]
}
