/**
 * Workflow runs as Claude Code writes them, and the ruflo swarm in the same shape (ADR-458). Pure: every function here
 * takes text or records and returns records; `data/workflows-read.ts` is the only part that touches the disk.
 *
 * What a run directory holds (schemas read from real runs, Claude Code 2.1.x):
 *   <session>/subagents/workflows/<runId>/journal.jsonl            {type:'launched'} | {type:'started',key,agentId,label,phase} | {type:'result',key,agentId,result}
 *   <session>/subagents/workflows/<runId>/agent-<id>.meta.json     {description, workflowPhase, spawnedWithWorktree?, worktreePath?, agentType}
 *   <session>/subagents/workflows/<runId>/agent-<id>.jsonl         transcript lines; assistant lines carry message.{id,model,usage}, every line a timestamp
 *   <session>/workflows/<runId>.json                               written when the run ends: {status, phases, durationMs, startTime, workflowProgress[]}
 *   <session>/workflows/scripts/<name>-<runId>.js                  the script, whose `meta.phases` names the phases (live runs have no .json yet)
 * Unknown event types and keys are ignored, a half-written last line is dropped, and a missing source is a missing fact:
 * nothing here is estimated.
 */
import { ESCAPES, HIDDEN, INVISIBLE, shortId, type AgentRecord } from './parse'

export type AgentState = 'running' | 'done' | 'failed' | 'stale' | 'idle' | 'queued'

export type WfAgent = {
  id: string
  label: string
  phase: string
  state: AgentState
  model?: string
  hasWorktree: boolean
  worktreePath?: string
  /** Context tokens of the agent's latest request (the figure Claude Code's panel shows); a tail-read transcript makes it a floor. */
  tokens?: number
  isTokensPartial?: boolean
  startedMs?: number
  /** For a running agent the time since it started; for a finished one the span of its transcript or the run record's own figure. */
  elapsedMs?: number
  /** The transcript to open (workflow agents), or the agent's id (ruflo agents). */
  transcriptPath?: string
  resultPreview?: string
  toolCalls?: number
  lastTool?: string
  /** Set for a ruflo agent: what the confirm-gated verbs act on. */
  ruflo?: AgentRecord
}

export type WfPhase = { title: string; detail?: string; agents: WfAgent[]; done: number; total: number; running: number; failed: number }

export type RunState = 'running' | 'completed' | 'failed' | 'stalled' | 'finished' | 'active'

export type WfRun = {
  id: string
  name: string
  kind: 'workflow' | 'ruflo-swarm'
  state: RunState
  phases: WfPhase[]
  running: number
  done: number
  failed: number
  idle: number
  total: number
  /** Sum of the agents whose tokens are known; null when none is. */
  totalTokens: number | null
  isTokensPartial: boolean
  startedMs?: number
  durationMs?: number
  dir?: string
  /** True where the run record's `workflowProgress` gave the figures (a finished run), false where they were derived from journal and transcripts. */
  hasRecord: boolean
  /** A ruflo swarm run only (data/wf-swarm.ts): when its record was last written, whether a "running" one has gone stale, how many ids it lists. */
  updatedMs?: number
  isStale?: boolean
  listed?: number
}

const asRecord = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null)
/** Escape sequences go whole (an OSC title or a hyperlink would otherwise leave its text behind), then control, zero-width and bidi-override characters (they reorder or hide text) become spaces: every string a file supplies passes here. */
const CONTROL = HIDDEN
export const str = (value: unknown, max = 200): string | undefined => {
  const clean = typeof value === 'string' ? value.replace(ESCAPES, '').replace(INVISIBLE, '').replace(CONTROL, ' ').slice(0, max) : ''

  return clean === '' ? undefined : clean
}

