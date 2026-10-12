/**
 * ADRs on a mission (ADR-480): attach, suggest and detach, the digest Claude and the swarm read (and the file the swarm reads it from), the
 * comparison of changed files with the attached ADRs' paths, and a draft record from a mission. The page's logic is in adr.ts; the pure
 * parts are in data/adr-scope.ts. Nothing here blocks anything: a scope hit is a warning in the mission record.
 */
import { replaceFile } from './activity-io'
import { adrOf, announce, docOf, proposeSpec, root, say } from './adr'
import type { ActionSpec } from './actions'
import type { AdrDoc } from './data/adr'
import { checkScope, digestBlock, reportLines, suggest, type Suggestion } from './data/adr-scope'
import { draftFromMission } from './data/adr-write'
import { loadAdrs } from './adr'
import { plain } from './data/parse'
import type { Host } from './host'
import { activeMission, record, saveLedger } from './mission-control'
import type { MissionRecord } from './mission-types'
import type { State } from './state'


export const MAX_ATTACH = 8
const FILE_SAFE = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,119}\.md$/

/** The file names a mission has attached, validated (a saved ledger is not trusted). */
export const attachedOf = (mission: MissionRecord): string[] => (Array.isArray(mission.adrs) ? mission.adrs.filter((file): file is string => typeof file === 'string' && FILE_SAFE.test(file)).slice(0, MAX_ATTACH) : [])

/** The attached records that are in this project's folder now (an attached file that was removed simply is not listed). */
export const attachedDocs = (state: State, mission: MissionRecord): AdrDoc[] => attachedOf(mission).flatMap(file => docOf(state, file) ?? [])

/** What Claude and the swarm agents read for a mission: the digest block, or '' with no ADR attached. */
export const adrBlockFor = (state: State, mission: MissionRecord | null): string => (mission === null ? '' : digestBlock(attachedDocs(state, mission)))

export function suggestFor(state: State, mission: MissionRecord | null, goal: string): Suggestion[] {
  return suggest(goal, adrOf(state).registry.docs, mission === null ? [] : attachedOf(mission))
}

export async function setAttached(state: State, host: Host, file: string, on: boolean): Promise<void> {
  const mission = activeMission(state)

  if (mission === null) return say(state, host, 'attach ADR', false, ['no active mission: create one in Missions first'])
  if (!FILE_SAFE.test(file) || docOf(state, file) === undefined) return say(state, host, 'attach ADR', false, [`${plain(file, 60)} is not an ADR in this project`])

  const now = attachedOf(mission)

  if (on && !now.includes(file) && now.length >= MAX_ATTACH) return say(state, host, 'attach ADR', false, [`a mission carries at most ${MAX_ATTACH} ADRs`])

  mission.adrs = on ? [...new Set([...now, file])] : now.filter(each => each !== file)
  record(mission, { type: on ? 'adr.attached' : 'adr.detached', note: plain(file, 120) })
  saveLedger(state, host)
  await mirrorDigest(state, host)
  say(state, host, on ? 'attach ADR' : 'detach ADR', true, [`${file} ${on ? 'attached to' : 'detached from'} the mission`])
  announce(state, host, `ADR ${docOf(state, file)?.number ?? file} ${on ? 'attached to' : 'detached from'} the mission`)
}

/** Where the swarm plugin reads the digest: a small, masked file under the console's own folder. */
export const DIGEST_FILE = '.claude-flow/console/adr-digest.json'

/**
 * Writes (or clears) the digest the swarm plugin appends to a spawned subagent's prompt. Only the active mission's attached ADRs; the
 * text is the same masked, capped block Claude reads. Never throws.
 */
export async function mirrorDigest(state: State, host: Pick<Host, 'fs' | 'run'>): Promise<string | null> {
  const mission = activeMission(state)
  const docs = mission === null ? [] : attachedDocs(state, mission)
  const body = JSON.stringify({ v: 1, atMs: Date.now(), mission: mission?.id ?? '', adrs: docs.slice(0, MAX_ATTACH).map(doc => ({ number: doc.number, file: doc.file, status: doc.status })), block: digestBlock(docs) })

  return replaceFile(host, state.cwd, `${root(state)}/${DIGEST_FILE}`, body)
}

const mirrored = new WeakMap<State, string>()

