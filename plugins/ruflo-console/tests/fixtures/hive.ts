/**
 * A hive in the shapes hive-mind-tools.ts writes: three workers (two spawned into agents.json, one in no store), a raft
 * proposal with one ballot, a bft proposal with a Byzantine voter, two decisions and two broadcasts. The capability
 * token is the captured run's, so a test can assert it never reaches the screen.
 */
import { HIVE_TOKEN, RUFLO_FILES } from './ruflo-run'

export const WORKERS = ['hive-worker-1790903400000-a1b2', 'hive-worker-1790903400001-c3d4', 'hive-worker-1790903400002-e5f6'] as const
export const RAFT_ID = 'proposal-1790903500000-raft01'
export const BFT_ID = 'proposal-1790903500001-bft002'

export const HIVE_STATE = {
  initialized: true,
  topology: 'hierarchical',
  consensusStrategy: 'raft',
  queen: { agentId: 'queen-1790903321632', electedAt: '2026-10-02T01:08:41.632Z', term: 2 },
  hiveToken: HIVE_TOKEN,
  workers: [...WORKERS],
  consensus: {
    pending: [
      { proposalId: RAFT_ID, type: 'design', value: 'use raft for the console', proposedBy: 'console-operator', proposedAt: '2026-10-02T01:10:00.000Z', votes: { [WORKERS[0]]: true }, status: 'pending', strategy: 'raft', term: 2, timeoutAt: '2026-10-02T01:10:30.000Z' },
      { proposalId: BFT_ID, type: 'deploy', value: { target: 'staging' }, proposedBy: 'system', proposedAt: '2026-10-02T01:11:00.000Z', votes: { [WORKERS[1]]: false }, status: 'pending', strategy: 'bft', byzantineVoters: [WORKERS[2]] },
    ],
    history: [
      { proposalId: 'proposal-1790903000000-old001', type: 'naming', result: 'approved', votes: { for: 2, against: 0 }, decidedAt: '2026-10-02T01:05:00.000Z', strategy: 'raft', term: 1 },
      { proposalId: 'proposal-1790903000001-old002', type: 'budget', result: 'rejected', votes: { for: 1, against: 2 }, decidedAt: '2026-10-02T01:06:00.000Z', strategy: 'bft', byzantineDetected: [WORKERS[2]] },
    ],
  },
  sharedMemory: {
    broadcasts: [
      { messageId: 'msg-1790903600000-aaaa01', message: 'standup in 5', priority: 'normal', fromId: 'console-operator', timestamp: '2026-10-02T01:12:00.000Z' },
      { messageId: 'msg-1790903600001-bbbb02', message: 'freeze the main branch', priority: 'high', fromId: 'system', timestamp: '2026-10-02T01:13:00.000Z' },
    ],
    'design-notes': { a: 1 },
  },
  createdAt: '2026-10-02T01:08:41.632Z',
  updatedAt: '2026-10-02T01:13:00.000Z',
}

const spawned = (agentId: string, role: string, status: string) => ({ agentId, agentType: 'worker', status, health: 1, taskCount: 0, config: { role, hiveRole: role }, createdAt: '2026-10-02T01:09:00.000Z', domain: 'hive-mind' })

export const HIVE_AGENTS = { agents: { [WORKERS[0]]: spawned(WORKERS[0], 'worker', 'busy'), [WORKERS[1]]: spawned(WORKERS[1], 'specialist', 'idle') } }

/** The captured project with this hive in place of its own, and agents.json beside it. */
export const HIVE_FILES: Readonly<Record<string, string>> = {
  ...RUFLO_FILES,
  '.claude-flow/hive-mind/state.json': JSON.stringify(HIVE_STATE, null, 2),
  '.claude-flow/agents.json': JSON.stringify(HIVE_AGENTS, null, 2),
}
