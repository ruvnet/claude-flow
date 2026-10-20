/**
 * The Events page's query language (ADR-474), small and safe:
 *   words (all must match) · "a quoted phrase" · -negation · kind:swarm level:bad agent:tester src:autopilot ref:run:wf_1 since:15m
 *   a|b inside a value is OR · /regex/ (or /regex/i) with a size cap, no nested quantifiers, no back-references, and a text cap.
 * `parseQuery` never throws: a problem is returned as an error line for the page to show, and the rest of the query still applies.
 * `matches` is pure over an event and runs on text the page already bounded.
 */
import type { ConsoleEvent } from './events'
import { refOf } from './events'
import { levelOf, type Level } from './event-severity'

export const QUERY_MAX = 20_000
export const REGEX_MAX = 48
/** An event's text is cut to this before a regex sees it, so no pattern can run for long. */
export const REGEX_TEXT_MAX = 200
const MAX_TERMS = 12
const MAX_ALTS = 8
const FIELDS = ['kind', 'level', 'agent', 'src', 'ref'] as const

export type Field = (typeof FIELDS)[number]
export type Term = { neg: boolean; type: 'word' | 'field' | 'regex'; field?: Field; /** Lower-cased alternatives (OR); one word or phrase for a plain term. */ alts: string[]; re?: RegExp }
export type Query = { terms: Term[]; sinceMs: number | null; errors: string[]; /** The query as typed, trimmed and capped. */ source: string }

/**
 * A pattern is also refused when it is slow in aggregate: even one quantifier is O(n^2) of the 200 characters on a text that does not
 * match (`.*.*x` cost about 280 microseconds a line, so 10 000 lines held the page for seconds). Callers that scan many events pass
 * a Budget; once its milliseconds are spent a regex term stops being evaluated and the caller says how many events were not searched.
 */
export type Budget = { ms: number; spentMs: number; skipped: number }
export const budgetOf = (ms: number): Budget => ({ ms, spentMs: 0, skipped: 0 })
export const REGEX_BUDGET_MS = 120

export const EMPTY_QUERY: Query = { terms: [], sinceMs: null, errors: [], source: '' }

const UNIT: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }

/** `15m`, `1h`, `2d`, `90s` as milliseconds (at most 30 days), or null. */
export function durationOf(value: string): number | null {
  const found = /^(\d{1,4})([smhd])$/.exec(value.trim().toLowerCase())

  if (found === null) return null

  const ms = Number(found[1]) * (UNIT[found[2] as string] as number)

  return ms > 0 && ms <= 30 * 86_400_000 ? ms : null
}

/** True where a group that is itself quantified (`+`, `*`, `{`) holds a quantifier or an alternation anywhere inside it: the shape of catastrophic backtracking. */
function unsafeGroup(source: string): boolean {
  const stack: { risky: boolean }[] = []
  let inClass = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i] as string

    if (ch === '\\') {
      i++
      continue
    }

    if (inClass) {
      if (ch === ']') inClass = false
      continue
    }

    if (ch === '[') inClass = true
    else if (ch === '(') stack.push({ risky: false })
    else if (ch === '+' || ch === '*' || ch === '{' || ch === '|' || (ch === '?' && source[i - 1] !== '(')) {
      const top = stack[stack.length - 1]

      if (top !== undefined) top.risky = true
    } else if (ch === ')') {
      const group = stack.pop()

      if (group === undefined) continue
      if (group.risky && /[+*{]/.test(source[i + 1] ?? '')) return true

      const parent = stack[stack.length - 1]

      if (parent !== undefined && group.risky) parent.risky = true
    }
  }

  return false
}

