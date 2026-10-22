/**
 * The console's pure parts under vitest, beside the engine kit's run of the whole mod (*.test.ts): readers, CLI JSON,
 * cell graphics, and the frame functions. They import nothing from the engine at run time. Run with
 *   npx vitest run plugins/ruflo-console
 */
import { describe, expect, it } from 'vitest'

import { jsonAfter, PROBES } from '../hooks/data/cli'
import { parseMarketplaces, parseNeural, parseOutcomes, parseRouter } from '../hooks/data/facts'
import { readBounded, READ_MAX, type ReadCache } from '../hooks/data/files'
import { idOf, parseAgents, parseClaims, parseHive, parseSwarmStore, plain } from '../hooks/data/parse'
import { readSnapshot } from '../hooks/data/snapshot'
import { toBase64 } from '../hooks/gfx/raster'
import { newState } from '../hooks/state'
import { CARD_COLUMNS } from '../hooks/views/card'
import { picturesOf } from '../hooks/views/frames'
import { ladder } from '../hooks/views/cost'
import { CLI_OUT, HIVE_TOKEN, RUFLO_FILES } from './fixtures/ruflo-run'

const at = (path: string) => RUFLO_FILES[path] ?? null

const memoryFs = (files: Record<string, string>) => ({
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => Promise.reject(new Error('ENOENT')),
})

describe('readers', () => {
  it('plain() drops whole ANSI colour sequences, not just the ESC byte', () => {
    expect(plain('\u001b[1mLogs for agent-1\u001b[0m')).toBe('Logs for agent-1')
    expect(plain('\u001b[2m11:24:13 AM\u001b[0m [INFO] created')).toBe('11:24:13 AM [INFO] created')
  })

  it('read the captured run: one swarm, two agents, two claims (one stealable), a queen and a proposal, no token', () => {
    expect(parseSwarmStore(at('.claude-flow/swarm/swarm-state.json'))).toMatchObject({ id: 'swarm-1790903031804-y9rnjr', topology: 'hierarchical', status: 'running', strategy: 'specialized', maxAgents: 6 })
    expect(parseAgents(at('.claude-flow/agents/store.json')).map(agent => `${agent.type}:${agent.status}`)).toEqual(['coder:idle', 'tester:idle'])

    const claims = parseClaims(at('.claude-flow/claims/claims.json'))

    expect(claims.map(claim => [claim.issueId, claim.isStealable])).toEqual([
      ['console-demo-1', false],
      ['console-demo-2', true],
    ])
    expect(claims[0]?.expiresAtMs).toBeUndefined()

    const hive = parseHive(at('.claude-flow/hive-mind/state.json'))

    expect(hive?.queen).toMatch(/^queen-/)
    expect(hive?.pending[0]).toMatchObject({ type: 'design', strategy: 'raft', votesFor: 0 })
    expect(JSON.stringify(hive)).not.toContain(HIVE_TOKEN)
  })

  it('learning stores: counts as written, a rate with its N, a default never taken as a measurement', () => {
    expect(parseNeural(at('.claude-flow/neural/stats.json'))).toMatchObject({ trajectories: 30797, patterns: 30781 })
    expect(parseOutcomes(at('.claude-flow/routing-outcomes.json'))).toMatchObject({ total: 9, successes: 9 })
    expect(parseRouter(at('.swarm/model-router-state.json'))).toMatchObject({ decisions: 11 })
    expect(parseNeural('not json')).toBeNull()
    expect(parseOutcomes('{"outcomes": [{"success": "yes"}]}')).toEqual({ total: 0, successes: 0, points: [] })
  })

  it('plain strips control and bidi characters; idOf admits only id-shaped strings', () => {
    expect(plain('a\u001b[31m‮b\u0000c')).toBe('ab c')
    expect(plain('x'.repeat(50), 10)).toHaveLength(10)
    expect(idOf('agent-1790903032181-97m25s')).toBe('agent-1790903032181-97m25s')
    for (const bad of ['bad id!', '-rf', '', 'a'.repeat(200), '../etc', 42]) expect(idOf(bad)).toBeNull()
  })

  it('a marketplace path with .. or not absolute is never followed', () => {
    const markets = parseMarketplaces(JSON.stringify({ a: { installLocation: '/x/../etc' }, b: { installLocation: 'relative' }, ruflo: { installLocation: '/home/dev/m/ruflo' } }))

    expect(markets?.map(market => market.location)).toEqual([undefined, undefined, '/home/dev/m/ruflo'])
  })

  it('a file over the read cap is stat-ed, never read', async () => {
    let reads = 0
    const fs = { read: async () => ((reads += 1), 'x'), stat: async () => ({ mtimeMs: 1, size: READ_MAX + 1 }), list: async () => [] }

    expect(await readBounded(fs, new Map(), '/work/.claude-flow/policy/state.json')).toEqual({ text: null, reason: 'too-large', size: READ_MAX + 1 })
    expect(reads).toBe(0)
  })

  it('the snapshot names a stale marketplace clone by what it lacks, and an unchanged file is not read twice', async () => {
    const files: Record<string, string> = {
      ...Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text])),
      '/home/dev/.claude/plugins/known_marketplaces.json': JSON.stringify({ ruflo: { installLocation: '/home/dev/m/ruflo' } }),
      '/home/dev/m/ruflo/.claude-plugin/marketplace.json': JSON.stringify({ plugins: [{ name: 'ruflo-core' }, { name: 'ruflo-swarm' }] }),
    }
    const fs = memoryFs(files)
    const cache: ReadCache = new Map()
    const first = await readSnapshot(fs, cache, '/work', '/home/dev', {}, 0)

    expect(first.plugins.missingFromClone).toEqual(['ruflo-mods'])
    expect(first.isRufloProject).toBe(true)

    let reads = 0
    const counting = { ...fs, read: async (path: string) => ((reads += 1), fs.read(path)) }

    await readSnapshot(counting, cache, '/work', '/home/dev', {}, 1)
    expect(reads).toBe(0)
  })
})

