/**
 * The Conversation's live half (ADR-465): one conversation per console state, the facts it reads once (the peers file, whether the codex CLI
 * exists, the home folder), and the `ActionSpec`s that send, fan out, relay, watch and save. The pure rules are in data/wf-targets.ts,
 * data/wf-send.ts and data/wf-convo.ts; this binds them to the host. Every spec's card shows the exact payload (data/wf-send.ts
 * `payloadOf`, the same strings `sendTo` sends), a send that leaves the machine says so, and nothing runs before the person confirms.
 */
import type { ActionSpec } from './actions'
import { cleanText } from './data/wf-clean'
import { addMessage, applyFetch, FETCH_MAX, fromBbs, fromChannel, newConvo, pollParams, POLL_MAX, POLL_MS, recordSend, relayBody, lastAnswer, threadOf, transcriptMarkdown, transcriptName, type Convo } from './data/wf-convo'
import { checkNoLinks, EXPORT_DIR, resolveExportPath } from './data/wf-file'
import { writeFlavorReady } from './data/write-flavor'
import { exportSpec } from './data/wf-export'
import { payloadOf, sendTo, type SendDeps, tidy } from './data/wf-send'
import { parseConfig, peersOf, targetsOf, type Config, type PeerRef, type Target } from './data/wf-targets'
import { jsonAfter } from './data/cli'
import { plain } from './data/parse'
import type { WfRun } from './data/workflows'
import type { Host } from './host'
import { CLI_PREFIXES, type State } from './state'
import { afterRead } from './wf-live'

export type Live = { convo: Convo; draft: string; relayDraft: string; config: Config; peers: PeerRef[]; hasCodex: boolean; home: string | null; checkedAtMs: number; said: string | null; timers: Map<string, { cancel: () => void }> }

const lives = new WeakMap<State, Live>()
const hosts = new WeakMap<State, Host>()

const fresh = (): Live => ({ convo: newConvo(), draft: '', relayDraft: '', config: parseConfig(''), peers: [], hasCodex: false, home: null, checkedAtMs: 0, said: null, timers: new Map() })

export function liveOf(state: State): Live {
  let held = lives.get(state)

  if (held === undefined) {
    held = fresh()
    lives.set(state, held)
  }

  return held
}

let isHooked = false

/**
 * The wiring: the host, and the option string that names the endpoints, rooms and channels (nothing secret: a key is a variable's name). The
 * facts the target list depends on are read after each read of the run folders (`afterRead`, which runs only while the page is open), never
 * from a render: a view calls nothing on the engine.
 */
export function wireConvo(state: State, host: Host, optionText?: string): void {
  hosts.set(state, host)
  if (optionText !== undefined) liveOf(state).config = parseConfig(optionText)

  if (isHooked) return

  isHooked = true
  afterRead.push((s, _h, _before, _runs, nowMs) => void refreshFacts(s, nowMs))
}

export const hostOf = (state: State): Host | null => hosts.get(state) ?? null

const SAY_MAX = 200
/** What the confirm card can show of one send; a payload longer than this is refused (see sendSpec). */
export const CARD_MAX = 6000

const say = (state: State, label: string, ok: boolean, detail: string): void => {
  state.outcome = { label, ok, verified: 'n/a', detail: tidy(plain(detail, SAY_MAX), SAY_MAX), atMs: Date.now() }
  hosts.get(state)?.invalidate()
}

/**
 * Reads what the target list depends on, at most once a minute and only while the Conversation is open: the federation helper's peers
 * file and whether `codex` is on the PATH. Each read is bounded and a failure is an empty list, not an error.
 */
export async function refreshFacts(state: State, nowMs: number): Promise<void> {
  const host = hosts.get(state)
  const live = liveOf(state)

  if (host === undefined || nowMs - live.checkedAtMs < 60_000) return

  live.checkedAtMs = nowMs
  live.home = (await host.home().catch(() => undefined)) ?? live.home

  if (live.home !== null) live.peers = peersOf(await host.fs.read(`${live.home}/.claude/federation/peers.json`).then(text => (text.length > 200_000 ? null : text), () => null))

  const found = await host.run(['which', 'codex'], 3000).catch(() => undefined)

  live.hasCodex = found !== undefined && found.exitCode === 0
  host.invalidate()
}

/** The targets now: the running agents of the runs on the page, the hive if one exists, and what the facts and the option added. */
export function targetsFor(state: State, runs: readonly WfRun[]): Target[] {
  const live = liveOf(state)
  const agents = runs.filter(run => run.kind === 'workflow').flatMap(run => run.phases.flatMap(phase => phase.agents)).filter(agent => agent.state === 'running' && /^[A-Za-z0-9][A-Za-z0-9_-]{5,63}$/.test(agent.id)).map(agent => ({ id: agent.id, name: agent.label }))

  return targetsOf({ agents, peers: live.peers, config: live.config, hasHive: state.snapshot?.hive != null, hasCodex: live.hasCodex })
}