/** A result preview is agent output: anything shaped like a credential is masked before it is kept or drawn. */
const SECRETISH = new RegExp(
  [
    // Vendor prefixes with a long tail (sk-ant-..., ghp_..., xoxb-..., AKIA..., AIza...), and the ones that need a separator so a plain word cannot match.
    String.raw`\b(?:sk|pk|ghp|gho|ghs|github_pat|xox[abprs]|xapp|AKIA|ASIA|AIza)[-_A-Za-z0-9]{12,}`,
    String.raw`\b(?:glpat|npm|hf|dop_v1|shpat|whsec|rk_live|sk_live|ya29)[-_.][-_.A-Za-z0-9]{12,}`,
    String.raw`\bBearer\s+\S{8,}`,
    // A JSON web token: three dot-separated base64url parts, the first starting eyJ.
    String.raw`\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.?[A-Za-z0-9_-]*`,
    // A long unbroken run of key-alphabet characters.
    String.raw`\b[A-Za-z0-9+_-]{32,}={0,2}`,
    // A private key block (whole when it ends in the text, else from its header to the end), and user:password@ in a URL.
    String.raw`-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)`,
    String.raw`\b[a-z][a-z0-9+.-]*://[^\s/:@]+:[^\s/@]+@`,
    // key=value, "key": "value", Authorization: Bearer x, --token x. The key may be quoted; the value may be a quoted string or follow Bearer/Basic/Token.
    String.raw`(?:key|token|secret|passw(?:or)?d|pwd|passphrase|credential|authorization)["']?\s*[=:]\s*(?:(?:Bearer|Basic|Token)\s+)?(?:"[^"]*"|'[^']*'|\S+)`,
    String.raw`(?<![A-Za-z0-9])pass["']?\s*=\s*(?:"[^"]*"|'[^']*'|\S+)`,
    String.raw`(?:^|\s)--?(?:token|password|passwd|pwd|secret|api-?key|auth(?:orization)?|access-?key|client-?secret)(?:=|\s+)\S+`,
  ].join('|'),
  'gi',
)
export const maskSecrets = (text: string): string => text.replace(SECRETISH, '‹masked›')
export const num = (value: unknown): number | undefined => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)

/** A line longer than this is not read (ADR-473): the engine refuses files over 4 MiB and the console reads 3 MB whole, so no real line is this long, and the cap bounds what a half-written line can hold. */
export const LINE_CAP = 3_000_000

/** JSONL as records: a line that does not parse (a half-written tail) is dropped, never thrown on. */
export function jsonLines(text: string | null): Record<string, unknown>[] {
  if (text === null) return []

  const out: Record<string, unknown>[] = []

  for (const line of text.split('\n')) {
    if (line.length < 2 || line.length > LINE_CAP || line[0] !== '{') continue

    try {
      const record = asRecord(JSON.parse(line))

      if (record !== null) out.push(record)
    } catch {
      /* a partial line */
    }
  }

  return out
}

export type JournalAgent = { agentId: string; label: string; phase?: string; hasResult: boolean; resultPreview?: string }

/** The agents a journal names, in launch order, with whether each has reported a result. Events of any other type are ignored. */
export function parseJournal(text: string | null): { isLaunched: boolean; agents: JournalAgent[] } {
  const byId = new Map<string, JournalAgent>()
  let isLaunched = false

  for (const event of jsonLines(text)) {
    const id = str(event.agentId, 80)

    if (event.type === 'launched') isLaunched = true
    else if (event.type === 'started' && id !== undefined) {
      const phase = str(event.phase, 80)

      byId.set(id, { agentId: id, label: str(event.label, 80) ?? id, hasResult: false, ...(phase !== undefined && { phase }) })
    } else if (event.type === 'result' && id !== undefined) {
      const held = byId.get(id) ?? { agentId: id, label: id, hasResult: false }
      const preview = typeof event.result === 'string' ? maskSecrets(event.result.replace(ESCAPES, '').replace(INVISIBLE, '').replace(CONTROL, ' ').replace(/\s+/g, ' ')).slice(0, 160) : asRecord(event.result) !== null ? `structured result (${Object.keys(event.result as object).length} fields)` : undefined

      byId.set(id, { ...held, hasResult: true, ...(preview !== undefined && preview !== '' && { resultPreview: preview }) })
    }
  }

  return { isLaunched, agents: [...byId.values()] }
}

