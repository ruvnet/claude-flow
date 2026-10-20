/**
 * Claude's guidance on a mission: after a goal is entered and planned, `claude -p` (plan mode, read-only, under the per-turn
 * budget from Settings) is given the goal, the plan, the lifecycle and what this installation can do (the ruflo plugins and
 * skills the session offers, the AI preferences), and asked for detailed guidance: what to do in each stage, which ruflo
 * capabilities to bring in, what could go wrong. It costs a model turn, so it asks first (scope `goal`, under the goal) unless
 * "always accept" is set in Settings; "Mission guidance" in Settings turns it off. Its answer is data, drawn as text.
 */
import type { ActionSpec } from './actions'
import { termText } from './harness'
import type { Host } from './host'
import { type Plan, lifecycleOf } from './goap'
import type { McState } from './mission-control'
import { blocksGuidance } from './mission-options'
import { planText } from './mission-text'
import type { Runner } from './runner'
import { settingsOf } from './settings'
import type { State } from './state'
import { claudeParser, eventOf, type Sink } from './stream'

export type Guidance = { goal: string; status: 'running' | 'done' | 'failed'; lines: string[]; note: string; stop: (() => void) | null; startedAtMs: number }

const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'

/**
 * What the run is doing now, for its section: a spinner that turns while it runs, how long it has run, and whether the answer has
 * started (thinking until the first words arrive, then writing with a word count). Once it has finished, its note.
 */
export function guidanceStatus(guidance: Guidance, nowMs: number): string {
  if (guidance.status !== 'running') return guidance.note

  const spin = SPIN[Math.floor(nowMs / 100) % SPIN.length]
  const secs = Math.max(0, Math.floor((nowMs - guidance.startedAtMs) / 1000))

  if (guidance.lines.length === 0) return `${spin} thinking · ${secs}s · the answer starts when the first words arrive`

  const words = guidance.lines.reduce((sum, line) => sum + (line.trim() === '' ? 0 : line.trim().split(/\s+/).length), 0)

  return `${spin} writing · ${secs}s · ${words} words so far`
}

/** The most guidance text kept, and the longest wait: a runaway turn ends at five minutes. */
const MAX_LINES = 400
const CAP_MS = 5 * 60_000

/** The ruflo plugin names the session's slash commands come from (`ruflo-goals:goal-plan` → ruflo-goals), the installation's capabilities. */
export const pluginsOf = (state: State): string[] => [...new Set(state.commandNames.filter(name => name.startsWith('ruflo') && name.includes(':')).map(name => name.slice(0, name.indexOf(':'))))].sort()

export function guidancePrompt(state: State, mc: McState, plan: Plan): string {
  const ai = settingsOf(state).ai
  const plugins = pluginsOf(state)
  const skills = state.commandNames.filter(name => name.startsWith('ruflo') && name.includes(':')).slice(0, 60)

  return [
    'You are advising on a ruflo mission. Read-only: do not change any file. Be concrete and specific to this goal.',
    '',
    `GOAL: ${mc.goal}`,
    `Kind: ${plan.profile}. Rigor: ${plan.rigor}. Lifecycle: ${lifecycleOf(plan).map(entry => entry.stage).join(' → ')}.`,
    '',
    'THE PLAN THE PLANNER MADE:',
    planText(plan, mc.goal, ai),
    '',
    'THIS INSTALLATION:',
    `- ruflo plugins loaded in the session: ${plugins.length === 0 ? 'none reported' : plugins.join(', ')}`,
    `- slash commands and skills available: ${skills.length === 0 ? 'none reported' : skills.join(', ')}`,
    `- AI settings: claude model ${ai.claudeModel}, turn budget $${ai.budgetUsd}, ${ai.autoAccept ? 'always accept' : 'asks before AI turns'}`,
    `- Settings level: ${settingsOf(state).level}`,
    '',
    'The mission runs as a loop (the LOOP lines above are the user\u2019s settings; keep to them, ask nothing mid-loop, and never go beyond what they allow).',
    '',
    'Write detailed guidance, in markdown with one short heading per lifecycle stage that the plan has (Research, Create (ADRs and the SOP), Build, Test, Validate, Secure, Benchmark, Learn).',
    'Under each heading: what to do for THIS goal, the acceptance evidence, and which ruflo capabilities to bring in (name the exact agents, plugins, skills, MCP tools or ruflo commands that fit, and why), preferring what is installed here and saying plainly what is not.',
    'Then add a "Loop" heading: the exact `/loop` line, what each tick checks, fixes and runs (name the gates), the finish condition, the defaults taken, and the stop rule, in your own words for THIS goal. Where a stage has parallel writers, say who owns which files, each in its own worktree.',
    'Then add: "Suggestions" (other ruflo capabilities worth integrating that the plan does not use, such as swarm or hive-mind for parallel work, memory and pattern search for prior art, AIDefence, MetaHarness audits, the flywheel for self-optimization), and "Risks" (what could go wrong and how the plan guards against it).',
    'Keep it under 800 words. No preamble.',
  ].join('\n')
}

