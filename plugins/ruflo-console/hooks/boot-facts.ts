/**
 * What the boot screen shows of this machine, pure: the ruvector constellation (nine stars, each lit only if something real says it is
 * there) and the numbers under it. Every fact comes from what the console has already read (the CLI's version probe, the memory and
 * intelligence probes, the installed-plugin list, the neural and swarm files); nothing is spawned for the boot, and nothing is invented:
 * a star with no evidence stays dark and says so. The drawing is gfx/boot-cyber.ts. Tested in tests/boot-cyber.spec.ts.
 */
import type { ProbeResult } from './data/cli'
import type { State } from './state'

export type Star = {
  id: string
  label: string
  /** Where it sits on the map, 0 to 1 across and down. */
  x: number
  y: number
  alive: boolean
  /** What lit it, in words (a version, a count), or why it is dark. */
  detail: string
  /** Milliseconds into the log before this star may light, so they come on one after another. */
  appearAt: number
}

export type BootFacts = {
  title: string
  /** The person who made it, the version and the git build, for the title row. */
  credit: string
  version: string
  build: string
  stars: Star[]
  links: readonly (readonly [string, string])[]
  /** Real numbers to cycle through: only the ones there is data for. */
  stats: { label: string; value: string }[]
}

/** The constellation's lines: the hub, then what hangs off ruvector. */
export const LINKS: readonly (readonly [string, string])[] = [
  ['ruflo', 'ruvector'],
  ['ruflo', 'agentdb'],
  ['ruflo', 'sona'],
  ['agentdb', 'ruvector'],
  ['ruvector', 'rvf'],
  ['ruvector', 'ruvllm'],
  ['ruvector', 'rulake'],
  ['rulake', 'ruqu'],
  ['rulake', 'rvdna'],
]

/** The map: where each star sits and when it may light. The ids are the packages' own names. */
const MAP: readonly { id: string; label: string; x: number; y: number; appearAt: number }[] = [
  { id: 'ruflo', label: 'ruflo', x: 0.5, y: 1, appearAt: 0 },
  { id: 'agentdb', label: 'agentdb', x: 0.1, y: 1, appearAt: 250 },
  { id: 'sona', label: 'sona', x: 0.88, y: 1, appearAt: 500 },
  { id: 'ruvector', label: 'ruvector', x: 0.5, y: 0.6, appearAt: 750 },
  { id: 'rvf', label: 'rvf', x: 0.84, y: 0.62, appearAt: 1000 },
  { id: 'ruvllm', label: 'ruvllm', x: 0.8, y: 0.3, appearAt: 1250 },
  { id: 'rulake', label: 'rulake', x: 0.38, y: 0.3, appearAt: 1500 },
  { id: 'ruqu', label: 'ruqu', x: 0.08, y: 0, appearAt: 1750 },
  { id: 'rvdna', label: 'rvdna', x: 0.86, y: 0, appearAt: 2000 },
]

/** A probe's last good value, or null when it has none or its latest word is an error: the same test the pages use before they call a source live. */
const liveOf = <T>(result: ProbeResult | undefined): T | null => {
  if (result === undefined || result.value === null) return null
  if (result.error !== null && (result.errorAtMs ?? 0) >= (result.okAtMs ?? 0)) return null

  return result.value as T
}

type Evidence = { alive: boolean; detail: string }

export function bootFacts(state: State, version: string, build: string): BootFacts {
  const snap = state.snapshot
  const installed = snap?.plugins.installed ?? []
  const named = (name: string) => installed.find(entry => entry.name === name)
  const matching = (part: string) => installed.filter(entry => entry.name.includes(part))
  const cli = liveOf<string>(state.probes.get('version'))
  const memory = liveOf<unknown>(state.probes.get('memory'))
  const engine = liveOf<unknown>(state.probes.get('intelligence'))
  const plugin = (name: string): Evidence => {
    const found = named(name)

    return found === undefined ? { alive: false, detail: `${name} is not installed` } : { alive: true, detail: `plugin ${found.version}` }
  }
  const family = (part: string): Evidence => {
    const found = matching(part)

    return found.length === 0 ? { alive: false, detail: `no ${part} plugin installed` } : { alive: true, detail: `${found.length} plugin${found.length === 1 ? '' : 's'}` }
  }

  const evidence: Record<string, Evidence> = {
    ruflo: cli !== null ? { alive: true, detail: `cli ${cli}` } : snap?.isRufloProject === true ? { alive: true, detail: 'a ruflo project' } : { alive: false, detail: 'the CLI has not answered' },
    agentdb: memory !== null ? { alive: true, detail: 'memory answers' } : named('ruflo-agentdb') !== undefined ? plugin('ruflo-agentdb') : { alive: false, detail: 'no memory database found' },
    sona:
      snap?.sona != null
        ? { alive: true, detail: `${snap.sona.patterns} patterns` }
        : snap?.neural != null
          ? { alive: true, detail: 'neural stats on disk' }
          : engine !== null
            ? { alive: true, detail: 'the engine answers' }
            : { alive: false, detail: 'nothing learned here yet' },
    ruvector: plugin('ruflo-ruvector'),
    rvf: plugin('ruflo-rvf'),
    ruvllm: plugin('ruflo-ruvllm'),
    rulake: family('rulake'),
    ruqu: family('ruqu'),
    rvdna: family('rvdna'),
  }

  const stats: { label: string; value: string }[] = []
  const add = (label: string, value: number | string | null | undefined): void => {
    if (value !== null && value !== undefined && value !== 0 && value !== '') stats.push({ label, value: String(value) })
  }

  add('agents', snap?.agents.length)
  add('claims', snap?.claims.length)
  add('tasks', snap?.tasks.length)
  add('patterns', snap?.neural?.patterns ?? snap?.sona?.patterns)
  add('trajectories', snap?.neural?.trajectories)
  add('plugins', installed.length)
  add('missions', snap?.missions?.missions.length)

  return {
    title: 'RUV.NET // RUVECTOR CONSTELLATION',
    credit: 'rUv',
    version,
    build,
    stars: MAP.map(star => ({ ...star, alive: (evidence[star.id] as Evidence).alive, detail: (evidence[star.id] as Evidence).detail })),
    links: LINKS,
    stats,
  }
}
