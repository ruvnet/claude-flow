/**
 * The console's self-check, pure and spawn-free: for every area the boot log names, does what a press would run still resolve
 * to a well-formed command? It reads the same registries the buttons read (Security, Performance, Dev Tools, the MetaHarness
 * lab), so a verb whose argv is empty, whose text field accepts what its rule forbids, or whose documented input is refused is
 * caught here, not by a person pressing it. It does not run the CLI: that every command is built right is proved here, that the CLI
 * answers is the Doctor's job. The boot log shows these results, so an `[ OK ]` on screen means this passed for that area.
 * Tested in tests/self-check.spec.ts, including that a broken entry fails (so a pass is not vacuous).
 */
import { VIEW_ASK } from './ask-claude'
import { emptyFields, type DevFields } from './data/devtools'
import { DEV, type DevEntry } from './devtools'
import { BOOT_MODULES } from './gfx/boot'
import { LAB, type LabEntry } from './mh-lab'
import { PERF, type PerfEntry } from './perf'
import { SECURE, SECURE_TEXT, type SecEntry, type SecText } from './secure'
import { newState, VIEWS, type State, type ViewId } from './state'

export type CheckResult = { area: string; ok: boolean; checked: number; problems: string[] }

/** Each boot area and the page it opens: every area must name a real page, and the spec fails on an area with no row here. */
export const AREA_VIEW: Record<string, ViewId> = {
  Missions: 'missions', Overview: 'overview', Swarm: 'swarm', Workflows: 'workflows', 'Hive-Mind': 'hive', Claims: 'claims', Approvals: 'approvals', Automation: 'automate',
  Learning: 'learning', Neural: 'neural', 'Vector Lab': 'vector', 'Memory Lab': 'memory', MetaHarness: 'metaharness', 'Self-Evolution': 'evolve',
  Security: 'secure', Federation: 'federation', 'x.ruv.io': 'xruv', 'Plugins & Mods': 'plugins', Skills: 'skills', 'Plugin Catalog': 'market',
  'Dev Tools': 'devtools', Sandbox: 'sandbox', 'Cost & Budget': 'cost', Timeline: 'timeline', Events: 'events', 'The Room': 'room', Performance: 'perf', 'AI Terminal': 'terminal', 'What’s new': 'whatsnew', ADRs: 'adrs', Settings: 'settings',
}

/** Pages with no hotkey on purpose (every letter is taken): reached from the menu, the nav, the palette or by name. */
const NAMED_ONLY: ReadonlySet<string> = new Set(['sandbox', 'room', 'workflows', 'whatsnew', 'adrs'])

export type Registries = { secure: readonly SecEntry[]; secureText: readonly SecText[]; perf: readonly PerfEntry[]; dev: readonly DevEntry[]; lab: readonly LabEntry[] }
export const REGISTRIES: Registries = { secure: SECURE, secureText: SECURE_TEXT, perf: PERF, dev: DEV, lab: LAB }

/** One value per field that its rule accepts, so every runnable Dev Tools row has an input that runs. */
export const SAMPLE_FIELDS: DevFields = { ref: 'HEAD~1', path: 'memory/sample.rvf', label: 'ckpt-1', url: 'https://example.com', target: '@e1', query: 'auth', task: 'review my pull request', cmd: 'ls', id: 'agent-1', note: 'hello', session: 'demo', send: 'ls -la' }

/** Free text, then an action type (policy-eval takes one): a text verb passes when any of these builds its command. */
const SAMPLE_TEXTS = ['hello world', 'deploy']
const isArgv = (value: unknown): value is readonly string[] => Array.isArray(value) && value.length > 0 && value.every(part => typeof part === 'string' && part !== '' && !/[\u0000-\u001f]/.test(part))

function checkArgs(id: string, args: unknown, problems: string[]): void {
  if (!isArgv(args)) problems.push(`${id}: its command is empty or has an empty or control-character part`)
}

