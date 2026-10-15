/**
 * At the default `read` level Claude only looks (ADR-444): an entry that spends, writes or reaches the network is gated however it is flagged, and an
 * ask that resolves late keeps the origin it had when called and never replaces what the person has waiting (ADR-450 T8, T14, T17; #3815).
 * Real controller, runner, palette and `callTool` over a fake host.
 */
import { describe, expect, it } from 'vitest'

import { callTool, classOf } from '../hooks/model-tools'
import { paletteEntries } from '../hooks/palette'
import { activeMission, mcOf } from '../hooks/mission-control'
import type { MissionRecord } from '../hooks/mission-types'
import { settingsOf } from '../hooks/settings'
import { rig } from './fixtures/real-rig'

const MISSION = 'msn_0123456789abcdef01234567'
const mission = (): MissionRecord => ({ id: MISSION, objective: 'ship it', profile: 'feature', rigor: 'standard', tasks: [{ id: 't1', title: 'one', phase: 'S', agent: 'coder', requirement: 'r', dependsOn: [], rufloTaskId: 'r1' }], acceptance: [], events: [], paused: false, cancelled: false, auto: false, createdAtMs: 1 })

function at(level: 'read' | 'write' | 'manage' | 'full', confirm: 'ask' | 'auto' = 'ask') {
  const world = rig()

  Object.assign(settingsOf(world.state).ai, { modelControl: level, modelConfirm: confirm })
  mcOf(world.state).missions.set(MISSION, mission())
  mcOf(world.state).active = MISSION
  world.control.setView('missions')

  return world
}

const missionOf = (world: ReturnType<typeof rig>) => activeMission(world.state) as MissionRecord
const acts = (world: ReturnType<typeof rig>) => world.seen.runs.length + world.seen.prompts.length + world.seen.slashes.length

describe('entries flagged read-only that act are gated for Claude (#3815)', () => {
  const CASES: readonly [id: string, text: string][] = [
    ['mission-aside', 'a question'],
    ['mission-pause', ''],
    ['mission-resume', ''],
    ['mission-goal', 'plan this'],
    ['mission-auto', 'on'],
    ['skills-find', 'react'],
    ['x-registry', ''],
    ['x-roster', ''],
    ['x-sync', ''],
    ['x-claims', ''],
    ['x-read', 'pub:announce'],
  ]

  for (const [id, text] of CASES) {
    it(`${id} at read is refused and does nothing`, async () => {
      const world = at('read')
      const before = acts(world)
      const answer = await callTool('console_run', { id, text }, world.deps)

      expect(answer, id).toMatch(/^Refused/)
      expect(acts(world), id).toBe(before)
      expect(activeMission(world.state)?.auto, id).toBe(false)
      expect(activeMission(world.state)?.paused, id).toBe(false)
      expect(world.state.pending, id).toBeNull()
    })
  }

  it('mission-auto on never hands out a billed turn at read', async () => {
    const world = at('read')

    await callTool('console_run', { id: 'mission-auto', text: 'on' }, world.deps)
    expect(activeMission(world.state)?.auto).toBe(false)
    expect(world.seen.prompts).toEqual([])
  })

  it('a billed or network entry waits for the person even at full:auto (it always asks)', async () => {
    for (const id of ['mission-aside', 'skills-find', 'x-registry']) {
      const world = at('full', 'auto')
      const answer = await callTool('console_run', { id, text: 'q' }, world.deps)

      expect(answer, id).toMatch(/^Waiting for the person to confirm/)
      expect(world.seen.runs, id).toEqual([])
      expect(world.seen.slashes, id).toEqual([])
    }
  })

  it('the person\'s own click on the same entry still runs at once', () => {
    const world = at('read')

    world.control.runner.runById('mission-pause', '')
    expect(activeMission(world.state)?.paused).toBe(true)
  })

  it('console_open skills at read does not run `npx skills ls`', async () => {
    const world = at('read')

    expect(await callTool('console_open', { view: 'skills' }, world.deps)).toMatch(/^Opened/)
    expect(world.seen.runs.filter(argv => argv.includes('skills'))).toEqual([])
  })

  it('mission-auto takes on and off in any case and refuses any other word', async () => {
    const world = at('manage', 'auto')
    const entry = (text: string) => world.control.runner.runById('mission-auto', text, { exact: true })

    expect(entry('ON')).toBe(true)
    expect(activeMission(world.state)?.auto).toBe(true)
    expect(entry('Off')).toBe(true)
    expect(activeMission(world.state)?.auto).toBe(false)
    for (const word of ['yes', 'onn', '1', 'true', 'off please', '']) {
      ;(world.state as { outcome: unknown }).outcome = null
      missionOf(world).auto = true
      entry(word)
      expect((world.state.outcome as { ok: boolean } | null)?.ok, word).toBe(false)
      expect(activeMission(world.state)?.auto, word).toBe(true)
    }
  })
})

