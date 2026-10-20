import { describe, expect, it } from 'vitest'

import { evidenceEvent, GATES_ROW, gateSpec, parseGates, verdictOf, type Gate } from '../hooks/mission-verify'
import type { LedgerEvent, MissionRecord } from '../hooks/mission-types'

const gate = (line: string): Gate => parseGates(line).gates[0]!
const unit = gate('npm test')
const lint = gate('npm run lint')

const missionOf = (events: LedgerEvent[]): MissionRecord => ({ id: 'm1', objective: 'o', profile: 'feature', rigor: 'standard', tasks: [], acceptance: [], events, paused: false, cancelled: false, auto: false, createdAtMs: 0 }) as MissionRecord
const ev = (seq: number, type: string, extra: Partial<LedgerEvent> = {}): LedgerEvent => ({ seq, atMs: seq, type, taskId: 't1', ...extra })
const gateEv = (seq: number, g: Gate, status: 'passed' | 'failed' | 'unknown', taskId = 't1'): LedgerEvent => ev(seq, 'evidence.gate', { status, taskId, evidenceRef: `gate:${g.id}:${status === 'passed' ? 0 : 1}` })

describe('parseGates', () => {
  it('splits a line on single spaces into a fixed argv', () => {
    const { gates, rejected } = parseGates('npm run lint')

    expect(rejected).toEqual([])
    expect(gates).toHaveLength(1)
    expect(gates[0]!.argv).toEqual(['npm', 'run', 'lint'])
    expect(gates[0]!.label).toBe('npm run lint')
    expect(gates[0]!.id).toMatch(/^g[0-9a-z]+$/)
    expect(parseGates('npm run lint').gates[0]!.id).toBe(gates[0]!.id)
    expect(parseGates('npm test').gates[0]!.id).not.toBe(gates[0]!.id)
  })

  it.each([
    ['semicolon', 'npm test; rm x'],
    ['pipe', 'npm test | tee'],
    ['ampersand', 'npm test &'],
    ['redirect out', 'npm test > out'],
    ['redirect in', 'npm test < in'],
    ['backtick', 'echo `id`'],
    ['command substitution', 'echo $(id)'],
    ['control character', 'npm\ttest'],
    ['leading dash', '-rf /'],
    ['double space', 'npm  test'],
  ])('rejects %s and says why', (_name, line) => {
    const { gates, rejected } = parseGates(line)

    expect(gates).toEqual([])
    expect(rejected).toHaveLength(1)
    expect(rejected[0]!.why.length).toBeGreaterThan(5)
  })

  it('allows a dash after the first word', () => {
    expect(parseGates('cargo test -p x --lib').gates[0]!.argv).toEqual(['cargo', 'test', '-p', 'x', '--lib'])
  })

  it('splits lines on newlines and on a literal backslash-n, skipping empty lines', () => {
    expect(parseGates('a\n\n  \nb\r\nc').gates.map(g => g.label)).toEqual(['a', 'b', 'c'])
    expect(parseGates('a\\nb').gates.map(g => g.label)).toEqual(['a', 'b'])
  })

  it('keeps the first 4 gates and reports the rest', () => {
    const { gates, rejected } = parseGates('a\nb\nc\nd\ne\nf')

    expect(gates.map(g => g.label)).toEqual(['a', 'b', 'c', 'd'])
    expect(rejected.map(r => r.line)).toEqual(['e', 'f'])
    expect(rejected[0]!.why).toMatch(/first 4/)
  })

  it('refuses a line over 200 characters and accepts exactly 200', () => {
    expect(parseGates('x'.repeat(201)).rejected[0]!.why).toMatch(/200/)
    expect(parseGates('x'.repeat(200)).gates).toHaveLength(1)
  })

  it('reports a duplicate command once and gives nothing for non-text', () => {
    expect(parseGates('npm test\nnpm test')).toMatchObject({ gates: [{ label: 'npm test' }], rejected: [{ why: expect.stringMatching(/already/) }] })
    expect(parseGates(undefined)).toEqual({ gates: [], rejected: [] })
    expect(parseGates(42)).toEqual({ gates: [], rejected: [] })
    expect(parseGates('')).toEqual({ gates: [], rejected: [] })
  })

  it('does not let a rejected line use up a gate slot', () => {
    expect(parseGates('a;b\nb\nc\nd\ne').gates).toHaveLength(4)
  })
})

