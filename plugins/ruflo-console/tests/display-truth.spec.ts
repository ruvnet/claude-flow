/**
 * What the console shows matches what is on disk and what the gate does (seen live 2026-10-09):
 *  - an epoch-ms stamp is read as a time, never through the 1e12 count cap (agentdb-mod "written 9161d ago" for a file minutes old);
 *  - a swarm's agent count is its own, never the agent store's (a 0-agent swarm read "running · 259 agents"), with the record's age;
 *  - a palette entry's words agree with the control level Claude's gate asks for (mission-goal "nothing is written" yet gated as a write;
 *    perf-bottleneck gated as a delete because its note said "removes").
 *   npx vitest run plugins/ruflo-console/tests/display-truth.spec.ts
 */
import { describe, expect, it } from 'vitest'

import { parseAgentdbMod } from '../hooks/data/agentdb-mod'
import { parseSwarmStore } from '../hooks/data/parse'
import { sinceOf } from '../hooks/data/safe'
import { swarmStatusOf } from '../hooks/data/swarm-status'
import { readSnapshot } from '../hooks/data/snapshot'
import { mcOf } from '../hooks/mission-control'
import { callTool, classOf } from '../hooks/model-tools'
import { paletteEntries } from '../hooks/palette'
import { PERF } from '../hooks/perf'
import { SECURE } from '../hooks/secure'
import { settingsOf } from '../hooks/settings'
import { newState } from '../hooks/state'
import { barText } from '../hooks/views/bar'
import type { Actions } from '../hooks/views/common'
import { topoModelOf } from '../hooks/views/frames'
import { viewText } from '../hooks/views/pane'
import { readableFs } from './fixtures/hostile-fs'
import { rig } from './fixtures/real-rig'

// A real "now" in the range the console sees (2026-10-09): above the 1e12 count cap that turned such a stamp into 2001-09-09.
const NOW = 1_791_551_000_000
const act = new Proxy({}, { get: () => () => undefined }) as unknown as Actions

async function stateWith(files: Record<string, string>) {
  const state = newState({})

  state.snapshot = await readSnapshot(readableFs(files), new Map(), '/work', '/home/dev', {}, NOW)

  return state
}

describe('agentdb-mod: updatedMs is a time, not a count', () => {
  const file = (extra: Record<string, unknown>) => JSON.stringify({ version: 1, recall: true, guard: true, attached: 1, lastMs: 41, ...extra })

  it('keeps a Date.now()-scale stamp exactly (it was clamped to 1e12)', () => {
    expect(parseAgentdbMod(file({ updatedMs: NOW - 180_000 }))?.updatedMs).toBe(NOW - 180_000)
    expect(parseAgentdbMod(file({ updatedMs: NOW - 180_000 }))?.lastMs).toBe(41)
  })

  it('a missing, junk or out-of-Date stamp is null, never 0', () => {
    for (const bad of [undefined, 'soon', -0.5 * 1e20, 1e20, Number.NaN]) expect(parseAgentdbMod(file({ updatedMs: bad })), String(bad)).toMatchObject({ updatedMs: null })
  })

  it('the Memory page says "written 3m ago" for a file written three minutes ago, and n/a (not "56 years ago") for none', async () => {
    const at = (updatedMs: unknown) => stateWith({ '/work/.claude-flow/agentdb-mod/status.json': file({ updatedMs }) })
    const fresh = viewText({ state: await at(NOW - 180_000), nowMs: NOW, columns: 110, act }, 'memory')

    expect(fresh).toContain('written 3m ago')
    expect(fresh).not.toContain('an earlier session')

    const none = viewText({ state: await at(undefined), nowMs: NOW, columns: 110, act }, 'memory')

    expect(none).toContain('written n/a')
    expect(none).not.toMatch(/\d+d ago/)
  })
})

describe('an age is only said of a believable time', () => {
  it('sinceOf: 2000 to a day past now; Date\'s far edges and the future are n/a', () => {
    expect(sinceOf(NOW - 60_000, NOW)).toBe(NOW - 60_000)
    expect(sinceOf(NOW + 3_600_000, NOW)).toBe(NOW + 3_600_000)
    for (const bad of [8.64e15, -8.64e15, NOW + 2 * 86_400_000, 946_684_799_999, 0, null, undefined]) expect(sinceOf(bad, NOW), String(bad)).toBeUndefined()
  })

  it('agentdb-mod and the swarm say n/a, not "100020735d ago" or "0s ago"', async () => {
    for (const bad of [-8.64e15, 8.64e15, NOW + 2 * 86_400_000]) {
      const state = await stateWith({ '/work/.claude-flow/agentdb-mod/status.json': JSON.stringify({ version: 1, updatedMs: bad }) })

      expect(viewText({ state, nowMs: NOW, columns: 110, act }, 'memory'), String(bad)).toContain('written n/a')
    }

    const future = { id: 's', topology: 'mesh', status: 'running', agentIds: [], updatedAt: new Date(NOW + 30 * 86_400_000).toISOString() }

    expect(swarmStatusOf(future, NOW, [])).toMatchObject({ updatedMs: undefined, isStale: false })
  })
})

