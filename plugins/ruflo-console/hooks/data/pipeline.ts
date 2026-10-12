/**
 * The learning pipeline and the router's last route as data (ADR-455). Pure: nothing here reads a file or draws; the view
 * hands in what the Learning page already reads. Staleness is a clock rule on a source's own timestamp, never a guess.
 */

/** A stage is stale when the file behind it has had nothing new for this long (the same day the Router block already flags). */
export const STALE_AFTER_MS = 24 * 3_600_000

export type StageState = 'live' | 'stale' | 'absent'

export type PipeStage = { name: string; count: number | null; /** When the source last gained something; null where nothing timestamps it. */ atMs: number | null; state: StageState; ageMs: number | null }

/**
 * `absent`: nothing measures the stage (no count). `stale`: it has a timestamp older than STALE_AFTER_MS. Otherwise `live`,
 * which includes a count with no timestamp (CONSOLIDATE): an unknown age is never read as old.
 */
export function stageStateOf(count: number | null, atMs: number | null, nowMs: number): { state: StageState; ageMs: number | null } {
  if (count === null) return { state: 'absent', ageMs: null }
  if (atMs === null || !Number.isFinite(atMs)) return { state: 'live', ageMs: null }

  const ageMs = Math.max(0, nowMs - atMs)

  return { state: ageMs > STALE_AFTER_MS ? 'stale' : 'live', ageMs }
}

/** The stages with their state; `atMs` maps a stage name to its source's last-change time where one exists. */
export function pipeStagesOf(stages: readonly { name: string; count: number | null }[], atMs: Readonly<Record<string, number | null | undefined>>, nowMs: number): PipeStage[] {
  return stages.map(stage => {
    const at = atMs[stage.name] ?? null

    return { name: stage.name, count: stage.count, atMs: at, ...stageStateOf(stage.count, at, nowMs) }
  })
}

/** A short age: 40s, 12m, 3h, 8d. */
export function ageWords(ageMs: number): string {
  const s = Math.round(ageMs / 1000)

  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86_400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86_400)}d`
}

/** What a stage's note line says under its count. */
export function stageNote(stage: PipeStage): string {
  if (stage.state === 'absent') return 'no data'
  if (stage.ageMs === null) return 'age n/a'

  return stage.state === 'stale' ? `stale ${ageWords(stage.ageMs)}` : `${ageWords(stage.ageMs)} ago`
}

/** The route picture draws at most this many candidates, so the parser stops here: a long route query costs the same as a short one. */
export const MAX_CANDIDATES = 5

export type RouteOwner = 'mods' | 'classic' | 'unseated'
export type RouteCandidate = { agent: string; /** 0..1, or null where the router printed none. */ confidence: number | null }
export type RouteSource = 'mods' | 'router-query' | 'none'

export type RouteModel = { owner: RouteOwner; source: RouteSource; candidates: RouteCandidate[]; /** Whether a keyword matched (the in-process pick only). */ matched: boolean | null; reason: string | null; asked: string | null }

/** Who routes in this project: the classic hook-handler, the mod, or nobody known (ruflo-mods not seated). */
export const routeOwnerOf = (seated: boolean, classicOwnsRoute: boolean): RouteOwner => (!seated ? 'unseated' : classicOwnsRoute ? 'classic' : 'mods')

/** The router's text is untrusted: control characters never reach a cell. */
// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '')
const clamp01 = (value: number): number => (Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0)
const percent = (text: string | undefined): number | null => (text === undefined ? null : clamp01(Number(text) / 100))

/**
 * The router's answer as the Learning Lab prints it (`nn-route`, from `hooks route --format json`): `→ agent · 87% · method`,
 * then one `  or agent · 12%` line per runner-up. Anything that does not start that way yields no candidates.
 */
export function candidatesFromLines(lines: readonly string[]): RouteCandidate[] {
  const first = /^→ (\S+)(?: · (\d{1,3})%)?/.exec(lines[0] ?? '')

  if (first === null) return []

  const out: RouteCandidate[] = [{ agent: plain(first[1] as string), confidence: percent(first[2]) }]

  for (let i = 1; i < lines.length && out.length < MAX_CANDIDATES; i++) {
    const line = lines[i] as string
    const alt = /^\s+or (\S+)(?: · (\d{1,3})%)?/.exec(line)

    if (alt !== null) out.push({ agent: plain(alt[1] as string), confidence: percent(alt[2]) })
  }

  return out
}

/**
 * The last route. A route the person asked for in the Lab (`nn-route`) carries the runner-ups, so it wins when there is one;
 * otherwise the mod's last in-process pick, which stores only the winner. Neither: an honest empty model.
 */
export function routeModelOf(input: {
  seated: boolean
  classicOwnsRoute: boolean
  route: { agent: string; confidence: number; matched: boolean; reason: string } | null
  lab: { id: string; label: string; lines: readonly string[] } | null
}): RouteModel {
  const owner = routeOwnerOf(input.seated, input.classicOwnsRoute)
  const asked = input.lab?.id === 'nn-route' ? candidatesFromLines(input.lab.lines) : []

  if (input.lab !== null && asked.length > 0) return { owner, source: 'router-query', candidates: asked, matched: null, reason: null, asked: plain(input.lab.label) }
  if (input.route !== null) return { owner, source: 'mods', candidates: [{ agent: input.route.agent, confidence: clamp01(input.route.confidence) }], matched: input.route.matched, reason: input.route.reason, asked: null }

  return { owner, source: 'none', candidates: [], matched: null, reason: null, asked: null }
}
