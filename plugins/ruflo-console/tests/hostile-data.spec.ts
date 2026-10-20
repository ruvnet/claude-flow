/**
 * Any ruflo file, mod status, federation board or CLI answer can hold hostile or odd data (#3817): a time past Date's range, a negative or
 * infinite count, a link where a file belongs, an option named like an Object.prototype key, a stray brace after the JSON. None may crash a view,
 * draw nonsense, read through a link, or break an action. Real readers and views, hostile inputs.
 */
import { describe, expect, it } from 'vitest'

import { readableFs } from './fixtures/hostile-fs'
import { parseAutopilot, objectIn } from '../hooks/data/automate'
import { readDisk } from '../hooks/data/files'
import { parseNeural, parseRouter, parseDaemon } from '../hooks/data/facts'
import { msOf, parseAgents, parseSwarmStore } from '../hooks/data/parse'
import { countOf, isoOf, ratioOf, timeOf } from '../hooks/data/safe'
import { parseModStatus, type ModRow } from '../hooks/data/mods'
import { readDoc } from '../hooks/data/plugin-catalog'
import { roomFeed } from '../hooks/data/room'
import { readSnapshot } from '../hooks/data/snapshot'
import { gauge } from '../hooks/memory-lines'
import { roomOf } from '../hooks/room'
import { newState, optionsOf, CLI_PREFIXES } from '../hooks/state'
import { xruvLines } from '../hooks/xruv'
import { count, pct, type Actions } from '../hooks/views/common'
import { viewText } from '../hooks/views/pane'

const HOSTILE_NUMBERS = [Number.NaN, Infinity, -Infinity, -1, -0, 0, 1.5, 1e-7, 1e15, 8.64e15, 8.64e15 + 1, 1e20, 1e300, 1e302, -1e308, Number.MAX_VALUE, Number.MIN_VALUE, 2 ** 53]
const HOSTILE_VALUES: unknown[] = [...HOSTILE_NUMBERS, '5', '', null, undefined, {}, [], true, 'NaN', '1e999']

describe('times never throw (#3817)', () => {
  it('isoOf takes anything and answers text; timeOf and msOf keep only what Date can hold', () => {
    for (const value of HOSTILE_VALUES) {
      expect(() => isoOf(value), String(value)).not.toThrow()
      expect(typeof isoOf(value)).toBe('string')
      const kept = timeOf(value)

      if (kept !== undefined) expect(() => new Date(kept).toISOString()).not.toThrow()
      const ms = msOf(value)

      if (ms !== undefined) expect(() => new Date(ms).toISOString()).not.toThrow()
    }

    expect(isoOf(1e20)).toBe(new Date(8.64e15).toISOString())
    expect(isoOf(Number.NaN)).toBe('n/a')
  })

  const room = (mod: ModRow) => {
    const act = new Proxy({}, { get: () => () => undefined }) as unknown as Actions
    const state = newState({})

    return readSnapshot(readableFs({}), new Map(), '/work', '/home/dev', {}, 0).then(snapshot => {
      state.snapshot = { ...snapshot, mods: { rows: [mod], refused: 0, truncated: false } }
      state.view = 'room'
      roomOf(state).mod = mod.name

      return viewText({ state, nowMs: 1_000, columns: 100, act }, 'room')
    })
  }

  it('opening a mod whose updatedMs or startedMs is far past Date draws the page, close control included', async () => {
    for (const bad of [1e20, 8.64e15 + 1, 1e300, Infinity, Number.NaN]) {
      const text = await room({ name: 'docs', guard: true, calls: 1, blocked: 0, updatedMs: bad, startedMs: bad })

      expect(text, String(bad)).toContain('docs')
      expect(text).not.toContain('Invalid time value')
    }
  })

  it('a mod status file with such times reads as "not reported"', () => {
    const row = parseModStatus('docs-mod', JSON.stringify({ version: 1, updatedMs: 1e20, startedMs: 8.64e15 + 1, calls: 1 }))

    expect(row?.updatedMs).toBeNull()
    expect(row?.startedMs).toBeNull()
  })

  it('a board entry that expires far in the future does not replace the claims board with an error', () => {
    const board = JSON.stringify({ claims: [{ resource: 'a', owner: 'b', expiresAt: 1e20 }, { resource: 'c', owner: 'd', expiresAt: '2999-01-01T00:00:00Z' }] })

    expect(() => xruvLines('x-claims', `Result:\n${board}\n`)).not.toThrow()
  })
})

