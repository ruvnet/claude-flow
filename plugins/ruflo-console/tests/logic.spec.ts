/**
 * The console's pure logic: `/ruflo` parsing, the palette's entries and fuzzy filter, the event diff, and the alerts
 * and approvals derived from a snapshot. Run with `npx vitest run plugins/ruflo-console`.
 */
import { describe, expect, it } from 'vitest'

import { alertsOf, approvalsOf, STALL_MS } from '../hooks/data/alerts'
import { diffEvents, recentByAgent } from '../hooks/data/events'
import { readSnapshot, type Snapshot } from '../hooks/data/snapshot'
import { parseRuflo } from '../hooks/commands'
import { filterPalette, fuzzy, paletteEntries } from '../hooks/palette'
import { memoryStore, reroute, textArg } from '../hooks/ops'
import { newState } from '../hooks/state'
import { RUFLO_FILES } from './fixtures/ruflo-run'

async function snapshotOf(files: Record<string, string>): Promise<Snapshot> {
  const all = Object.fromEntries(Object.entries(files).map(([path, text]) => [`/work/${path}`, text]))
  const fs = {
    read: async (path: string) => all[path] ?? Promise.reject(new Error('ENOENT')),
    stat: async (path: string) => (all[path] !== undefined ? { mtimeMs: 1, size: (all[path] as string).length } : Promise.reject(new Error('ENOENT'))),
    list: async () => [],
  }

  return readSnapshot(fs, new Map(), '/work', null, {}, 0)
}

describe('/ruflo', () => {
  it('reads every subcommand into an intent; swarm alone is the view, swarm <sub> belongs to ruflo-swarm', () => {
    expect(parseRuflo('')).toEqual({ kind: 'open', view: null })
    expect(parseRuflo('4')).toEqual({ kind: 'open', view: 'claims' })
    expect(parseRuflo('autopilot Stop')).toEqual({ kind: 'autopilot', arg: 'stop' })
    expect(parseRuflo('cost')).toEqual({ kind: 'open', view: 'cost' })
    expect(parseRuflo('swarm')).toEqual({ kind: 'open', view: 'swarm' })
    expect(parseRuflo('swarm status json')).toEqual({ kind: 'delegate', owner: 'ruflo-swarm', words: 'status json' })
    expect(parseRuflo('mods')).toEqual({ kind: 'delegate', owner: 'ruflo-mods', words: '' })
    expect(parseRuflo('run route fix the login bug')).toEqual({ kind: 'run', paletteId: 'route', text: 'fix the login bug' })
    expect(parseRuflo('agent coder-1')).toEqual({ kind: 'agent', who: 'coder-1' })
    expect(parseRuflo('filter claims')).toEqual({ kind: 'filter', filter: 'claims' })
    expect(parseRuflo('yes')).toEqual({ kind: 'confirm', isYes: true })
    expect(parseRuflo('frobnicate')).toEqual({ kind: 'unknown', word: 'frobnicate' })
  })
})

describe('palette', () => {
  it('fuzzy matches letters in order, prefers word starts, and refuses a missing letter', () => {
    expect(fuzzy('spc', 'spawn a coder agent')).not.toBeNull()
    expect(fuzzy('xyz', 'spawn a coder agent')).toBeNull()
    expect(fuzzy('sw', 'stop the swarm') ?? 0).toBeGreaterThan(fuzzy('sw', 'show the logs of coder') ?? 0)
  })

  it('offers the selection actions, every spawn type, votes for each proposal, workers and views', async () => {
    const state = newState({})

    state.snapshot = await snapshotOf(RUFLO_FILES)

    const ids = paletteEntries(state, 0).map(entry => entry.id)

    expect(ids).toEqual(expect.arrayContaining(['agent-drill', 'agent-logs', 'claim-release', 'claim-handoff', 'spawn-coder', 'swarm-init', 'swarm-stop', 'vote-yes-proposal-1790903321981-23aov7', 'mh-audit', 'worker-testgaps', 'route', 'store', 'search', 'view-approvals']))
    expect(filterPalette(paletteEntries(state, 0), 'route fix the login bug', 'all').map(entry => entry.id)).toEqual(['route'])
    expect(filterPalette(paletteEntries(state, 0), '', 'selection').every(entry => entry.group === 'agent' || entry.group === 'claims')).toBe(true)
  })

  it('free text is one argv element and never a flag', () => {
    expect(textArg('  -rf /  ')).toBeNull()
    expect(textArg('a\u001bb')).toBe('a b')
    expect(reroute('fix it')?.args).toEqual(['hooks', 'route', '--task', 'fix it', '--format', 'json'])
    expect(memoryStore('note; rm -rf ~', 7)?.args).toEqual(['memory', 'store', '--key', 'console-7', '--value', 'note; rm -rf ~', '--namespace', 'console'])
  })
})

describe('events, alerts, approvals', () => {
  it('the first read is a baseline; later reads yield what changed, tagged with the agent it concerns', async () => {
    const before = await snapshotOf(RUFLO_FILES)
    const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, Record<string, unknown>> }

    ;(Object.values(store.agents)[0] as Record<string, unknown>).status = 'busy'

    const claims = JSON.parse(RUFLO_FILES['.claude-flow/claims/claims.json'] ?? '{}') as { claims: Record<string, unknown> }

    delete claims.claims['console-demo-1']

    const after = await snapshotOf({ ...RUFLO_FILES, '.claude-flow/agents/store.json': JSON.stringify(store), '.claude-flow/claims/claims.json': JSON.stringify(claims) })

    expect(diffEvents(null, after, 5)).toEqual([])

    const events = diffEvents(before, after, 5)

    expect(events.map(event => event.text)).toEqual(['agent coder: idle → busy', 'console-demo-1 released'])
    expect(recentByAgent(events, 10, 100).get('agent-1790903032181-97m25s')).toBe(5)
  })

  it('alerts name what they saw and the fix; approvals list proposals and stealable claims with their actions', async () => {
    const state = newState({})
    const store = JSON.parse(RUFLO_FILES['.claude-flow/agents/store.json'] ?? '{}') as { agents: Record<string, Record<string, unknown>> }

    ;(Object.values(store.agents)[0] as Record<string, unknown>).status = 'busy'
    state.snapshot = await snapshotOf({ ...RUFLO_FILES, '.claude-flow/agents/store.json': JSON.stringify(store) })

    const created = Date.parse('2026-10-02T01:03:52.181Z')
    const alerts = alertsOf(state, created + STALL_MS + 60_000, created)

    expect(alerts.map(alert => alert.id)).toEqual(expect.arrayContaining(['stalled-agent-1790903032181-97m25s', 'mods']))
    expect(alertsOf(state, created + 60_000, created).some(alert => alert.id.startsWith('stalled'))).toBe(false)
    expect(approvalsOf(state).map(item => [item.kind, item.actions.map(action => action.paletteId)])).toEqual([
      ['proposal', ['vote-yes-proposal-1790903321981-23aov7', 'vote-no-proposal-1790903321981-23aov7']],
      ['stealable', ['claim-steal']],
    ])
  })
})
