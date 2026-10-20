import { describe, expect, test } from 'claude-code/testing'

import { MAX_TEXT, parseAgents, parseClaims, parseHive, parseRoute, parseSwarmPointer, parseSwarmStore, parseTasks } from '../hooks/reader/parse'

/** Text from another process's files: a line of a hundred thousand characters must cost a moment, not a frozen hook. */
const N = 100_000

const SHAPES: Record<string, string> = {
  spaces: `${' '.repeat(N)}x`,
  braces: `${'{'.repeat(N)}${'}'.repeat(N)}`,
  brackets: `${'['.repeat(N)}${']'.repeat(N)}`,
  digits: '9'.repeat(N),
  'log then brace': `${'[INFO] x\n'.repeat(N / 10)}{`,
  'deep json': `${'{"a":'.repeat(5_000)}1${'}'.repeat(5_000)}`,
  'many agents': JSON.stringify({ agents: Object.fromEntries(Array.from({ length: 5_000 }, (_, i) => [`a${i}`, { agentId: `agent-${i}`, agentType: 'coder', status: 'idle' }])) }),
  'control characters': JSON.stringify({ tasks: { t: { taskId: 'task-1', description: '\u001b[2J\u0007'.repeat(N / 10), status: 'pending' } } }),
  'oversized': `{"agents":{${' '.repeat(MAX_TEXT)}}}`,
}

const PARSERS: Record<string, (text: string) => unknown> = {
  swarm: parseSwarmStore,
  pointer: parseSwarmPointer,
  agents: parseAgents,
  tasks: parseTasks,
  claims: parseClaims,
  hive: parseHive,
  route: text => parseRoute(text, 0),
}

describe('parse', () => {
  test('no reader takes long over hostile text, whatever it is made of', () => {
    const slow: string[] = []

    for (const [parserName, parse] of Object.entries(PARSERS)) {
      for (const [shapeName, text] of Object.entries(SHAPES)) {
        const started = Date.now()

        parse(text)

        const took = Date.now() - started

        if (took > 500) {
          slow.push(`${parserName} on ${shapeName}: ${took} ms`)
        }
      }
    }

    expect(slow).toEqual([])
  })

  test('a store with more agents than the pane keeps is cut to a thousand, and terminal escapes never pass through', () => {
    expect(parseAgents(SHAPES['many agents'] ?? '')).toHaveLength(1_000)
    expect(parseTasks(SHAPES['control characters'] ?? '')[0]?.description).not.toMatch(/[\u0000-\u001f]/)
    expect(parseAgents(SHAPES.oversized ?? ''), 'past the size cap nothing is parsed').toEqual([])
  })

  test('shapes ruflo does not write are left out, never guessed at', () => {
    expect(parseSwarmStore('[]')).toBeNull()
    expect(parseSwarmStore('{"swarms":{"x":{"swarmId":"bad id;rm"}}}')).toBeNull()
    expect(parseAgents('{"agents":{"a":{"agentType":"coder"}}}'), 'no id').toEqual([])
    expect(parseClaims('{"claims":{"t":{"issueId":"task-1","claimant":{"type":"agent","agentId":"$(x)"}}}}')).toEqual([])
    expect(parseHive('{"initialized":false}')).toBeNull()
    expect(parseRoute('{"primaryAgent":{"type":"coder"}}', 0), 'no confidence: no pick').toBeNull()
  })
})
