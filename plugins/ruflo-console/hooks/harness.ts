/**
 * The terminal view's second terminal: a conversation with codex or claude (or both at once, the swarm), or one ruflo
 * CLI command. Each agent keeps a session per project, so a follow-up resumes the conversation: codex by its thread
 * id (`codex exec resume`), claude by a session id the console picks (`--session-id`, then `--resume`). Their JSON
 * streams are read as they arrive (stream.ts), so the answer types out and each tool call shows as it runs.
 *
 * Starting or resuming a session costs money, so it is asked once (Enter shows the command, Enter again runs it);
 * after that the session is live for this Claude Code session and Enter sends. A ruflo command is asked every time.
 * The person's text reaches an agent on stdin, never as an argument, so it cannot be read as a flag.
 */
import { ARGV_TEXT_MAX, checkLimit, LONG_TEXT_MAX } from './full-text'
import type { ActionSpec } from './actions'
import { ESCAPES, HIDDEN, INVISIBLE } from './data/parse'
import type { Host } from './host'
import { CLI_PREFIXES, PANE_ID, push, termStoreKeyOf, type AgentId, type HarnessId, type State, type TermLine } from './state'
import { claudeParser, codexEvent, eventOf, type Sink } from './stream'
import { maskInvites } from './xruv'

export const TERM_MAX_LINES = 600
/** The engine ends a spawned child only when its loop ends: the console ends a run at ten minutes. */
export const RUN_CAP_MS = 10 * 60_000
// A question goes to the agent on its stdin (a ruflo command as one argv): the most a prompt takes is LONG_TEXT_MAX, refused over it (whyNotRun).

export type Harness = { id: HarnessId; key: string; label: string; about: string; agents: readonly AgentId[] }

export const HARNESSES: readonly Harness[] = [
  { id: 'claude', key: 'l', label: 'claude', about: 'claude -p in plan mode, a per-turn budget cap (Settings), one session per project · billed to your Claude plan', agents: ['claude'] },
  { id: 'codex', key: 'c', label: 'codex', about: 'codex exec, read-only sandbox, one thread per project · billed to your OpenAI plan', agents: ['codex'] },
  { id: 'swarm', key: 'v', label: 'swarm', about: 'codex and claude together: one question to both, answering side by side in their own sessions', agents: ['codex', 'claude'] },
  { id: 'ruflo', key: 'u', label: 'ruflo', about: 'one ruflo CLI command, split on spaces with no shell (swarm status, memory search -q auth) · asked each time', agents: ['ruflo'] },
]

export const harnessOf = (id: HarnessId): Harness => HARNESSES.find(harness => harness.id === id) ?? (HARNESSES[0] as Harness)

/** A v4 UUID for a new claude session (not a secret: it only names the conversation). */
function uuid(): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16))

  hex[12] = '4'
  hex[16] = ((parseInt(hex[16] as string, 16) & 0x3) | 0x8).toString(16)

  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

/** The argv for one agent's next turn: a new session, or the saved one resumed. */
import { settingsOf } from './settings'

export function argvOf(state: State, agent: AgentId, text: string): readonly string[] | null {
  const session = agent === 'ruflo' ? undefined : state.terminal.sessions[agent]

  switch (agent) {
    case 'codex':
      return session === undefined
        ? ['codex', 'exec', '--json', '--sandbox', 'read-only', '--skip-git-repo-check', '-']
        : ['codex', 'exec', 'resume', '--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', session, '-']
    case 'claude':
      return ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--max-budget-usd', String(settingsOf(state).ai.budgetUsd), ...(settingsOf(state).ai.claudeModel === 'default' ? [] : ['--model', settingsOf(state).ai.claudeModel]), ...(session === undefined ? [] : ['--resume', session])]
    case 'ruflo': {
      const words = text.split(/\s+/).filter(word => word !== '')

      return words.length === 0 || words.length > 40 ? null : [...CLI_PREFIXES[state.options.cli], ...words]
    }
  }
}

/**
 * One line of an agent's output as the scrollback keeps it: escape sequences, control, bidirectional and other invisible
 * characters gone (the set plain() strips), tabs as two spaces, indentation kept, and any x.ruv.io invite code masked:
 * it is a bearer secret, so neither the terminal page nor console_state ever carries one. `trim` false keeps a trailing
 * space (a token typed mid-sentence).
 */
export function termText(line: string, max = 400, trim = true): string {
  // The same strip set as plain() (data/parse.ts), so a character one drops cannot get through the other (#3816).
  const cleaned = maskInvites(line.replace(/\t/g, '  ').replace(ESCAPES, '').replace(INVISIBLE, '').replace(HIDDEN, ''))
  const out = trim ? cleaned.trimEnd() : cleaned

  return out.length <= max ? out : `${out.slice(0, max - 1)}…`
}

