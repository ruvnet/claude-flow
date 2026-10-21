import { describe, expect, mock, test } from 'claude-code/testing'

import { RUFLO_FILES } from './fixtures/ruflo-run'
import { command, SESSION, worldOf } from './fixtures/world'

/** Every palette action that changes something: the selection it needs, and the head of the argv it must run. */
// Hive votes are covered in palette.test.ts and hive.spec.ts: they need a world with registered workers.
const CASES: { id: string; setup?: string[]; text?: string; head: string[] }[] = [
  { id: 'task-claim', head: ['mcp', 'exec', '-t', 'claims_claim'] },
  { id: 'claim-release', head: ['mcp', 'exec', '-t', 'claims_release'] },
  { id: 'claim-pause', head: ['mcp', 'exec', '-t', 'claims_status'] },
  { id: 'claim-handoff', setup: ['swarm', 'next'], head: ['mcp', 'exec', '-t', 'claims_handoff'] },
  { id: 'claim-steal', setup: ['claims', 'next'], head: ['mcp', 'exec', '-t', 'claims_steal'] },
  { id: 'agent-stop', head: ['agent', 'stop', 'agent-1790903032181-97m25s'] },
  { id: 'spawn-tester', head: ['agent', 'spawn', '--type', 'tester'] },
  { id: 'swarm-init', head: ['swarm', 'init', '--topology', 'hierarchical', '--max-agents', '8', '--strategy', 'specialized'] },
  { id: 'swarm-stop', head: ['swarm', 'stop'] },
  { id: 'mh-audit', head: ['metaharness', 'oia-audit', '--format', 'json'] },
  { id: 'mh-bench-create', head: ['metaharness', 'bench', '--op', 'create', '--repo', '.'] },
  { id: 'mh-redblue-init', head: ['metaharness', 'redblue', 'init'] },
  { id: 'mh-redblue-real', head: ['metaharness', 'redblue', 'run', '--tests', '10', '--max-cost-usd', '3'] },
  { id: 'mh-evolve', head: ['metaharness', 'evolve', '--repo', '.', '--confirm'] },
  { id: 'mh-security-bench', head: ['mcp', 'exec', '-t', 'metaharness_security_bench', '-p', '{}'] },
  { id: 'mh-flywheel-run', head: ['metaharness', 'flywheel', 'run', '--proposer', 'local'] },
  { id: 'worker-optimize', head: ['hooks', 'worker', 'dispatch', '--trigger', 'optimize'] },
  { id: 'store', text: 'remember the login fix', head: ['memory', 'store', '--key'] },
]

describe('every confirm-gated action', () => {
  for (const entry of CASES) {
    test(`${entry.id}: asks first, runs nothing until yes, then exactly its fixed argv`, async ($, on) => {
      const world = worldOf(on, RUFLO_FILES)
      mock.clock(on)
      await $.session.start(SESSION)

      for (const step of entry.setup ?? []) await $.command.run(command(step))

      const before = world.runs.length
      const asked = await $.command.run(command(`run ${entry.id}${entry.text !== undefined ? ` ${entry.text}` : ''}`))

      expect(asked.text).toMatch(/^Asked: /)
      expect(world.runs.slice(before).filter(argv => argv.join(' ').includes(entry.head.slice(0, 2).join(' ')))).toHaveLength(0)

      await $.command.run(command('yes'))

      const ran = world.runs.slice(before).filter(argv => argv.slice(4, 4 + entry.head.length).join(' ') === entry.head.join(' '))

      expect(ran).toHaveLength(1)
      expect(ran[0]?.slice(0, 4)).toEqual(['npx', '--offline', '-y', '@claude-flow/cli@latest'])
    })
  }
})
