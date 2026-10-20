/**
 * The disk half of the workflows view (ADR-458): finds the newest workflow runs of this project under Claude Code's
 * config directory and hands their text to `buildRun`. Read-only and bounded: at most MAX_RUNS runs, MAX_AGENTS agents
 * a run, and a transcript over TRANSCRIPT_CAP bytes is tail-read where the host can (`readTail`), else not read at all and
 * counted in `skipped`, so its tokens read n/a rather than a guess. A finished run's own record carries every figure, so
 * its transcripts are not read.
 */
import { readBounded, under, type ReadCache, type ReaderFs } from './files'
import { FactsIncr } from './wf-incr'
import { beginWarm, warmActivity } from './wf-incr-store'
import { buildRun, type RunInput, type TranscriptFacts, type WfRun } from './workflows'

/** The engine refuses files over 4 MiB; below this a transcript is read whole. */
export const TRANSCRIPT_CAP = 3_000_000
/** How much of an oversized transcript's end is read, where the host offers it. */
export const TAIL_BYTES = 400_000
export const MAX_RUNS = 6
export const MAX_AGENTS = 60
const MAX_SESSIONS = 30

export type WorkflowFs = ReaderFs & { readTail?: (path: string, bytes: number) => Promise<string> }

export type WorkflowRuns = { runs: WfRun[]; /** The project's folder under the config directory, or null where none is known. */ root: string | null; capBytes: number; /** Transcripts left unread for size, by path. */ skipped: string[]; /** How many runs the folders hold beyond those shown. */ more: number }

/** Claude Code's folder name for a project: every character that is not a letter or digit becomes `-`. */
export const slugOf = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-')

/**
 * What each transcript parsed to, by path. A refresh re-reads every run on a timer; JSON.parse of the same unchanged transcripts was the whole
 * cost of it (bench-swarmui.mjs: ~170 ms of ~170 ms at 6 runs x 60 agents), and of a transcript that grew, the parse of the lines it already had.
 * Each path keeps its parse state (data/wf-incr.ts): an unchanged text is the held answer, an appended one is parsed from the end of the old
 * one (ADR-473), anything else is parsed whole. Bounded, oldest out.
 */
const PARSED_MAX = MAX_RUNS * MAX_AGENTS * 2
const parsed = new Map<string, FactsIncr>()

function factsOf(path: string, text: string, isTail: boolean, tag = ''): TranscriptFacts {
  const state = parsed.get(path) ?? new FactsIncr()

  parsed.delete(path)
  parsed.set(path, state)

  if (parsed.size > PARSED_MAX) parsed.delete(parsed.keys().next().value as string)

  return state.update(text, isTail, tag).value
}

/**
 * What a tail-read transcript parsed to, by path, with the size and mtime the folder listing gave for the file. A transcript over the cap is
 * tail-read, and a refresh used to read 400 KB again from every one of them (360 agents: ~144 MB a tick) only to find the same text. While the
 * listing's size and mtime are unchanged the file is unchanged, as the read cache already assumes for whole files, so the facts are reused and the
 * read is skipped. The text itself is not kept (only the few figures parsed from it), and a listing with no mtime is never trusted.
 */
const tailFacts = new Map<string, { size: number; mtimeMs: number; facts: TranscriptFacts }>()

function rememberTail(path: string, size: number, mtimeMs: number | undefined, facts: TranscriptFacts): void {
  if (mtimeMs === undefined) return

  tailFacts.delete(path)
  tailFacts.set(path, { size, mtimeMs, facts })

  if (tailFacts.size > PARSED_MAX) tailFacts.delete(tailFacts.keys().next().value as string)
}

const safeList = (fs: ReaderFs, path: string) => fs.list(path).catch(() => [] as Awaited<ReturnType<ReaderFs['list']>>)

