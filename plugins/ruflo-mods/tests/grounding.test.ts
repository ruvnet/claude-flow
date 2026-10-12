import { describe, expect, test, tier } from 'claude-code/testing'

import { BRAIN_ID, detectBrain, groundingLine, groundingState } from '../hooks/grounding'
import { readOptions } from '../hooks/options'
import { run } from './fixtures/consumer'
import { HELPER, START, world } from './fixtures/world'

tier('user')

const installed = (ids: string[]) => JSON.stringify({ version: 2, plugins: Object.fromEntries(ids.map(id => [id, [{ scope: 'user', version: '4.3.14' }]])) })

describe('detectBrain, pure (ADR-487)', () => {
  test('on, disabled, not installed', () => {
    expect(detectBrain(installed([BRAIN_ID]), { enabledPlugins: { [BRAIN_ID]: true } })).toBe('on')
    expect(detectBrain(installed([BRAIN_ID]), { enabledPlugins: { [BRAIN_ID]: false } })).toBe('disabled')
    expect(detectBrain(installed([BRAIN_ID]), { enabledPlugins: {} })).toBe('disabled')
    expect(detectBrain(installed(['ruflo-core@ruflo']), { enabledPlugins: { 'ruflo-core@ruflo': true } })).toBe('not-installed')
  })

  test('unreadable or malformed data is unknown, never an absence', () => {
    expect(detectBrain(null, {})).toBe('unknown')
    for (const text of ['', 'not json', '[]', '{"plugins":[]}', '{"plugins":"x"}', '{}', 'a'.repeat(2_000_001)]) expect(detectBrain(text, { enabledPlugins: {} }), text.slice(0, 20)).toBe('unknown')
    expect(detectBrain(installed([BRAIN_ID]), undefined)).toBe('unknown')
    expect(detectBrain(installed([BRAIN_ID]), { enabledPlugins: 'yes' })).toBe('unknown')
  })

  test('a same-named plugin from another marketplace, and prototype names, are not the brain', () => {
    expect(detectBrain(installed(['ruvnet-brain@evil']), { enabledPlugins: { 'ruvnet-brain@evil': true } })).toBe('not-installed')
    expect(detectBrain('{"plugins":{"__proto__":[{"scope":"user"}],"constructor":[1]}}', { enabledPlugins: {} })).toBe('not-installed')
    expect(detectBrain(installed([BRAIN_ID]), { enabledPlugins: { [BRAIN_ID]: 'true' } })).toBe('disabled')
  })

  test('the line is off by default and factual when on', () => {
    expect(groundingLine(groundingState())).toBe('off (set the grounding option)')
    for (const status of ['on', 'not-installed', 'disabled', 'unknown'] as const) {
      const line = groundingLine({ enabled: true, status })
      expect(line).toContain('RuvNet Brain')
      expect(line).not.toMatch(/better|accurate|improv|faster|best/i)
    }
  })

  test('the option is validated: only true turns it on', () => {
    expect(readOptions(undefined).grounding).toBe(false)
    expect(readOptions({ grounding: true }).grounding).toBe(true)
    expect(readOptions({ grounding: 'true' }).grounding).toBe(true)
    expect(readOptions({ grounding: 'yes' }).grounding).toBe(false)
    expect(readOptions({ grounding: 1 }).grounding).toBe(false)
  })
})

describe('grounding option in a session (ADR-487)', () => {
  const FILE = '/home/u/.claude/plugins/installed_plugins.json'
  const boot = (on: Parameters<Parameters<typeof test>[2]>[1], files: Record<string, string>, settings: unknown = {}, env: Record<string, string> = { HOME: '/home/u' }) => {
    const w = world(on, settings, { [HELPER]: '', ...files })
    for (const [k, v] of Object.entries(env)) w.env.set(k, v)
    on('tool.check', () => ({ decision: 'allow' }))
    return w
  }
  const report = async ($: Parameters<Parameters<typeof test>[2]>[0]) => (await $.command.run(run('ruflo-mods'))).text ?? ''
  const row = (text: string) => text.split('\n').find(l => /^\s*grounding:/.test(l)) ?? ''

  test('off by default: the row says off even with the brain installed and enabled', async ($, on) => {
    const w = boot(on, { [FILE]: installed([BRAIN_ID]) }, { enabledPlugins: { [BRAIN_ID]: true } })
    await $.session.start(START)
    expect(row(await report($))).toContain('off (set the grounding option)')
    expect(w.files.has(FILE)).toBe(true)
  })

  test('on: brain on', { options: { grounding: true } }, async ($, on) => {
    boot(on, { [FILE]: installed([BRAIN_ID]) }, { enabledPlugins: { [BRAIN_ID]: true } })
    await $.session.start(START)
    expect(row(await report($))).toContain('RuvNet Brain: on')
  })

  test('on: installed but disabled', { options: { grounding: true } }, async ($, on) => {
    boot(on, { [FILE]: installed([BRAIN_ID]) }, { enabledPlugins: { [BRAIN_ID]: false } })
    await $.session.start(START)
    expect(row(await report($))).toContain('installed, disabled')
  })

  test('on: not installed', { options: { grounding: true } }, async ($, on) => {
    boot(on, { [FILE]: installed(['ruflo-core@ruflo']) }, { enabledPlugins: {} })
    await $.session.start(START)
    expect(row(await report($))).toContain('not installed')
  })

  test('on: a missing, malformed or unreachable file is unknown', { options: { grounding: true } }, async ($, on) => {
    boot(on, {}, { enabledPlugins: {} })
    await $.session.start(START)
    expect(row(await report($))).toContain('unknown')
  })

  test('on: CLAUDE_CONFIG_DIR wins over HOME', { options: { grounding: true } }, async ($, on) => {
    boot(on, { '/cfg/plugins/installed_plugins.json': installed([BRAIN_ID]) }, { enabledPlugins: { [BRAIN_ID]: true } }, { HOME: '/home/u', CLAUDE_CONFIG_DIR: '/cfg' })
    await $.session.start(START)
    expect(row(await report($))).toContain('RuvNet Brain: on')
  })

  test('on: the brain changes nothing else in the report', { options: { grounding: true } }, async ($, on) => {
    boot(on, { [FILE]: installed([BRAIN_ID]) }, { enabledPlugins: { [BRAIN_ID]: true } })
    await $.session.start(START)
    const text = await report($)
    const lines = text.split('\n').filter(l => !/^\s*grounding:/.test(l))
    expect(lines.some(l => /^\s*owns:/.test(l))).toBe(true)
    expect(text).not.toMatch(/search_ruvnet|deny|refus/i)
  })
})
