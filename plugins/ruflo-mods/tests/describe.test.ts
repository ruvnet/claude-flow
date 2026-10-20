import { describe, expect, test, tier } from 'claude-code/testing'

import { HINTS, MARK, MAX_HINT_CHARS } from '../hooks/describe/hints'
import { consumer, run } from './fixtures/consumer'
import { START, world } from './fixtures/world'

tier('user')

const ENGINE = { plugin: 'engine', tier: 'core' } as never
const ask = (tool: string, description = 'Core description.') => ({ tool, description, provider: ENGINE })
const SEARCH = 'mcp__plugin_ruflo-core_ruflo__memory_search'

describe('tool.describe hints (ADR-451)', () => {
  test('off by default: a ruflo tool keeps the description the engine computed', { plugins: [consumer] }, async ($, on) => {
    world(on)
    on('tool.describe', ($, e) => ({ description: e.description }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)

    expect((await $.tool.describe(ask(SEARCH))).description).toBe('Core description.')
    expect((await $.command.run(run('ruflo-mods'))).text).toContain('tool hints:  off')
  })

  test('on: a ruflo tool gets its one hint once, with placement and the core text kept', { options: { toolHints: true } }, async ($, on) => {
    const w = world(on)
    on('tool.describe', ($, e) => ({ description: e.description, isDeferred: true }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)

    const first = await $.tool.describe(ask(SEARCH))
    expect(first.description).toBe(`Core description.${MARK}${HINTS.memory_search}`)
    expect(first.isDeferred).toBe(true)
    // asked again (a reload, an invalidate): the same text, never a doubled hint
    expect((await $.tool.describe(ask(SEARCH, first.description))).description).toBe(first.description)
    expect(w.logs.join('\n')).not.toMatch(/tool.describe/)
  })

  test('only ruflo servers and only tools in the table: everything else is byte-identical', { options: { toolHints: true } }, async ($, on) => {
    world(on)
    on('tool.describe', ($, e) => ({ description: e.description }))
    await $.session.start(START)

    for (const tool of [
      'mcp__evil__memory_search', // another server with a ruflo tool's name
      'mcp__plugin_ruflo-core_ruflo__memory_delete', // a ruflo tool with no hint
      'mcp__plugin_ruflo-core_ruflo__constructor', // an Object prototype name is not a hint
      'mcp__ruflo__memory_search_unified',
      'memory_search',
      'Bash',
    ]) {
      expect((await $.tool.describe(ask(tool))).description).toBe('Core description.')
    }
    for (const tool of ['mcp__claude-flow__swarm_init', 'mcp__ruflo__hooks_route']) {  // audit-allow: standalone-mcp-prefix (the hint also supports the standalone claude-flow server name)
      expect((await $.tool.describe(ask(tool))).description).toContain(MARK)
    }
  })

  test('/ruflo-mods counts the tools described', { options: { toolHints: true }, plugins: [consumer] }, async ($, on) => {
    world(on)
    on('tool.describe', ($, e) => ({ description: e.description }))
    on('command.run', () => ({ text: 'core' }))
    await $.session.start(START)
    await $.tool.describe(ask(SEARCH))
    await $.tool.describe(ask('mcp__ruflo__swarm_init'))
    expect((await $.command.run(run('ruflo-mods'))).text).toContain('tool hints:  2 tool(s) described')
  })

  test('every hint is short, plain ASCII and one line', () => {
    for (const [name, hint] of Object.entries(HINTS)) {
      expect(hint.length, name).toBeLessThanOrEqual(MAX_HINT_CHARS)
      expect(hint, name).toMatch(/^[\x20-\x7e]+$/)
    }
  })
})
