/**
 * One-click starts: what a section offers when there is nothing in it yet. Every view's empty state was a command to
 * copy ("`npx ruflo hive-mind init` starts one"); the console is the place to use ruflo, so each is now a button that
 * asks (the confirm row shows the exact argv) and runs it, and the disk is re-read to say whether it took. Each is one
 * fixed argv through the ruflo CLI, flags checked against `<command> --help` on CLI 3.51.1. Joining the federation
 * reaches the network, and `mods install` writes Claude Code settings; both say so on the confirm row.
 */
import type { ActionSpec } from './actions'
import { NOSTR_KEY, under } from './data/files'
import { MISSION_OBJECTIVE_MAX } from './full-text'
import { spawnAgent, swarmInit, textArg } from './ops'

export type StartId =
  | 'init'
  | 'daemon'
  | 'swarm'
  | 'spawn-coder'
  | 'spawn-tester'
  | 'spawn-reviewer'
  | 'hive'
  | 'hive-workers'
  | 'pretrain'
  | 'federation-join'
  | 'channel-read'
  | 'marketplace'
  | 'mission'
  | 'task'

/** The words each start shows on its button. */
export const START_LABEL: Record<StartId, string> = {
  init: 'init ruflo here',
  daemon: 'start the daemon',
  swarm: 'start a swarm',
  'spawn-coder': 'spawn a coder',
  'spawn-tester': 'spawn a tester',
  'spawn-reviewer': 'spawn a reviewer',
  hive: 'start a hive-mind (raft)',
  'hive-workers': 'spawn 3 hive workers',
  pretrain: 'pretrain on this repo',
  'federation-join': 'join the federation',
  'channel-read': 'read pub:announce',
  marketplace: 'add the ruflo marketplace',
  mission: 'create the mission',
  task: 'create the task',
}

/** The ask for a start, or null when its text cannot be passed (a mission objective is the only text). */
export function startSpec(id: StartId, nowMs: number, text = '', observeKey?: (present: boolean) => void): ActionSpec | null {
  switch (id) {
    case 'init':
      return {
        label: 'initialise ruflo in this project (.claude-flow, .claude settings and the mods)',
        args: ['init', '--no-signup', '--no-global'],
        expect: 'ruflo state in .claude-flow',
        verify: snapshot => snapshot.isRufloProject,
      }
    case 'daemon':
      return { label: 'start the ruflo daemon (background workers: map, audit, optimize, consolidate, testgaps)', args: ['daemon', 'start'], expect: 'daemon-state.json saying running', verify: snapshot => snapshot.daemon?.running === true }
    case 'swarm':
      return swarmInit()
    case 'spawn-coder':
    case 'spawn-tester':
    case 'spawn-reviewer':
      return spawnAgent(id.slice(6), nowMs)
    case 'hive':
      return {
        label: 'start a hive-mind: a queen with raft consensus',
        args: ['hive-mind', 'init', '--consensus', 'raft'],
        expect: 'a queen in .claude-flow/hive-mind/state.json',
        verify: snapshot => snapshot.hive !== null,
      }
    case 'hive-workers':
      return {
        label: 'spawn 3 hive workers (they vote; the CLI counts only registered workers)',
        args: ['hive-mind', 'spawn', '--count', '3'],
        expect: 'three workers in the hive',
        verify: snapshot => (snapshot.hive?.workers.length ?? 0) > 0,
      }
    case 'pretrain':
      return {
        label: 'pretrain the learning loop on this repository (local, shallow)',
        args: ['hooks', 'pretrain', '--depth', 'shallow'],
        expect: 'patterns learned from the repo',
        verify: snapshot => snapshot.sona !== null || snapshot.neural !== null || snapshot.outcomes !== null,
      }
    case 'federation-join':
      return {
        label: 'join the open federation with your own key (makes ~/.ruflo/nostr.key, registers on x.ruv.io: network)',
        args: ['federation', 'join'],
        expect: 'a local Nostr key (the CLI reports registration separately)',
        verifyLocal: async host => {
          const home = await host.home().catch(() => undefined)
          const present = home === undefined ? false : await host.fs.stat(under(home, NOSTR_KEY)).then(stat => stat !== undefined, () => false)
          observeKey?.(present)
          return present
        },
      }
    case 'channel-read':
      return { label: 'read the pub:announce channel (network)', args: ['federation', 'channel', '--action', 'read', '--channel', 'pub:announce', '--limit', '10'], expect: 'the latest announcements', isReadOnly: true, declared: 'network' }
    case 'marketplace':
      return {
        label: 'add the ruflo marketplace to Claude Code and install the ruflo mods (ruflo mods install: settings.local.json + claude plugin install)',
        args: ['mods', 'install'],
        expect: 'the ruflo marketplace in known_marketplaces.json',
        verify: snapshot => snapshot.plugins.missingFromClone !== undefined && snapshot.isRufloProject,
      }
    case 'task': {
      const description = textArg(text)

      return description === null
        ? null
        : {
            label: `create a task: ${description.slice(0, 60)}`,
            args: ['task', 'create', '--type', 'implementation', '--description', description],
            expect: 'the task in .claude-flow/tasks/store.json',
            verify: snapshot => snapshot.tasks.some(task => task.description === description),
          }
    }
    case 'mission': {
      const objective = textArg(text, MISSION_OBJECTIVE_MAX)

      return objective === null
        ? null
        : {
            label: `create a mission: ${objective.slice(0, 60)}`,
            args: ['mission', 'create', '--objective', objective, '--request-id', `console-${nowMs}`],
            expect: 'the mission in .claude-flow/missions',
            verify: snapshot => snapshot.missions !== null,
          }
    }
  }
}

/** The starts that need no text: each is also a palette entry, so `/ruflo run init` works headless (the spawn buttons use the palette's existing spawn-<type> ids). */
export const START_IDS: readonly StartId[] = ['init', 'daemon', 'swarm', 'hive', 'hive-workers', 'pretrain', 'federation-join', 'channel-read', 'marketplace']
