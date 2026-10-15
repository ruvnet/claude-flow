/**
 * The Events query language (ADR-474): the parser, the evaluator, highlights, and the safety of /regex/ terms (size cap, no nested
 * quantifiers, no back-references, bounded text), plus a property test that no query text ever throws.
 */
import { describe, expect, it } from 'vitest'

import { durationOf, highlights, matches, parseQuery, regexProblem, REGEX_MAX } from '../hooks/data/event-query'
import type { ConsoleEvent } from '../hooks/data/events'

const NOW = Date.UTC(2026, 9, 7, 12)
const ev = (kind: ConsoleEvent['kind'], text: string, extra: Partial<ConsoleEvent> = {}, agoMs = 0): ConsoleEvent => ({ kind, text, atMs: NOW - agoMs, ...extra })
const run = (q: string, e: ConsoleEvent): boolean => matches(e, parseQuery(q), NOW)

describe('parseQuery', () => {
  it('free words are ANDed, a quoted phrase keeps its spaces, a leading minus negates', () => {
    const e = ev('swarm', 'agent coder spawned (coder)')

    expect(run('agent coder', e)).toBe(true)
    expect(run('agent reviewer', e)).toBe(false)
    expect(run('"agent coder"', e)).toBe(true)
    expect(run('"coder agent"', e)).toBe(false)
    expect(run('agent -spawned', e)).toBe(false)
    expect(run('agent -failed', e)).toBe(true)
  })

  it('field filters: kind, level, agent, src, ref, with OR by a|b', () => {
    const e = ev('workflows', 'run wf_1 failed (1 of 2 agents)', { src: 'workflows', ref: 'run:wf_1', agentId: 'tester-7' })

    expect(run('kind:workflows', e)).toBe(true)
    expect(run('kind:swarm|workflows', e)).toBe(true)
    expect(run('kind:swarm|claims', e)).toBe(false)
    expect(run('level:bad', e)).toBe(true)
    expect(run('level:ok|info', e)).toBe(false)
    expect(run('agent:tester', e)).toBe(true)
    expect(run('src:autopilot', e)).toBe(false)
    expect(run('ref:run:wf_1', e)).toBe(true)
    expect(run('-kind:workflows', e)).toBe(false)
    expect(run('failed|stuck', e)).toBe(true)
  })

  it('since: keeps only recent events and takes the smallest of several', () => {
    expect(run('since:15m', ev('swarm', 'a', {}, 5 * 60_000))).toBe(true)
    expect(run('since:15m', ev('swarm', 'a', {}, 20 * 60_000))).toBe(false)
    expect(run('since:2d since:1h', ev('swarm', 'a', {}, 2 * 3_600_000))).toBe(false)
    expect(durationOf('90s')).toBe(90_000)
    expect(durationOf('1h')).toBe(3_600_000)
    expect(durationOf('0m')).toBeNull()
    expect(durationOf('999d')).toBeNull()
    expect(durationOf('soon')).toBeNull()
  })

  it('reports problems inline and still applies the rest', () => {
    const q = parseQuery('since:soon kind: swarm "unclosed')

    expect(q.errors.some(error => error.startsWith('since:'))).toBe(true)
    expect(q.errors.some(error => error.includes('quote'))).toBe(true)
    expect(q.terms.length).toBeGreaterThan(0)
  })

  it('caps the query length and the number of terms', () => {
    const q = parseQuery('word '.repeat(500))

    expect(q.source.length).toBe(2499)
    expect(q.terms.length).toBeLessThanOrEqual(12)
  })
})

describe('regex terms', () => {
  it('match case-sensitively, or with /i, against the event text', () => {
    expect(run('/spawn(ed)?/', ev('swarm', 'agent spawned'))).toBe(true)
    expect(run('/SPAWN/', ev('swarm', 'agent spawned'))).toBe(false)
    expect(run('/SPAWN/i', ev('swarm', 'agent spawned'))).toBe(true)
    expect(run('-/spawn/', ev('swarm', 'agent spawned'))).toBe(false)
  })

  it.each(['(a+)+$', '(a*)*b', '(a|aa)+c', '((a+))+', '(.*a){3}', '(x+x+)+y', '(a|b)*', '\\1(a)(b)\\2', '(?=a)a', '(?<!a)b'])('refuses the dangerous pattern %s', pattern => {
    expect(regexProblem(pattern)).not.toBeNull()

    const q = parseQuery(`/${pattern}/`)

    expect(q.terms).toHaveLength(0)
    expect(q.errors.length).toBeGreaterThan(0)
  })

  it('refuses a pattern over the size cap, and accepts ordinary ones', () => {
    expect(regexProblem('a'.repeat(REGEX_MAX + 1))).not.toBeNull()
    expect(regexProblem('step s[0-9]+ (done|failed)')).toBeNull()
    expect(regexProblem('^agent \\w+$')).toBeNull()
  })

  it('cannot be made to run long: a hostile event text and a hostile pattern both finish at once', () => {
    const text = `${'a'.repeat(50_000)}!`
    const started = performance.now()

    for (const pattern of ['a*a*a*a*b', '.*.*.*x', '(a+)+$']) expect(parseQuery(`/${pattern}/`).terms).toHaveLength(0)
    for (const pattern of ['.*a.*b', 'a+a+b', '\\w+ \\w+x']) for (let i = 0; i < 40; i++) matches(ev('swarm', text), parseQuery(`/${pattern}/`), NOW)

    expect(performance.now() - started).toBeLessThan(3000)
  })

  it('a regex that cannot compile is an error line, not a throw', () => {
    expect(() => parseQuery('/[a-/')).not.toThrow()
    expect(parseQuery('/[a-/').errors.length).toBeGreaterThan(0)
  })
})

describe('highlights', () => {
  it('ranges of words, phrases and regexes, merged, and none for a negation or a field', () => {
    const q = parseQuery('coder "was busy" -zzz kind:swarm')

    expect(highlights('agent coder was busy', q)).toEqual([[6, 11], [12, 20]])
    expect(highlights('coder coder', parseQuery('coder'))).toEqual([[0, 5], [6, 11]])
    expect(highlights('abc', parseQuery('/b/'))).toEqual([[1, 2]])
    expect(highlights('abc', parseQuery('-b'))).toEqual([])
  })
})

describe('a random query never throws', () => {
  it('over 3000 random strings drawn from the language alphabet', () => {
    let seed = 7
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff

      return seed % n
    }
    const alphabet = ['a', 'b', ' ', '"', '/', '-', ':', '|', '(', ')', '+', '*', '\\', '[', ']', '{', '}', 'kind', 'level:', 'since:', '1h', '.', '^', '$', '?', 'é', '\u0000', '‮']
    const event = ev('swarm', 'agent coder spawned', { agentId: 'x' })

    for (let i = 0; i < 3000; i++) {
      const q = Array.from({ length: rnd(40) }, () => alphabet[rnd(alphabet.length)]).join('')

      expect(() => highlights(event.text, parseQuery(q))).not.toThrow()
      expect(() => matches(event, parseQuery(q), NOW)).not.toThrow()
    }
  })
})