export type AgentMeta = { description?: string; phase?: string; hasWorktree: boolean; worktreePath?: string; agentType?: string }

export function parseAgentMeta(text: string | null): AgentMeta {
  let record: Record<string, unknown> | null = null

  try {
    record = text === null ? null : asRecord(JSON.parse(text))
  } catch {
    record = null
  }

  const description = str(record?.description, 80)
  const phase = str(record?.workflowPhase, 80)
  const worktreePath = str(record?.worktreePath, 300)
  const agentType = str(record?.agentType, 60)

  return { hasWorktree: record?.spawnedWithWorktree === true, ...(description !== undefined && { description }), ...(phase !== undefined && { phase }), ...(worktreePath !== undefined && { worktreePath }), ...(agentType !== undefined && { agentType }) }
}

export type TranscriptFacts = { model?: string; tokens?: number; firstMs?: number; lastMs?: number; toolCalls: number; lastTool?: string; messages: number }

/**
 * What a transcript says: the model of its last answer, the context tokens of its latest request (input + cache read + cache
 * write + output, each request counted once however many lines streamed it), the first and last timestamps, and tool calls.
 * `isTail` says the text begins mid-file: the first line is dropped and the first timestamp is then not the start.
 */
export function parseTranscript(text: string | null, isTail = false): TranscriptFacts {
  const lines = jsonLines(isTail && text !== null ? text.slice(text.indexOf('\n') + 1) : text)
  const usage = new Map<string, number>()
  let model: string | undefined
  let firstMs: number | undefined
  let lastMs: number | undefined
  let lastKey: string | undefined
  let toolCalls = 0
  let lastTool: string | undefined

  for (const [index, line] of lines.entries()) {
    const at = typeof line.timestamp === 'string' ? Date.parse(line.timestamp) : Number.NaN

    if (Number.isFinite(at)) {
      firstMs ??= at
      lastMs = at
    }

    const message = asRecord(line.message)

    if (line.type !== 'assistant' || message === null) continue

    const u = asRecord(message.usage)
    const key = str(message.id, 80) ?? `line-${index}`

    if (u !== null) {
      usage.set(key, (num(u.input_tokens) ?? 0) + (num(u.cache_creation_input_tokens) ?? 0) + (num(u.cache_read_input_tokens) ?? 0) + (num(u.output_tokens) ?? 0))
      lastKey = key
    }

    model = str(message.model, 60) ?? model

    // A streamed message repeats its content blocks: count a tool_use by its id.
    if (Array.isArray(message.content)) {
      for (const block of message.content) {
        const b = asRecord(block)

        if (b?.type === 'tool_use') {
          toolCalls += 1
          lastTool = str(b.name, 40) ?? lastTool
        }
      }
    }
  }

  const tokens = lastKey === undefined ? undefined : usage.get(lastKey)

  return { toolCalls, messages: usage.size, ...(model !== undefined && { model }), ...(tokens !== undefined && { tokens }), ...(firstMs !== undefined && { firstMs }), ...(lastMs !== undefined && { lastMs }), ...(lastTool !== undefined && { lastTool }) }
}

export type RunRecordAgent = { agentId: string; label?: string; phase?: string; model?: string; state?: string; startedMs?: number; tokens?: number; durationMs?: number; toolCalls?: number; lastTool?: string }
export type RunRecord = { name?: string; status?: string; phases: { title: string; detail?: string }[]; startedMs?: number; durationMs?: number; totalTokens?: number; defaultModel?: string; agents: RunRecordAgent[] }