/** Appends one line; while the person has scrolled up, the window stays put and the new line is counted instead. */
function add(state: State, line: TermLine): void {
  push(state.terminal.lines, line, TERM_MAX_LINES)
  if (state.terminal.scroll > 0) state.terminal.unseen += 1
}

function note(state: State, kind: TermLine['kind'], text: string, from?: AgentId): void {
  // What the person asked is kept whole (the row can ask it again); an agent's own long lines are the scrollback's to bound.
  for (const line of text.split('\n')) add(state, { kind, text: termText(line, kind === 'in' ? Number.MAX_SAFE_INTEGER : 400), ...(from !== undefined && { from }) })
}

const persist = (state: State, host: Host) => void host.storeSet(termStoreKeyOf(state.cwd), state.terminal.sessions).catch(() => undefined)

/**
 * A run starting or ending adds or drops rows above the field (the spinner, the turn's last line), and the engine
 * does not keep the focus ring on the field across that: the person's next keys would leave it. Put it back after
 * the redraw, while the terminal is in front and the pane holds the keys.
 */
function keepField(state: State, host: Host): void {
  host.after(80, () => {
    if (state.view === 'terminal' && state.pane.isFocused) void host.focus(PANE_ID, 'term-input').catch(() => undefined)
  })
}

/** Why the field's text cannot be sent now, or null when it can. */
export function whyNotRun(state: State, text: string): string | null {
  const harness = harnessOf(state.terminal.harness)
  const busy = harness.agents.find(agent => state.terminal.runs.has(agent))

  if (text.trim() === '') return 'type something first'

  const fit = checkLimit(text.trim(), harness.id === 'ruflo' ? ARGV_TEXT_MAX : LONG_TEXT_MAX, 'the question', harness.id === 'ruflo' ? 'a ruflo command is one argument list' : 'sent to the agent as one prompt')

  if (!fit.ok) return fit.message
  if (busy !== undefined) return `${busy} is still answering: wait, or stop it (s)`
  if (harness.id === 'ruflo' && argvOf(state, 'ruflo', text.trim()) === null) return `that is not one ruflo command (1 to 40 words; this is ${text.trim().split(/\s+/).length})`

  return null
}

/** True when the person said "always accept" in Settings and the harness is an AI one (a ruflo command always asks). */
export const isAutoAccept = (state: State): boolean => settingsOf(state).ai.autoAccept && harnessOf(state.terminal.harness).id !== 'ruflo'

/** True when the text can go straight to the agents: every one of them has a session the person said yes to. */
export const isLive = (state: State): boolean => {
  const agents = harnessOf(state.terminal.harness).agents

  return agents.every(agent => agent !== 'ruflo' && state.terminal.isLive[agent])
}

/** The confirm-gated ask that opens (or resumes) the harness's sessions with this text, or null (see `whyNotRun`). */
export function harnessSpec(state: State, host: Host, text: string): ActionSpec | null {
  if (whyNotRun(state, text) !== null) return null

  const harness = harnessOf(state.terminal.harness)
  const prompt = text.trim()
  const plans = harness.agents.map(agent => ({ agent, argv: argvOf(state, agent, prompt) ?? [] }))
  const verb = harness.agents.every(agent => agent !== 'ruflo' && state.terminal.sessions[agent] !== undefined) ? 'resume' : 'start'

  return {
    label: harness.id === 'ruflo' ? `ruflo ${termText(prompt.replace(/\s+/g, ' '), 48)}` : `${verb} a ${harness.label} session: ${termText(prompt.replace(/\s+/g, ' '), 40)}`,
    args: plans[0]?.argv ?? [],
    shows: plans.map(plan => `${plan.argv.join(' ')}${plan.agent === 'ruflo' ? '' : '  (your text on stdin)'}`).join('  &  '),
    expect: 'its output in the terminal',
    run: async () => {
      for (const agent of harness.agents) if (agent !== 'ruflo') state.terminal.isLive[agent] = true

      send(state, host, prompt)
    },
  }
}

/** Sends the text to every agent of the picked harness at once; each streams into the shared scrollback. */
export function send(state: State, host: Host, text: string): void {
  const harness = harnessOf(state.terminal.harness)
  const prompt = text.trim()

  // A new question brings the window back to the tail, so its answer is seen streaming in.
  state.terminal.scroll = 0
  state.terminal.unseen = 0
  note(state, 'in', prompt, harness.agents.length === 1 ? harness.agents[0] : undefined)

  for (const agent of harness.agents) void runAgent(state, host, agent, prompt)
}

/** Forgets the picked harness's sessions: the next question starts new ones (and is asked first). */
export function newSession(state: State, host: Host): void {
  for (const agent of harnessOf(state.terminal.harness).agents) {
    if (agent === 'ruflo') continue
    delete state.terminal.sessions[agent]
    state.terminal.isLive[agent] = false
  }

  note(state, 'sys', `── new ${state.terminal.harness} session: the next question starts fresh ──`)
  persist(state, host)
  host.invalidate()
}

