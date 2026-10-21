/**
 * The `claude` adapter (ADR-486): sessions Claude Code keeps as `<config dir>/projects/<folder>/<session id>.jsonl`. The format was read
 * on this machine for the entry types used here (user and assistant lines with `message.content` blocks, `tool_use` and `tool_result`,
 * `ai-title`, `cost-state`, `system/turn_duration`); a line of any other shape is ignored, never guessed at. The file name is the session id
 * (every entry's own `sessionId` was checked to match it); an entry that names another id makes the row unassigned.
 * Declared: discovery and preview. Claude Code writes no approval request into the transcript, so `approvals` is not claimed.
 */
import { repoOf, no, yes, type Capabilities, type HarnessAdapter, type Preview, type ScanEnv, type ScanResult, type SessionRow, type SessionStatus, type Signals } from './harness'
import { believedAt, isRecord, isTestCommand, scanRecords, shown, str, testLine, timeMs } from './harness-text'
import { settle, type Candidate, type Memory } from './harness-track'
import { under } from './files'

export const CLAUDE_CAPS: Capabilities = {
  discovery: yes('projects/<folder>/<session id>.jsonl'),
  preview: yes('latest assistant text, last tool, edited files, test output'),
  approvals: no('Claude Code does not write a pending permission request into the transcript'),
  resume: no('opening a session is a model turn; not offered from browsing'),
  fork: no('not in phase 1'),
  messaging: no('not in phase 1'),
  stop: no('not in phase 1'),
}

export type ClaudeSummary = {
  cwd: string | null
  branch: string | null
  title: string | null
  idMismatch: boolean
  lastAtMs: number | null
  pendingTool: string | null
  preview: Preview
  signals: Signals
  costUsd: number | null
  costPartial: boolean
}

const EDITS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit'])
const FILES_MAX = 8
const ACTIVE_MS = 90_000
const FAIL_QUIET_MS = 30_000
/**
 * The two whole results Claude Code writes when the person refuses a tool call at the permission prompt (both read on this machine): the
 * refusal sentence alone (optionally with Claude Code's own "Note:" paragraph after it), or the refusal and the person's reply. Matched as that
 * structure, never as a prefix: a genuine error that merely quotes the sentence is still a failure.
 */
const REFUSED = "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file)."
const REFUSED_STOP = `${REFUSED} STOP what you are doing and wait for the user to tell you how to proceed.`
const REFUSED_SAID = `${REFUSED} To tell you how to proceed, the user said:\n`
const isRefusal = (body: string): boolean => body === REFUSED_STOP || body.startsWith(`${REFUSED_STOP}\n\nNote: `) || (body.startsWith(REFUSED_SAID) && body.length > REFUSED_SAID.length)

const resultText = (content: unknown): string => (typeof content === 'string' ? content : Array.isArray(content) ? content.map(part => (isRecord(part) && typeof part.text === 'string' ? part.text : '')).join('\n') : '')

