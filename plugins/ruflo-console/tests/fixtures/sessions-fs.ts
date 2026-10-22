/**
 * A synthetic machine for the session workspace tests (ADR-486): an in-memory disk with 20 mixed sessions, none of them real. Every session
 * carries a unique TOKEN in what it says, so a test can prove that selecting a row shows that row's words and no other row's.
 */
import type { SessionFs } from '../../hooks/data/harness'

export const NOW = Date.UTC(2026, 9, 9, 12, 0, 0)
export const HOME = '/home/u'
export const CLAUDE = `${HOME}/.claude`
export const CODEX = `${HOME}/.codex`

type File = { content: string; mtimeMs: number; size?: number; kind?: 'file' | 'symlink'; statLink?: boolean }

export type Disk = { files: Map<string, File>; reads: string[]; tails: string[]; failList: Set<string>; failRead: Set<string> }

export const newDisk = (): Disk => ({ files: new Map(), reads: [], tails: [], failList: new Set(), failRead: new Set() })

const parent = (path: string) => path.slice(0, path.lastIndexOf('/'))

export function fsOn(disk: Disk, withTail = true): SessionFs {
  const fs: SessionFs = {
    read: async path => {
      disk.reads.push(path)

      const file = disk.files.get(path)

      if (file === undefined || disk.failRead.has(path)) throw new Error('refused')
      if ((file.size ?? file.content.length) > 4 * 1024 * 1024) throw new Error('over 4 MiB')

      return file.content
    },
    stat: async path => {
      const file = disk.files.get(path)

      if (file !== undefined) return { kind: file.kind === 'symlink' && file.statLink !== true ? 'symlink' : 'file', size: file.size ?? file.content.length, mtimeMs: file.mtimeMs, isLink: file.statLink === true || file.kind === 'symlink' }

      return [...disk.files.keys()].some(key => key.startsWith(`${path}/`)) ? { kind: 'dir' } : undefined
    },
    list: async path => {
      if (disk.failList.has(path)) throw new Error('listing refused')

      const names = new Map<string, { kind: string; size?: number; mtimeMs: number }>()

      for (const [key, file] of disk.files) {
        if (!key.startsWith(`${path}/`)) continue

        const rest = key.slice(path.length + 1)
        const slash = rest.indexOf('/')
        const name = slash < 0 ? rest : rest.slice(0, slash)
        const prior = names.get(name)

        names.set(name, slash < 0 ? { kind: file.kind === 'symlink' ? 'symlink' : file.statLink === true ? 'file' : 'file', size: file.size ?? file.content.length, mtimeMs: file.mtimeMs } : { kind: 'dir', mtimeMs: Math.max(prior?.mtimeMs ?? 0, file.mtimeMs) })
      }

      if (names.size === 0) throw new Error('no such directory')

      return [...names].map(([name, entry]) => ({ name, ...entry }))
    },
  }

  if (withTail) {
    fs.readTail = async (path, bytes) => {
      disk.tails.push(path)

      const file = disk.files.get(path)

      // A refused read is refused whichever call makes it.
      if (file === undefined || disk.failRead.has(path)) throw new Error('refused')

      return file.content.slice(-bytes)
    }
  }

  return fs
}