/** `<session>/workflows/<runId>.json`: the finished run's own account of its phases and agents. */
export function parseRunRecord(text: string | null): RunRecord | null {
  let record: Record<string, unknown> | null = null

  try {
    record = text === null ? null : asRecord(JSON.parse(text))
  } catch {
    return null
  }

  if (record === null) return null

  const phases = (Array.isArray(record.phases) ? record.phases : []).flatMap(entry => {
    const p = asRecord(entry)
    const title = str(p?.title, 60)
    const detail = str(p?.detail, 100)

    return title === undefined ? [] : [{ title, ...(detail !== undefined && { detail }) }]
  })
  const agents = (Array.isArray(record.workflowProgress) ? record.workflowProgress : []).flatMap(entry => {
    const a = asRecord(entry)
    const agentId = str(a?.agentId, 80)

    if (a === null || a.type !== 'workflow_agent' || agentId === undefined) return []

    const label = str(a.label, 80)
    const phase = str(a.phaseTitle, 80)
    const model = str(a.model, 60)
    const state = str(a.state, 20)
    const startedMs = num(a.startedAt)
    const tokens = num(a.tokens)
    const durationMs = num(a.durationMs)
    const toolCalls = num(a.toolCalls)
    const lastTool = str(a.lastToolName, 40)

    return [{ agentId, ...(label !== undefined && { label }), ...(phase !== undefined && { phase }), ...(model !== undefined && { model }), ...(state !== undefined && { state }), ...(startedMs !== undefined && { startedMs }), ...(tokens !== undefined && { tokens }), ...(durationMs !== undefined && { durationMs }), ...(toolCalls !== undefined && { toolCalls }), ...(lastTool !== undefined && { lastTool })}]
  })
  const name = str(record.workflowName, 80)
  const status = str(record.status, 30)
  const startedMs = num(record.startTime)
  const durationMs = num(record.durationMs)
  const totalTokens = num(record.totalTokens)
  const defaultModel = str(record.defaultModel, 60)

  return { phases, agents, ...(name !== undefined && { name }), ...(status !== undefined && { status }), ...(startedMs !== undefined && { startedMs }), ...(durationMs !== undefined && { durationMs }), ...(totalTokens !== undefined && { totalTokens }), ...(defaultModel !== undefined && { defaultModel }) }
}