describe('counts and ratios are whole, non-negative and capped; ratios sit in 0..1 (#3817)', () => {
  it('countOf and ratioOf over every hostile value', () => {
    for (const value of HOSTILE_VALUES) {
      const n = countOf(value)
      const r = ratioOf(value)

      if (n !== undefined) expect(Number.isInteger(n) && n >= 0 && n <= 1e12, String(value)).toBe(true)
      if (r !== undefined) expect(r >= 0 && r <= 1, String(value)).toBe(true)
    }
  })

  it('count() and pct() never draw 1e+302M, -Infinity% or a negative count', () => {
    for (const value of HOSTILE_NUMBERS) {
      expect(count(value), String(value)).not.toMatch(/e[+-]\d|Infinity|NaN|^-/)
      expect(pct(value), String(value)).not.toMatch(/e[+-]\d|Infinity|NaN|^-/)
    }

    expect(count(1e302)).toBe('1T+')
    expect(count(-1e308)).toBe('n/a')
  })

  it('gauge() never throws for a negative, NaN or infinite part, whole or width', () => {
    for (const part of HOSTILE_NUMBERS) for (const whole of HOSTILE_NUMBERS) for (const width of [-5, 0, 1, 12, Number.NaN, Infinity, 1e9]) {
      const bar = gauge(part, whole, width)

      expect(bar.length, `${part} ${whole} ${width}`).toBeLessThanOrEqual(200)
    }
  })

  it('agents, swarm, learning, daemon and autopilot files with hostile numbers read as sane ones', () => {
    const agents = parseAgents('{"agents":{"a":{"agentId":"agent-1","agentType":"coder","status":"busy","health":-3,"taskCount":1e302},"b":{"agentId":"agent-2","agentType":"coder","status":"idle","health":1e-7,"taskCount":-1e308}}}')

    expect(agents.map(agent => agent.health)).toEqual([0, 1e-7])
    expect(agents.map(agent => agent.taskCount)).toEqual([1e12, undefined])

    expect(parseSwarmStore('{"swarms":{"s":{"swarmId":"swarm-1","status":"running","maxAgents":1e300}}}')?.maxAgents).toBe(1e12)
    expect(parseNeural('{"trajectoriesRecorded":-4,"patternsLearned":1e300,"signalsProcessed":1e999}')).toEqual({ patterns: 1e12 })
    expect(parseRouter(JSON.stringify({ totalDecisions: -1, avgConfidence: 7, modelDistribution: { a: -3, b: 1e300 } }))).toMatchObject({ avgConfidence: 1, distribution: [{ model: 'b', count: 1e12 }] })
    expect(parseDaemon(JSON.stringify({ running: true, workers: { audit: { runCount: -1e308, failureCount: 1e302 } } }))?.workers[0]).toMatchObject({ runs: 0, failures: 1e12 })

    const autopilot = parseAutopilot(JSON.stringify({ enabled: true, iterations: -2, maxIterations: 1e300, tasks: { completed: -1, total: 1e302, percent: 1e-7 } }))

    expect(autopilot).toMatchObject({ iterations: 0, maxIterations: 1e12, done: 0, total: 1e12, percent: 0 })
  })
})

describe('the Room feed ids are unique (#3817)', () => {
  it('two events of one time and one text length get distinct ids, so one press opens one line', () => {
    const events = [{ atMs: 5_000, kind: 'tools', text: 'aaaa' }, { atMs: 5_000, kind: 'tools', text: 'bbbb' }, { atMs: 5_000, kind: 'tools', text: 'cccc' }]
    const feed = roomFeed({ events, log: [{ atMs: 5_000, tool: 'console_state', summary: 'abcd', outcome: 'ok', detail: '' }], said: [], pending: null, outcome: null, source: 'all', query: '', untilMs: null, blocked: false } as never)
    const ids = feed.map(item => item.id)

    expect(feed).toHaveLength(4)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('files and options that are not what they claim (#3817)', () => {
  it('a symlinked SKILL.md (or any non-file) is never read, so its target text is neither drawn nor returned', async () => {
    const reads: string[] = []
    const fs = { read: async (path: string) => (reads.push(path), 'name: leak\ndescription: SECRET TARGET TEXT'), stat: async () => ({ size: 40, isLink: true, kind: 'file' }), list: async () => [] }
    const plugin = { name: 'p', dir: '/plugins/p' } as never

    expect(await readDoc(fs, plugin, 'skill', 'demo')).toBeNull()
    expect(await readDoc({ ...fs, stat: async () => ({ size: 40, kind: 'directory' }) }, plugin, 'agent', 'demo')).toBeNull()
    expect(reads).toEqual([])
    expect(await readDoc({ ...fs, stat: async () => ({ size: 40, kind: 'file' }) }, plugin, 'skill', 'demo')).not.toBeNull()
  })

  it('a linked agentdb-mod status file is typed "not-regular" and the section says it was refused, not "no session yet"', async () => {
    const files = { '/work/.claude-flow/agentdb-mod/status.json': JSON.stringify({ version: 1, recall: true }) }
    const fs = readableFs(files, { link: ['/work/.claude-flow/agentdb-mod/status.json'] })
    const state = newState({})
    const act = new Proxy({}, { get: () => () => undefined }) as unknown as Actions
    const snapshot = await readSnapshot(fs, new Map(), '/work', '/home/dev', {}, 0)
    const disk = await readDisk(fs, new Map(), '/work', '/home/dev')

    expect(disk.project.agentdbMod).toMatchObject({ text: null, reason: 'not-regular' })
    expect(snapshot.reads.agentdbMod).toBe('not-regular')
    state.snapshot = snapshot
    state.view = 'memory'
    expect(viewText({ state, nowMs: 1_000, columns: 100, act }, 'memory')).toMatch(/refused/)
    expect(viewText({ state, nowMs: 1_000, columns: 100, act }, 'memory')).not.toContain('no session yet')
  })

  it('a cli option named like an Object.prototype key is the default, never a prefix that is not iterable', () => {
    for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
      const options = optionsOf({ cli: bad } as never)

      expect(options.cli, bad).toBe('npx-offline')
      expect(Array.isArray(CLI_PREFIXES[options.cli])).toBe(true)
    }

    expect(optionsOf({ cli: 'claude-flow' } as never).cli).toBe('claude-flow')
  })

  it('objectIn cuts the JSON where it ends, so a footer line with a brace after it does not hide the data', () => {
    const out = `[hooks] starting\n{"enabled": true, "iterations": 3}\n[INFO] done {see docs}`

    expect(objectIn(out)).toEqual({ enabled: true, iterations: 3 })
    expect(objectIn('{"a": "}"}\ntrailer }')).toEqual({ a: '}' })
    expect(objectIn('{"a": 1')).toBeNull()
  })
})