describe('the swarm record itself', () => {
  it('counts a listed id once, and says "listed, found" when the store lacks some', async () => {
    const state = await stateWith({
      '/work/.claude-flow/swarm/swarm-state.json': JSON.stringify({ swarms: { s: { swarmId: 's', topology: 'mesh', status: 'running', agents: ['a1', 'a1', 'gone'], updatedAt: new Date(NOW - 60_000).toISOString() } } }),
      '/work/.claude-flow/agents/store.json': JSON.stringify({ agents: { a1: { agentId: 'a1', agentType: 'coder', status: 'idle' } } }),
    })

    expect(viewText({ state, nowMs: NOW, columns: 140, act }, 'overview')).toContain('s · mesh · running · 2 listed, 1 found · updated 1m ago')
  })

  it('the newest swarm is chosen by instant, not by the text of its time', () => {
    const store = (a: string, b: string) => JSON.stringify({ swarms: { a: { swarmId: 'older', topology: 'mesh', status: 'running', agents: [], updatedAt: a }, b: { swarmId: 'newer', topology: 'mesh', status: 'running', agents: [], updatedAt: b } } })

    // 10:00+02:00 is 08:00Z: older than 09:00Z though it sorts after it as text.
    expect(parseSwarmStore(store('2026-10-09T10:00:00+02:00', '2026-10-09T09:00:00Z'))?.id).toBe('newer')
  })
})

describe('swarm: its own agent count and age, never the agent store', () => {
  const agents = Object.fromEntries(Array.from({ length: 259 }, (_, i) => [`agent-${i}`, { agentId: `agent-${i}`, agentType: 'coder', status: 'idle' }]))
  const swarmFile = (updatedAt: string, ids: string[] = []) =>
    JSON.stringify({ swarms: { 'swarm-1': { swarmId: 'swarm-1', topology: 'hierarchical', maxAgents: 3, status: 'running', agents: ids, updatedAt } } })
  const world = (updatedAt: string, ids: string[] = []) =>
    stateWith({ '/work/.claude-flow/swarm/swarm-state.json': swarmFile(updatedAt, ids), '/work/.claude-flow/agents/store.json': JSON.stringify({ agents }) })
  const WEEK_AGO = new Date(NOW - 7 * 86_400_000).toISOString()

  it('overview: a 0-agent swarm reads 0 agents with its age, the store is labelled "on disk"; no member to judge by, so not "stale"', async () => {
    const text = viewText({ state: await world(WEEK_AGO), nowMs: NOW, columns: 140, act }, 'overview')

    expect(text).toContain('swarm-1 · hierarchical · running · 0 agents · max 3 · updated 7d ago · 259 agents on disk')
    expect(text).not.toContain('stale')
    expect(text).toContain('259 agents on disk')
    expect(text).not.toMatch(/running · 259 agents/)
  })

  it('a fresh record is not stale and counts only the ids it lists', async () => {
    const text = viewText({ state: await world(new Date(NOW - 60_000).toISOString(), ['agent-1', 'agent-2']), nowMs: NOW, columns: 140, act }, 'overview')

    expect(text).toContain('running · 2 agents · max 3 · updated 1m ago')
    expect(text).not.toContain('stale')
  })

  it('swarm page: the topology row carries the swarm\'s count, the agent list is the store and says so', async () => {
    const text = viewText({ state: await world(WEEK_AGO), nowMs: NOW, columns: 140, act }, 'swarm')

    expect(text).toContain('running · 0 agents · max 3 · updated 7d ago')
    expect(text).toContain('graph needs a terminal: 0 swarm members')
    expect(text).toContain('259 agents on disk (every swarm)')
  })

  it('the graph draws only the swarm\'s members, and the status bar does not call the store "ready"', async () => {
    const state = await world(WEEK_AGO)

    expect(topoModelOf(state.snapshot, new Map(), NOW)?.nodes.map(node => [node.label, node.status])).toEqual([['swarm', 'running']])
    expect(barText(state, NOW)).toContain('swarm, no agents')
    expect(barText(state, NOW)).not.toContain('259')
  })
})

