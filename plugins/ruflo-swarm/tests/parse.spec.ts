/**
 * The pure readers under vitest, beside the engine kit's own run of the same modules (parse.test.ts): they import nothing
 * from the engine, so they run in Node as they are. Run with
 *   npx vitest run --root plugins/ruflo-swarm tests/parse.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { idOf, parseAgents, parseClaims, parseHive, parseRoute, parseSwarmStore, parseTasks, plain, routeFromStore } from '../hooks/reader/parse'
import { parseEvents, parseHosts, remoteHostOf, runWord } from '../hooks/reader/ruos'
import { readSnapshot, type ReadCache } from '../hooks/reader/snapshot'
import { HIVE_TOKEN, RUFLO_RUN } from './fixtures/ruflo-run'

const at = (path: string) => RUFLO_RUN[path] ?? null

describe('parse (vitest)', () => {
  it('reads the real run: one running swarm, three agents, two tasks, one claim, a queen and an open proposal', () => {
    expect(parseSwarmStore(at('.claude-flow/swarm/swarm-state.json'))).toMatchObject({ id: 'swarm-1790888806724-u3ktj4', topology: 'hierarchical', status: 'running', strategy: 'specialized', agentIds: expect.any(Array) })
    expect(parseAgents(at('.claude-flow/agents/store.json')).map(agent => `${agent.type}:${agent.status}`)).toEqual(['coder:busy', 'tester:idle', 'reviewer:idle'])
    expect(parseTasks(at('.claude-flow/tasks/store.json')).map(task => task.status)).toEqual(['in_progress', 'pending'])
    expect(parseClaims(at('.claude-flow/claims/claims.json'))).toEqual([
      { issueId: 'task-1790888817265-vatniv', status: 'active', claimant: { kind: 'agent', id: 'agent-1790888815793-6ju96w', agentType: 'coder' }, progress: 0, isStealable: false },
    ])

    const hive = parseHive(at('.claude-flow/hive-mind/state.json'))

    expect(hive?.queen).toEqual({ id: 'queen-1790888818222', term: 1 })
    expect(hive?.pending[0]).toMatchObject({ type: 'design', strategy: 'raft', votesFor: 0, votesAgainst: 0 })
    expect(JSON.stringify(hive)).not.toContain(HIVE_TOKEN)
  })

  it('a missing file is a missing fact, and the snapshot names which', async () => {
    const files: Record<string, string> = { '.swarm/state.json': at('.swarm/state.json') ?? '' }
    const fs = {
      read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
      stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: 1 } : Promise.reject(new Error('ENOENT'))),
    }
    const cache: ReadCache = new Map()
    const snapshot = await readSnapshot(fs, cache, 0)

    expect(snapshot.swarm).toMatchObject({ id: 'swarm-1790888806724-u3ktj4', topology: 'hierarchical', status: 'ready' })
    expect(snapshot.missing).toEqual(['swarm', 'agents', 'tasks', 'claims', 'hive'])
    expect(snapshot.hasSwarm).toBe(true)
  })

  it('an unchanged file is not read twice', async () => {
    let reads = 0
    const fs = { read: async () => (reads++, at('.claude-flow/agents/store.json') ?? ''), stat: async () => ({ mtimeMs: 7, size: 9 }) }
    const cache: ReadCache = new Map()

    await readSnapshot(fs, cache, 0)
    await readSnapshot(fs, cache, 1)
    expect(reads, "six swarm files and the two ruOS files, once each").toBe(8)
  })

  it('ids are only what ruflo mints; text is printable and bounded', () => {
    expect(idOf('agent-1790888815793-6ju96w')).toBe('agent-1790888815793-6ju96w')
    for (const bad of ['', ' agent', 'a b', 'a;rm', '$(x)', '-rf', '../x', 'a'.repeat(200), 7, null]) {
      expect(idOf(bad)).toBeNull()
    }
    expect(plain('a\u001b[31mred\u0007‮evil', 50)).toBe('a [31mred evil')
    expect(plain('x'.repeat(500), 10)).toHaveLength(10)
  })

  it('a router pick keeps its own matched flag and its score; a store copy is re-checked', () => {
    const pick = parseRoute('[INFO] x\n{"task":"t","matched":true,"primaryAgent":{"type":"architect","confidence":0.41},"alternativeAgents":[]}', 3)

    expect(pick).toMatchObject({ agent: 'architect', confidence: 0.41, matched: true })
    expect(parseRoute('no json here', 0)).toBeNull()
    expect(routeFromStore({ task: 't', agent: 'x', confidence: 'high', atMs: 1 })).toBeNull()
    expect(routeFromStore(pick)).toMatchObject({ agent: 'architect', confidence: 0.41 })
  })

  it('reads the ruflo-ruos remote-host contract and keeps only ids, names and states', () => {
    expect(remoteHostOf({ host: { kind: 'ruos', desktopId: 'm-1', desktopName: 'desk', transport: 'ssh', runId: 'run-1' } })).toEqual({ desktopId: 'm-1', desktopName: 'desk', transport: 'ssh', runId: 'run-1' })
    expect(parseHosts('{"hosts":[{"desktopId":"m-1","name":"desk","state":"running","agents":["agent-1","bad id"]}]}')).toEqual([{ desktopId: 'm-1', name: 'desk', state: 'running', agents: ['agent-1'] }])

    const [event] = parseEvents('{"ts":3,"type":"run.failed","runId":"run-1","exitCode":2,"error":"secret"}')

    expect(event).toEqual({ ts: 3, type: 'run.failed', runId: 'run-1', exitCode: 2 })
    expect(event !== undefined && runWord(event)).toBe('failed (exit 2)')
  })
})