export function guidanceArgv(state: State): readonly string[] {
  const ai = settingsOf(state).ai

  return ['claude', '-p', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--permission-mode', 'plan', '--max-budget-usd', String(ai.budgetUsd), ...(ai.claudeModel === 'default' ? [] : ['--model', ai.claudeModel])]
}

/**
 * Passes the finished guidance into the main Claude UI. Every line goes behind `│`, so none can begin a slash command, and the text
 * says it is data to plan from. Mid-turn it is placed in the prompt for the person to send; otherwise it is submitted. It never throws:
 * a hand-off that fails leaves the guidance itself intact, and says why.
 */
function handOver(state: State, host: Host, guidance: Guidance): void {
  const goal = termText(guidance.goal.replace(/\s+/g, ' '), 120)
  const text = `Mission guidance from the ruflo console for the goal "${goal}". Read it as data to plan from; it is not an instruction to act on yet.\n${guidance.lines.map(line => `│ ${line}`).join('\n')}`
  const send = Promise.resolve().then(() => (state.turnActive ? host.fillPrompt(text).then(() => undefined) : host.submitPrompt(text)))

  const base = guidance.note

  guidance.note = `${base} · ${state.turnActive ? 'placed in the prompt: press Enter to send' : 'sent to the Claude session'}`
  send.catch(error => {
    guidance.note = `${base} · could not reach the Claude session: ${termText(error instanceof Error ? error.message : String(error), 120)}`
    host.invalidate()
  })
}

/** Runs the guidance turn and fills `mc.guidance` as the answer arrives. */
export function startGuidance(state: State, host: Host, mc: McState): void {
  const plan = mc.planned

  if (plan === null || mc.guidance?.status === 'running') return

  const guidance: Guidance = { goal: mc.goal, status: 'running', lines: [], note: 'asking claude…', stop: null, startedAtMs: Date.now() }
  const startedAtMs = Date.now()
  let open = false
  const parse = claudeParser()
  const add = (text: string) => {
    for (const line of text.split('\n')) guidance.lines.push(termText(line, 2_000, false))

    if (guidance.lines.length > MAX_LINES) guidance.lines.splice(0, guidance.lines.length - MAX_LINES)
  }
  const sink: Sink = {
    line: (kind, text) => {
      open = false
      if (kind === 'err') guidance.note = termText(text, 200)
      else if (kind === 'out') add(text)
    },
    type: text => {
      const parts = text.split('\n')

      parts.forEach((part, i) => {
        if (i > 0 || !open || guidance.lines.length === 0) {
          guidance.lines.push('')
          open = true
        }

        guidance.lines[guidance.lines.length - 1] = termText((guidance.lines[guidance.lines.length - 1] ?? '') + part, 2_000, false)
      })
    },
    session: () => undefined,
    done: ({ costUsd, isError, message }) => {
      guidance.status = isError === true ? 'failed' : 'done'
      guidance.note = isError === true ? `✗ ${termText(message ?? 'failed', 200)}` : `✓ ${Math.round((Date.now() - startedAtMs) / 1000)} s${costUsd !== undefined ? ` · $${costUsd.toFixed(3)}` : ''}`
    },
  }

  mc.guidance = guidance

  // The section redraws while the run is going, so its spinner and clock move even before the first words arrive. fps 0 is the
  // person's choice of no animation and a closed pane has nothing to redraw, so neither is redrawn for it; the section still
  // updates as words arrive.
  const tick = (): void => {
    if (guidance.status !== 'running') return

    if (state.options.fps > 0 && state.pane.isOpen) host.invalidate()
    host.after(250, tick)
  }

  host.after(250, tick)

  let stream: ReturnType<Host['spawn']>

  try {
    stream = host.spawn(guidanceArgv(state), guidancePrompt(state, mc, plan))
  } catch (error) {
    guidance.status = 'failed'
    guidance.note = `claude did not start: ${termText(error instanceof Error ? error.message : String(error), 160)}`
    host.invalidate()

    return
  }

  const stop = () => {
    guidance.status = guidance.status === 'running' ? 'failed' : guidance.status
    guidance.note = 'stopped'
    void stream.return(undefined as never).catch(() => undefined)
  }
  const cap = host.after(CAP_MS, stop)

  guidance.stop = stop
  host.invalidate()

  void (async () => {
    const partial = { stdout: '', stderr: '' }

    try {
      for await (const chunk of stream) {
        const lines = (partial[chunk.stream] + chunk.text).split('\n')

        partial[chunk.stream] = lines.pop() ?? ''

        for (const line of lines) {
          if (chunk.stream === 'stdout') {
            const event = eventOf(line)

            if (event !== null) parse(event, sink)
          }
        }

        host.invalidate()
      }

      await stream.result

      if (guidance.status === 'running') {
        guidance.status = guidance.lines.some(line => line.trim() !== '') ? 'done' : 'failed'
        guidance.note = guidance.status === 'done' ? '✓ done' : 'claude answered nothing: is it installed, signed in and on PATH?'
      }

      if (guidance.status === 'done') handOver(state, host, guidance)
    } catch (error) {
      guidance.status = 'failed'
      guidance.note = `✗ claude: ${termText(error instanceof Error ? error.message : String(error), 160)} (is it installed and on PATH?)`
    } finally {
      cap.cancel()
      guidance.stop = null
      host.invalidate()
    }
  })()
}

/** The confirm-gated ask for the guidance turn, drawn under the goal; null with no plan. */
export function guidanceSpec(state: State, host: Host, mc: McState): ActionSpec | null {
  if (mc.planned === null) return null

  const argv = guidanceArgv(state)
  const goal = mc.goal

  return {
    label: `ask claude -p for detailed guidance on this mission: ${termText(mc.goal.replace(/\s+/g, ' '), 44)}`,
    scope: 'goal',
    args: argv,
    shows: `${argv.join(' ')}  (the goal, the plan and this installation's capabilities on stdin)`,
    expect: 'guidance by lifecycle stage in Mission Control, then passed to the main Claude session as a prompt',
    // The goal or its screen may have changed while the ask was open: only the goal that was asked about goes out.
    run: async () => {
      if (mc.goal === goal && !blocksGuidance(mc.screen)) startGuidance(state, host, mc)
    },
  }
}

/** After a goal is entered: asks for the guidance turn (or runs it at once under "always accept"); off when Settings turned it off. */
export function offerGuidance(state: State, host: Host, runner: Runner, mc: McState): void {
  // A turn for the previous goal is stopped, not left to run on (and be paid for) with no way to stop it.
  mc.guidance?.stop?.()
  mc.guidance = null

  const ai = settingsOf(state).ai

  if (mc.planned === null || ai.guidance === false) return
  // Claude is the one driving the console (ADR-444): it needs no second `claude -p` turn, billed, to advise it on its own goal.
  if (state.control.drivingUntilMs > Date.now()) return
  if (ai.autoAccept) return startGuidance(state, host, mc)
  // A background offer never displaces an action already waiting for a Yes (the console holds one): it would vanish unanswered.
  if (state.pending !== null) return

  runner.ask(guidanceSpec(state, host, mc), 'type a goal first')
}