/** What `sendTo` needs from the host, for this state. Null where there is no host. */
export function depsOf(state: State): SendDeps | null {
  const host = hosts.get(state)
  const live = liveOf(state)

  if (host === undefined) return null

  return {
    toolCall: host.toolCall,
    toolCheck: host.toolCheck,
    run: host.run,
    httpSend: host.httpSend,
    submitPrompt: host.submitPrompt,
    cli: CLI_PREFIXES[state.options.cli],
    helper: `${live.home ?? '~'}/.claude/helpers/federation.sh`,
    trustedPeers: new Set(live.peers.filter(peer => peer.trusted).map(peer => peer.host)),
    cwd: state.cwd,
    hive: state.snapshot?.hive ?? null,
    config: live.config,
  }
}

/**
 * One confirm card for asking one or several targets the same thing. The card's `shows` lists every payload (what leaves the machine is named
 * per target); `run` sends them one after another so a refusal or a slow peer does not hide the others, and each answer lands in its own thread.
 */
export function sendSpec(state: State, targets: readonly Target[], body: string): { spec: ActionSpec | null; why: string } {
  const deps = depsOf(state)
  const live = liveOf(state)

  if (deps === null) return { spec: null, why: 'the console is not wired to a host here' }
  if (targets.length === 0) return { spec: null, why: 'pick a target, or name one with @name' }

  if (live.home === null && targets.some(target => target.transport === 'peer')) return { spec: null, why: 'the home folder is not known yet, so the federation helper cannot be located: nothing is sent to a peer' }

  const made = targets.map(target => ({ target, built: payloadOf(target, body, deps) }))
  const bad = made.find(entry => !entry.built.ok)

  if (bad !== undefined && !bad.built.ok) return { spec: null, why: `${bad.target.id}: ${bad.built.why}` }

  const leaving = targets.filter(target => target.leaves !== 'machine')
  const shows = made.map(entry => (entry.built.ok ? `${entry.target.id}: ${entry.built.payload.shows}` : '')).join('\n')

  // The card must show EVERYTHING that is sent: a payload the card would cut is refused, never sent with its tail hidden.
  if (shows.length > CARD_MAX) return { spec: null, why: `the payload is ${shows.length} characters and the confirm card shows ${CARD_MAX}: shorten the message or ask fewer targets, so nothing is sent that you could not read` }
  const spec: ActionSpec = {
    label: targets.length === 1 ? `ask ${targets[0]?.id ?? 'target'}` : `ask ${targets.length} targets at once (${targets.map(target => target.id).join(', ')})`,
    args: [],
    shows,
    expect: 'each target\'s answer, or why it did not answer, in its own thread',
    declared: targets.some(target => target.cost === 'session-turn' || target.cost === 'metered' || target.cost === 'peer-session') ? 'spend' : leaving.length > 0 ? 'network' : 'write',
    note: `${leaving.length > 0 ? `LEAVES THIS MACHINE for ${leaving.map(target => `${target.id} (${target.leaves})`).join(', ')}. ` : 'Stays on this machine. '}${made.map(entry => (entry.built.ok ? `${entry.target.id}: ${entry.built.payload.note} Cost: ${entry.target.costText}.` : '')).join(' ')}`.slice(0, 900),
    timeoutMs: 600_000,
    run: async () => {
      let answered = 0

      for (const target of targets) {
        const result = await sendTo(deps, target, body).catch((error: unknown) => ({ ok: false, state: 'error' as const, text: error instanceof Error ? error.message : 'refused' }))

        recordSend(live.convo, target, body, result, Date.now())
        if (result.ok) answered++
        hosts.get(state)?.invalidate()
      }

      live.convo.picked = targets[0]?.id ?? live.convo.picked
      say(state, targets.length === 1 ? `ask ${targets[0]?.id ?? ''}` : 'ask several targets', answered === targets.length, `${answered} of ${targets.length} went through; each answer or failure is in its thread`)
    },
  }

  return { spec, why: '' }
}

/** A relay: one thread's newest answer, attributed, sent to other targets through the same card. */
export function relaySpec(state: State, from: Target, to: readonly Target[], instruction: string): { spec: ActionSpec | null; why: string } {
  const answer = lastAnswer(liveOf(state).convo, from.id)

  if (answer === null) return { spec: null, why: `${from.id} has not answered yet: nothing to relay` }
  if (to.some(target => target.id === from.id)) return { spec: null, why: 'a relay goes to another target, not back to the one that answered' }

  const sent = sendSpec(state, to, relayBody(from, answer, instruction))

  return sent.spec === null ? sent : { spec: { ...sent.spec, label: `relay ${from.id}'s answer to ${to.map(target => target.id).join(', ')}` }, why: '' }
}

