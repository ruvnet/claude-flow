/**
 * The `codex` adapter (ADR-486): rollouts Codex keeps as `<codex dir>/sessions/YYYY/MM/DD/rollout-<time>-<session id>.jsonl`, lines of
 * `{timestamp, type, payload}`. Verified here: `session_meta` (id, cwd), `turn_context` (cwd), `event_msg` task_started / task_complete
 * (last_agent_message) / turn_aborted (reason), and `response_item` function_call / custom_tool_call with their `_output` by call_id.
 * Not seen in any rollout, so not claimed: an approval request, a cost, a question. Declared: discovery and preview.
 */
import { under } from './files'
import { no, yes, repoOf, type Capabilities, type HarnessAdapter, type Preview, type ScanEnv, type ScanResult, type SessionRow, type SessionStatus, type Signals } from './harness'
import { believedAt, isRecord, scanRecords, shown, str, timeMs } from './harness-text'
import { settle, type Candidate, type Memory } from './harness-track'

export const CODEX_CAPS: Capabilities = {
  discovery: yes('sessions/YYYY/MM/DD/rollout-*.jsonl'),
  preview: yes('last agent message, last tool call'),
  approvals: no('no approval request appears in the rollouts read'),
  resume: no('opening a session is a model turn; not offered from browsing'),
  fork: no('not in phase 1'),
  messaging: no('not in phase 1'),
  stop: no('not in phase 1'),
}

export type CodexSummary = { id: string | null; cwd: string | null; lastAtMs: number | null; open: boolean; pendingTool: string | null; preview: Preview; signals: Signals; title: string | null }

/**
 * `whole`: the text starts at the file's first line. Only then is `session_meta` read, and only the FIRST one: a sub-agent's rollout carries its
 * parent's `session_meta` later in the file (seen on this machine: 5 of 19 recent rollouts), which is lineage, not a second identity.
 */
export function summarizeCodex(text: string, whole = true): CodexSummary {
  const out: CodexSummary = { id: null, cwd: null, lastAtMs: null, open: false, pendingTool: null, preview: { latest: '', tool: null, files: [], test: null }, signals: { question: false, approval: false, failed: false, turnEndedAtMs: null }, title: null }
  const calls = new Map<string, string>()

  scanRecords(text, record => {
    const at = timeMs(record.timestamp)
    const payload = isRecord(record.payload) ? record.payload : {}
    const type = str(record.type)
    const kind = str(payload.type)

    if (at !== undefined) out.lastAtMs = Math.max(out.lastAtMs ?? 0, at)

    if (type === 'session_meta') {
      if (!whole || out.id !== null) return
      out.id = str(payload.id)?.slice(0, 64) ?? out.id
      out.cwd = shown(payload.cwd, 400) || out.cwd
    } else if (type === 'turn_context') out.cwd = shown(payload.cwd, 400) || out.cwd
    else if (type === 'event_msg' && kind === 'task_started') {
      out.open = true
      out.signals.turnEndedAtMs = null
      out.signals.failed = false
      out.signals.failedAtMs = null
    } else if (type === 'event_msg' && kind === 'task_complete') {
      out.open = false
      out.signals.turnEndedAtMs = at ?? out.signals.turnEndedAtMs
      out.signals.failed = false
      out.signals.failedAtMs = null

      const last = shown(payload.last_agent_message, 600)

      if (last !== '') out.preview.latest = last
    } else if (type === 'event_msg' && kind === 'turn_aborted') {
      // "interrupted" is the person pressing Esc (every abort in the rollouts read here): their choice, so the session is idle, not failed.
      const interrupted = str(payload.reason) === 'interrupted'

      out.open = false
      out.signals.failed = !interrupted
      out.signals.failedAtMs = interrupted ? null : (at ?? null)
      out.preview.latest = `turn aborted${str(payload.reason) === undefined ? '' : `: ${shown(payload.reason, 60)}`}`
    } else if (type === 'response_item' && (kind === 'function_call' || kind === 'custom_tool_call') && typeof payload.call_id === 'string') {
      calls.set(payload.call_id.slice(0, 100), shown(payload.name, 40))
      out.preview.tool = shown(payload.name, 40)
    } else if (type === 'response_item' && (kind === 'function_call_output' || kind === 'custom_tool_call_output') && typeof payload.call_id === 'string') calls.delete(payload.call_id.slice(0, 100))
  })

  out.pendingTool = calls.size > 0 ? [...calls.values()].pop() ?? null : null

  return out
}

const idOfName = (name: string): string | undefined => /^rollout-.{1,40}?-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/.exec(name)?.[1]
const ACTIVE_MS = 90_000
/** As for Claude (ADR-486 §2.3): an abort is a failure only when nothing followed it for this long. */
const FAIL_QUIET_MS = 30_000
const DAYS = 14
const MAX_TRACKED = 60