describe('CLI JSON', () => {
  it('every captured probe output parses, log lines and the mcp exec header notwithstanding', () => {
    const byProbe: Record<string, string> = { version: 'version', memory: 'memory-stats', namespaces: 'memory-list', metaharness: 'mh-score', flywheel: 'mh-flywheel', intelligence: 'intel', peers: 'bbs-peers', channels: 'channels' }

    for (const probe of PROBES) {
      const name = byProbe[probe.id]

      if (name === undefined) continue

      expect(probe.parse(CLI_OUT[name] ?? ''), probe.id).not.toBeNull()
    }

    expect(jsonAfter('Transformers.js loaded: x\n{\n "a": 1\n}\n')).toEqual({ a: 1 })
    expect(jsonAfter('[INFO] Executing tool\nResult:\n{\n "b": [1]\n}')).toEqual({ b: [1] })
    expect(jsonAfter('no json here')).toBeNull()
    // a trailing log line with a stray bracket is not part of the JSON (#3789)
    expect(jsonAfter('{"available":true,"totalDecisions":5}\n[info] see https://x/guide]')).toEqual({ available: true, totalDecisions: 5 })
    expect(jsonAfter('{"backend":"sqlite","entries":{"total":10}}\nDone (lexical-degraded}')).toEqual({ backend: 'sqlite', entries: { total: 10 } })
    expect(jsonAfter('{"s":"a } and ] in a string","n":1}\ntrailing ]')).toEqual({ s: 'a } and ] in a string', n: 1 })
    expect(jsonAfter('{"cut":')).toBeNull()
  })

  it('no probe reaches the network but the opt-in roster and registry; plugins list and verify are never run', () => {
    expect(PROBES.filter(probe => probe.isNetwork === true).map(probe => probe.id)).toEqual(['roster', 'registry'])

    for (const probe of PROBES) {
      expect(probe.args.slice(0, 2).join(' ')).not.toBe('plugins list')
      expect(probe.args[0]).not.toBe('verify')
    }
  })

  it('the intelligence probe drops the default confidence the tool answers before any decision', () => {
    const intel = PROBES.find(probe => probe.id === 'intelligence')?.parse(CLI_OUT.intel ?? '') as { routerConfidence?: number; routerDecisions?: number }

    expect(intel.routerDecisions).toBe(0)
    expect(intel.routerConfidence).toBeUndefined()
  })
})

describe('graphics', () => {
  it('toBase64 matches Buffer for every length 0..17', () => {
    for (let n = 0; n <= 17; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 37 + 11) & 255)

      expect(toBase64(bytes)).toBe(Buffer.from(bytes).toString('base64'))
    }
  })

  it('the frame functions answer the same pictures for the render and the loop', () => {
    const state = newState({})

    state.view = 'learning'
    expect([...picturesOf(state, 90, 0, 5).keys()]).toEqual(['title', 'curve', 'pipeline', 'patterns'])
    state.view = 'memory'
    expect([...picturesOf(state, 90, 0, 5).keys()]).toEqual(['title'])
    // The RUFLO banner is the main menu's alone; every other page leads with `RUFLO | PAGE`.
    state.view = 'menu'
    expect([...picturesOf(state, 90, 0, 5).keys()]).toEqual(['header', 'palette', 'title'])
  })

  it('the menu\'s palette strip moves with the clock, is still at fps 0, and is the BBS look\'s alone', () => {
    const cells = (state: ReturnType<typeof newState>, t: number) => Array.from((picturesOf(state, 90, 0, t).get('palette') as { cells: Uint32Array }).cells)
    const bbs = newState({})

    bbs.view = 'menu'
    expect(cells(bbs, 0)).not.toEqual(cells(bbs, 1_512))
    // As wide as the menu's own rows: the pane less the card's border and padding, less the two columns of margin.
    expect(cells(bbs, 0).length / 3).toBe(90 - CARD_COLUMNS - 2)

    bbs.options.fps = 0
    expect(cells(bbs, 987_654)).toEqual(cells(bbs, 0))

    const plain = newState({ look: 'plain' } as never)

    plain.view = 'menu'
    expect([...picturesOf(plain, 90, 0, 5).keys()]).toEqual(['header'])

    const other = newState({})

    other.view = 'swarm'
    expect(picturesOf(other, 90, 0, 5).has('palette')).toBe(false)
  })

  it('the budget ladder marks 50/75/90/100% and fills to the spend', () => {
    expect(ladder(3.9, 5, 20)).toBe('█████████│████│█·│·│')
  })
})
