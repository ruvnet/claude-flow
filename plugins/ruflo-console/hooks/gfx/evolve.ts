/**
 * The governed-evolution loop as a picture, and the champion's ancestry as a tree. Pure: `loopStagesOf` and
 * `lineageOf` read what the evolve view holds, `loopPicture` draws the stages for an instant on the real clock. A stage
 * lights only from data: a file ruflo wrote, or what its CLI answered when the person asked. What nothing measures
 * reads n/a, dimmed, never dark. The dot that runs along the arrows is decoration over lit stages only.
 */
import { isoOf } from '../data/safe'
import { shortRef, type EvolveFiles, type EvolveState } from '../data/evolve'
import { COLOR, Grid, mix } from './raster'

export type StageMark = 'lit' | 'dark' | 'bad' | 'na'
export type LoopStage = { name: string; value: string; mark: StageMark; source: string }

const na = (name: string, source: string): LoopStage => ({ name, value: 'n/a', mark: 'na', source })

/**
 * OBSERVE → PROPOSE → EVALUATE → VERIFY → PROMOTE → REVERSE. The counts come from the flywheel files (receipts, commits,
 * generations), VERIFY from the last `flywheel status` the person ran, REVERSE from the active policy's rollback pointer.
 */
export function loopStagesOf(evolve: EvolveState): LoopStage[] {
  const files = evolve.files

  if (files === null) return ['OBSERVE', 'PROPOSE', 'EVALUATE', 'VERIFY', 'PROMOTE', 'REVERSE'].map(name => na(name, 'not read yet'))

  const receipts = files.receipts ?? []
  const generations = files.generations ?? []
  const hasStore = files.flywheel !== null || files.receipts !== null || files.generations !== null
  const runs = receipts.length + generations.length
  const candidates = new Set([...receipts.flatMap(receipt => receipt.candidate ?? []), ...generations.flatMap(generation => generation.candidate ?? [])]).size
  const decided = receipts.filter(receipt => receipt.decision !== undefined)
  const accepted = decided.filter(receipt => receipt.decision === 'accepted').length + generations.filter(generation => generation.isPromoted).length
  const promoted = (files.flywheel?.commits.length ?? 0) + generations.filter(generation => generation.isPromoted).length
  const mark = (n: number): StageMark => (n > 0 ? 'lit' : 'dark')
  const ledger = evolve.ledger
  const policy = files.policy

  return [
    hasStore ? { name: 'OBSERVE', value: `${runs} runs`, mark: mark(runs), source: 'receipts + generations on disk' } : na('OBSERVE', 'no flywheel files'),
    hasStore ? { name: 'PROPOSE', value: `${candidates} cand`, mark: mark(candidates), source: 'distinct candidate refs' } : na('PROPOSE', 'no flywheel files'),
    hasStore ? { name: 'EVALUATE', value: `${decided.length + generations.length} · ${accepted}✓`, mark: mark(decided.length + generations.length), source: 'receipt decisions' } : na('EVALUATE', 'no flywheel files'),
    ledger === null ? na('VERIFY', '▸ LEDGER checks the hash chain') : { name: 'VERIFY', value: ledger.isValid ? 'valid' : 'INVALID', mark: ledger.isValid ? 'lit' : 'bad', source: 'metaharness flywheel status' },
    hasStore ? { name: 'PROMOTE', value: `${promoted} · ep ${files.flywheel?.epoch ?? 'n/a'}`, mark: mark(promoted), source: 'promotion commits + promoted generations' } : na('PROMOTE', 'no flywheel files'),
    policy === null
      ? na('REVERSE', 'no harness-active-policy.json')
      : { name: 'REVERSE', value: policy.isRolledBack ? 'rolled back' : policy.previous !== undefined ? 'armed' : 'no ptr', mark: policy.isRolledBack ? 'lit' : 'dark', source: 'the active policy’s previous pointer' },
  ]
}

const BORDER: Record<StageMark, number> = { lit: COLOR.ok, dark: COLOR.line, bad: COLOR.bad, na: COLOR.dim }

/** Rows the loop picture takes: the six boxes and the return path under them. */
export const LOOP_ROWS = 5

/** Six boxes left to right with their values, and the way back from REVERSE to OBSERVE underneath. */
export function loopPicture(stages: readonly LoopStage[], columns: number, t: number): Grid {
  const grid = new Grid(columns, LOOP_ROWS)
  const n = Math.max(1, stages.length)
  const box = Math.max(7, Math.floor((columns - (n - 1) * 3) / n))
  const centre = (i: number) => i * (box + 3) + Math.floor(box / 2)

  stages.forEach((stage, i) => {
    const x0 = i * (box + 3)
    const color = BORDER[stage.mark]
    const inner = box - 2

    grid.text(x0, 0, `╭${'─'.repeat(inner)}╮`, color)
    grid.text(x0, 1, `│${stage.name.padEnd(inner).slice(0, inner)}│`, stage.mark === 'na' ? COLOR.dim : COLOR.accent)
    grid.text(x0, 2, `│${stage.value.padStart(inner).slice(0, inner)}│`, stage.mark === 'lit' ? COLOR.ok : stage.mark === 'bad' ? COLOR.bad : COLOR.dim)
    grid.text(x0, 3, `╰${'─'.repeat(inner)}╯`, color)

    if (i > 0) {
      const ax = x0 - 3
      const isFlowing = stage.mark === 'lit' && stages[i - 1]?.mark === 'lit'

      grid.text(ax, 1, '──▶', isFlowing ? COLOR.ok : COLOR.line)
      if (isFlowing) grid.set(ax + (Math.floor(t / 400) % 3), 1, '●', mix(COLOR.ok, COLOR.warn, 0.5))
    }
  })

  // The loop closes: REVERSE (or a new run) feeds the next OBSERVE.
  const from = centre(n - 1)
  const to = centre(0)

  grid.set(to, 4, '╰', COLOR.line)
  grid.text(to + 1, 4, '─'.repeat(Math.max(0, from - to - 1)), COLOR.line)
  grid.set(from, 4, '╯', COLOR.line)
  grid.set(to, 3, '▲', stages[0]?.mark === 'lit' ? COLOR.ok : COLOR.line)
  grid.text(to + 2, 4, ' next run ', COLOR.dim)

  return grid
}