/** Why a pattern is refused, or null when it is safe to compile: short, no group quantified in a way that can blow up, no back-references. */
export function regexProblem(source: string): string | null {
  if (source === '') return 'an empty pattern'
  if (source.length > REGEX_MAX) return `a pattern over ${REGEX_MAX} characters`
  if (/\\[1-9]|\\k</.test(source)) return 'a back-reference'
  if (unsafeGroup(source)) return 'a quantified group that holds a quantifier or an alternation'
  if (/\(\?[<=!]/.test(source)) return 'a lookaround'
  // `?` counts: `a?a?a?...a{n}` is exponential too (the first review missed it: 20 of them took 18 ms on a 20-character text).
  if ((source.match(/[+*]|(?<!\()\?|\{\d*,\d*\}/g) ?? []).length > 2) return 'more than two quantifiers'

  return null
}

type Raw = { text: string; quoted: boolean }

/** The query cut into raw tokens: quoted phrases keep their spaces, a /regex/ keeps its slashes, a leading - is kept on the token. */
function tokens(input: string, errors: string[]): Raw[] {
  const out: Raw[] = []
  let i = 0

  while (i < input.length && out.length < MAX_TERMS * 2) {
    while (input[i] === ' ') i++
    if (i >= input.length) break

    const start = i
    const neg = input[i] === '-' && i + 1 < input.length && input[i + 1] !== ' '

    if (neg) i++

    if (input[i] === '"') {
      const end = input.indexOf('"', i + 1)

      if (end === -1) {
        errors.push('a quote is not closed: the rest is taken as one phrase')
        out.push({ text: `${neg ? '-' : ''}${input.slice(i + 1)}`, quoted: true })
        break
      }

      out.push({ text: `${neg ? '-' : ''}${input.slice(i + 1, end)}`, quoted: true })
      i = end + 1
    } else if (input[i] === '/') {
      let end = i + 1

      while (end < input.length && (input[end] !== '/' || input[end - 1] === '\\')) end++

      if (end >= input.length) {
        errors.push('a /regex/ is not closed with a second slash')
        i = input.length
      } else {
        let stop = end + 1

        while (stop < input.length && input[stop] === 'i') stop++

        out.push({ text: input.slice(start, stop), quoted: false })
        i = stop
      }
    } else {
      while (i < input.length && input[i] !== ' ') {
        if (input[i] === '"' && input[i - 1] === ':') {
          const end = input.indexOf('"', i + 1)

          if (end !== -1) {
            i = end + 1
            continue
          }
        }

        i++
      }

      out.push({ text: input.slice(start, i), quoted: false })
    }
  }

  return out
}

export function parseQuery(input: string, nowMs = 0): Query {
  void nowMs

  const source = input.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, QUERY_MAX)
  const errors: string[] = []
  const terms: Term[] = []
  let sinceMs: number | null = null

  for (const raw of tokens(source, errors)) {
    if (terms.length >= MAX_TERMS) {
      errors.push(`only the first ${MAX_TERMS} terms are used`)
      break
    }

    const neg = raw.text.startsWith('-') && raw.text.length > 1
    const body = neg ? raw.text.slice(1) : raw.text

    if (body === '') continue

    if (!raw.quoted && body.startsWith('/')) {
      const flags = body.endsWith('/i') ? 'i' : ''
      const pattern = body.slice(1, body.length - 1 - flags.length)
      const why = regexProblem(pattern)

      if (why !== null) {
        errors.push(`/${pattern.slice(0, 20)}${pattern.length > 20 ? '…' : ''}/ refused: ${why}`)
        continue
      }

      try {
        terms.push({ neg, type: 'regex', alts: [pattern], re: new RegExp(pattern, flags) })
      } catch {
        errors.push(`/${pattern.slice(0, 20)}/ is not a valid pattern`)
      }

      continue
    }

    const field = raw.quoted ? null : /^([a-z]+):(.*)$/.exec(body)

    if (field !== null) {
      const name = field[1] as string
      const value = (field[2] as string).replace(/^"|"$/g, '')

      if (name === 'since') {
        const ms = durationOf(value)

        if (ms === null) errors.push(`since: wants 90s, 15m, 1h or 2d, not "${value.slice(0, 12)}"`)
        else sinceMs = sinceMs === null ? ms : Math.min(sinceMs, ms)

        continue
      }

      if ((FIELDS as readonly string[]).includes(name)) {
        if (value === '') {
          errors.push(`${name}: needs a value`)
          continue
        }

        terms.push({ neg, type: 'field', field: name as Field, alts: value.toLowerCase().split('|').filter(Boolean).slice(0, MAX_ALTS) })
        continue
      }
    }

    terms.push({ neg, type: 'word', alts: (raw.quoted ? [body] : body.split('|')).map(word => word.toLowerCase()).filter(Boolean).slice(0, MAX_ALTS) })
  }

  return { terms, sinceMs, errors, source }
}


const fieldValue = (event: ConsoleEvent, field: Field): string => {
  switch (field) {
    case 'kind':
      return event.kind
    case 'level':
      return levelOf(event.kind, event.text)
    case 'agent':
      return (event.agentId ?? '').toLowerCase()
    case 'src':
      return (event.src ?? (event.kind === 'tools' ? 'session' : 'observed')).toLowerCase()
    case 'ref':
      return (refOf(event) ?? '').toLowerCase()
  }
}

/** Whether one event satisfies one term, before negation. A field match is exact for kind, level and src; a substring for agent and ref. */
function hit(event: ConsoleEvent, term: Term, lower: string, budget?: Budget): boolean {
  if (term.type === 'regex') {
    if (budget === undefined) return (term.re as RegExp).test(event.text.slice(0, REGEX_TEXT_MAX))
    if (budget.spentMs > budget.ms) {
      budget.skipped++

      return false
    }

    const from = performance.now()
    const found = (term.re as RegExp).test(event.text.slice(0, REGEX_TEXT_MAX))

    budget.spentMs += performance.now() - from

    return found
  }

  if (term.type === 'field') {
    const value = fieldValue(event, term.field as Field)

    return term.alts.some(alt => (term.field === 'agent' || term.field === 'ref' ? value.includes(alt) : value === alt))
  }

  return term.alts.some(alt => lower.includes(alt))
}

export function matches(event: ConsoleEvent, query: Query, nowMs: number, budget?: Budget): boolean {
  if (query.sinceMs !== null && nowMs - event.atMs > query.sinceMs) return false
  if (query.terms.length === 0) return true

  const lower = `${event.text} ${event.kind}`.toLowerCase()

  return query.terms.every(term => hit(event, term, lower, budget) !== term.neg)
}

/** The [start, end) ranges of `text` the positive word, phrase and regex terms hit, merged and sorted, for the row to colour. */
export function highlights(text: string, query: Query): [number, number][] {
  const lower = text.toLowerCase()
  const found: [number, number][] = []

  for (const term of query.terms) {
    if (term.neg || term.type === 'field') continue

    if (term.type === 'regex') {
      const global = new RegExp((term.re as RegExp).source, `${(term.re as RegExp).flags}g`)
      const cut = text.slice(0, REGEX_TEXT_MAX)

      for (const hitAt of cut.matchAll(global)) {
        if (hitAt[0] === '') break
        found.push([hitAt.index as number, (hitAt.index as number) + hitAt[0].length])
        if (found.length > 20) break
      }

      continue
    }

    for (const alt of term.alts) {
      let at = lower.indexOf(alt)

      while (at !== -1 && found.length < 40) {
        found.push([at, at + alt.length])
        at = lower.indexOf(alt, at + alt.length)
      }
    }
  }

  found.sort((a, b) => a[0] - b[0])

  const merged: [number, number][] = []

  for (const range of found) {
    const last = merged[merged.length - 1]

    if (last !== undefined && range[0] <= last[1]) last[1] = Math.max(last[1], range[1])
    else merged.push([range[0], range[1]])
  }

  return merged
}

export type { Level }
