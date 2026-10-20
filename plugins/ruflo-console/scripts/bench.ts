/**
 * Measures the console's pure costs on the captured run (tests/fixtures/ruflo-run.ts): one disk refresh over an
 * in-memory fs (parse cost; the engine's own fs latency is not in it), one full pane tree per view, and one animation
 * frame (every picture of the view drawn and base64-encoded). Prints median and p95 per row.
 *   npx -y tsx plugins/ruflo-console/scripts/bench.ts [iterations]
 */
import { PROBES } from '../hooks/data/cli'
import { readSnapshot, type Snapshot } from '../hooks/data/snapshot'
import { newState, VIEWS } from '../hooks/state'
import type { Actions, Kit } from '../hooks/views/common'
import { picturesOf } from '../hooks/views/frames'
import { paneView } from '../hooks/views/pane'
import { CLI_OUT, RUFLO_FILES } from '../tests/fixtures/ruflo-run'

const N = Math.max(10, Number(process.argv[2]) || 300)
const COLUMNS = 110
const files = Object.fromEntries(Object.entries(RUFLO_FILES).map(([path, text]) => [`/work/${path}`, text]))
const fs = {
  read: async (path: string) => files[path] ?? Promise.reject(new Error('ENOENT')),
  stat: async (path: string) => (files[path] !== undefined ? { mtimeMs: 1, size: (files[path] as string).length } : Promise.reject(new Error('ENOENT'))),
  list: async () => [],
}
const element = (type: string) => (props: Record<string, unknown>) => ({ type, props }) as never
const kit = { Box: element('Box'), Text: element('Text'), Button: element('Button'), Raster: element('Raster') } as unknown as Kit
const noop = () => undefined
const act = new Proxy({}, { get: () => noop }) as Actions
const ms = (start: bigint) => Number(process.hrtime.bigint() - start) / 1e6

function stats(samples: number[]): string {
  const sorted = [...samples].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))] ?? 0

  return `median ${at(0.5).toFixed(3)} ms · p95 ${at(0.95).toFixed(3)} ms`
}

async function main() {
  const state = newState({})
  const byProbe: Record<string, string> = { version: 'version', memory: 'memory-stats', namespaces: 'memory-list', metaharness: 'mh-score', flywheel: 'mh-flywheel', intelligence: 'intel', peers: 'bbs-peers', channels: 'channels' }

  for (const probe of PROBES) {
    const name = byProbe[probe.id]

    if (name !== undefined) state.probes.set(probe.id, { value: probe.parse(CLI_OUT[name] ?? ''), okAtMs: Date.now(), error: null, errorAtMs: null, isRunning: false })
  }

  state.cwd = '/work'
  state.activity = Array.from({ length: 60 }, (_, i) => i % 7)
  state.writes = Array.from({ length: 60 }, (_, i) => i % 3)

  const cold: number[] = []
  const warm: number[] = []
  let snapshot: Snapshot | null = null

  for (let i = 0; i < N; i++) {
    let start = process.hrtime.bigint()

    snapshot = await readSnapshot(fs, new Map(), '/work', null, {}, Date.now())
    cold.push(ms(start))
    start = process.hrtime.bigint()
    await readSnapshot(fs, state.cache, '/work', null, {}, Date.now())
    warm.push(ms(start))
  }

  state.snapshot = snapshot
  console.log(`refresh (parse every file)       ${stats(cold)}`)
  console.log(`refresh (unchanged files cached) ${stats(warm)}`)

  for (const view of VIEWS) {
    state.view = view.id

    const renders: number[] = []
    const frames: number[] = []

    for (let i = 0; i < N; i++) {
      let start = process.hrtime.bigint()
      const pictures = picturesOf(state, COLUMNS, Date.now(), Date.now())

      paneView({ kit, state, nowMs: Date.now(), columns: COLUMNS, pictures, act })
      renders.push(ms(start))
      start = process.hrtime.bigint()
      for (const grid of picturesOf(state, COLUMNS, Date.now(), Date.now() + i * 125).values()) grid.encode()
      frames.push(ms(start))
    }

    const pictures = [...picturesOf(state, COLUMNS, Date.now(), Date.now()).keys()].join(',') || 'none'

    console.log(`${view.id.padEnd(12)} render ${stats(renders)} · frame [${pictures}] ${stats(frames)}`)
  }

  // The frame budget is 4 ms at 100 agents: a synthetic 100-agent swarm (counts only, nothing shown as real data).
  const base = state.snapshot as Snapshot
  const agents = Array.from({ length: 100 }, (_, i) => ({ id: `agent-bench-${i}`, type: i % 2 === 0 ? 'coder' : 'tester', status: i % 3 === 0 ? 'busy' : 'idle' }))

  for (const [topology, columns] of [['hierarchical', 160], ['mesh', 160]] as const) {
    state.snapshot = { ...base, agents, swarm: { id: 'swarm-bench', topology, status: 'running', agentIds: agents.map(agent => agent.id) } }
    state.view = 'swarm'
    state.events = agents.slice(0, 30).map((agent, i) => ({ atMs: Date.now() - i * 40, kind: 'swarm' as const, text: 'bench', agentId: agent.id }))

    const frames: number[] = []

    for (let i = 0; i < N; i++) {
      const start = process.hrtime.bigint()

      for (const grid of picturesOf(state, columns, Date.now(), Date.now() + i * 83).values()) grid.encode()
      frames.push(ms(start))
    }

    console.log(`100 agents ${topology.padEnd(12)} frame [header,topology] ${stats(frames)} (budget 4 ms)`)
  }
}

void main()
