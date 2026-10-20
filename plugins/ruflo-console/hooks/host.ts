import type { CommandSpec, HookStream, PaneOpenArgs, ProcessRunResult, ProcessSpawnChunk, ProcessSpawnResult, Timer, UiBlitArgs } from 'claude-code'

import type { ReaderFs } from './data/files'
import type { ToastLevel } from './toast-policy'
import type { RufloRoute, RufloSnapshot } from '../types'

/** What `$.ui.open` answers: drawn, or held back with the reason. A build that answers nothing has drawn it. */
export type OpenResult = { isPlaced: boolean; reason?: string } | void

/**
 * The engine as `session.start` bound it. Every later hook, timer and button reaches the engine through this, so the
 * controller is plain functions over an interface a test can stand in for. Any member may be refused (an administrator
 * removed the affordance, a policy mod said no): every caller catches, and a refusal is a missing fact, never a crash.
 */
export type Host = {
  fs: ReaderFs
  every: (ms: number, fn: () => void) => Timer
  after: (ms: number, fn: () => void) => Timer
  storeGet: (key: string) => Promise<unknown>
  storeSet: (key: string, value: unknown) => Promise<void>
  /** A GET through the host (never the plugin's own network; an administrator's policy may refuse it): the status and the body text. */
  fetchText: (url: string) => Promise<{ ok: boolean; status: number; text: string }>
  /** The engine's own choice dialog: the label chosen. Rejects when dismissed, and when nobody can be asked (a -p run). */
  askChoice: (question: string, options: readonly string[]) => Promise<string>
  /** A short note over the transcript's corner; it leaves the transcript and the model untouched. */
  toast: (text: string, timeoutMs?: number, level?: ToastLevel) => void
  invalidate: () => void
  /** Scrolls the pane back to its first row: a page that was switched to (or opened over this one) starts at its top, not where the last one was left. */
  scrollTop: () => void
  /** Moves a pane's focus ring onto an element it drew (a field), while the pane holds the keys. */
  focus: (paneId: string, key: string) => Promise<unknown>
  /** Fire and forget: a blit resolves only once painted, and blits between frames fold anyway. */
  blit: (args: UiBlitArgs) => void
  openPane: (pane: PaneOpenArgs) => Promise<OpenResult>
  closePane: (id: string) => Promise<void>
  panes: () => Promise<readonly { id: string; isShown: boolean; isFocused: boolean }[]>
  registerCommand: (spec: CommandSpec) => Promise<unknown>
  run: (argv: readonly string[], timeoutMs: number, stdin?: string) => Promise<ProcessRunResult>
  /** Starts a command and streams what it writes; `input` goes to its stdin, which is then closed. */
  spawn: (argv: readonly string[], input?: string) => HookStream<ProcessSpawnChunk, ProcessSpawnResult>
  usage: () => Promise<{ costUsd?: number; contextPercent?: number }>
  /** The ruflo / claude-flow MCP tools the model can call now, and the servers they come from. */
  rufloTools: () => Promise<{ tools: number; servers: string[] }>
  settings: () => Promise<unknown>
  home: () => Promise<string | undefined>
  configDir: () => Promise<string | undefined>
  /** This plugin's folder: where its own files (the command catalog) are. */
  pluginRoot: string
  rufloSnapshot: () => Promise<RufloSnapshot>
  rufloRoute: () => Promise<RufloRoute | null>
  rufloSegment: (text: string | null) => Promise<void>
  /** Submits a prompt to the primary Claude session as a visible turn of its own (once idle). */
  submitPrompt: (text: string) => Promise<void>
  /** Puts text in the prompt box as the draft (the person presses Enter); false where there is no box. */
  fillPrompt: (text: string) => Promise<boolean>
  /** The names of the slash commands the session offers now (built-in, plugin and MCP alike). */
  listCommands: () => Promise<string[]>
  /** Runs a slash command as if typed (built-in, plugin or MCP); queued until the session is idle. */
  runSlash: (command: string, args: string) => Promise<{ text?: string } | void>
  /**
   * Calls an engine tool as the session would ($.tool.call: every hook, the permission check and its dialog, then the tool), from a clock tick
   * (a tool call waits on the turn). A refusal comes back as `deny`, a failure as `isError`; a missing tool or an aborted call rejects.
   * Optional: a build that does not bind it makes the control actions fall back to a prompt-box prefill (ADR-465).
   */
  toolCall?: (input: { tool: string } & Record<string, unknown>) => Promise<ToolReply>
  /** The engine's permission verdict for a tool call now, with nothing run and no dialog ($.tool.check). */
  toolCheck?: (tool: string, input: unknown) => Promise<{ decision: 'allow' | 'ask' | 'deny'; reason?: string }>
  /** A request with a method, headers and a text body through the host (the OpenAI-compatible targets); the key rides a header and is never logged. */
  httpSend?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<{ ok: boolean; status: number; text: string }>
}

/** What a tool call answered: the refusal, or the output (text and structure) and whether it was an error. */
export type ToolReply = { deny?: string; text?: string; result?: unknown; isError?: boolean }