describe('gateSpec', () => {
  it('asks first, shows the exact argv, and says what is recorded', () => {
    const spec = gateSpec(unit)

    expect(spec.label).toBe('run gate: npm test')
    expect(spec.argv).toEqual(['npm', 'test'])
    expect(spec.shows).toBe('npm test')
    expect(spec.isReadOnly).toBe(false)
    expect(spec.expect).toMatch(/exit code/)
    expect(spec.expect).toMatch(/output summary/)
    expect(spec.expect).toMatch(/evidence/)
  })

  it('takes plumbing from baseSpec but never the argv, label or read-only flag', () => {
    const run = async () => {}
    const spec = gateSpec(unit, { run, scope: 'goal', timeoutMs: 5, isReadOnly: true, argv: ['rm', '-rf', '/'], label: 'harmless', shows: 'nothing' })

    expect(spec.run).toBe(run)
    expect(spec.scope).toBe('goal')
    expect(spec.timeoutMs).toBe(5)
    expect(spec.isReadOnly).toBe(false)
    expect(spec.argv).toEqual(['npm', 'test'])
    expect(spec.label).toBe('run gate: npm test')
    expect(spec.shows).toBe('npm test')
  })

  it('does not share the gate’s argv array', () => {
    const spec = gateSpec(unit)

    expect(spec.argv).not.toBe(unit.argv)
  })
})

describe('evidenceEvent', () => {
  it('summarises a pass: exit code, line count and the first line', () => {
    const out = Array.from({ length: 12 }, (_v, i) => `line ${i}`).join('\n')
    const event = evidenceEvent(unit, { exitCode: 0, stdout: out, stderr: '' }, 't1')

    expect(event).toEqual({ type: 'evidence.gate', taskId: 't1', status: 'passed', note: 'exit 0, 12 lines of output: line 0', evidenceRef: `gate:${unit.id}:0` })
  })

  it('a non-zero exit is failed; null is unknown', () => {
    expect(evidenceEvent(unit, { exitCode: 2, stdout: '', stderr: 'boom' }).status).toBe('failed')
    expect(evidenceEvent(unit, { exitCode: 2, stdout: '', stderr: 'boom' }).note).toBe('exit 2, 1 line of output: boom')

    const unknown = evidenceEvent(unit, { exitCode: null, stdout: '', stderr: '' })

    expect(unknown.status).toBe('unknown')
    expect(unknown.evidenceRef).toBe(`gate:${unit.id}:none`)
    expect(unknown.note).toMatch(/no exit code/)
    expect(unknown).not.toHaveProperty('taskId')
  })

  it('caps the first line at 120 characters and strips control characters', () => {
    const event = evidenceEvent(unit, { exitCode: 1, stdout: `\u001b[31mred\u0007 ${'y'.repeat(300)}`, stderr: '' })
    const shown = event.note.split(': ')[1]!

    expect(shown.length).toBeLessThanOrEqual(120)
    expect(event.note).not.toMatch(/[\u0000-\u001f]/)
    expect(event.note).not.toContain('[31m')
  })

  it('says no output when there is none, and falls back to stderr for the first line', () => {
    expect(evidenceEvent(unit, { exitCode: 0, stdout: '', stderr: '' }).note).toBe('exit 0, no output')
    expect(evidenceEvent(unit, { exitCode: 1, stdout: '\n\n', stderr: 'e1\ne2' }).note).toBe('exit 1, 2 lines of output: e1')
  })
})