function checkSecure(entries: readonly SecEntry[], text: readonly SecText[], perf: readonly PerfEntry[], problems: string[]): number {
  for (const entry of [...entries, ...perf]) {
    checkArgs(entry.id, entry.args, problems)
    if (typeof entry.read !== 'function') problems.push(`${entry.id}: nothing reads its output`)
    if (entry.label.trim() === '') problems.push(`${entry.id}: no label for the confirm row`)
  }

  for (const entry of text) {
    const empty = entry.argv('')
    const sample = SAMPLE_TEXTS.find(candidate => isArgv(entry.argv(candidate)))

    if (empty !== null) problems.push(`${entry.id}: an empty field must be refused, but it builds a command`)
    if (entry.argv('-rf') !== null) problems.push(`${entry.id}: text starting with - must be refused (it could be read as a flag)`)
    if (sample === undefined) problems.push(`${entry.id}: no sample input (${SAMPLE_TEXTS.join(', ')}) builds its command, so its button can never run`)
    else if (!(entry.argv(sample) ?? []).some(part => part.includes(sample))) problems.push(`${entry.id}: the text does not reach the command`)
    if (typeof entry.read !== 'function') problems.push(`${entry.id}: nothing reads its output`)
  }

  return entries.length + text.length + perf.length
}

function checkDev(entries: readonly DevEntry[], problems: string[]): number {
  for (const entry of entries) {
    if (entry.na !== undefined) {
      if (entry.na.trim() === '') problems.push(`${entry.id}: marked n/a with no reason to show`)

      continue
    }

    const build = entry.exec ?? entry.args

    if (build === undefined) {
      problems.push(`${entry.id}: it is neither runnable nor marked n/a`)

      continue
    }

    const bare = build(emptyFields())

    // With no field needed, an empty page must already run; with one, an empty field may be refused, but the sample must run.
    if (bare === null && entry.input === undefined) problems.push(`${entry.id}: it names no input field, yet cannot run on an empty page`)

    const sampled = build(SAMPLE_FIELDS)

    if (!isArgv(sampled)) problems.push(`${entry.id}: no input is accepted, so its button can never run`)
  }

  return entries.length
}

function checkLab(entries: readonly LabEntry[], state: State, problems: string[]): number {
  for (const entry of entries) {
    const args = typeof entry.args === 'function' ? entry.args(state) : entry.args

    if (args === undefined && entry.types === undefined) problems.push(`${entry.id}: no command and no command to type`)
    else if (args === null) {
      if ((entry.why ?? '').trim() === '') problems.push(`${entry.id}: it cannot run now and says nothing about why`)
    } else if (args !== undefined) checkArgs(entry.id, args, problems)
  }

  return entries.length
}

function checkUnique(registries: Registries, problems: string[]): void {
  const seen = new Set<string>()

  for (const id of [...registries.secure, ...registries.secureText, ...registries.perf, ...registries.dev, ...registries.lab].map(entry => entry.id)) {
    if (seen.has(id)) problems.push(`${id}: used by two entries (ids are palette keywords)`)
    seen.add(id)
  }
}

/**
 * One result per boot area, in boot order. Every area has its page checked (it exists, has a key, and has an Ask row); the areas that
 * own a command registry have each command checked too. `problems` names what is wrong, so the boot log can say what failed.
 */
export function selfCheck(registries: Registries = REGISTRIES, views: readonly { id: string; key: string }[] = VIEWS, ask: Record<string, unknown> = VIEW_ASK): CheckResult[] {
  const state = newState(undefined)
  const shared: string[] = []

  checkUnique(registries, shared)

  return BOOT_MODULES.map(({ name }): CheckResult => {
    const problems: string[] = []
    const view = AREA_VIEW[name]
    let checked = 1

    if (view === undefined) problems.push(`${name}: no page is named for this area`)
    else {
      if (!views.some(entry => entry.id === view)) problems.push(`${name}: its page "${view}" does not exist`)
      if (!views.some(entry => entry.id === view && (entry.key !== '' || NAMED_ONLY.has(entry.id)))) problems.push(`${name}: its page has no key`)
      if (ask[view] === undefined) problems.push(`${name}: its page has no Ask Claude row`)
    }

    if (name === 'Security') checked += checkSecure(registries.secure, registries.secureText, [], problems)
    if (name === 'Performance') checked += checkSecure([], [], registries.perf, problems)
    if (name === 'Dev Tools') checked += checkDev(registries.dev, problems)
    if (name === 'MetaHarness') checked += checkLab(registries.lab, state, problems)
    // Ids are palette keywords shared by all four registries, so a duplicate fails each area that owns one of them.
    if (['Security', 'Performance', 'Dev Tools', 'MetaHarness'].includes(name)) problems.push(...shared)

    return { area: name, ok: problems.length === 0, checked, problems }
  })
}

let held: CheckResult[] | null = null

/** The real registries' results, computed once: the boot log reads these every frame. */
export function selfCheckResults(): CheckResult[] {
  held ??= selfCheck()

  return held
}