const statusOf = (s: CodexSummary, mtimeMs: number, nowMs: number): SessionStatus => {
  if (s.signals.failed && nowMs - mtimeMs >= FAIL_QUIET_MS) return 'failed'
  if (s.open && nowMs - mtimeMs < ACTIVE_MS * 4) return 'working'

  return s.signals.turnEndedAtMs !== null ? 'done' : 'idle'
}

const pad = (n: number) => String(n).padStart(2, '0')
const dayDirs = (nowMs: number, days: number): string[] => {
  const out = new Set<string>()

  for (let i = 0; i < days; i += 1) {
    const d = new Date(nowMs - i * 86_400_000)

    out.add(`${d.getUTCFullYear()}/${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}`)
    out.add(`${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`)
  }

  return [...out]
}

export function codexRow(cand: Candidate, held: { value: CodexSummary | null; noPreview: string | null; stale: string | null }, home: string, nowMs: number): SessionRow {
  const s = held.value
  const where = s?.cwd ?? null
  const split = where === null ? { repo: cand.folder, worktree: null } : repoOf(where)

  return {
    key: `codex:${home}:${cand.nativeId}`,
    harness: 'codex',
    home,
    nativeId: cand.nativeId,
    title: s === null ? `rollout ${cand.nativeId.slice(0, 8)}` : s.preview.latest !== '' ? s.preview.latest.slice(0, 80) : `rollout ${cand.nativeId.slice(0, 8)}`,
    status: s === null ? 'unknown' : statusOf(s, cand.mtimeMs, nowMs),
    cwd: where,
    folder: cand.folder,
    repo: split.repo,
    worktree: split.worktree,
    branch: null,
    mission: null,
    updatedMs: cand.mtimeMs,
    size: cand.size,
    unassigned: s?.id != null && s.id !== cand.nativeId ? 'session_meta names a different id than the file' : null,
    stale: held.stale,
    external: true,
    cost: { label: 'unavailable', note: 'rollouts carry token counts, not dollars' },
    signals: s === null ? { question: false, approval: false, failed: false, turnEndedAtMs: null } : { ...s.signals, turnEndedAtMs: believedAt(s.signals.turnEndedAtMs, cand.mtimeMs, nowMs), failedAtMs: believedAt(s.signals.failedAtMs, cand.mtimeMs, nowMs) },
    preview: s === null ? null : s.preview,
    context: [],
    noPreview: held.noPreview,
  }
}

export function codexAdapter(): HarnessAdapter & { reset(): void } {
  const memory: Memory<CodexSummary> = new Map()
  const known = new Map<string, Candidate>()
  let last: SessionRow[] = []
  let detected = false

  return {
    id: 'codex',
    label: 'Codex',
    capabilities: CODEX_CAPS,
    reset: () => {
      memory.clear()
      known.clear()
      last = []
      detected = false
    },
    async scan(env: ScanEnv): Promise<ScanResult> {
      if (env.codexDir === null) return { state: 'not-detected', rows: [], note: 'no Codex directory is known' }

      const home = env.codexDir.replace(/\/+$/, '')
      const root = under(home, 'sessions')

      try {
        await env.fs.list(root)
        detected = true
      } catch {
        return detected ? { state: 'failed', rows: last.map(row => ({ ...row, stale: row.stale ?? 'discovery failed; showing the last read' })), note: 'could not list the sessions folder; rows are from the last read' } : { state: 'not-detected', rows: [], note: 'not detected: no Codex sessions folder' }
      }

      for (const day of dayDirs(env.nowMs, env.full ? DAYS : 2)) {
        try {
          const dir = under(root, day)
          const list = await env.fs.list(dir)
          const names = new Set(list.map(entry => under(dir, entry.name)))

          for (const [path, cand] of known) if (cand.folder === day && !names.has(path)) known.delete(path)

          for (const entry of list.slice(0, 5000)) {
            const id = idOfName(entry.name)

            if (id === undefined || (entry.kind !== undefined && entry.kind !== 'file')) continue

            known.set(under(dir, entry.name), { path: under(dir, entry.name), nativeId: id, folder: day, size: entry.size ?? 0, mtimeMs: entry.mtimeMs ?? 0 })
          }
        } catch {
          // A day with no folder has no sessions.
        }
      }

      const tracked = [...known.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_TRACKED)
      const settled = await settle(env.fs, memory, tracked, (text, whole) => summarizeCodex(text, whole), env.budget)

      for (const path of [...memory.keys()]) if (!known.has(path)) memory.delete(path)

      last = settled.map(({ cand, held }) => codexRow(cand, held, home, env.nowMs))

      return { state: 'ok', rows: last, note: `${known.size} rollouts seen, ${last.length} tracked` }
    },
  }
}