describe('verdictOf', () => {
  it('says no-gates when none are configured, even with old evidence', () => {
    const mission = missionOf([gateEv(1, unit, 'passed')])

    expect(verdictOf(mission, 't1', [])).toMatchObject({ state: 'no-gates', passed: 0, failed: 0 })
    expect(verdictOf(missionOf([]), 't1')).toMatchObject({ state: 'no-gates' })
  })

  it('verifies when every gate’s latest result is a pass', () => {
    const mission = missionOf([gateEv(1, unit, 'passed'), gateEv(2, lint, 'passed')])

    expect(verdictOf(mission, 't1')).toMatchObject({ state: 'verified', passed: 2, failed: 0 })
  })

  it('a later pass after a fail does not count while the fail is newer than the pass, and clears it once the pass is newer', () => {
    expect(verdictOf(missionOf([gateEv(1, unit, 'passed'), gateEv(2, unit, 'failed')]), 't1')).toMatchObject({ state: 'failed', failed: 1 })
    expect(verdictOf(missionOf([gateEv(1, unit, 'failed'), gateEv(2, unit, 'passed')]), 't1')).toMatchObject({ state: 'verified', passed: 1, failed: 0 })
  })

  it('a pass on one gate does not hide a fail on another', () => {
    const mission = missionOf([gateEv(1, unit, 'failed'), gateEv(2, lint, 'passed')])

    expect(verdictOf(mission, 't1')).toMatchObject({ state: 'failed', passed: 1, failed: 1 })
  })

  it('orders by seq, not by array position', () => {
    const mission = missionOf([gateEv(5, unit, 'passed'), gateEv(2, unit, 'failed')])

    expect(verdictOf(mission, 't1').state).toBe('verified')
  })

  it('a new start wipes the earlier run’s evidence', () => {
    const mission = missionOf([gateEv(1, unit, 'failed'), ev(2, 'task.dispatched'), gateEv(3, unit, 'passed')])
    const restarted = missionOf([gateEv(1, unit, 'passed'), ev(2, 'task.dispatched')])

    expect(verdictOf(mission, 't1').state).toBe('verified')
    expect(verdictOf(restarted, 't1', [unit])).toMatchObject({ state: 'unverified', passed: 0 })
  })

  it('ignores other tasks and other event types', () => {
    const mission = missionOf([gateEv(1, unit, 'failed', 't2'), ev(2, 'task.completed', { status: 'failed' }), gateEv(3, unit, 'passed')])

    expect(verdictOf(mission, 't1').state).toBe('verified')
    expect(verdictOf(mission, 't2').state).toBe('failed')
  })

  it('an unknown exit is unverified, never a pass', () => {
    expect(verdictOf(missionOf([gateEv(1, unit, 'unknown')]), 't1')).toMatchObject({ state: 'unverified', passed: 0, failed: 0 })
  })

  it('with the configured gates, an unrun gate keeps the task unverified and a removed gate’s evidence does not count', () => {
    const mission = missionOf([gateEv(1, unit, 'passed')])

    expect(verdictOf(mission, 't1', [unit, lint])).toMatchObject({ state: 'unverified', passed: 1 })
    expect(verdictOf(mission, 't1', [lint]).state).toBe('unverified')
    expect(verdictOf(mission, 't1', [unit]).state).toBe('verified')
  })

  it('round-trips an evidenceEvent into a verdict', () => {
    const recorded = evidenceEvent(unit, { exitCode: 0, stdout: 'ok', stderr: '' }, 't1')
    const mission = missionOf([{ seq: 1, atMs: 1, ...recorded }])

    expect(verdictOf(mission, 't1', [unit]).state).toBe('verified')
  })
})

describe('GATES_ROW', () => {
  it('is a text row with the loop-gates id', () => {
    expect(GATES_ROW.id).toBe('loop-gates')
    expect(GATES_ROW.kind).toBe('text')
    expect(GATES_ROW.current({})).toBe('')
    expect(GATES_ROW.isChanged({})).toBe(false)
    expect(GATES_ROW.isChanged({ loopGates: 'npm test' })).toBe(true)
  })

  it('patches the text, keeping newlines, dropping other control characters and capping length', () => {
    expect(GATES_ROW.patch('npm test\nnpm run lint\u0007')).toEqual({ loopGates: 'npm test\nnpm run lint ' .trim() })
    // Not cut here (ADR-481): parseGates refuses an over-long line and keeps four, each with its reason.
    expect(GATES_ROW.patch('x'.repeat(5000)).loopGates.length).toBe(5000)
  })
})
