/**
 * Search across the drill's levels (ADR-459): run names, phase titles, agent labels, tool calls, transcript text and, where the project
 * has them, mission tasks. Hits come grouped by level and each carries the exact place it jumps to. Pure, and it searches only text
 * already in memory: an agent whose transcript has not been read is counted as unread, never guessed at. The scan is capped
 * (SCAN_CHARS characters of transcript text in all, MAX_SHOWN hits a group) and the result says what was and was not looked at.
 * Snippets come from washed text (data/wf-activity), so a hit can never show what the washing masked.
 */
import { cleanLine, type CallEntry, type Parsed } from './wf-activity'
import type { Target } from './wf-trail'
import { currentPhase, type WfAgent, type WfRun } from './workflows'

export type HitLevel = 'run' | 'phase' | 'agent' | 'tool' | 'text' | 'mission'
export const HIT_ORDER: readonly HitLevel[] = ['run', 'phase', 'agent', 'tool', 'text', 'mission']
export const HIT_NAME: Record<HitLevel, string> = { run: 'Runs', phase: 'Phases', agent: 'Agents', tool: 'Tool calls', text: 'Transcript text', mission: 'Mission tasks' }

export const MIN_QUERY = 2
export const MAX_QUERY = 20_000
export const MAX_SHOWN = 6
/** Characters of transcript text looked through in one search, across all agents. */
export const SCAN_CHARS = 8_000_000

export type Hit = { level: HitLevel; title: string; detail: string; /** Where Enter goes; absent for a mission task, which lives on the Missions page. */ target?: Target }

export type MissionTaskRef = { mission: string; id: string; title: string; status: string }

export type SearchInput = {
  runs: readonly WfRun[]
  /** The transcript of an agent as already parsed, or null where it has not been read. */
  parsed: (agent: WfAgent) => Parsed | null
  /**
   * Whether the agent's transcript is in memory, WITHOUT parsing it. Once the scan cap stops the scan the remaining agents are only counted, and
   * counting must not cost a parse of each (a search over 360 large transcripts parsed all 360 to print two numbers). Absent: `parsed` is asked.
   */
  isHeld?: (agent: WfAgent) => boolean
  tasks?: readonly MissionTaskRef[]
}

export type SearchResult = {
  query: string
  /** False for a query too short to search: nothing was looked at. */
  isSearched: boolean
  groups: Record<HitLevel, Hit[]>
  /** Matches found per level, including those past MAX_SHOWN. */
  counts: Record<HitLevel, number>
  /** Agents with a transcript (workflow agents) that was searched / was not in memory. */
  scanned: number
  unread: number
  chars: number
  /** True where the character cap stopped the scan. */
  isCapped: boolean
}

const empty = (query: string, isSearched: boolean): SearchResult => ({ query, isSearched, groups: { run: [], phase: [], agent: [], tool: [], text: [], mission: [] }, counts: { run: 0, phase: 0, agent: 0, tool: 0, text: 0, mission: 0 }, scanned: 0, unread: 0, chars: 0, isCapped: false })

/** A short stretch of `text` around the first match, as one washed line. */
function snippet(text: string, at: number, needle: number): string {
  const from = Math.max(0, at - 40)
  const body = cleanLine(text.slice(from, at + needle + 60), 110)

  return `${from > 0 ? '…' : ''}${body}`
}

export function search(input: SearchInput, query: string): SearchResult {
  const wanted = query.trim().slice(0, MAX_QUERY)
  const needle = wanted.toLowerCase()

  if (needle.length < MIN_QUERY) return empty(wanted, false)

  const out = empty(wanted, true)
  const add = (hit: Hit): void => {
    out.counts[hit.level] += 1

    if (out.groups[hit.level].length < MAX_SHOWN) out.groups[hit.level].push(hit)
  }
  const at = (text: string | undefined): number => (text === undefined ? -1 : text.toLowerCase().indexOf(needle))

  for (const [r, run] of input.runs.entries()) {
    if (at(run.name) >= 0 || at(run.id) >= 0) add({ level: 'run', title: run.name, detail: `${run.kind === 'workflow' ? 'workflow' : 'ruflo swarm'} · ${run.state} · ${run.total} agents`, target: { run: r, phase: currentPhase(run.phases) ?? 0, agent: -1 } })

    for (const [p, phase] of run.phases.entries()) {
      if (at(phase.title) >= 0 || at(phase.detail) >= 0) add({ level: 'phase', title: phase.title, detail: `${run.name} · ${phase.done}/${phase.total} done`, target: { run: r, phase: p, agent: -1 } })

      for (const [a, agent] of phase.agents.entries()) {
        const place = { run: r, phase: p, agent: a }
        const field = [agent.label, agent.resultPreview, agent.lastTool, agent.model, agent.id].find(value => at(value) >= 0)

        if (field !== undefined) add({ level: 'agent', title: agent.label, detail: `${run.name} · ${phase.title}${field === agent.label ? '' : ` · ${snippet(field, at(field), needle.length)}`}`, target: place })

        if (agent.ruflo !== undefined) continue

        if (out.isCapped && input.isHeld !== undefined) {
          if (input.isHeld(agent)) out.scanned += 1
          else if (agent.transcriptPath !== undefined) out.unread += 1

          continue
        }

        const parsed = input.parsed(agent)

        if (parsed === null) {
          if (agent.transcriptPath !== undefined) out.unread += 1
          continue
        }

        out.scanned += 1

        if (out.isCapped) continue

        for (const entry of parsed.entries) {
          if (out.chars > SCAN_CHARS) {
            out.isCapped = true
            break
          }

          if (entry.kind === 'call') {
            out.chars += entry.input.text.length + (entry.output?.text.length ?? 0)

            const call: CallEntry = entry
            const hay = `${call.tool} ${call.summary} ${call.input.text}`
            const i = at(hay)

            if (i >= 0) add({ level: 'tool', title: `${call.tool} ${call.summary}`.trim(), detail: `${agent.label} · call #${call.callIndex + 1} · ${call.status}`, target: { ...place, sub: 'activity', call: call.callIndex } })

            const o = at(call.output?.text)

            if (call.output !== null && o >= 0) add({ level: 'text', title: snippet(call.output.text, o, needle.length), detail: `${agent.label} · output of ${call.tool}`, target: { ...place, sub: 'log', line: call.index } })
          } else {
            out.chars += entry.body.text.length

            const i = at(entry.body.text)

            if (i >= 0) add({ level: 'text', title: snippet(entry.body.text, i, needle.length), detail: `${agent.label} · ${entry.role}`, target: { ...place, sub: 'log', line: entry.index } })
          }
        }
      }
    }
  }

  for (const task of input.tasks ?? []) {
    if (at(task.title) >= 0 || at(task.id) >= 0) add({ level: 'mission', title: cleanLine(task.title, 100), detail: `${cleanLine(task.mission, 40)} · ${cleanLine(task.status, 20)} · on the Missions page` })
  }

  return out
}

/** Every hit in the order the page lists them: by level, then as found. */
export const flatHits = (result: SearchResult): Hit[] => HIT_ORDER.flatMap(level => result.groups[level])