export type LineageKind = 'root' | 'promoted' | 'champion' | 'rejected' | 'pending'
export type LineageRow = { prefix: string; ref: string; kind: LineageKind; note: string }
type Edge = { parent: string; child: string; kind: Exclude<LineageKind, 'root' | 'champion'>; note: string; atMs: number }

export const MAX_LINEAGE_ROWS = 18
const ROOT = 'root'

/** A forest of edges as rows, roots first, each child under its parent with ├─ / └─ and the champion marked. */
function treeRows(edges: readonly Edge[], champion: string | undefined): LineageRow[] {
  const children = new Map<string, Edge[]>()

  for (const edge of edges) children.set(edge.parent, [...(children.get(edge.parent) ?? []), edge])

  const isChild = new Set(edges.map(edge => edge.child))
  const roots = [...children.keys()].filter(ref => !isChild.has(ref))
  const rows: LineageRow[] = []
  const seen = new Set<string>()
  const walk = (ref: string, prefix: string, depth: number) => {
    const kids = (children.get(ref) ?? []).slice().sort((a, b) => a.atMs - b.atMs)

    kids.forEach((edge, i) => {
      if (rows.length >= MAX_LINEAGE_ROWS || seen.has(edge.child) || depth > 24) return

      const isLast = i === kids.length - 1

      seen.add(edge.child)
      rows.push({ prefix: `${prefix}${isLast ? '└─' : '├─'}`, ref: edge.child, kind: edge.child === champion && edge.kind === 'promoted' ? 'champion' : edge.kind, note: edge.note })
      walk(edge.child, `${prefix}${isLast ? '  ' : '│ '}`, depth + 1)
    })
  }

  for (const root of roots) {
    if (rows.length >= MAX_LINEAGE_ROWS) break
    rows.push({ prefix: '', ref: root, kind: 'root', note: root === ROOT ? 'the first generation' : 'baseline' })
    walk(root, '', 1)
  }

  return rows
}

const when = (atMs: number | undefined) => (atMs === undefined ? '' : ` · ${isoOf(atMs).slice(0, 10)}`)

/**
 * The champion's ancestry, per store. The flywheel's: each promotion commit links its baseline to the candidate, and
 * each receipt not promoted hangs off its baseline as rejected or waiting. The generations loop's: each bundle's parent.
 */
export function lineageOf(files: EvolveFiles | null): { flywheel: LineageRow[]; generations: LineageRow[] } {
  if (files === null) return { flywheel: [], generations: [] }

  const commits = files.flywheel?.commits ?? []
  const promoted = new Set(commits.map(commit => commit.candidate))
  const flywheel: Edge[] = [
    ...commits.map(commit => ({ parent: commit.baseline ?? ROOT, child: commit.candidate, kind: 'promoted' as const, note: `epoch ${commit.epoch ?? '?'}${commit.receipt !== undefined ? ` · receipt ${shortRef(commit.receipt)}` : ''}${when(commit.atMs)}`, atMs: commit.atMs ?? 0 })),
    ...(files.receipts ?? []).flatMap(receipt =>
      receipt.candidate === undefined || promoted.has(receipt.candidate)
        ? []
        : [{ parent: receipt.baseline ?? ROOT, child: receipt.candidate, kind: receipt.decision === 'accepted' ? ('pending' as const) : ('rejected' as const), note: `${receipt.decision ?? 'undecided'} · ${receipt.status ?? 'unregistered'} · receipt ${shortRef(receipt.id)}${when(receipt.atMs)}`, atMs: receipt.atMs ?? 0 }],
    ),
  ]
  const generations: Edge[] = (files.generations ?? []).flatMap(generation =>
    generation.candidate === undefined
      ? []
      : [{ parent: generation.parent ?? ROOT, child: generation.candidate, kind: generation.isPromoted ? ('promoted' as const) : ('rejected' as const), note: `gen ${generation.generation}${generation.mutation !== undefined ? ` · ${generation.mutation}` : ''}${generation.cause !== undefined ? ` · failed ${generation.cause}` : ''}${when(generation.atMs)}`, atMs: generation.atMs ?? generation.generation }],
  )

  return { flywheel: treeRows(flywheel, files.flywheel?.champion), generations: treeRows(generations, files.served?.champion) }
}