async function runAgent(state: State, host: Host, agent: AgentId, prompt: string): Promise<void> {
  const term = state.terminal
  // Every line names its agent: the screen draws each answer in that agent's colour, tagged where several talk.
  const tag = agent
  const startedAtMs = Date.now()
  const secs = () => `${Math.round((Date.now() - startedAtMs) / 1000)} s`
  // claude takes the session id the console picks; it counts once the CLI reports the session started.
  const claudeId = agent === 'claude' && term.sessions.claude === undefined ? uuid() : undefined
  const base = argvOf(state, agent, prompt)

  if (base === null) return

  const argv = claudeId === undefined ? base : [...base, '--session-id', claudeId]
  const parse = agent === 'codex' ? codexEvent : agent === 'claude' ? claudeParser() : null
  let open: TermLine | null = null
  let sawSession = false
  let isStopped = false
  let ended: string | null = null
  let events = 0
  let isAnswered = false
  const sink: Sink = {
    line: (kind, text) => {
      open = null
      if (kind === 'out') isAnswered = true
      note(state, kind, text, tag)
    },
    type: text => {
      const parts = text.split('\n')

      isAnswered = true

      parts.forEach((part, i) => {
        if (i > 0 || open === null) {
          open = { kind: 'out', text: '', from: tag }
          add(state, open)
        }
        open.text = termText(open.text + part, 2_000, false)
      })
    },
    session: id => {
      sawSession = true
      if (agent !== 'ruflo' && term.sessions[agent] !== id) {
        term.sessions[agent] = id
        persist(state, host)
      }
    },
    done: ({ costUsd, tokens, isError, message }) => {
      if (agent === 'codex' || agent === 'claude') term.turns[agent] += 1
      if (costUsd !== undefined) {
        term.costUsd += costUsd
        term.costReports += 1
      }
      ended = isError === true ? `✗ ${message ?? 'failed'}` : `✓ ${secs()}${costUsd !== undefined ? ` · $${costUsd.toFixed(3)}` : ''}${tokens !== undefined ? ` · ${tokens.toLocaleString('en-US')} tokens` : ''}`
    },
  }

  let stream: ReturnType<Host['spawn']>

  try {
    stream = host.spawn(argv, agent === 'ruflo' ? undefined : prompt)
  } catch (error) {
    note(state, 'err', `${argv[0]} did not start: ${error instanceof Error ? error.message : String(error)}`, tag)
    host.invalidate()

    return
  }

  const stop = () => {
    isStopped = true
    void stream.return(undefined as never).catch(() => undefined)
  }
  const cap = host.after(RUN_CAP_MS, stop)
  const partial = { stdout: '', stderr: '' }

  term.runs.set(agent, { label: agent, startedAtMs, stop })
  keepField(state, host)
  note(state, 'head', agent, tag)
  host.invalidate()

  const take = (from: 'stdout' | 'stderr', line: string) => {
    if (from === 'stderr' || parse === null) {
      // codex and claude write progress to stderr; only a line that reads as an error is worth a row.
      if (parse === null || /error|denied|not found|invalid/i.test(line)) sink.line(from === 'stderr' ? 'err' : 'out', line)

      return
    }

    const event = eventOf(line)

    if (event !== null) {
      events += 1
      parse(event, sink)
    }
  }

  try {
    for await (const chunk of stream) {
      const lines = (partial[chunk.stream] + chunk.text).split('\n')

      partial[chunk.stream] = lines.pop() ?? ''
      for (const line of lines) if (line.trim() !== '' || parse === null) take(chunk.stream, line)
      host.invalidate()
    }

    for (const from of ['stdout', 'stderr'] as const) if (partial[from].trim() !== '') take(from, partial[from])

    const result = await stream.result

    if (claudeId !== undefined && !sawSession) delete term.sessions.claude
    // A stream read to its end with events but no answer drawn: the CLI's format moved, and silence would hide it.
    if (parse !== null && !isStopped && !isAnswered && ended === null) note(state, 'err', `no answer read from ${events} ${agent} event${events === 1 ? '' : 's'}: has its --json format changed?`, tag)
    note(state, 'end', isStopped ? `stopped after ${secs()}` : (ended ?? (result.code === 0 ? `✓ ${secs()}` : `✗ exit ${result.code ?? result.signal ?? '?'} · ${secs()}`)), tag)
  } catch (error) {
    if (claudeId !== undefined && !sawSession) delete term.sessions.claude
    note(state, 'end', isStopped ? `stopped after ${secs()}` : `✗ ${argv[0]}: ${error instanceof Error ? error.message : String(error)} (is it installed and on PATH?)`, tag)
  } finally {
    cap.cancel()
    term.runs.delete(agent)
    keepField(state, host)
    host.invalidate()
  }
}