describe('labels agree with the gate', () => {
  it('every security and performance entry is gated as the cost tier it shows (writes → write, network → network); an entry that removes its probe file stays a delete', () => {
    for (const entry of [...SECURE, ...PERF]) {
      if (entry.cost === 'read') continue

      expect(classOf({ label: entry.label, args: entry.args, expect: '', ...(entry.note !== undefined && { note: entry.note }) }), entry.id).toBe(entry.note?.includes('removes') === true ? 'delete' : entry.cost === 'writes' ? 'write' : 'network')
    }
  })

  it('perf-bottleneck and perf-optimize stay a delete: refused at write, run at full (the gate is not lowered)', async () => {
    for (const id of ['perf-bottleneck', 'perf-optimize']) {
      const write = rig()

      Object.assign(settingsOf(write.state).ai, { modelControl: 'write', modelConfirm: 'auto' })
      expect(await callTool('console_run', { id }, write.deps), id).toMatch(/is a delete action/)

      const full = rig()

      Object.assign(settingsOf(full.state).ai, { modelControl: 'full', modelConfirm: 'auto' })
      expect(await callTool('console_run', { id }, full.deps), id).not.toMatch(/^Refused/)
    }
  })

  it('mission-goal does not claim "nothing is written": it is gated as a write, like console_set goal, and it replaces the goal', async () => {
    const world = rig()
    const entry = paletteEntries(world.state, NOW).find(candidate => candidate.id === 'mission-goal')

    expect(entry?.label).not.toMatch(/nothing is written/)
    expect(entry?.label).toMatch(/replaces the current goal/)
    world.control.setView('missions')
    Object.assign(settingsOf(world.state).ai, { modelControl: 'read', modelConfirm: 'auto' })
    expect(await callTool('console_run', { id: 'mission-goal', text: 'add a dark mode toggle' }, world.deps)).toMatch(/is a write action/)
    expect(mcOf(world.state).goal).toBe('')

    Object.assign(settingsOf(world.state).ai, { modelControl: 'write', modelConfirm: 'auto' })
    await callTool('console_run', { id: 'mission-goal', text: 'add a dark mode toggle' }, world.deps)
    expect(mcOf(world.state).goal).toBe('add a dark mode toggle')
  })
})

describe('stale needs evidence of no activity, not just an old record', () => {
  const DAY = 86_400_000
  const swarm = (ids: string[]) => ({ id: 's', topology: 'mesh', status: 'running', agentIds: ids, updatedAt: new Date(NOW - 7 * DAY).toISOString() })
  const agent = (id: string, status: string, createdAtMs?: number) => ({ id, type: 'coder', status, ...(createdAtMs !== undefined && { createdAtMs }) })

  it('an old record with a busy member is not stale (the CLI does not rewrite updatedAt on spawn or status reads)', () => {
    expect(swarmStatusOf(swarm(['a', 'b']), NOW, [agent('a', 'busy', NOW - 5 * DAY), agent('b', 'idle', NOW - 5 * DAY)])).toMatchObject({ isStale: false, shown: 'running' })
  })

  it('an old record whose newest member was created within a day is not stale', () => {
    expect(swarmStatusOf(swarm(['a', 'b']), NOW, [agent('a', 'idle', NOW - 5 * DAY), agent('b', 'idle', NOW - 3_600_000)])).toMatchObject({ isStale: false })
  })

  it('a member with no creation time, or no member at all, is no evidence: the age is shown, "stale" is not', () => {
    expect(swarmStatusOf(swarm(['a']), NOW, [agent('a', 'idle')])).toMatchObject({ isStale: false, updatedMs: NOW - 7 * DAY })
    expect(swarmStatusOf(swarm([]), NOW, [])).toMatchObject({ isStale: false, updatedMs: NOW - 7 * DAY })
  })

  it('an old record whose members are all idle and were created days ago is stale, and reads stalled', () => {
    expect(swarmStatusOf(swarm(['a', 'b']), NOW, [agent('a', 'idle', NOW - 5 * DAY), agent('b', 'stopped', NOW - 4 * DAY)])).toMatchObject({ isStale: true, shown: 'stalled' })
  })

  it('a duplicated store id is one agent, and the bar never calls a missing agent ready', async () => {
    const state = await stateWith({
      '/work/.claude-flow/swarm/swarm-state.json': JSON.stringify({ swarms: { s: { swarmId: 's', topology: 'mesh', status: 'running', agents: ['a1', 'a1', 'gone'], updatedAt: new Date(NOW - 60_000).toISOString() } } }),
      '/work/.claude-flow/agents/store.json': JSON.stringify({ agents: { x: { agentId: 'a1', agentType: 'coder', status: 'idle' }, y: { agentId: 'a1', agentType: 'coder', status: 'idle' } } }),
    })

    expect(swarmStatusOf(state.snapshot?.swarm as never, NOW, state.snapshot?.agents ?? [])).toMatchObject({ listed: 2, found: 1 })
    expect(barText(state, NOW)).toContain('idle · 1 agent ready (2 listed, 1 found)')
  })
})