const j = (value: unknown) => JSON.stringify(value)
export const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-${n.toString(16).padStart(12, '0')}`
const iso = (ms: number) => new Date(ms).toISOString()

export type ClaudeSpec = { n: number; folder: string; cwd: string; token: string; end: 'completed' | 'failed' | 'question' | 'working' | 'idle'; ageMs: number; cost?: number; edits?: string[]; test?: boolean; idInEntries?: string }

/** The lines Claude Code writes for a session, in the shapes read on a real machine (only what the adapter uses). */
export function claudeLines(spec: ClaudeSpec): string {
  const at = NOW - spec.ageMs
  const id = spec.idInEntries ?? uuid(spec.n)
  const base = (offset: number) => ({ sessionId: id, cwd: spec.cwd, gitBranch: 'main', timestamp: iso(at - offset), isSidechain: false })
  const lines: unknown[] = [{ type: 'user', ...base(9000), message: { role: 'user', content: `please do ${spec.token}` } }]

  for (const [i, file] of (spec.edits ?? []).entries()) {
    lines.push({ type: 'assistant', ...base(8000 - i * 100), message: { role: 'assistant', content: [{ type: 'tool_use', id: `e${i}`, name: 'Edit', input: { file_path: file } }] } })
    lines.push({ type: 'user', ...base(7900 - i * 100), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: `e${i}`, content: 'ok' }] } })
  }

  if (spec.test === true) {
    lines.push({ type: 'assistant', ...base(5000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tt', name: 'Bash', input: { command: 'npx vitest run' } }] } })
    lines.push({ type: 'user', ...base(4900), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tt', content: 'noise\nTests  12 passed (12)\n' }] } })
  }

  if (spec.end === 'failed') {
    lines.push({ type: 'assistant', ...base(2000), message: { role: 'assistant', content: [{ type: 'tool_use', id: 'f1', name: 'Bash', input: { command: 'make' } }] } })
    lines.push({ type: 'user', ...base(1000), message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'f1', is_error: true, content: 'boom' }] } })
  } else if (spec.end === 'question') {
    lines.push({ type: 'assistant', ...base(1000), message: { role: 'assistant', content: [{ type: 'text', text: `which one ${spec.token}?` }, { type: 'tool_use', id: 'q1', name: 'AskUserQuestion', input: { question: 'x' } }] } })
  } else if (spec.end === 'working') {
    lines.push({ type: 'assistant', ...base(500), message: { role: 'assistant', content: [{ type: 'text', text: `working on ${spec.token}` }, { type: 'tool_use', id: 'w1', name: 'Bash', input: { command: 'sleep 1' } }] } })
  } else {
    lines.push({ type: 'assistant', ...base(1000), message: { role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: `done ${spec.token}` }] } })
    if (spec.end === 'completed') lines.push({ type: 'system', subtype: 'turn_duration', ...base(0), durationMs: 5 })
  }

  lines.push({ type: 'ai-title', sessionId: id, aiTitle: `title ${spec.token}` })
  if (spec.cost !== undefined) lines.push({ type: 'cost-state', sessionId: id, totalCostUSD: spec.cost, hasUnknownModelCost: false })

  return `${lines.map(j).join('\n')}\n`
}

export function addClaude(disk: Disk, spec: ClaudeSpec, extra: Partial<File> = {}): string {
  const path = `${CLAUDE}/projects/${spec.folder}/${uuid(spec.n)}.jsonl`

  disk.files.set(path, { content: claudeLines(spec), mtimeMs: NOW - spec.ageMs, ...extra })

  return path
}

export type CodexSpec = { n: number; day: string; cwd: string; token: string; end: 'complete' | 'aborted' | 'working'; ageMs: number; metaId?: string }

export function addCodex(disk: Disk, spec: CodexSpec): string {
  const at = NOW - spec.ageMs
  const rec = (offset: number, type: string, payload: Record<string, unknown>) => j({ timestamp: iso(at - offset), type, payload })
  const lines = [rec(3000, 'session_meta', { id: spec.metaId ?? uuid(spec.n), cwd: spec.cwd }), rec(2000, 'event_msg', { type: 'task_started', turn_id: 't' }), rec(1500, 'response_item', { type: 'function_call', name: 'shell', call_id: 'c1', arguments: '{}' })]

  if (spec.end !== 'working') lines.push(rec(1200, 'response_item', { type: 'function_call_output', call_id: 'c1', output: 'x' }))
  if (spec.end === 'complete') lines.push(rec(0, 'event_msg', { type: 'task_complete', turn_id: 't', last_agent_message: `codex says ${spec.token}` }))
  if (spec.end === 'aborted') lines.push(rec(0, 'event_msg', { type: 'turn_aborted', turn_id: 't', reason: 'interrupted' }))

  const path = `${CODEX}/sessions/${spec.day}/rollout-2026-10-09T10-00-00-${uuid(spec.n)}.jsonl`

  disk.files.set(path, { content: `${lines.join('\n')}\n`, mtimeMs: at })

  return path
}

export const TOKENS: string[] = []

/** The 20-session machine: 8 Claude in three repositories (one in a worktree), a duplicated id, an id mismatch, a hostile transcript, a link, 3 Codex, and ruflo's own. */
export function twentySessions(): { disk: Disk; tokens: Record<string, string> } {
  const disk = newDisk()
  const tokens: Record<string, string> = {}
  const claude = (spec: Omit<ClaudeSpec, 'token'>, extra: Partial<File> = {}) => {
    const token = `TOK${spec.n}X`

    tokens[`claude-${spec.n}`] = token
    addClaude(disk, { ...spec, token }, extra)
  }

  claude({ n: 1, folder: '-work-repo-a', cwd: '/work/repo-a', end: 'completed', ageMs: 60_000, cost: 1.25, edits: ['/work/repo-a/src/a.ts'], test: true })
  claude({ n: 2, folder: '-work-repo-a', cwd: '/work/repo-a', end: 'failed', ageMs: 300_000 })
  claude({ n: 3, folder: '-work-repo-a-wt', cwd: '/work/repo-a/.claude/worktrees/feat-x', end: 'question', ageMs: 120_000 })
  claude({ n: 4, folder: '-work-repo-b', cwd: '/work/repo-b', end: 'working', ageMs: 2000 })
  claude({ n: 5, folder: '-work-repo-b', cwd: '/work/repo-b', end: 'idle', ageMs: 3_600_000 })
  claude({ n: 6, folder: '-work-repo-c', cwd: '/work/repo-c', end: 'completed', ageMs: 30_000 })
  claude({ n: 7, folder: '-work-repo-c', cwd: '/work/repo-c', end: 'idle', ageMs: 7_200_000, cost: 0.4 })
  claude({ n: 8, folder: '-work-repo-c', cwd: '/work/repo-c', end: 'completed', ageMs: 5_000_000 })
  claude({ n: 14, folder: '-work-repo-b', cwd: '/work/repo-b', end: 'idle', ageMs: 9_000_000, cost: 2.5 })
  // The same session id in two project folders: ambiguous, both unassigned.
  claude({ n: 9, folder: '-work-repo-a', cwd: '/work/repo-a', end: 'completed', ageMs: 50_000 })
  claude({ n: 9, folder: '-work-repo-b', cwd: '/work/repo-b', end: 'completed', ageMs: 40_000 })
  // An entry that names another session than its file.
  claude({ n: 10, folder: '-work-repo-b', cwd: '/work/repo-b', end: 'completed', ageMs: 45_000, idInEntries: uuid(999) })
  // Hostile: stat says 5 MB, the tail is garbage, an over-long line, escape sequences, a bidi override and a credential-shaped string.
  const hostile = `${'\u0000garbage not json\n'.repeat(500)}${`{"type":"assistant","message":{"content":[{"type":"text","text":"${'A'.repeat(450_000)}"}]}}\n`}{"type":"assistant","sessionId":"${uuid(11)}","timestamp":"${iso(NOW - 10_000)}","cwd":"/work/repo-c","message":{"stop_reason":"end_turn","content":[{"type":"text","text":"\\u001b]0;pwned\\u0007\\u001b[31mred\\u001b[0m \\u202eevil sk-ant-api03-${'x'.repeat(40)} TOK11X"}]}}\n{"type":"system","subtype":"turn_duration","sessionId":"${uuid(11)}","timestamp":"${iso(NOW - 10_000)}"}\n`

  tokens['claude-11'] = 'TOK11X'
  disk.files.set(`${CLAUDE}/projects/-work-repo-c/${uuid(11)}.jsonl`, { content: hostile, mtimeMs: NOW - 10_000, size: 5_000_000 })
  // A transcript that is a link to a file outside the config directory: never read, never shown.
  disk.files.set(`${CLAUDE}/projects/-work-repo-c/${uuid(12)}.jsonl`, { content: 'ESCAPED-SECRET-MARKER\n', mtimeMs: NOW - 5000, statLink: true })
  // A project folder that is a link: skipped whole.
  disk.files.set(`${CLAUDE}/projects/-linked/${uuid(13)}.jsonl`, { content: 'ESCAPED-SECRET-MARKER\n', mtimeMs: NOW - 5000, kind: 'symlink' })

  const codex = (spec: Omit<CodexSpec, 'token'>) => {
    const token = `TOK${spec.n}X`

    tokens[`codex-${spec.n}`] = token
    addCodex(disk, { ...spec, token })
  }

  codex({ n: 21, day: '2026/10/09', cwd: '/work/repo-a', end: 'complete', ageMs: 20_000 })
  codex({ n: 22, day: '2026/10/09', cwd: '/work/repo-b', end: 'aborted', ageMs: 400_000 })
  codex({ n: 23, day: '2026/10/08', cwd: '/work/repo-c', end: 'working', ageMs: 4000 })

  return { disk, tokens }
}
