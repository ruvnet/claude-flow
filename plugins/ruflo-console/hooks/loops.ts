/**
 * The Loop Manager: presets from practical to exotic, a configurator (interval, task, stop condition), and a launcher that starts the
 * loop in the main Claude UI as a visible `/loop` prompt. A loop spends a model turn on every tick until it stops, so it asks first,
 * says so, and always carries a stop condition when one is set. What the person types is data: a task that begins with a slash must
 * be a plugin command the session lists, a typed task is screened by AIDefence, and everything is cut to a short single line.
 */
import { checkLimit, LONG_TEXT_MAX } from './full-text'
import type { ActionSpec } from './actions'
import { plain } from './data/parse'
import type { Host } from './host'
import { mcOf } from './mission-control'
import { blocksGuidance, screenText } from './mission-options'
import type { Runner } from './runner'
import type { State } from './state'

export type LoopTier = 'practical' | 'steady' | 'exotic'

export type LoopPreset = {
  id: string
  tier: LoopTier
  title: string
  about: string
  /** One of INTERVALS. */
  interval: string
  /** The task, in words, or one plugin command (`/plugin:command args`) for a worker. */
  task: string
  /** Why this one costs: what each tick does. */
  cost: string
  /**
   * A security sentry, offered on the Security page: `watch` finds and reports and edits nothing; `fix` also fixes the top finding,
   * in a new worktree branch. The guard (read-only, never push) leads the task, so a cut at the length limit cannot remove it.
   */
  sentry?: 'watch' | 'fix'
}

export const INTERVALS = ['self-paced', '1m', '5m', '10m', '30m', '1h', '4h', '1d'] as const
export const TIERS: readonly { id: LoopTier; title: string; about: string }[] = [
  { id: 'practical', title: 'Practical', about: 'everyday watching and fixing' },
  { id: 'steady', title: 'Steady', about: 'scheduled upkeep and autopilot' },
  { id: 'exotic', title: 'Exotic', about: 'self-pacing, consensus and learning loops' },
]

