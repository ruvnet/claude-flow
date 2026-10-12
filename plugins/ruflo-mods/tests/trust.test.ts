import { describe, expect, test, tier } from 'claude-code/testing'
import type { Plugin } from 'claude-code/testing'

import { START, world } from './fixtures/world'

tier('user')

const autoAllow: Plugin = {
  name: 'auto-allow',
  tier: 'user',
  register: on => {
    on('tool.check', () => ({ decision: 'allow' }))
  },
}
const promptSteer: Plugin = {
  name: 'prompt-steer',
  tier: 'user',
  register: on => {
    on('prompt.submit', ($, e, next) => next(e))
  },
}
const quiet: Plugin = {
  name: 'quiet',
  tier: 'user',
  register: on => {
    on('turn.complete', ($, e, next) => next(e))
  },
}

describe('trust', () => {
  test('observe (default): names what a later mod can do, and loads it', { plugins: [autoAllow, quiet] }, async ($, on) => {
    const w = world(on)
    on('tool.check', () => ({ decision: 'ask' }))
    await $.session.start(START)

    expect(w.logs.join('\n')).toContain('ruflo mod trust: auto-allow')
    expect(w.logs.join('\n')).toContain('on tool.check (can answer tool permission verdicts)')
  })

  test(
    'refuse-risky: a later user-tier mod that can answer tool verdicts is refused at load',
    { plugins: [autoAllow], options: { modTrust: 'refuse-risky' } },
    async ($, on) => {
      world(on)
      on('tool.check', () => ({ decision: 'ask' }))
      // The host refuses the module at load and the test engine reports it,
      // naming who refused and why.
      await expect($.session.start(START)).rejects.toThrow(/auto-allow: refused by ruflo-mods: .*can answer tool permission verdicts/)
    },
  )

  test(
    'refuse-risky: a user-tier mod whose only hook is prompt.submit is refused (ADR-450: it is the documented injection path)',
    { plugins: [promptSteer], options: { modTrust: 'refuse-risky' } },
    async ($, on) => {
      world(on)
      await expect($.session.start(START)).rejects.toThrow(/prompt-steer: refused by ruflo-mods: .*every prompt you send/)
    },
  )

  test('refuse-risky loads a mod that does nothing risky', { plugins: [quiet], options: { modTrust: 'refuse-risky' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.logs.join('\n')).not.toContain('REFUSED')
  })

  test(
    'refuse-risky honours the allow-list',
    { plugins: [autoAllow], options: { modTrust: 'refuse-risky', modTrustAllow: 'auto-allow@claude-plugin-test' } },
    async ($, on) => {
      world(on)
      on('tool.check', () => ({ decision: 'ask' }))
      await $.session.start(START)

      expect((await $.tool.check({ tool: 'Read', input: { file_path: 'a' } })).decision).toBe('allow')
    },
  )
})

describe('trust by provenance', () => {
  // A mod calling itself ruflo-mods is covered by the harness suite: the kit
  // refuses to load two plugins of one name.
  test('the allow-list matches provenance, not the self-declared name', { plugins: [autoAllow], options: { modTrust: 'refuse-risky', modTrustAllow: 'nobody@inline' } }, async ($, on) => {
    world(on)
    on('tool.check', () => ({ decision: 'ask' }))
    await expect($.session.start(START)).rejects.toThrow(/allow it by provenance \(auto-allow@/)
  })
})

/** Runs a host command through $.process.spawn rather than $.process.run. */
const spawner: Plugin = {
  name: 'spawner',
  tier: 'user',
  register: on => {
    on('turn.complete', async ($, e, next) => {
      for await (const _ of $.process.spawn({ argv: ['true'] })) void _
      return next(e)
    })
  },
}
/** Reaches any connected MCP server's tools. */
const mcpCaller: Plugin = {
  name: 'mcp-caller',
  tier: 'user',
  register: on => {
    on('turn.complete', async ($, e, next) => {
      await $.mcp.call('ruflo', 'terminal_execute', {})
      return next(e)
    })
  },
}
/** Hooks only agent.spawn: it can rewrite every subagent's task (#3787). */
const spawnSteer: Plugin = {
  name: 'spawn-steer',
  tier: 'user',
  register: on => {
    on('agent.spawn', ($, e, next) => next(e))
  },
}

describe('trust: every call and hook that reaches outside the session is risky', () => {
  for (const [plugin, why] of [
    [spawner, /process\.spawn \(runs host commands\)/],
    [mcpCaller, /mcp\.call \(calls MCP tools/],
    [promptSteer, /on prompt\.submit \(can add to or rewrite every prompt you send\)/],
    [spawnSteer, /on agent\.spawn \(can rewrite or answer every agent spawn\)/],
  ] as const) {
    test(`refuse-risky refuses ${plugin.name}`, { plugins: [plugin], options: { modTrust: 'refuse-risky' } }, async ($, on) => {
      world(on)
      await expect($.session.start(START)).rejects.toThrow(new RegExp(`${plugin.name}: refused by ruflo-mods: .*${why.source}`))
    })
    test(`observe names what ${plugin.name} can do`, { plugins: [plugin] }, async ($, on) => {
      const w = world(on)
      await $.session.start(START)
      expect(w.logs.join('\n')).toMatch(why)
    })
  }
})

describe('trust: a glob or a negation is judged by what it selects (#3801)', () => {
  // The engine reads `on` calls statically: each pattern is a literal at its call site.
  const toolGlob: Plugin = { name: 'tool-glob', tier: 'user', register: on => { on('tool.*', ($, e, next) => next(e)) } }
  const allButOne: Plugin = { name: 'all-but-one', tier: 'user', register: on => { on('!tool.describe', ($, e, next) => next(e)) } }
  const promptGlob: Plugin = { name: 'prompt-glob', tier: 'user', register: on => { on('prompt.*', ($, e, next) => next(e)) } }
  const agentGlob: Plugin = { name: 'agent-glob', tier: 'user', register: on => { on('agent.*', ($, e, next) => next(e)) } }
  const clockGlob: Plugin = { name: 'clock-glob', tier: 'user', register: on => { on('clock.*', ($, e, next) => next(e)) } }
  for (const [plugin, why] of [
    [toolGlob, /on tool\.\* → tool\.check \(can answer tool permission verdicts\)/],
    [allButOne, /on !tool\.describe → \* \(sees every event\)/],
    [promptGlob, /on prompt\.\* → prompt\.submit/],
    [agentGlob, /on agent\.\* → agent\.spawn/],
  ] as const) {
    test(`refuse-risky refuses ${plugin.name}`, { plugins: [plugin], options: { modTrust: 'refuse-risky' } }, async ($, on) => {
      world(on)
      await expect($.session.start(START)).rejects.toThrow(new RegExp(`${plugin.name}: refused by ruflo-mods: .*${why.source}`))
    })
  }

  test('a glob that selects nothing risky still loads', { plugins: [clockGlob], options: { modTrust: 'refuse-risky' } }, async ($, on) => {
    const w = world(on)
    await $.session.start(START)
    expect(w.logs.join('\n')).not.toContain('REFUSED')
  })
})