export function summarizeClaude(text: string, id: string): ClaudeSummary {
  const out: ClaudeSummary = { cwd: null, branch: null, title: null, idMismatch: false, lastAtMs: null, pendingTool: null, preview: { latest: '', tool: null, files: [], test: null }, signals: { question: false, approval: false, failed: false, turnEndedAtMs: null }, costUsd: null, costPartial: false }
  const open = new Map<string, { name: string; command: string }>()
  let prompt: string | null = null
  let lastErrorAtMs: number | null = null
  let convAtMs = 0
  let afterError = false

  scanRecords(text, record => {
    const at = timeMs(record.timestamp)
    const type = str(record.type)

    if (str(record.sessionId) !== undefined && record.sessionId !== id) out.idMismatch = true
    if (record.isSidechain === true) return
    if (at !== undefined) out.lastAtMs = Math.max(out.lastAtMs ?? 0, at)
    if (str(record.cwd) !== undefined) out.cwd = shown(record.cwd, 400) || out.cwd
    if (str(record.gitBranch) !== undefined) out.branch = shown(record.gitBranch, 60)

    if ((type === 'assistant' || type === 'user') && at !== undefined) convAtMs = Math.max(convAtMs, at)
    // The person typed (a prompt, or an interrupt such as "[Request interrupted by user for tool use]"): whatever failed before is theirs to
    // see in their terminal now, and the session waits on them, not on a failure.
    if (type === 'user' && isRecord(record.message) && typeof record.message.content === 'string' && record.message.content !== '') afterError = false

    if (type === 'ai-title') out.title = shown(record.aiTitle, 80) || out.title
    else if (type === 'last-prompt') prompt = shown(record.lastPrompt, 80) || prompt
    else if (type === 'cost-state') {
      out.costUsd = typeof record.totalCostUSD === 'number' && Number.isFinite(record.totalCostUSD) && record.totalCostUSD >= 0 ? record.totalCostUSD : out.costUsd
      out.costPartial = record.hasUnknownModelCost === true
    } else if (type === 'system' && record.subtype === 'turn_duration') {
      if (at !== undefined) out.signals.turnEndedAtMs = at
    } else if ((type === 'assistant' || type === 'user') && isRecord(record.message) && Array.isArray(record.message.content)) {
      for (const block of record.message.content as unknown[]) {
        if (!isRecord(block)) continue

        if (block.type === 'text' && type === 'assistant') {
          const line = shown(block.text, 600)

          if (line !== '') out.preview.latest = line
          afterError = false
        } else if (block.type === 'text' && type === 'user') {
          afterError = false
        } else if (block.type === 'tool_use' && type === 'assistant') {
          const name = shown(block.name, 40)
          const input = isRecord(block.input) ? block.input : {}
          const command = typeof input.command === 'string' ? input.command.slice(0, 600) : ''

          if (typeof block.id === 'string') open.set(block.id.slice(0, 100), { name, command })
          out.preview.tool = name
          if (name === 'AskUserQuestion') out.signals.question = true
          if (EDITS.has(name)) {
            const file = shown(input.file_path ?? input.notebook_path, 120)

            if (file !== '' && !out.preview.files.includes(file)) out.preview.files = [...out.preview.files, file].slice(-FILES_MAX)
          }

          afterError = false
        } else if (block.type === 'tool_result' && typeof block.tool_use_id === 'string') {
          const call = open.get(block.tool_use_id.slice(0, 100))
          const body = resultText(block.content)
          // A refusal at the permission prompt is the person's decision: is_error is set, but nothing failed. (Esc on it writes a user text
          // block after the result, which clears the error below.)
          const failed = block.is_error === true && !isRefusal(body)

          open.delete(block.tool_use_id.slice(0, 100))
          if (call?.name === 'AskUserQuestion') out.signals.question = false
          afterError = failed
          lastErrorAtMs = failed ? (at ?? null) : lastErrorAtMs

          if (call !== undefined && isTestCommand(call.command)) {
            out.preview.test = `${failed ? 'failed' : 'passed'}${testLine(body) === null ? '' : `: ${testLine(body)}`}`
          }
        }
      }
    }
  })

  out.signals.failed = afterError && lastErrorAtMs !== null && open.size === 0
  out.signals.failedAtMs = out.signals.failed ? lastErrorAtMs : null
  out.pendingTool = open.size > 0 ? [...open.values()].map(call => call.name).pop() ?? null : null
  out.title = out.title ?? prompt
  if (out.pendingTool === null) out.signals.question = false
  // A turn that ended and was followed by a message has not ended: only the last conversation line may be the end.
  if (out.signals.turnEndedAtMs !== null && out.signals.turnEndedAtMs < convAtMs) out.signals.turnEndedAtMs = null

  return out
}

const statusOf = (s: ClaudeSummary, mtimeMs: number, nowMs: number): SessionStatus => {
  if (s.signals.failed && nowMs - mtimeMs >= FAIL_QUIET_MS) return 'failed'
  if (nowMs - mtimeMs < ACTIVE_MS) return 'working'

  return s.signals.turnEndedAtMs !== null && s.pendingTool === null ? 'done' : 'idle'
}