export const PRESETS: readonly LoopPreset[] = [
  { id: 'ci-watch', tier: 'practical', title: 'Watch CI on this branch', about: 'report failures with the log lines, fix what is mine', interval: '5m', task: 'Check CI for the current branch’s pull request. If a check failed, read its log, fix the cause and push; otherwise say what is still running.', cost: 'one short turn per tick; reads and may push fixes' },
  { id: 'test-fix', tier: 'practical', title: 'Keep the tests green', about: 'run the test suite, fix a failure at a time', interval: '10m', task: 'Run the project’s tests. If any fail, find the cause and fix it with the smallest change, then run them again.', cost: 'a turn per tick; edits files' },
  { id: 'pr-babysit', tier: 'practical', title: 'Babysit open PRs', about: 'rebase, answer review comments, merge when green', interval: '10m', task: 'List my open pull requests. For each: rebase if behind, address review comments, and report when checks are green. Do not merge without asking.', cost: 'a turn per tick; may push' },
  { id: 'worker-audit', tier: 'practical', title: 'Audit worker', about: 'security scanning on a schedule (ruflo-loop-workers)', interval: 'self-paced', task: '/ruflo-loop-workers:ruflo-loop audit', cost: 'the worker runs, then schedules its own next wake-up' },
  { id: 'worker-testgaps', tier: 'practical', title: 'Test-gap worker', about: 'find untested code on a schedule', interval: 'self-paced', task: '/ruflo-loop-workers:ruflo-loop testgaps', cost: 'the worker runs, then schedules its own next wake-up' },
  { id: 'worker-optimize', tier: 'steady', title: 'Optimize worker', about: 'performance optimisation upkeep', interval: 'self-paced', task: '/ruflo-loop-workers:ruflo-loop optimize', cost: 'the worker runs, then schedules its own next wake-up' },
  { id: 'worker-consolidate', tier: 'steady', title: 'Memory consolidation worker', about: 'keep memory compact and recallable', interval: 'self-paced', task: '/ruflo-loop-workers:ruflo-loop consolidate', cost: 'low priority; a short turn per tick' },
  { id: 'autopilot', tier: 'steady', title: 'Autopilot', about: 'finish the task list on its own, supervised', interval: 'self-paced', task: '/ruflo-autopilot:autopilot', cost: 'a turn per step until the list is done' },
  { id: 'schedule', tier: 'steady', title: 'Nightly schedule', about: 'a recurring ruflo job on a cron (ruflo-schedule)', interval: '1d', task: '/ruflo-loop-workers:ruflo-schedule', cost: 'one turn a day' },
  { id: 'docs-sync', tier: 'steady', title: 'Keep docs in step', about: 'update docs and ADRs for what changed', interval: '1h', task: 'Compare the last hour’s commits with the docs and ADRs; update whatever no longer matches the code, in one small commit.', cost: 'a turn per tick; edits docs' },
  { id: 'drift-watch', tier: 'exotic', title: 'Harness drift watch', about: 'MetaHarness drift against a baseline, alert on worsening', interval: '30m', task: 'Run `npx ruflo metaharness drift-from-history --alert-on-new-severity high`. Report only a change from the last tick.', cost: 'a short turn per tick; reads local files' },
  { id: 'dream-cycle', tier: 'exotic', title: 'Dream cycle', about: 'flywheel: evaluate candidates into receipts, never promote', interval: '1h', task: 'Run `npx ruflo metaharness flywheel run --proposer auto --max-concurrency 2`, then list the new receipts. Do not promote anything.', cost: 'a turn per tick; evaluation may spend on a model proposer' },
  { id: 'hive-vote', tier: 'exotic', title: 'Hive consensus loop', about: 'each tick: the hive proposes, votes and records the decision', interval: '30m', task: 'Use the hive-mind: propose the next most valuable improvement to this project, have the workers vote, and record the decision with its tally in memory.', cost: 'a longer turn per tick: several agents' },
  { id: 'horizon', tier: 'exotic', title: 'Long-horizon tracker', about: 'checkpoint a long objective across sessions, detect drift', interval: '1h', task: '/ruflo-goals:horizon-track', cost: 'a turn per tick; writes memory checkpoints' },
  { id: 'ultralearn', tier: 'exotic', title: 'Ultralearn', about: 'deep knowledge acquisition into memory and patterns', interval: 'self-paced', task: '/ruflo-loop-workers:ruflo-loop ultralearn', cost: 'long turns; the worker schedules itself' },
  // Security sentries (the Security page lists these): five that find and report, one that also fixes in an isolated branch.
  { id: 'sentry-live', tier: 'practical', sentry: 'watch', title: 'Sentry: live, on change', about: 'scan as files change and report only new findings', interval: 'self-paced', task: 'Read-only. Use the Monitor tool to watch this repo: poll `git status --porcelain` every 20 s and emit a line only when it changes. On each event run `npx ruflo security scan --depth quick --type code --output json` and report only findings that are new since the last event. Edit nothing.', cost: 'a turn only when files change (events, not polling turns); edits nothing' },
  { id: 'sentry-quick', tier: 'practical', sentry: 'watch', title: 'Sentry: quick scan', about: 'a quick code scan, new findings only', interval: '30m', task: 'Read-only. Run `npx ruflo security scan --depth quick --type code --output json`. Report only findings that are new since the last tick, by severity and file, and say nothing if there are none. Edit nothing.', cost: 'a short turn per tick; edits nothing; writes the scan report' },
  { id: 'sentry-secrets', tier: 'practical', sentry: 'watch', title: 'Sentry: secrets and PII', about: 'secrets, PII and injection text in the tree and recent commits', interval: '4h', task: 'Read-only. Run `npx ruflo security secrets`, then check the last 20 commits and the working tree for secrets, PII or prompt-injection text. Report file and type only, and never print a value. Edit nothing.', cost: 'a short turn per tick; edits nothing; values are never shown' },
  { id: 'sentry-nightly', tier: 'steady', sentry: 'watch', title: 'Sentry: nightly deep scan', about: 'a deep scan and STRIDE threats, grouped by root cause', interval: '1d', task: 'Read-only. Run `npx ruflo security scan --depth deep --type code --output json` and `npx ruflo security threats`. Group the findings by root cause, rank them by risk, and say what changed since yesterday. Edit nothing.', cost: 'one longer turn a day; edits nothing; writes the scan report' },
  { id: 'sentry-deps', tier: 'steady', sentry: 'watch', title: 'Sentry: dependencies', about: 'known CVEs in the dependency tree, with the fixing version', interval: '1d', task: 'Read-only. Run `npx ruflo security cve --list`. For each vulnerable dependency give the fixed version and what an upgrade could break. Propose the upgrades; change no file and open no pull request.', cost: 'one turn a day; reaches npm (npm audit); edits nothing' },
  { id: 'sentry-fix', tier: 'steady', sentry: 'fix', title: 'Sentry: find and fix', about: 'fix the top real finding in its own branch, never push', interval: '1h', task: 'Never push or merge, never edit this checkout. Run `npx ruflo security scan --depth quick --type code --output json`. Take the highest-severity real finding (skip false positives), make a git worktree on branch sentry/<date>-<id>, fix it with the smallest change, run the tests, commit there, and report the branch and diff.', cost: 'a turn per tick; edits files only in a new worktree branch and commits there; never pushes (the guard is the instruction, not a sandbox)' },
  { id: 'self-heal', tier: 'exotic', title: 'Self-heal the swarm', about: 'find stuck agents and claims, release, re-route', interval: '10m', task: 'Check the swarm: find agents or claims that have made no progress for 10 minutes, release or hand them off, and say what you changed.', cost: 'a turn per tick; writes through confirmed commands' },
]

