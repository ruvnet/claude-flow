/**
 * The session workspace's adapter contract (ADR-486). A harness adapter finds the sessions one agent harness keeps on this machine and
 * says, per capability, whether it can do that and why not. An action a harness has not declared stays unavailable; nothing is inferred.
 * Discovery is local and read-only: it makes no model call, spawns no process and wakes no agent.
 */
import type { PassBudget } from './harness-track'
import type { ReaderFs } from './files'

export const HARNESS_IDS = ['claude', 'codex', 'ruflo'] as const
export type HarnessId = (typeof HARNESS_IDS)[number]

/** What an adapter may declare. `approvals`: it can tell that a session is waiting for a yes. */
export const CAPABILITIES = ['discovery', 'preview', 'approvals', 'resume', 'fork', 'messaging', 'stop'] as const
export type Capability = (typeof CAPABILITIES)[number]
export type CapabilityState = { supported: boolean; why: string }
export type Capabilities = Record<Capability, CapabilityState>

export const yes = (why = 'verified against the on-disk format'): CapabilityState => ({ supported: true, why })
export const no = (why: string): CapabilityState => ({ supported: false, why })

/** The four kinds the attention queue shows. */
export const ATTENTION_KINDS = ['needs-approval', 'question', 'failed', 'completed-unread'] as const
export type AttentionKind = (typeof ATTENTION_KINDS)[number]

/** Cost is never guessed: `reported` came from the harness, `estimated` from a stated rule, `unavailable` is shown as such. */
export type Cost = { label: 'reported' | 'estimated' | 'unavailable'; usd?: number; note?: string }

export type Preview = {
  /** The latest response, sanitised and cut. Never model-facing, never persisted, never exported. */
  latest: string
  tool: string | null
  files: string[]
  test: string | null
}

export type Signals = {
  /** A question put to the person is open (the harness asked, nothing has answered). */
  question: boolean
  /** An approval is open (only an adapter that declares `approvals` sets it). */
  approval: boolean
  /** The last tool failed and nothing followed it. */
  failed: boolean
  /** When the failure was recorded, from the failing record's own timestamp: a later metadata line (title, cost) does not make it new. */
  failedAtMs?: number | null
  /** The last turn finished at this time. */
  turnEndedAtMs: number | null
}

export type SessionStatus = 'working' | 'idle' | 'done' | 'failed' | 'unknown'

export type SessionRow = {
  /** Identity: harness + canonical home + native id. Two rows never share one. */
  key: string
  harness: HarnessId
  home: string
  nativeId: string
  title: string
  status: SessionStatus
  /** The working directory the harness recorded, or null when it could not be read (never guessed from the folder name). */
  cwd: string | null
  /** The project folder name the harness keeps this session in; the group label when no cwd is known. */
  folder: string
  repo: string
  worktree: string | null
  branch: string | null
  /** The mission this session is known to belong to, by an exact id the harness recorded; null otherwise. */
  mission: string | null
  updatedMs: number
  size: number
  /** Why this row could not be tied to one session (ambiguous id, id mismatch); it then sits in the unassigned bucket. */
  unassigned: string | null
  /** The last read failed or the window was incomplete: what is shown is from an earlier read or from the tail only. */
  stale: string | null
  /** Started outside Ruflo: nothing in Ruflo launched it. */
  external: boolean
  cost: Cost
  signals: Signals
  preview: Preview | null
  /** Mission context lines (assigned task, dependencies, claims, ADRs, verification): only what the console's own records hold. */
  context: string[]
  /** Why there is no preview (too large for this host, unreadable). */
  noPreview: string | null
}

export type ScanResult = { state: 'ok' | 'not-detected' | 'failed'; rows: SessionRow[]; note: string }

/** What a host can do for a read: `readTail` exists only where the host offers it (ADR-473). */
export type SessionFs = ReaderFs & { readTail?: (path: string, bytes: number) => Promise<string> }

export type ScanEnv = {
  fs: SessionFs
  /** Claude Code's config directory and Codex's home, or null when unknown. */
  claudeDir: string | null
  codexDir: string | null
  nowMs: number
  /** Relist everything (slow pass); otherwise only what changed and the recently active files. */
  full: boolean
  /** The pass's read allowance, shared by every adapter in the pass (data/harness-track.ts); a fresh one per scan when absent. */
  budget?: PassBudget
}

export interface HarnessAdapter {
  readonly id: HarnessId
  readonly label: string
  readonly capabilities: Capabilities
  scan(env: ScanEnv): Promise<ScanResult>
}

/** Splits a recorded cwd into its repository and worktree by path alone (no git, no disk): `<repo>/.claude/worktrees/<name>` and its kin. */
export function repoOf(cwd: string): { repo: string; worktree: string | null } {
  const marker = /^(.*?)\/(?:\.claude\/worktrees|\.git-worktrees|\.worktrees)\/([^/]+)/.exec(cwd)

  return marker !== null && marker[1] !== undefined && marker[2] !== undefined ? { repo: marker[1] === '' ? '/' : marker[1], worktree: marker[2] } : { repo: cwd, worktree: null }
}