/** Starts a bounded watch on a polled target: a read every POLL_MS, at most POLL_MAX times, stopped by Stop or the cap. The card names the read and the cadence. */
export function watchSpec(state: State, target: Target): { spec: ActionSpec | null; why: string } {
  const host = hosts.get(state)
  const live = liveOf(state)
  const first = pollParams(target, undefined, Date.now())

  if (host === undefined) return { spec: null, why: 'the console is not wired to a host here' }
  if (first === null) return { spec: null, why: `${target.id} is not polled: ${target.arrivalText}` }

  const thread = threadOf(live.convo, target.id)

  if (thread === null) return { spec: null, why: 'too many threads open' }

  return {
    spec: {
      label: `watch ${target.id} for replies every ${POLL_MS / 1000}s`,
      args: [],
      shows: `ruflo mcp exec -t ${first.tool} -p ${JSON.stringify(first.params)}  (every ${POLL_MS / 1000}s, at most ${POLL_MAX} times)`,
      expect: 'new messages appear in the thread',
      declared: target.leaves === 'internet' ? 'network' : 'write',
      note: `${target.leaves === 'internet' ? 'Each read goes to the relay. ' : 'Reads only. '}It stops by itself after ${POLL_MAX} reads (${Math.round((POLL_MAX * POLL_MS) / 60_000)} minutes), or when you stop it.`,
      run: async () => {
        live.timers.get(target.id)?.cancel()
        thread.isWatching = true
        thread.polls = 0

        const poll = async (): Promise<void> => {
          const read = pollParams(target, thread.cursor, Date.now())

          if (read === null) return

          const out = await host.run([...CLI_PREFIXES[state.options.cli], 'mcp', 'exec', '-t', read.tool, '-p', JSON.stringify(read.params)], 30_000).catch(() => undefined)

          if (out === undefined || out.exitCode !== 0 || out.stdout.length > FETCH_MAX || jsonAfter(out.stdout) === null) {
            addMessage(live.convo, target.id, { atMs: Date.now(), who: 'target', text: `the read failed: ${out !== undefined && out.stdout.length > FETCH_MAX ? `the answer was over the ${FETCH_MAX} character cap and was not read` : tidy(out?.stderr || 'no answer', 120)}`, state: 'error' })
            thread.polls++
            if (thread.polls >= POLL_MAX) thread.isWatching = false
          } else applyFetch(live.convo, target.id, target.transport === 'bbs' ? fromBbs(out.stdout, Date.now()) : fromChannel(out.stdout, thread.cursor))

          if (!thread.isWatching) stopWatch(state, target.id)

          host.invalidate()
        }

        live.timers.set(target.id, host.every(POLL_MS, () => void poll()))
        await poll()
        say(state, `watch ${target.id}`, true, `reading every ${POLL_MS / 1000}s, up to ${POLL_MAX} times`)
      },
    },
    why: '',
  }
}

export function stopWatch(state: State, targetId: string): void {
  const live = liveOf(state)

  live.timers.get(targetId)?.cancel()
  live.timers.delete(targetId)

  const thread = live.convo.threads.get(targetId)

  if (thread !== undefined) thread.isWatching = false
  hosts.get(state)?.invalidate()
}

/** The transcript as a confirm-gated new file under the console's exports folder (never overwrites, no link on the way, masked and capped). */
export async function saveTranscript(state: State, target: Target, ask: (spec: ActionSpec | null, why: string) => void): Promise<void> {
  const host = hosts.get(state)
  const thread = liveOf(state).convo.threads.get(target.id)

  if (host === undefined || thread === undefined || thread.msgs.length === 0) return ask(null, 'this thread has nothing to save yet')

  const roots = { cwd: state.cwd, scratch: null }
  const wanted = resolveExportPath(`${state.cwd.replace(/\/+$/, '')}/${EXPORT_DIR}/${transcriptName(target.id, Date.now())}`, roots)

  if (!wanted.ok) return ask(null, wanted.why)

  const clear = await checkNoLinks(host.fs, wanted.path, roots)

  if (!clear.ok) return ask(null, clear.why)

  const made = transcriptMarkdown(thread, target, Date.now())
  const hasDir = (await host.fs.stat(clear.path.slice(0, Math.max(1, clear.path.lastIndexOf('/')))).catch(() => undefined)) !== undefined

  ask({ ...exportSpec(clear.path, made.text, cleanText(target.id), hasDir, await writeFlavorReady()), label: `save the ${target.id} conversation${made.isCut ? ' (cut at the cap)' : ''}` }, 'that transcript cannot be written')
}

/** For tests: drops the held conversation and host of a state, and stops its timers. */
export function resetConvo(state: State): void {
  for (const timer of lives.get(state)?.timers.values() ?? []) timer.cancel()
  lives.delete(state)
  hosts.delete(state)
}
