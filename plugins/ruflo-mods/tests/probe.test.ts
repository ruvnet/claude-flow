import { describe, expect, test, tier } from 'claude-code/testing'

import { readOptions } from '../hooks/options'
import { probeLine, probeState, registeredEvents, versionText } from '../hooks/probe'
import { register } from '../hooks/register'
import { run } from './fixtures/consumer'
import { HELPER, ROOT, START, world } from './fixtures/world'

tier('user')

describe('capability probe, pure (ADR-451 item 5)', () => {
  test('version text: release base wins, anything unprintable is not exposed', () => {
    expect(versionText({ version: '2.1.287', base: '2.1.287' })).toBe('2.1.287')
    expect(versionText({ version: '2.1.280-dev.20260920.t1.sha1a2b3c4', base: '2.1.280-dev' })).toBe('2.1.280-dev')
    expect(versionText({ version: '2.1.287' })).toBe('2.1.287')
    for (const bad of [undefined, null, 7, {}, { version: 'x\u001b[2Jy' }, { version: 'a'.repeat(41) }, { version: '' }]) expect(versionText(bad)).toBeUndefined()
  })

  test('the line is bounded however many events never fired', () => {
    const probe = probeState()
    probe.enabled = true
    for (let i = 0; i < 64; i++) probe.registered.add(`never.fired.event.number.${i}`)
    const line = probeLine(probe)
    expect(line.length).toBeLessThanOrEqual(240)
    expect(line).toContain('events fired 0/64')
  })

  test('the registered-event list grows with the options that register more events (smoke.sh checks it against hooks/)', () => {
    const off = registeredEvents({ toolHints: false, agentTrim: false, deliveryScreen: false })
    expect(off).not.toContain('tool.describe')
    expect(off).toContain('tool.check')
    expect(registeredEvents({ toolHints: true, agentTrim: true, deliveryScreen: true, compactCarry: true })).toEqual(
      [...off, 'tool.describe', 'agent.offer', 'agent.spawn', 'session.receive', 'session.send', 'session.compact'].sort(),
    )
  })

  test('registeredEvents matches what register() hooks, for every option combination', () => {
    const B = [false, true]
    for (const costBudgetUsd of [undefined, 5]) for (const costHardStop of B) for (const sessionRollup of B)
    for (const agentTrim of B) for (const modTrust of ['observe', 'off']) for (const toolHints of B)
    for (const deliveryScreen of B) for (const compactCarry of B) {
      const o = { costBudgetUsd, costHardStop, sessionRollup, agentTrim, modTrust, toolHints, deliveryScreen, compactCarry, capabilityProbe: true }
      const seen = new Set<string>()
      const chain: { catch: () => unknown } = { catch: () => chain }
      register(((name: string) => (name !== '*' && seen.add(name), chain)) as never, o as never)
      expect(registeredEvents(readOptions(o as never)), JSON.stringify(o)).toEqual([...seen].sort())
    }
  })

  test('events hooked only under an option are counted only under it', () => {
    const base = { toolHints: false, agentTrim: false, deliveryScreen: false }
    const off = registeredEvents(base)
    for (const e of ['session.measure', 'agent.spawn']) expect(off).not.toContain(e)
    expect(off).toContain('plugin.register')
    expect(registeredEvents({ ...base, modTrust: 'off' })).not.toContain('plugin.register')
    expect(registeredEvents({ ...base, costBudgetUsd: 5 })).toContain('session.measure')
    expect(registeredEvents({ ...base, costBudgetUsd: 5 })).not.toContain('agent.spawn')
    expect(registeredEvents({ ...base, costBudgetUsd: 5, costHardStop: true })).toContain('agent.spawn')
    expect(registeredEvents({ ...base, costHardStop: true })).not.toContain('agent.spawn')
    expect(registeredEvents({ ...base, sessionRollup: true })).toContain('agent.spawn')
  })
})

