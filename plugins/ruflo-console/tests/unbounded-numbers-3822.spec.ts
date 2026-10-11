/**
 * A number another process printed is bounded where it is read (#3817, #3822): `JSON.parse('1e999')` is Infinity, and a CLI's JSON can carry a
 * negative, fractional or absurd count. The severity counts, totals, confidences and the other counts the readers keep must never draw "Infinity",
 * "NaN", a negative count or "1e+300" on the band or in a result panel. Real readers and the real band over a fresh State.
 */
import { describe, expect, it } from 'vitest'

import { memoryProbe, PROBES } from '../hooks/data/cli'
import { parseLedger, parsePolicyLedger, parseWitness } from '../hooks/data/evolve'
import { MAX_COUNT } from '../hooks/data/safe'
import { labLines } from '../hooks/mh-lab'
import { routeSpec } from '../hooks/neural'
import { metricsReader, reportReader } from '../hooks/perf'
import { compositionReader, countText, mcpReader, scanReader, secMemo } from '../hooks/secure'
import { newState } from '../hooks/state'
import { barParts, barText } from '../hooks/views/bar'
import { parseResearch } from '../hooks/data/research'
import { memLines } from '../hooks/memory-lines'

const NOT_A_NUMBER = /Infinity|NaN|e\+\d/
const scan = (summary: string, findings = '[]') => `{"type":"all","depth":"quick","summary":${summary},"findings":${findings}}`