export async function readWorkflowRuns(fs: WorkflowFs, cache: ReadCache, options: { configDir: string | null; cwd: string; nowMs: number; maxRuns?: number }): Promise<WorkflowRuns> {
  const empty: WorkflowRuns = { runs: [], root: null, capBytes: TRANSCRIPT_CAP, skipped: [], more: 0 }

  if (options.configDir === null) return empty

  const root = under(options.configDir, `projects/${slugOf(options.cwd)}`)
  const sessions = (await safeList(fs, root)).filter(entry => /^[0-9a-f-]{36}$/.test(entry.name)).sort((a, b) => (b.mtimeMs ?? 0) - (a.mtimeMs ?? 0)).slice(0, MAX_SESSIONS)
  const found = (
    await Promise.all(sessions.map(async session => (await safeList(fs, under(root, `${session.name}/subagents/workflows`))).filter(entry => /^wf_[A-Za-z0-9-]{1,40}$/.test(entry.name)).map(entry => ({ session: session.name, id: entry.name, mtimeMs: entry.mtimeMs ?? 0 }))))
  )
    .flat()
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
  const chosen = found.slice(0, options.maxRuns ?? MAX_RUNS)
  const skipped: string[] = []

  const runs = await Promise.all(
    chosen.map(async ({ session, id }) => {
      const dir = under(root, `${session}/subagents/workflows/${id}`)
      const entries = await safeList(fs, dir)
      const text = async (path: string, max?: number) => (await readBounded(fs, cache, path, max, true)).text
      const record = await text(under(root, `${session}/workflows/${id}.json`), 6_000_000)
      const scripts = record === null ? await safeList(fs, under(root, `${session}/workflows/scripts`)) : []
      const scriptName = scripts.find(entry => entry.name.endsWith(`-${id}.js`))?.name
      const agentIds = [...new Set(entries.flatMap(entry => /^agent-([A-Za-z0-9]+)\.(?:meta\.json|jsonl)$/.exec(entry.name)?.[1] ?? []))].slice(0, MAX_AGENTS)
      const agents: RunInput['agents'] = new Map(
        await Promise.all(
          agentIds.map(async agentId => {
            const path = under(dir, `agent-${agentId}.jsonl`)
            const meta = await text(under(dir, `agent-${agentId}.meta.json`), 20_000)
            const listed = entries.find(entry => entry.name === `agent-${agentId}.jsonl`)
            const size = listed?.size ?? 0
            let transcript: string | null = null
            let isTail = false
            let kept: TranscriptFacts | undefined

            if (record === null && size > 0) {
              if (size <= TRANSCRIPT_CAP) transcript = await text(path, TRANSCRIPT_CAP)
              else if (fs.readTail !== undefined) {
                const held = listed?.mtimeMs === undefined ? undefined : tailFacts.get(path)

                if (held !== undefined && held.size === size && held.mtimeMs === listed?.mtimeMs) {
                  // Unchanged since the last read: its figures stand in for the text, which buildRun only ever turns into these.
                  kept = held.facts
                  transcript = ''
                  isTail = true
                } else {
                  transcript = await fs.readTail(path, TAIL_BYTES).catch(() => null)
                  isTail = transcript !== null
                }
              }

              if (transcript === null) skipped.push(path)
            }

            const facts = kept ?? (transcript === null ? undefined : factsOf(path, transcript, isTail, isTail ? `${size}:${listed?.mtimeMs ?? 0}` : ``))

            if (kept === undefined && isTail && facts !== undefined) rememberTail(path, size, listed?.mtimeMs, facts)

            return [agentId, { meta, transcript, isTail, path, ...(facts !== undefined && { facts }) }] as const
          }),
        ),
      )
      const lastActivityMs = entries.reduce((latest, entry) => Math.max(latest, entry.mtimeMs ?? 0), 0)

      return buildRun({
        id,
        dir,
        journal: await text(under(dir, 'journal.jsonl'), 1_000_000),
        agents,
        record,
        script: scriptName === undefined ? null : await text(under(root, `${session}/workflows/scripts/${scriptName}`), 200_000),
        nowMs: options.nowMs,
        ...(lastActivityMs > 0 && { lastActivityMs }),
      })
    }),
  )

  warmAhead(runs, cache)

  return { runs, root, capBytes: TRANSCRIPT_CAP, skipped, more: Math.max(0, found.length - chosen.length) }
}

/**
 * Parses the transcripts this refresh read for the drill and its search before any frame asks (ADR-473), in the order the search walks them (live runs
 * first, then each run's phases and agents), so the search finds them parsed. A small allowance a refresh; a transcript already current costs nothing.
 */
function warmAhead(runs: readonly WfRun[], cache: ReadCache): void {
  beginWarm()

  for (const run of [...runs.filter(candidate => candidate.running > 0), ...runs.filter(candidate => candidate.running === 0)]) {
    for (const agent of run.phases.flatMap(phase => phase.agents)) {
      const held = agent.ruflo !== undefined || agent.transcriptPath === undefined ? undefined : cache.get(agent.transcriptPath)

      if (held !== undefined && 'text' in held && held.text !== '') warmActivity(agent.transcriptPath as string, held.text)
    }
  }
}
