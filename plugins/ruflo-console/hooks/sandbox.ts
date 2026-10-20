/**
 * The Sandbox page's catalog (ADR-442): isolated places to try things. tmux sessions are real, throwaway work places for agents:
 * every argv is fixed, runs with no shell, and names a session only as `ruflo-sb-<name>` (the name is checked, the prefix is always
 * the console's, and `=` makes tmux match exactly), so the console can only ever touch its own. The RVF branches are the Dev Tools
 * agenticow rows (group `cow`), drawn here too. RVM is information only: no ruflo command or MCP tool reads or changes it. These
 * entries join `DEV`, so the confirm row, the palette ids and the self-check treat them like every other Dev Tools row. Pure.
 */
import { need } from './data/devtools'
import { plain } from './data/parse'
import { isoOf } from './data/safe'
import type { Host } from './host'
import type { DevEntry } from './devtools'
import type { State } from './state'

export const SANDBOX_PREFIX = 'ruflo-sb-'

/** The sandbox groups: drawn on the Sandbox page, not on Dev Tools. */
export const SANDBOX_GROUPS = [
  { id: 'tmux', title: 'tmux sandboxes', right: 'throwaway shells · ruflo-sb-* only' },
  { id: 'rvm', title: 'RVM · resource and effect boundary', right: 'information · this console never changes it' },
] as const

const target = (name: string): string => `=${SANDBOX_PREFIX}${name}:`
const exactName = (name: string): string => `=${SANDBOX_PREFIX}${name}`
const NOT_SECURITY = 'a tmux session is a separate shell that runs as you: a place to work apart, not a security boundary'

const done = (what: string) => (stdout: string, stderr: string, ok: boolean): string[] => (ok ? [`✓ ${what}`] : [`✗ ${plain(stderr || stdout, 160) || 'tmux refused'}`])

/** `tmux list-sessions` as lines: only ruflo-sb-* sessions, whatever else the server holds; none (or no server yet) says so. */
export function sandboxLines(stdout: string, stderr: string, ok: boolean): string[] {
  const rows = stdout.split('\n').map(line => line.split('|')).filter(part => (part[0] ?? '').startsWith(SANDBOX_PREFIX))

  if (rows.length === 0) return [ok || /no server running/.test(stderr) ? `no sandbox sessions yet${ok ? '' : ' (tmux has no server running)'}: NEW starts one` : `✗ ${plain(stderr, 160) || 'tmux refused'}`]

  return rows.map(([name = '', windows = '?', created = '0']) => {
    const at = Number(created)

    return `${plain(name.slice(SANDBOX_PREFIX.length), 40)} · ${windows} window${windows === '1' ? '' : 's'}${Number.isFinite(at) && at > 0 ? ` · started ${isoOf(at * 1000).slice(0, 16).replace('T', ' ')}Z` : ''}`
  })
}

/** The last lines of a captured pane, trailing blanks dropped. */
export function paneLines(stdout: string, stderr: string, ok: boolean): string[] {
  if (!ok) return [`✗ ${plain(stderr, 160) || 'no such sandbox: LIST shows the ones that exist'}`]

  const lines = stdout.split('\n').map(line => plain(line, 160))

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

  return lines.length === 0 ? ['(the pane is empty)'] : lines.slice(-40)
}

const RVM_NA = 'ruflo has no rvm command or MCP tool (searched the CLI source and tool list). RVM is a separate boundary (ADR-399, ADR-400): code here has authority: none, and nothing in this console can read or change it'

export const SANDBOX: readonly DevEntry[] = [
  { id: 'dt-sb-list', group: 'tmux', name: 'LIST', about: 'the ruflo-sb-* sessions on this machine', label: 'list tmux sandbox sessions', cost: 'read', needs: 'tmux', exec: () => ['tmux', 'list-sessions', '-F', '#{session_name}|#{session_windows}|#{session_created}', '-f', `#{m:${SANDBOX_PREFIX}*,#{session_name}}`], read: sandboxLines },
  { id: 'dt-sb-new', group: 'tmux', name: 'NEW', about: 'a detached session ruflo-sb-<name> running your shell', label: 'start a tmux sandbox session', cost: 'writes', needs: 'tmux', input: 'session', exec: f => need(f, ['session'], v => ['tmux', 'new-session', '-d', '-s', `${SANDBOX_PREFIX}${v.session}`]), read: done('session started: SEND types into it'), note: `starts a tmux session; ${NOT_SECURITY}` },
  { id: 'dt-sb-send', group: 'tmux', name: 'SEND', about: 'type the line into that session and press Enter', label: 'type a command into the tmux sandbox', cost: 'writes', needs: 'tmux', input: 'send', exec: f => need(f, ['session', 'send'], v => ['tmux', 'send-keys', '-t', target(v.session), '-l', v.send, ';', 'send-keys', '-t', target(v.session), 'Enter']), read: done('typed, Enter pressed: CAPTURE shows what it did'), note: 'SHELL COMMAND: runs in that session, as you' },
  { id: 'dt-sb-capture', group: 'tmux', name: 'CAPTURE', about: 'the last 40 lines on that session’s screen', label: 'capture the tmux sandbox screen', cost: 'read', needs: 'tmux', input: 'session', exec: f => need(f, ['session'], v => ['tmux', 'capture-pane', '-p', '-t', target(v.session), '-S', '-40']), read: paneLines },
  { id: 'dt-sb-kill', group: 'tmux', name: 'KILL', about: 'end that session and everything running in it', label: 'kill the tmux sandbox session', cost: 'deletes', needs: 'tmux', input: 'session', exec: f => need(f, ['session'], v => ['tmux', 'kill-session', '-t', exactName(v.session)]), read: done('session ended'), note: 'DELETES the session and what it runs' },

  { id: 'dt-rvm-status', group: 'rvm', name: 'STATUS', about: 'n/a: no rvm command to read', label: 'rvm status', cost: 'read', na: RVM_NA },
  { id: 'dt-rvm-ceilings', group: 'rvm', name: 'CEILINGS', about: 'n/a: resource ceilings are enforced by RVM, not shown here', label: 'rvm resource ceilings', cost: 'read', na: RVM_NA },
  { id: 'dt-rvm-authority', group: 'rvm', name: 'AUTHORITY', about: 'n/a: the console never grants or widens authority', label: 'rvm authority', cost: 'read', na: RVM_NA },
]

/** What RVM is, per the ADRs, as lines for the page: facts from the repo, nothing the console measured. */
export const RVM_LINES: readonly string[] = [
  ' RVM is the privileged effect and resource-ceiling boundary: it decides what code may do and how much it may use.',
  ' Advisory code (planners, admission decisions) carries authority: none and cannot widen a ceiling (ADR-398, ADR-400).',
  ' Git subprocesses and sandboxes stay inside RVM and the OS boundary (ADR-399). This console never changes RVM.',
]

/** Is tmux here? A local, $0 probe when the page opens: a missing tmux makes its rows n/a with the reason. */
export async function probeTmux(state: State, host: Host): Promise<void> {
  try {
    const result = await host.run(['tmux', '-V'], 5_000)

    state.devtools.tmux = result.exitCode === 0 ? 'present' : 'missing'
  } catch {
    state.devtools.tmux = 'missing'
  }

  host.invalidate()
}