export type LoopCfg = { tier: LoopTier; preset: string | null; interval: string; task: string; stop: string }

const configs = new WeakMap<State, LoopCfg>()

export function loopsOf(state: State): LoopCfg {
  let found = configs.get(state)

  if (found === undefined) {
    found = { tier: 'practical', preset: null, interval: '10m', task: '', stop: '' }
    configs.set(state, found)
  }

  return found
}

const SLASH = /^\/([a-z0-9-]+:[A-Za-z0-9._-]+)(?: [A-Za-z0-9 ._:,=-]{0,120})?$/
/** A task longer than this is cut, so every preset must fit: the spec fails on one that does not. */
/**
 * A loop's task is sent on EVERY tick, billed each time, so it has a real bound (ADR-481): MAX_TASK characters for the task and MAX_LOOP for the
 * whole `/loop` line. Over it the start is refused with the exact count and the typed task is kept; it is never cut.
 */
export const MAX_TASK = 4_000
const MAX_LOOP = MAX_TASK + 200

/** The stop condition as a clause for the loop's prompt, or why it is not understood. Empty is "no stop condition". */
export function stopClause(raw: string): { ok: true; clause: string } | { ok: false; why: string } {
  const text = raw.trim().toLowerCase()

  if (text === '') return { ok: true, clause: '' }

  const until = /^until ((?:[01]?\d|2[0-3]):[0-5]\d)$/.exec(text)

  if (until !== null) return { ok: true, clause: `Stop the loop at ${until[1]} local time and report a one-line outcome.` }

  const runs = /^after (\d{1,3}) (?:runs|ticks)$/.exec(text)

  if (runs !== null && Number(runs[1]) >= 1) return { ok: true, clause: `Stop the loop after ${runs[1]} runs and report a one-line outcome.` }
  if (text === 'when done') return { ok: true, clause: 'Stop the loop when the work is complete and report a one-line outcome.' }

  return { ok: false, why: 'stop reads "until 09:00", "after 12 runs" or "when done" (or leave it empty)' }
}

/** The exact `/loop` input for a configuration, or why it cannot run. `listed` are the slash commands the session offers. */
export function loopInput(cfg: LoopCfg, listed: readonly string[]): { ok: true; text: string } | { ok: false; why: string } {
  const task = plain(cfg.task, LONG_TEXT_MAX).trim()
  const fit = checkLimit(task, MAX_TASK, 'the task', 'the loop sends it again on every tick')

  if (!fit.ok) return { ok: false, why: fit.message }

  if (task === '') return { ok: false, why: 'pick a preset or type what the loop should do' }
  if (!(INTERVALS as readonly string[]).includes(cfg.interval)) return { ok: false, why: 'pick an interval' }

  if (task.startsWith('/')) {
    const slash = SLASH.exec(task)?.[1]

    if (slash === undefined) return { ok: false, why: 'a task that starts with / must be one plugin command: /plugin:command and a few plain words' }
    if (!listed.includes(slash)) return { ok: false, why: `/${slash} is not offered by this session: install its plugin (Plugin Catalog) and /reload-plugins` }
  }

  const stop = stopClause(cfg.stop)

  if (!stop.ok) return stop

  const text = `/loop ${cfg.interval === 'self-paced' ? '' : `${cfg.interval} `}${task}${stop.clause === '' ? '' : ` ${stop.clause}`}`

  const whole = checkLimit(text, MAX_LOOP, 'the /loop line', 'the loop sends it again on every tick')

  return whole.ok ? { ok: true, text } : { ok: false, why: whole.message }
}

export type LoopActions = {
  tier: (tier: LoopTier) => void
  pick: (id: string) => void
  interval: (value: string) => void
  task: (text: string) => void
  stop: (text: string) => void
  /** Starts the loop in the main Claude UI as a visible /loop prompt (asks first; mid-turn it only fills the prompt box). */
  launch: () => void
  /** Asks the main Claude to list the scheduled loops and stop the ones named. */
  manage: () => void
}