export function claudeRow(cand: Candidate, held: { value: ClaudeSummary | null; noPreview: string | null; stale: string | null }, home: string, nowMs: number): SessionRow {
  const s = held.value
  const where = s === null ? null : s.cwd
  const split = where === null ? { repo: cand.folder, worktree: null } : repoOf(where)

  return {
    key: `claude:${home}:${cand.nativeId}`,
    harness: 'claude',
    home,
    nativeId: cand.nativeId,
    title: s?.title ?? `session ${cand.nativeId.slice(0, 8)}`,
    status: s === null ? 'unknown' : statusOf(s, cand.mtimeMs, nowMs),
    cwd: where,
    folder: cand.folder,
    repo: split.repo,
    worktree: split.worktree,
    branch: s?.branch ?? null,
    mission: null,
    updatedMs: cand.mtimeMs,
    size: cand.size,
    unassigned: s?.idMismatch === true ? 'an entry names a different session id than the file' : null,
    stale: held.stale,
    external: true,
    cost: s === null || s.costUsd === null ? { label: 'unavailable', note: 'the transcript holds no cost entry' } : { label: 'reported', usd: s.costUsd, ...(s.costPartial && { note: 'some models unpriced' }) },
    // Times a record claims are held to the file's mtime and the clock (believedAt), so a skewed timestamp cannot pin "seen" in the future.
    signals: s === null ? { question: false, approval: false, failed: false, turnEndedAtMs: null } : { ...s.signals, turnEndedAtMs: believedAt(s.signals.turnEndedAtMs, cand.mtimeMs, nowMs), failedAtMs: believedAt(s.signals.failedAtMs, cand.mtimeMs, nowMs) },
    preview: s === null ? null : s.preview,
    context: [],
    noPreview: held.noPreview,
  }
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const FOLDER = /^[A-Za-z0-9._-]{1,200}$/
const MAX_DIRS = 400
const MAX_TRACKED = 60
const RECENT_MS = 14 * 86_400_000
const FAST_DIRS = 8

export function claudeAdapter(): HarnessAdapter & { reset(): void } {
  const memory: Memory<ClaudeSummary> = new Map()
  const dirs = new Map<string, number>()
  const known = new Map<string, Candidate>()
  let last: SessionRow[] = []

  const relist = async (fs: ScanEnv['fs'], root: string, folder: string): Promise<boolean> => {
    try {
      const list = await fs.list(under(root, folder))

      const names = new Set(list.map(entry => under(under(root, folder), entry.name)))

      for (const [path, cand] of known) if (cand.folder === folder && !names.has(path)) known.delete(path)

      for (const entry of list.slice(0, 5000)) {
        const id = /^(.*)\.jsonl$/.exec(entry.name)?.[1]

        if (id === undefined || !ID.test(id) || (entry.kind !== undefined && entry.kind !== 'file')) continue

        const path = under(under(root, folder), entry.name)

        known.set(path, { path, nativeId: id, folder, size: entry.size ?? 0, mtimeMs: entry.mtimeMs ?? 0 })
      }

      return true
    } catch {
      return false
    }
  }

  return {
    id: 'claude',
    label: 'Claude Code',
    capabilities: CLAUDE_CAPS,
    reset: () => {
      memory.clear()
      dirs.clear()
      known.clear()
      last = []
    },
    async scan(env: ScanEnv): Promise<ScanResult> {
      if (env.claudeDir === null) return { state: 'not-detected', rows: [], note: 'no Claude Code config directory is known' }

      const home = env.claudeDir.replace(/\/+$/, '')
      const root = under(home, 'projects')
      let entries: Awaited<ReturnType<ScanEnv['fs']['list']>>

      try {
        entries = await env.fs.list(root)
      } catch {
        return last.length === 0 ? { state: 'not-detected', rows: [], note: 'no projects folder' } : { state: 'failed', rows: last.map(row => ({ ...row, stale: row.stale ?? 'discovery failed; showing the last read' })), note: 'could not list the projects folder; rows are from the last read' }
      }

      const folders = entries.filter(entry => FOLDER.test(entry.name) && !entry.name.includes('..') && (entry.kind === undefined || entry.kind === 'dir' || entry.kind === 'directory')).slice(0, MAX_DIRS)
      const recentFolders = new Set([...known.values()].sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, FAST_DIRS).map(cand => cand.folder))
      let failedDirs = 0

      for (const folder of folders) {
        const seen = dirs.get(folder.name)

        if (env.full || seen === undefined || seen !== (folder.mtimeMs ?? 0) || recentFolders.has(folder.name)) {
          if (await relist(env.fs, root, folder.name)) dirs.set(folder.name, folder.mtimeMs ?? 0)
          else failedDirs += 1
        }
      }

      const names = new Set(folders.map(folder => folder.name))

      for (const [path, cand] of known) if (!names.has(cand.folder)) known.delete(path)

      const tracked = [...known.values()].filter(cand => env.nowMs - cand.mtimeMs < RECENT_MS || cand.mtimeMs === 0).sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, MAX_TRACKED)
      const settled = await settle(env.fs, memory, tracked, (text, _whole, cand) => summarizeClaude(text, cand.nativeId), env.budget)

      for (const path of [...memory.keys()]) if (!known.has(path)) memory.delete(path)

      last = settled.map(({ cand, held }) => claudeRow(cand, held, home, env.nowMs))

      return { state: 'ok', rows: last, note: failedDirs > 0 ? `${failedDirs} project folder${failedDirs === 1 ? '' : 's'} could not be listed` : `${folders.length} project folders, ${known.size} sessions seen, ${last.length} tracked` }
    },
  }
}