describe('capabilityProbe option (ADR-451 item 5)', () => {
  const BEAT = `${ROOT}/.claude-flow/mods/session.json`
  let w: ReturnType<typeof world>
  const boot = (on: Parameters<Parameters<typeof test>[2]>[1], version?: unknown) => {
    w = world(on, {}, { [HELPER]: '' })
    on('tool.check', () => ({ decision: 'allow' }))
    if (version !== undefined) on('session.version', () => ({ value: version as never }))
  }
  const report = async ($: Parameters<Parameters<typeof test>[2]>[0]) => (await $.command.run(run('ruflo-mods'))).text ?? ''
  const check = (command: string) => ({ tool: 'Bash', input: { command } }) as never

  test('off by default: the report says off, nothing is added to the heartbeat', async ($, on) => {
    boot(on, { version: '2.1.287', base: '2.1.287' })
    await $.session.start(START)
    expect(await report($)).toContain('probe:       off (set the capabilityProbe option)')
    const beat = w.files.get(BEAT) ?? ''
    expect(beat).not.toContain('engine')
    expect(beat).not.toContain('events')
  })

  test('on: version, fired count and the never-fired events are reported', { options: { capabilityProbe: true } }, async ($, on) => {
    boot(on, { version: '2.1.287', base: '2.1.287' })
    await $.session.start(START)
    const line = (await report($)).split('\n').find(l => /^\s*probe:\s+engine/.test(l)) ?? ''
    expect(line).toMatch(/probe:\s+engine 2\.1\.287 · events fired \d+\/\d+ · never fired: /)
    expect(line).not.toMatch(/probe:\s+probe:/) // the label is printed once
    expect(Number(/fired (\d+)\//.exec(line)?.[1])).toBeGreaterThanOrEqual(2) // session.start and command.run fired
    expect(line).not.toMatch(/never fired:.*\bsession\.start\b/)
    expect(line).toMatch(/never fired:.*\btool\.check\b/)
    const beat = JSON.parse(w.files.get(BEAT) ?? '')
    expect(beat.engine).toBe('2.1.287')
    expect(beat.events).toContain('tool.check')
  })

  test('on: an event that fires moves from never fired to fired', { options: { capabilityProbe: true } }, async ($, on) => {
    boot(on, { version: '2.1.287', base: '2.1.287' })
    await $.session.start(START)
    const before = await report($)
    await $.tool.check(check('ls')).catch(() => undefined)
    const after = await report($)
    expect(before).toMatch(/never fired:.*\btool\.check\b/)
    expect(after).not.toMatch(/never fired:.*\btool\.check\b/)
  })

  test('on: a build that does not expose the version says so and still counts events', { options: { capabilityProbe: true } }, async ($, on) => {
    boot(on)
    on('session.version', () => ({ deny: 'not available' }))
    await $.session.start(START)
    expect(await report($)).toMatch(/probe:\s+engine version not exposed · events fired/)
    expect(JSON.parse(w.files.get(BEAT) ?? '').engine).toBeNull()
  })

  test('on: hostile version text is not echoed, and the probe changes no verdict', { options: { capabilityProbe: true } }, async ($, on) => {
    boot(on, { version: '2.1.287\n\u001b]0;pwned\u0007<script>', base: 7 })
    await $.session.start(START)
    const text = await report($)
    expect(text).toContain('engine version not exposed')
    expect(text).not.toContain('pwned')
    // still refused by the guard (the probe never loosens) and a plain call is still allowed (never denies)
    const bad = await $.tool.check(check(['rm', '-rf', '/'].join(' ')))
    expect(bad.decision).toBe('deny')
    expect((await $.tool.check(check('ls'))).decision).toBe('allow')
    const odd = await $.command.run({ ...run('ruflo-mods'), args: '\u0000'.repeat(10) })
    expect(odd.text).toMatch(/probe:\s+engine/)
  })
})