describe('an ask that resolves late keeps its origin and never replaces a waiting action (#3815)', () => {
  it('a screened ask (ask, mission-guide) Claude starts is attributed to Claude and gated at read', async () => {
    for (const [id, text] of [['ask', 'what now?'], ['mission-guide', 'do the thing'], ['ask-aside', 'what now?']] as const) {
      const world = at('read')
      const answer = await callTool('console_run', { id, text }, world.deps)

      await new Promise(resolve => setTimeout(resolve, 30))
      expect(answer, id).toMatch(/^Refused/)
      expect(world.state.pending, id).toBeNull()
      expect(world.seen.prompts, id).toEqual([])
    }
  })

  it('at write the late ask waits for the person, as Claude\'s ask (not "you")', async () => {
    const world = at('write', 'auto')
    const answer = await callTool('console_run', { id: 'ask', text: 'what now?' }, world.deps)

    expect(answer).toMatch(/Waiting for the person to confirm|^Refused/)
    if (world.state.pending !== null) expect(world.state.pending.source).toBe('claude')
  })

  it('a late ask from Claude never replaces the action the person has waiting', async () => {
    const world = at('full', 'ask')
    const answer = callTool('console_run', { id: 'mission-guide', text: 'later one' }, world.deps)

    // The person opens their own card while the screen is still running.
    world.control.runner.ask({ label: 'store my note', args: ['memory', 'store'], expect: 'a note' }, 'x')

    const mine = world.state.pending

    expect(mine?.source).toBe('you')
    expect(await answer).toMatch(/waiting for the person/)
    await new Promise(resolve => setTimeout(resolve, 30))
    expect(world.state.pending).toBe(mine)
    expect(world.state.pending?.label).toBe('store my note')
    expect(world.seen.prompts).toEqual([])
    // Claude's attempt is on the record (the Room feed and console_state show the control log), as a refusal.
    expect(world.state.control.log.some(entry => entry.outcome === 'denied' && /waiting/.test(entry.summary))).toBe(true)
  })

})

/** Local reads whose WORDS sound like an action (doctor, deploy status, installed, join, cleanup dry run): each is a curated read (a Dev Tools `cost: read`, a local list), so it stays instant for Claude. */
// mh-doctor, doc-npm: `doctor --component …` local checks. x-channels: lists the channel keys held on this machine. x-bbs-peers, x-bbs-watch: read the local
// agentbbs peers.json and envelope log (federation_bbs_peers / federation_bbs_watch, v3/@claude-flow/cli/src/mcp-tools/agentbbs-tools.ts), never the relay.
// vec-edge-join: prints how to join. mem-cleanup-plan, dt-cleanup: a dry run. dt-deploy-*, dt-plug-installed, dt-update-history, dt-migrate-*: Dev Tools entries with `cost: read`.
const LOCAL_READS = new Set(['mh-doctor', 'x-channels', 'x-bbs-peers', 'x-bbs-watch', 'mem-cleanup-plan', 'doc-npm', 'vec-edge-join', 'dt-deploy-status', 'dt-deploy-history', 'dt-plug-installed', 'dt-cleanup', 'dt-update-history', 'dt-migrate-status', 'dt-migrate-breaking'])

describe('no palette entry flagged read-only hides that it acts (#3815 audit)', () => {
  it('every read-only spec either reads (by its words) or declares what it does', () => {
    const world = at('full', 'auto')
    const found: string[] = []

    for (const entry of paletteEntries(world.state, Date.now())) {
      const specs = entry.run.kind === 'spec' ? [entry.run.spec] : entry.run.kind === 'text' ? ['react', 'pub:announce', 'a b', 'on', 'x'].map(sample => entry.run.kind === 'text' ? entry.run.make(sample) : null) : []

      for (const spec of specs) {
        if (spec === null || spec.isReadOnly !== true || spec.declared !== undefined) continue
        if (classOf({ label: spec.label, args: spec.args, expect: spec.expect, ...(spec.note !== undefined && { note: spec.note }), ...(spec.shows !== undefined && { shows: spec.shows }) }) !== 'write') { if (!LOCAL_READS.has(entry.id)) found.push(`${entry.id}: ${spec.label}`) }
      }
    }

    // `classOf` reads anything unclear as a write, so only a read-only spec whose words say network, install, spend or delete must declare it.
    expect([...new Set(found)]).toEqual([])
  })
})