describe('security scan counts are bounded at the reader (#3822)', () => {
  it('a summary count of 1e999 with nothing listed is unknown, not 0: the result, the page and the band say so', () => {
    const state = newState({})
    const lines = scanReader(scan('{"critical":1e999,"high":0,"medium":0,"low":0}'), '', state)
    const findings = secMemo(state).findings

    expect(barText(state)).not.toMatch(NOT_A_NUMBER)
    expect(lines.join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(findings?.unreadable).toEqual(['critical'])
    expect(findings === null ? '' : countText(findings, 'critical')).toBe('?')
    expect(lines[0]).toMatch(/^COUNTS UNREADABLE/)
    expect(lines[1]).toMatch(/critical \? · high 0/)
    expect(barText(state)).toMatch(/🔒 security counts unreadable/)
    expect(barParts(state, Date.now()).find(part => part.go === 'secure')?.tone).toBe('attention')
  })

  it('an unreadable count with a listed critical: at least 1, still unknown, and the band warns (the review case)', () => {
    const state = newState({})
    const lines = scanReader(scan('{"critical":1e999,"high":0,"medium":0,"low":0,"total":1}', '[{"severity":"critical","type":"secret","location":"a.ts"}]'), '', state)

    expect(secMemo(state).findings?.counts.critical).toBe(1)
    expect(secMemo(state).findings?.unreadable).toEqual(['critical'])
    expect(lines[0]).toMatch(/^ATTENTION · 1 finding/)
    expect(lines[1]).toMatch(/critical ≥1 \?/)
    expect(barText(state)).toMatch(/🔒 1\+ high or critical/)
  })

  it('an unreadable critical count with only a LOW finding listed stays unknown: the listed count is a lower bound, and the band warns', () => {
    const state = newState({})
    const lines = scanReader(scan('{"critical":1e999,"high":0,"medium":0,"low":0,"total":1}', '[{"severity":"low","type":"x"}]'), '', state)
    const findings = secMemo(state).findings

    expect(findings?.unreadable).toEqual(['critical'])
    expect(findings === null ? '' : countText(findings, 'critical')).toBe('?')
    expect(lines[0]).toMatch(/^COUNTS UNREADABLE/)
    expect(barText(state)).toMatch(/🔒 security counts unreadable/)
  })

  it('an unreadable count keeps the listed findings of that severity as its lower bound ("≥2 ?")', () => {
    const state = newState({})

    scanReader(scan('{"critical":0,"high":-3,"medium":0,"low":0,"total":2}', '[{"severity":"high","type":"x"},{"severity":"high","type":"y"}]'), '', state)
    const findings = secMemo(state).findings

    expect(findings?.unreadable).toEqual(['high'])
    expect(findings === null ? '' : countText(findings, 'high')).toBe('≥2 ?')
    expect(barText(state)).toMatch(/🔒 2\+ high or critical/)
  })

  it('an unreadable total with every severity 0 is recorded and warns on the band', () => {
    const state = newState({})
    const lines = scanReader(scan('{"critical":0,"high":0,"medium":0,"low":0,"total":1e999}'), '', state)

    expect(secMemo(state).findings?.isTotalUnknown).toBe(true)
    expect(lines[0]).toMatch(/^COUNTS UNREADABLE · \? findings/)
    expect(barText(state)).toMatch(/🔒 security counts unreadable/)
  })

  it('the total and each severity are at least the listed findings: never CLEAN while a finding is listed', () => {
    const state = newState({})
    const lines = scanReader(scan('{"critical":0,"high":0,"medium":0,"low":0,"total":0}', '[{"severity":"low","type":"x"}]'), '', state)

    expect(lines[0]).toMatch(/^REVIEW · 1 finding /)
    expect(lines[1]).toMatch(/low 1/)
    expect(secMemo(state).findings?.counts.low).toBe(1)
  })

  it('a summary that under-reports cannot hide a listed critical finding', () => {
    const state = newState({})

    scanReader(scan('{"critical":0,"high":0,"medium":0,"low":0,"total":1}', '[{"severity":"critical","type":"x"}]'), '', state)
    expect(secMemo(state).findings?.counts.critical).toBe(1)
    expect(barText(state)).toMatch(/🔒 1 high or critical/)
  })

  it('an unreadable total with nothing listed reads "? findings", never CLEAN', () => {
    const lines = scanReader(scan('{"critical":0,"high":0,"medium":0,"low":0,"total":-1}'), '', newState({}))

    expect(lines[0]).toMatch(/\? findings \(total unreadable\)/)
    expect(lines[0]).not.toMatch(/CLEAN/)
  })

  it('a finite but absurd count (1e300) is capped, never printed as "1e+300"', () => {
    const state = newState({})

    scanReader(scan('{"critical":1e300,"high":0,"medium":0,"low":0}'), '', state)
    expect(secMemo(state).findings?.counts.critical).toBe(MAX_COUNT)
    expect(barText(state)).toMatch(/🔒 1000000000000 high or critical/)
    expect(barText(state)).not.toMatch(NOT_A_NUMBER)
  })

  it('a total of 1e999 is unknown, with the findings it listed as its lower bound', () => {
    const state = newState({})
    const lines = scanReader(scan('{"critical":0,"high":0,"medium":0,"low":0,"total":1e999}', '[{"severity":"low","type":"x"}]'), '', state)

    expect(lines[0]).toMatch(/· ≥1 \? findings \(total unreadable\) ·/)
  })

  it('a negative count is unknown and a fractional one is whole; the band still warns, marked as a lower bound', () => {
    const state = newState({})

    scanReader(scan('{"critical":-5,"high":2.9,"medium":0,"low":0}'), '', state)
    expect(secMemo(state).findings?.counts).toMatchObject({ high: 2, medium: 0, low: 0 })
    expect(secMemo(state).findings?.unreadable).toEqual(['critical'])
    expect(barText(state)).toMatch(/🔒 2\+ high or critical/)
  })

  it('a threat confidence of 1e999 or 1e300 is not drawn as a percentage past 100', () => {
    const state = newState({})
    const out = mcpReader('aidefence_scan')(`Result:\n{"safe":false,"threats":[{"severity":"high","type":"inj","confidence":1e300},{"severity":"low","type":"b","confidence":1e999}]}`, '', state)

    expect(out.join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(out.join('\n')).toMatch(/inj 100%/)
    expect(out.join('\n')).toMatch(/\] b · /)
  })

  it('a composition suspect score of 1e999 reads n/a', () => {
    const out = compositionReader('{"suspects":[{"tool":"t","score":1e999,"reason":"r"}]}', '', newState({}))

    expect(out.join('\n')).not.toMatch(NOT_A_NUMBER)
  })
})

describe('the other readers that take numbers from CLI JSON (#3822 sweep)', () => {
  it('performance metrics: load, system memory and heap are finite or n/a', () => {
    const state = newState({})
    const out = metricsReader('{"memory":{"heapUsed":1e999,"heapTotal":1,"rss":1,"systemPercent":1e999},"cpu":{"loadAverage":[1e999,0.5]},"latency":{"avgMs":1e300},"cache":{}}', '', state)

    expect(out.join('\n')).not.toMatch(NOT_A_NUMBER)
  })

  it('performance_report: a cpu usage of 1e999 reads n/a', () => {
    const out = reportReader('Result:\n{"current":{"cpu":{"usage":1e999,"cores":4},"memory":{},"latency":{"avg":1e300}},"history":[]}', '', newState({}))

    expect(out.join('\n')).not.toMatch(NOT_A_NUMBER)
  })

  it('the gepa render and genome lines never print Infinity or 1e+300 (chars, ids, receipts)', () => {
    expect(labLines('mh-gepa-render', '{"system":"hello","chars":1e999}').join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(labLines('mh-gepa-render', '{"system":"hello","chars":1e300}')[0]).toMatch(/^5 chars/)
    expect(labLines('mh-gepa-genome', '{"valid":true,"errors":[],"genome":{"meta":{"id":1e300,"parent":1e999,"mutated":-1e300},"components":{}}}').join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(labLines('mh-receipts', '[{"receiptId":1e300,"decision":1e999,"state":"s"}]').join('\n')).not.toMatch(NOT_A_NUMBER)
  })

  it('a lab result (genome, redblue, audit) never prints Infinity or a cost of $Infinity', () => {
    expect(labLines('mh-genome', '{"genome":{"fitness":1e999,"generation":3}}').join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(labLines('mh-redblue', '{"summary":{"tests_run":1e999,"failures_found":2,"critical":-1,"cost_usd":1e999}}').join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(labLines('mh-audit', '{"worst":"low","findings":[],"allowedTools":1e999}').join('\n')).not.toMatch(NOT_A_NUMBER)
  })

  it('hooks route: a confidence of 1e300 is drawn as at most 100%', () => {
    const read = routeSpec('fix the bug')?.read

    expect(read).toBeDefined()

    const out = read?.('{"primaryAgent":{"type":"coder","confidence":1e300},"alternativeAgents":[{"type":"tester","confidence":-4}],"routing":{"method":"m"}}', '', true) ?? []

    expect(out.join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(out[0]).toMatch(/coder · 100%/)
    expect(out.join('\n')).toMatch(/tester · 0%/)
  })

  it('evolve: ledger, witness and policy counts are whole, non-negative and capped', () => {
    expect(parseLedger('{"ledger":{"valid":true,"commits":-3}}', 1)?.commits).toBe(0)
    expect(parseWitness('{"ok":true,"summary":{"pass":1e300,"drift":2.5,"regressed":-1,"missing":0}}', 'macos', 1)).toMatchObject({ pass: MAX_COUNT, drift: 2, regressed: 0, missing: 0 })
    expect(parsePolicyLedger('{"mode":"m","rules":1e300,"approvals":-2,"receipts":1.5,"ledger":{"valid":true}}', 1)).toMatchObject({ rules: MAX_COUNT, approvals: 0, receipts: 1 })
  })

  it('CLI memory stats and intelligence counts are whole, non-negative and capped', () => {
    expect(memoryProbe.parse('{"backend":"b","entries":{"total":-1,"vectors":1e300},"unreadStore":{"rows":2.5}}')).toMatchObject({ vectors: MAX_COUNT, unread: 2 })
    expect(memoryProbe.parse('{"backend":"b","entries":{"total":-1}}')?.total).toBeUndefined()

    const intel = PROBES.find(probe => probe.id === 'intelligence')?.parse('Result:\n{"sona":{"trajectoriesTotal":1e300,"patternsLearned":-4},"moe":{"routingDecisions":2.5},"ewc":{"consolidations":1e300}}') as Record<string, unknown>

    expect(intel).toMatchObject({ trajectories: MAX_COUNT, moeDecisions: 2, ewcConsolidations: MAX_COUNT })
    expect(intel.patterns).toBeUndefined()
  })

  it('memory search scores and vector elements of 1e300 read n/a, never "1e+300"', () => {
    expect(memLines('mem-search', '{"results":[{"key":"k","namespace":"n","score":1e300,"content":"c"}]}').join('\n')).not.toMatch(NOT_A_NUMBER)
    expect(memLines('mem-search', '{"results":[{"key":"k","namespace":"n","score":1e300,"content":"c"}]}').join('\n')).toMatch(/n\/a/)

    const vector = memLines('mem-embed', '{"embedding":[1e300,0.5,1e999,-0.25],"model":"m"}').join('\n')

    expect(vector).not.toMatch(NOT_A_NUMBER)
    expect(vector).toMatch(/^2 dimensions/)
  })

  it('a research record spending 1e300 dollars reads n/a, not "$1e+300"', () => {
    const records = parseResearch(JSON.stringify({ version: 1, records: [] }).replace('[]', '[{"question":"q","status":"done","spentUsd":1e300,"capUsd":1e999,"findings":[]}]'))

    expect(records?.[0]).toMatchObject({ spentUsd: null, capUsd: null })
  })

  it('intelligence success rate and router confidence are clamped ratios', () => {
    const intel = PROBES.find(probe => probe.id === 'intelligence')?.parse('Result:\n{"sona":{"trajectoriesTotal":2,"successRate":1e300},"modelRouter":{"totalDecisions":3,"avgConfidence":-7}}') as Record<string, unknown>

    expect(intel).toMatchObject({ successRate: 1, routerConfidence: 0 })
  })
})