/** `meta = { name, phases: [{ title }, …] }` out of a workflow script's text, read as text (the script is never run). */
export function parseScriptMeta(text: string | null): { name?: string; phases: { title: string; detail?: string }[] } {
  const head = text?.slice(0, 6000) ?? ''
  const name = /\bname:\s*['"`]([^'"`\n]{1,80})['"`]/.exec(head)?.[1]
  const block = /\bphases:\s*\[([\s\S]*?)\]\s*,?\s*\n?\s*\}/.exec(head)?.[1] ?? ''
  const phases = [...block.matchAll(/title:\s*['"`]([^'"`\n]{1,60})['"`](?:\s*,\s*detail:\s*['"`]([^'"`\n]{1,100})['"`])?/g)].map(match => ({ title: match[1] as string, ...(match[2] !== undefined && { detail: match[2] }) }))

  return { phases, ...(name !== undefined && { name }) }
}

/** An agent with no result and no sign of life this long is shown as stale, not running: a crashed run leaves the same files. */
export const STALE_MS = 15 * 60_000

export type RunInput = {
  id: string
  dir?: string
  journal: string | null
  /** agentId → meta file text, transcript text (and whether it is a tail), and its path. */
  agents: ReadonlyMap<string, { meta: string | null; transcript: string | null; isTail: boolean; path: string; /** What `parseTranscript` already made of this very text, where the reader kept it. */ facts?: TranscriptFacts }>
  record: string | null
  script: string | null
  nowMs: number
  /** The newest mtime among the run's files: what "no sign of life" is measured from when a transcript is unread. */
  lastActivityMs?: number
}

const STATE_OF_RECORD: Record<string, AgentState> = { done: 'done', completed: 'done', running: 'running', queued: 'queued', failed: 'failed', error: 'failed', errored: 'failed' }

/** One run, merged from every source it has: the record where it exists, else the journal, metas and transcripts. */
export function buildRun(input: RunInput): WfRun {
  const journal = parseJournal(input.journal)
  const record = parseRunRecord(input.record)
  const script = parseScriptMeta(input.script)
  const ids = [...new Set([...journal.agents.map(a => a.agentId), ...(record?.agents.map(a => a.agentId) ?? [])])]
  const fromJournal = new Map(journal.agents.map(a => [a.agentId, a]))
  const fromRecord = new Map((record?.agents ?? []).map(a => [a.agentId, a]))

  const agents: WfAgent[] = ids.map(id => {
    const j = fromJournal.get(id)
    const r = fromRecord.get(id)
    const source = input.agents.get(id)
    const meta = parseAgentMeta(source?.meta ?? null)
    const facts = source === undefined ? null : (source.facts ?? parseTranscript(source.transcript, source.isTail))
    const startedMs = r?.startedMs ?? (source?.isTail === true ? undefined : facts?.firstMs)
    const lastSeen = facts?.lastMs ?? input.lastActivityMs
    const hasResult = j?.hasResult === true
    const recorded = r?.state === undefined ? undefined : STATE_OF_RECORD[r.state.toLowerCase()]
    const state: AgentState = recorded ?? (hasResult ? 'done' : lastSeen !== undefined && input.nowMs - lastSeen > STALE_MS ? 'stale' : j === undefined ? 'queued' : 'running')
    const elapsedMs = r?.durationMs ?? (startedMs === undefined ? undefined : Math.max(0, (state === 'running' ? input.nowMs : (facts?.lastMs ?? input.nowMs)) - startedMs))
    const tokens = r?.tokens ?? facts?.tokens
    const model = r?.model ?? facts?.model ?? record?.defaultModel
    const phase = r?.phase ?? j?.phase ?? meta.phase ?? '—'
    const label = r?.label ?? j?.label ?? meta.description ?? id
    const resultPreview = j?.resultPreview
    const toolCalls = r?.toolCalls ?? (facts !== null && facts.toolCalls > 0 ? facts.toolCalls : undefined)
    const lastTool = r?.lastTool ?? facts?.lastTool

    return {
      id,
      label,
      phase,
      state,
      hasWorktree: meta.hasWorktree,
      ...(model !== undefined && { model }),
      ...(meta.worktreePath !== undefined && { worktreePath: meta.worktreePath }),
      ...(tokens !== undefined && { tokens }),
      ...(r?.tokens === undefined && tokens !== undefined && source?.isTail === true && { isTokensPartial: true }),
      ...(startedMs !== undefined && { startedMs }),
      ...(elapsedMs !== undefined && { elapsedMs }),
      ...(source !== undefined && { transcriptPath: source.path }),
      ...(resultPreview !== undefined && { resultPreview }),
      ...(toolCalls !== undefined && { toolCalls }),
      ...(lastTool !== undefined && { lastTool }),
    }
  })

  const declared = record?.phases.length ? record.phases : script.phases
  const phases = groupPhases(agents, declared)
  const counts = tally(agents)
  const known = agents.filter(agent => agent.tokens !== undefined)
  const sum = known.reduce((total, agent) => total + (agent.tokens ?? 0), 0)
  const status = record?.status?.toLowerCase()
  const state: RunState = status === undefined ? (counts.running > 0 ? 'running' : counts.stale > 0 ? 'stalled' : counts.failed > 0 ? 'failed' : 'finished') : /fail|error/.test(status) ? 'failed' : /complete|done|success/.test(status) ? 'completed' : counts.running > 0 ? 'running' : 'finished'
  const startedMs = record?.startedMs ?? agents.reduce<number | undefined>((least, agent) => (agent.startedMs === undefined ? least : least === undefined ? agent.startedMs : Math.min(least, agent.startedMs)), undefined)

  return {
    id: input.id,
    name: record?.name ?? script.name ?? input.id,
    kind: 'workflow',
    state,
    phases,
    running: counts.running,
    done: counts.done,
    failed: counts.failed,
    idle: 0,
    total: agents.length,
    // Where the record states a total it is the one to show: it counts agents whose files are gone.
    totalTokens: record?.totalTokens ?? (known.length === 0 ? null : sum),
    isTokensPartial: record?.totalTokens === undefined && agents.some(agent => agent.isTokensPartial === true || agent.tokens === undefined),
    ...(startedMs !== undefined && { startedMs }),
    ...(record?.durationMs !== undefined ? { durationMs: record.durationMs } : startedMs !== undefined ? { durationMs: Math.max(0, (state === 'running' ? input.nowMs : lastEnd(agents, startedMs)) - startedMs) } : {}),
    ...(input.dir !== undefined && { dir: input.dir }),
    hasRecord: record !== null,
  }
}

const lastEnd = (agents: readonly WfAgent[], fallback: number): number => agents.reduce((latest, agent) => (agent.startedMs !== undefined && agent.elapsedMs !== undefined ? Math.max(latest, agent.startedMs + agent.elapsedMs) : latest), fallback)

export function tally(agents: readonly WfAgent[]): Record<AgentState, number> {
  const counts: Record<AgentState, number> = { running: 0, done: 0, failed: 0, stale: 0, idle: 0, queued: 0 }

  for (const agent of agents) counts[agent.state] += 1

  return counts
}

/** Declared phases first, in the script's order; a phase an agent names that the script did not declare follows. */
export function groupPhases(agents: readonly WfAgent[], declared: readonly { title: string; detail?: string }[]): WfPhase[] {
  const titles = [...declared.map(phase => phase.title)]

  for (const agent of agents) if (!titles.includes(agent.phase)) titles.push(agent.phase)

  return titles.map(title => {
    const members = agents.filter(agent => agent.phase === title)
    const detail = declared.find(phase => phase.title === title)?.detail

    return { title, agents: members, done: members.filter(agent => agent.state === 'done').length, total: members.length, running: members.filter(agent => agent.state === 'running').length, failed: members.filter(agent => agent.state === 'failed').length, ...(detail !== undefined && { detail }) }
  })
}

/** The phase the run is in: the first with an agent running, else the first not finished; null when every phase is done. */
export function currentPhase(phases: readonly WfPhase[]): number | null {
  const running = phases.findIndex(phase => phase.running > 0)

  if (running >= 0) return running

  const open = phases.findIndex(phase => phase.done < phase.total)

  return open >= 0 ? open : null
}

/** 145.4k · 1.2M · 812 */
export function fmtTokens(tokens: number | undefined, isPartial = false): string {
  if (tokens === undefined) return 'n/a'

  const text = tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1)}M` : tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens)

  return `${isPartial ? '≥' : ''}${text}`
}

/** 15s · 3m12s · 1h05m · 68d06h (a day or more reads in days, as ago() does: never "1638h18m") */
export function fmtElapsed(ms: number | undefined): string {
  if (ms === undefined) return 'n/a'

  const s = Math.round(ms / 1000)

  if (s >= 86_400) return `${Math.floor(s / 86_400)}d${String(Math.floor((s % 86_400) / 3600)).padStart(2, '0')}h`

  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}m`
}

/** `claude-sonnet-5-5` → `Sonnet 5.5`; an unknown id is shown as it is. */
export function modelName(model: string | undefined): string {
  const match = model === undefined ? null : /^claude-(opus|sonnet|haiku)-(\d+)(?:-(\d+))?/.exec(model)

  return model === undefined ? 'n/a' : match === null ? model : `${(match[1] as string).replace(/^./, c => c.toUpperCase())} ${match[2]}${match[3] !== undefined && match[3].length <= 2 ? `.${match[3]}` : ''}`
}

export { shortId }
