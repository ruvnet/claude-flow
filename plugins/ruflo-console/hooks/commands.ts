/**
 * `/ruflo`, the one command for every ruflo mod. Pure: it reads the arguments into an intent; register.ts carries it
 * out. `mods` and `swarm <sub>` belong to ruflo-mods and ruflo-swarm, which hook the same command; the console passes
 * them on and answers only when neither is loaded. Every pane key has a subcommand here, since keys need focus.
 */
import { EVENT_KINDS, type EventKind } from './data/events'
import { VIEWS, viewOf, type ViewId } from './state'

export const SWARM_SUBS = ['pane', 'status', 'topology', 'claims', 'consensus'] as const

export type Intent =
  | { kind: 'open'; view: ViewId | null }
  | { kind: 'help' }
  | { kind: 'close' }
  | { kind: 'status' }
  | { kind: 'delegate'; owner: 'ruflo-mods' | 'ruflo-swarm'; words: string }
  | { kind: 'palette'; query: string }
  | { kind: 'run'; paletteId: string; text: string }
  | { kind: 'confirm'; isYes: boolean; /** The card id a typed `yes <id>` names. */ card?: number }
  | { kind: 'agent'; who: string }
  | { kind: 'back' }
  | { kind: 'select'; by: number }
  | { kind: 'filter'; filter: 'all' | EventKind }
  | { kind: 'dump'; view: ViewId | null }
  | { kind: 'commands'; query: string }
  | { kind: 'band'; arg: string }
  | { kind: 'notices'; isClear: boolean }
  | { kind: 'quiet'; arg: string }
  | { kind: 'autopilot'; arg: string }
  | { kind: 'events'; args: string[] }
  | { kind: 'timeline'; args: string[] }
  | { kind: 'unknown'; word: string }

export function parseRuflo(args: string): Intent {
  const words = args.trim().split(/\s+/).filter(Boolean)
  const [head = '', second = ''] = words.map(word => word.toLowerCase())
  const rest = args.trim().slice(words[0]?.length ?? 0).trim()

  switch (head) {
    case '':
    case 'open':
      return { kind: 'open', view: null }
    case 'help':
    case '?':
      return { kind: 'help' }
    case 'close':
      return { kind: 'close' }
    case 'status':
      return { kind: 'status' }
    case 'mods':
      return { kind: 'delegate', owner: 'ruflo-mods', words: rest }
    case 'swarm':
      return (SWARM_SUBS as readonly string[]).includes(second) ? { kind: 'delegate', owner: 'ruflo-swarm', words: rest } : { kind: 'open', view: 'swarm' }
    case 'palette':
    case 'p':
      return { kind: 'palette', query: rest }
    // `/ruflo plan <goal>` prints the SPARC plan; `/ruflo mission [status|next|pause|resume|cancel|create|guide <text>|aside <text>|auto on|off]`.
    // `/ruflo ask <question>`: ask the main Claude about the open section (asks first).
    case 'ask':
      return { kind: 'run', paletteId: 'ask', text: rest }
    case 'plan':
      return { kind: 'run', paletteId: 'mission-goal', text: rest }
    case 'mission':
      return { kind: 'run', paletteId: `mission-${second === '' ? 'status' : second.replace(/[^a-z-]/g, '')}`, text: rest.slice(second.length).trim() }
    case 'run':
    case 'act':
      return second === '' ? { kind: 'palette', query: '' } : { kind: 'run', paletteId: second, text: rest.slice(second.length).trim() }
    case 'yes':
    case 'y': {
      const card = /^#?([0-9]{1,9})$/.exec(second)?.[1]

      return card === undefined ? { kind: 'confirm', isYes: true } : { kind: 'confirm', isYes: true, card: Number(card) }
    }
    case 'no':
    case 'n':
      return { kind: 'confirm', isYes: false }
    case 'agent':
      return second === '' ? { kind: 'open', view: 'swarm' } : { kind: 'agent', who: words[1] ?? '' }
    case 'back':
      return { kind: 'back' }
    case 'next':
    case 'j':
      return { kind: 'select', by: 1 }
    case 'prev':
    case 'k':
      return { kind: 'select', by: -1 }
    case 'band':
      return { kind: 'band', arg: second }
    case 'notices':
      return { kind: 'notices', isClear: second === 'clear' }
    case 'quiet':
      return { kind: 'quiet', arg: second }
    case 'autopilot':
      return { kind: 'autopilot', arg: second }
    case 'commands':
    case 'catalog':
      return { kind: 'commands', query: rest }
    case 'dump':
    case 'text':
      return { kind: 'dump', view: second === '' ? null : viewOf(second) }
    // `/ruflo events [kind|level|since:15m|"query"|window <w>|clear|forget|export <path>|follow <ref>|pin|rule]` and `/ruflo timeline [5m|…|session|zoom in|out|follow <ref>|export <path>]` (ADR-474); bare, each just opens its page.
    case 'events':
      return words.length === 1 ? { kind: 'open', view: 'events' } : { kind: 'events', args: words.slice(1) }
    case 'timeline':
      return words.length === 1 ? { kind: 'open', view: 'timeline' } : { kind: 'timeline', args: words.slice(1) }
    case 'filter':
      return { kind: 'filter', filter: (EVENT_KINDS as readonly string[]).includes(second) ? (second as EventKind) : 'all' }
    default: {
      const view = viewOf(head)

      return view !== null ? { kind: 'open', view } : { kind: 'unknown', word: head }
    }
  }
}