/**
 * Keeps the swarm's digest file true to the ACTIVE mission, called from the controller's tick and cheap when nothing moved: it writes only
 * when the active mission or the text of its digest changed, writes an empty digest (which the swarm treats as none) when nothing is
 * attached, and clears a file an earlier session left behind. It never creates a file in a project that has never attached an ADR, and it
 * does not judge before the folder has been read (an unread registry would look like "nothing attached").
 */
export async function syncAdrDigest(state: State, host: Host): Promise<void> {
  const mission = activeMission(state)
  const attached = mission === null ? [] : attachedOf(mission)
  const adr = adrOf(state)

  if (attached.length > 0 && !adr.isLoaded) {
    if (!adr.isLoading) void loadAdrs(state, host)

    return
  }

  const block = mission === null ? '' : digestBlock(attachedDocs(state, mission))
  const key = `${mission?.id ?? ''}|${block}`
  const before = mirrored.get(state)

  if (before === key) return

  mirrored.set(state, key)

  // The first look of a session at an empty digest only matters if an earlier session left a non-empty file.
  if (before === undefined && block === '') {
    const stat = await host.fs.stat(`${root(state)}/${DIGEST_FILE}`).catch(() => undefined)

    if (stat === undefined) return
  }

  // A failed write is tried again on the next tick.
  if ((await mirrorDigest(state, host)) !== null) mirrored.delete(state)
}

/** Files changed in the project: uncommitted work, and commits since the mission began. Read-only git. */
export async function changedFiles(host: Pick<Host, 'run'>, cwd: string, sinceMs: number): Promise<string[]> {
  const out = new Set<string>()
  const status = await host.run(['git', '-C', cwd, 'status', '--porcelain'], 15_000).catch(() => null)

  for (const line of (status?.stdout ?? '').split('\n')) {
    const path = line.slice(3).split(' -> ').pop()?.trim().replace(/^"|"$/g, '')

    if (path !== undefined && path !== '') out.add(path)
  }

  const log = await host.run(['git', '-C', cwd, 'log', `--since=${new Date(Math.max(0, sinceMs)).toISOString()}`, '--name-only', '--pretty=format:'], 15_000).catch(() => null)

  for (const line of (log?.stdout ?? '').split('\n')) if (line.trim() !== '') out.add(line.trim())

  return [...out].slice(0, 400)
}

/** The scope check for the active mission: a warning per accepted ADR whose paths a changed file falls under. Recorded as mission evidence; blocks nothing. */
export async function scopeCheck(state: State, host: Pick<Host, 'run' | 'invalidate'>): Promise<string[]> {
  const mission = activeMission(state)

  if (mission === null) return ['no active mission']

  const docs = attachedDocs(state, mission)
  const report = checkScope(docs.length === 0 ? [] : await changedFiles(host, state.cwd, mission.createdAtMs), docs)
  const lines = reportLines(report)

  adrOf(state).scope = report
  if (docs.length > 0) record(mission, { type: 'adr.scope', note: plain(lines.join(' | '), 400) })
  host.invalidate()

  return lines
}

/** A draft record for the active mission, as a proposeSpec: only the mission's own words; a person writes the decision. */
export function draftSpec(state: State, host: Pick<Host, 'fs' | 'run' | 'invalidate' | 'toast'>, today: string): ActionSpec | null {
  const mission = activeMission(state)

  if (mission === null) return null

  const finished = mission.events.filter(event => event.type === 'task.complete' || event.status === 'done')
  const results = new Map<string, string>(finished.flatMap(event => (event.taskId !== undefined && event.note !== undefined ? [[event.taskId, event.note] as [string, string]] : [])))
  const draft = draftFromMission({ objective: mission.objective, tasks: mission.tasks.map(task => ({ title: task.title, ...(results.has(task.id) && { result: results.get(task.id) as string }) })) }, attachedDocs(state, mission).flatMap(doc => doc.scope.slice(0, 2)), today)

  const spec = proposeSpec(state, host, draft.title, today, { ...(draft.context !== undefined && { context: draft.context }), ...(draft.decision !== undefined && { decision: draft.decision }), scope: draft.scope ?? [] })

  // A title is one line; an objective can be a paragraph. When it was shortened, the confirm says so and by how much (ADR-481).
  if (spec === null || draft.titleShortenedFrom === undefined) return spec

  const said = `The title was shortened from the mission's objective: ${draft.titleShortenedFrom} → ${Array.from(draft.title).length} characters; the full objective is in the record's Context.`

  return { ...spec, note: `${said} ${spec.note ?? ''}`.trim() }
}