/** A `/loop` input: the arguments after the command name. */
const LOOP_COMMAND = /^\/loop(?:\s+([\s\S]*))?$/

export function loopActions(state: State, host: Host, runner: Runner): LoopActions {
  const cfg = loopsOf(state)
  const say = (label: string, ok: boolean, detail: string, next?: string) => {
    mcOf(state).last = { label, ok, detail, atMs: Date.now(), ...(next !== undefined && { next }) }
    host.invalidate()
  }
  // `/loop` is a slash command, so it runs as one (`$.command.run`, as if typed). Submitting it as a prompt sends the model a message that
  // merely looks like a command: no loop is created. Any other text (the manage ask) is a real prompt. Mid-turn the command can only wait in
  // the prompt box, and the person is told so: nothing starts until they press Enter, and a silent fill looked like a click that did nothing.
  const send = async (text: string): Promise<void> => {
    if (state.turnActive) {
      const isFilled = await host.fillPrompt(text)

      return say(
        isFilled ? 'waiting in your prompt box' : 'could not fill the prompt box',
        isFilled,
        isFilled ? 'Claude is mid-turn, so the command is in your prompt box.' : `the prompt box is not available (a dialog is open?); type it yourself: ${plain(text, 100)}`,
        isFilled ? 'press Enter in the prompt box to start it' : 'close the dialog, then start it again',
      )
    }

    const loop = LOOP_COMMAND.exec(text)

    if (loop === null) return host.submitPrompt(text)

    await host.runSlash('loop', loop[1] ?? '')
    say('loop command sent', true, 'Sent as /loop: it starts a Claude Code turn, and Claude reports what it scheduled in the conversation.', 'watch the conversation; ☰ list / stop my sentries shows and stops it')
  }
  const ask = (text: string, label: string, note: string): void =>
    runner.ask(
      {
        label,
        scope: 'loop',
        args: [],
        shows: text,
        expect: 'the loop in the main conversation',
        note,
        run: async () => {
          try {
            await send(text)
          } catch (error) {
            say('Claude did not take it', false, plain(error instanceof Error ? error.message : String(error), 140), 'check the command is offered here (/reload-plugins), then start it again')
          }
        },
      } satisfies ActionSpec,
      'nothing to start',
    )

  return {
    tier: tier => {
      cfg.tier = tier
      host.invalidate()
    },
    pick: id => {
      const preset = PRESETS.find(candidate => candidate.id === id)

      if (preset === undefined) return

      cfg.preset = id
      cfg.interval = preset.interval
      cfg.task = preset.task
      cfg.stop = ''
      host.invalidate()
    },
    interval: value => {
      if ((INTERVALS as readonly string[]).includes(value)) cfg.interval = value
      host.invalidate()
    },
    task: text => {
      cfg.task = plain(text, LONG_TEXT_MAX)
      // A hand-written task is no longer the preset it started from.
      if (PRESETS.find(candidate => candidate.id === cfg.preset)?.task !== cfg.task) cfg.preset = null
      host.invalidate()
    },
    stop: text => {
      cfg.stop = plain(text, 40)
      host.invalidate()
    },
    launch: () => {
      const built = loopInput(cfg, state.commandNames)

      if (!built.ok) return say('loop not started', false, built.why)

      const preset = PRESETS.find(candidate => candidate.id === cfg.preset)
      const go = () => ask(built.text, `start a loop in the main Claude UI: ${plain(built.text, 70)}`, `Starts a recurring /loop: a Claude Code turn on every tick, billed as any turn is${preset === undefined ? '' : ` (${preset.cost})`}; it auto-expires after 7 days. ${cfg.stop === '' ? 'No stop condition is set.' : ''}`.trim())

      // A hand-written task is screened before a model sees it; a preset is the console's own text.
      if (preset !== undefined || !mcOf(state).isScreenOn) return go()

      void screenText(state, host, cfg.task).then(screen => (blocksGuidance(screen) ? say('AIDefence blocked the task', false, screen.detail) : go()))
    },
    manage: () =>
      ask(
        'List my scheduled loops and wake-ups (CronList and any pending ScheduleWakeup), say what each does and when it next runs, and ask me which to stop before stopping any.',
        'ask Claude to list my loops and stop the ones I name',
        'Starts a Claude Code turn (billed as any turn is); it stops nothing without asking you.',
      ),
  }
}