export const HELP = [
  '/ruflo — the ruflo console and every ruflo mod command',
  '',
  'Open and switch',
  `  /ruflo                     open the cockpit (also opens by itself where it can dock, panel=auto)`,
  `  /ruflo <view>              ${VIEWS.map(view => (view.key === '' ? view.id : `${view.id} (${view.key})`)).join(', ')}`,
  '  /ruflo agent <id|name>     drill into one agent: role, task, claims, activity, logs, timeline',
  '  /ruflo back | close | status',
  '  /ruflo dump <view>         a view as plain text, without the pane (for claude -p and scripts)',
  '  /ruflo commands [word]     browse the ruflo command catalog (ADR-406): every command, who owns it, how it runs',
  '',
  'The band above the prompt',
  '  /ruflo band [auto|on|off|compact|full|reset]   show, hide or shrink the band for this session (compact = one row)',
  '  /ruflo notices [clear]     the last ten announcements (approvals, alerts, a mission finishing, a long turn ending, Anatole blocking a call)',
  '  /ruflo quiet [minutes|off] silence the band\'s notice row for a while; notices are still recorded',
  '  /ruflo autopilot [status|pause|resume|stop]   the mission autopilot (ADR-466); it never starts one: Start is on the Workflows page and asks first',
  '',
  'Act (each change asks to confirm; /ruflo yes or /ruflo no answers without focus)',
  '  /ruflo palette [query]     the command palette (key p): spawn, claims, swarm, votes, workers, memory',
  '  /ruflo run <entry> [text]  run a palette entry by id, e.g. run spawn-coder, run route fix the login bug',
  '  /ruflo next | prev         move the selection (keys j / k)',
  '  /ruflo filter <kind>       events view filter: all, swarm, claims, federation, learning, tools, mods, missions, workflows, autopilot, anatole, notices',
  '  /ruflo events [kind|level|since:15m|"query"|window <session|15m|1h|24h|all>|clear|forget|export <path>|follow <ref>|pin|rule]',
  '                             the Events page: filter, search (words "phrase" -not kind:x level:bad agent:x src:x since:1h a|b /re/), follow an agent, claim or run, export, forget the kept history',
  '  /ruflo timeline [5m|15m|1h|6h|24h|session|zoom <in|out>|follow <ref>|export <path>]   the Timeline page window, zoom, a lane\'s events, a lane summary export',
  '',
  'Other mods (answered by their own plugin)',
  '  /ruflo mods                ruflo-mods: what this session routed, recorded and tightened (was /ruflo-mods)',
  '  /ruflo swarm pane|status|topology|claims|consensus   ruflo-swarm (was /ruflo-swarm-*)',
  '',
  'Pane keys (while it holds the keyboard: /ruflo opens it with the keys, or click it; ctrl+x tab reaches the band, not the pane)',
  '  0 main menu · 1-9 views · g timeline · q approvals · e events · m plugin catalog · w x.ruv.io · i terminal · p palette · x actions for the selection',
  '  terminal: the field takes the keys; /codex /claude /swarm /ruflo switch harness, /new starts over · sessions remember the conversation per project; the first message asks, then Enter sends · Tab to s stop, o new, z clear',
  '  workflows (no key; nav SWARM, menu, or /ruflo workflows): j/k move · b/l phases or agents column · u/i switch run · d inspect · /ruflo next|prev = j/k',
  '  j/k select · d drill in · b back · r refresh · h help · f event filter · y/n confirm',
  '  Esc: a pane /ruflo opened closes; one that opened by itself (panel=auto) only hands the keys back. ✕ or /ruflo close closes either',
  '  (? and Enter cannot be pane hotkeys in this Claude Code build: use h, and d to drill in)',
].join('\n')
