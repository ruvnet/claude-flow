/**
 * The session workspace's index (ADR-486): the adapters' rows merged into one list, each with an identity that cannot be mistaken for
 * another's. Identity is harness + canonical home + native id. A row whose id is claimed by more than one file, or whose entries name another
 * id, is UNASSIGNED: it is listed in its own bucket, shows no preview, and never raises an attention item, because the one thing this page must
 * not do is show one session's output under another's name. Grouping is by repository, then worktree, from the recorded cwd's path alone.
 */
import { HARNESS_IDS, type Capabilities, type HarnessId, type ScanResult, type SessionRow } from './harness'

export type HarnessReport = { id: HarnessId; label: string; state: ScanResult['state']; note: string; count: number; capabilities: Capabilities }
export type Group = { label: string; repo: string; unassigned: boolean; rows: SessionRow[] }
export type Index = { rows: SessionRow[]; groups: Group[]; reports: HarnessReport[]; unassigned: number; builtAtMs: number }
export type Scanned = { id: HarnessId; label: string; capabilities: Capabilities; result: ScanResult }

const SEVERITY: Record<SessionRow['status'], number> = { failed: 0, working: 1, idle: 2, done: 3, unknown: 4 }

/** The last two path segments, so a long path stays recognisable in a group heading. */
export const shortRepo = (repo: string): string => {
  const parts = repo.split('/').filter(part => part !== '')

  return parts.length <= 2 ? repo : `…/${parts.slice(-2).join('/')}`
}

export function buildIndex(scans: readonly Scanned[], own: ReadonlySet<string>, nowMs: number): Index {
  const all = scans.flatMap(scan => scan.result.rows)
  const seen = new Map<string, number>()

  for (const row of all) seen.set(row.key, (seen.get(row.key) ?? 0) + 1)

  const rows: SessionRow[] = all.map((row, i) => {
    const copies = seen.get(row.key) ?? 1
    // A duplicated id gets a key of its own, so selecting one copy can never select (or show) the other.
    const key = copies > 1 ? `${row.key}~${row.folder}~${i}` : row.key
    const unassigned = copies > 1 ? `the id is claimed by ${copies} files` : row.unassigned

    return { ...row, key, unassigned, external: row.harness === 'ruflo' ? false : !own.has(row.nativeId), ...(unassigned !== null && { preview: null, noPreview: 'unassigned: not shown', title: `${row.harness} file ${row.nativeId.slice(0, 8)} in ${row.folder}`, cwd: null, branch: null, context: [] }) }
  })

  const groups = new Map<string, Group>()

  for (const row of rows) {
    const bucket = row.unassigned !== null
    const id = bucket ? '\u0000unassigned' : `${row.repo}\u0000${row.worktree ?? ''}`
    const held = groups.get(id) ?? { label: bucket ? 'unassigned' : `${shortRepo(row.repo)}${row.worktree === null ? '' : ` › ${row.worktree}`}`, repo: row.repo, unassigned: bucket, rows: [] }

    held.rows.push(row)
    groups.set(id, held)
  }

  const ordered = [...groups.values()].map(group => ({ ...group, rows: group.rows.sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status] || b.updatedMs - a.updatedMs) }))

  ordered.sort((a, b) => Number(a.unassigned) - Number(b.unassigned) || Math.max(...b.rows.map(r => r.updatedMs)) - Math.max(...a.rows.map(r => r.updatedMs)))

  return {
    rows,
    groups: ordered,
    unassigned: rows.filter(row => row.unassigned !== null).length,
    builtAtMs: nowMs,
    reports: HARNESS_IDS.map(id => scans.find(scan => scan.id === id)).flatMap(scan => (scan === undefined ? [] : [{ id: scan.id, label: scan.label, state: scan.result.state, note: scan.result.note, count: scan.result.rows.length, capabilities: scan.capabilities }])),
  }
}

/** The row with this key, or undefined: the only lookup the preview uses, so a selection can only ever resolve to the row it names. */
export const rowOf = (index: Index | null, key: string | null): SessionRow | undefined => (index === null || key === null ? undefined : index.rows.find(row => row.key === key))
