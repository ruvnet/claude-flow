/**
 * Coordination MCP Tools for CLI
 *
 * V2 Compatibility - Swarm coordination and orchestration tools
 *
 * ⚠️ IMPORTANT: These tools provide LOCAL STATE MANAGEMENT.
 * - Topology/consensus state is tracked locally
 * - No actual distributed coordination
 * - Useful for single-machine workflow orchestration
 */

import { type MCPTool, getProjectCwd } from './types.js';
import { validateIdentifier, validateText } from './validate-input.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

// Storage paths
const STORAGE_DIR = '.claude-flow';
const COORD_DIR = 'coordination';
const COORD_FILE = 'store.json';

interface TopologyConfig {
  type: 'mesh' | 'hierarchical' | 'ring' | 'star' | 'hybrid' | 'hierarchical-mesh';
  maxNodes: number;
  redundancy: number;
  consensusAlgorithm: string;
}

interface LoadBalanceConfig {
  algorithm: 'round-robin' | 'least-connections' | 'weighted' | 'adaptive';
  weights: Record<string, number>;
  healthCheck: boolean;
}

interface SyncState {
  lastSync: string;
  syncCount: number;
  conflicts: number;
  pendingChanges: number;
}

interface CoordConsensusProposal {
  proposalId: string;
  type: string;
  proposal: unknown;
  proposedBy: string;
  proposedAt: string;
  votes: Record<string, boolean>;
  status: string;
  strategy: string;
  term?: number;
  quorumPreset?: string;
  byzantineVoters?: string[];
}

interface CoordConsensusResult {
  proposalId: string;
  result: string;
  votes: { for: number; against: number };
  decidedAt: string;
  strategy: string;
  term?: number;
  byzantineDetected?: string[];
}

interface CoordConsensusState {
  pending: CoordConsensusProposal[];
  history: CoordConsensusResult[];
}

interface CoordinationStore {
  topology: TopologyConfig;
  loadBalance: LoadBalanceConfig;
  sync: SyncState;
  nodes: Record<string, { id: string; status: string; load: number; lastHeartbeat: string }>;
  version: string;
  consensus?: CoordConsensusState;
}

function getCoordDir(): string {
  return join(getProjectCwd(), STORAGE_DIR, COORD_DIR);
}

function getCoordPath(): string {
  return join(getCoordDir(), COORD_FILE);
}

function ensureCoordDir(): void {
  const dir = getCoordDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function loadCoordStore(): CoordinationStore {
  try {
    const path = getCoordPath();
    if (existsSync(path)) {
      return JSON.parse(readFileSync(path, 'utf-8'));
    }
  } catch {
    // Return default store
  }
  return {
    topology: {
      type: 'hierarchical',
      maxNodes: 15,
      redundancy: 2,
      consensusAlgorithm: 'raft',
    },
    loadBalance: {
      algorithm: 'adaptive',
      weights: {},
      healthCheck: true,
    },
    sync: {
      lastSync: new Date().toISOString(),
      syncCount: 0,
      conflicts: 0,
      pendingChanges: 0,
    },
    nodes: {},
    version: '3.0.0',
  };
}

function saveCoordStore(store: CoordinationStore): void {
  ensureCoordDir();
  writeFileSync(getCoordPath(), JSON.stringify(store, null, 2), 'utf-8');
}

export const coordinationTools: MCPTool[] = [
  {
    name: 'coordination_topology',
    description: 'Configure swarm topology Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'optimize'], description: 'Action to perform' },
        type: { type: 'string', enum: ['mesh', 'hierarchical', 'ring', 'star', 'hybrid', 'hierarchical-mesh'], description: 'Topology type' },
        maxNodes: { type: 'number', description: 'Maximum nodes' },
        redundancy: { type: 'number', description: 'Redundancy level' },
        consensusAlgorithm: { type: 'string', enum: ['raft', 'byzantine', 'gossip', 'crdt'], description: 'Consensus algorithm' },
      },
    },
    handler: async (input) => {
      const store = loadCoordStore();
      const action = (input.action as string) || 'get';

      if (action === 'get') {
        return {
          success: true,
          topology: store.topology,
          nodes: Object.keys(store.nodes).length,
          status: 'active',
        };
      }

      if (action === 'set') {
        if (input.type) store.topology.type = input.type as TopologyConfig['type'];
        if (input.maxNodes) store.topology.maxNodes = input.maxNodes as number;
        if (input.redundancy) store.topology.redundancy = input.redundancy as number;
        if (input.consensusAlgorithm) store.topology.consensusAlgorithm = input.consensusAlgorithm as string;

        saveCoordStore(store);

        return {
          success: true,
          action: 'updated',
          topology: store.topology,
        };
      }

      if (action === 'optimize') {
        // Analyze current state and suggest optimal topology
        const nodeCount = Object.keys(store.nodes).length;
        let recommended: TopologyConfig['type'] = 'hierarchical';

        if (nodeCount <= 5) {
          recommended = 'mesh';
        } else if (nodeCount <= 15) {
          recommended = 'hierarchical';
        } else {
          recommended = 'hybrid';
        }

        return {
          success: true,
          action: 'optimize',
          current: store.topology.type,
          recommended,
          reason: nodeCount <= 5
            ? 'Small cluster benefits from full mesh connectivity'
            : nodeCount <= 15
              ? 'Medium cluster works well with hierarchical coordination'
              : 'Large cluster needs hybrid approach for scalability',
        };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'coordination_load_balance',
    description: 'Configure load balancing Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['get', 'set', 'distribute'], description: 'Action to perform' },
        algorithm: { type: 'string', enum: ['round-robin', 'least-connections', 'weighted', 'adaptive'], description: 'Algorithm' },
        weights: { type: 'object', description: 'Node weights' },
        task: { type: 'string', description: 'Task to distribute' },
      },
    },
    handler: async (input) => {
      if (input.task) { const vTask = validateText(input.task, 'task'); if (!vTask.valid) return { success: false, error: vTask.error }; }
      const store = loadCoordStore();
      const action = (input.action as string) || 'get';

      if (action === 'get') {
        const nodes = Object.values(store.nodes);
        const avgLoad = nodes.length > 0
          ? nodes.reduce((sum, n) => sum + n.load, 0) / nodes.length
          : 0;

        return {
          success: true,
          loadBalance: store.loadBalance,
          metrics: {
            nodeCount: nodes.length,
            avgLoad,
            maxLoad: nodes.length > 0 ? Math.max(...nodes.map(n => n.load)) : 0,
            minLoad: nodes.length > 0 ? Math.min(...nodes.map(n => n.load)) : 0,
          },
        };
      }

      if (action === 'set') {
        if (input.algorithm) store.loadBalance.algorithm = input.algorithm as LoadBalanceConfig['algorithm'];
        if (input.weights) store.loadBalance.weights = input.weights as Record<string, number>;

        saveCoordStore(store);

        return {
          success: true,
          action: 'updated',
          loadBalance: store.loadBalance,
        };
      }

      if (action === 'distribute') {
        const task = input.task as string;
        const nodes = Object.values(store.nodes).filter(n => n.status === 'active');

        if (nodes.length === 0) {
          return { success: false, error: 'No active nodes available' };
        }

        // Select node based on algorithm
        let selectedNode: typeof nodes[0];
        const algorithm = store.loadBalance.algorithm;

        if (algorithm === 'least-connections' || algorithm === 'adaptive') {
          selectedNode = nodes.reduce((min, n) => n.load < min.load ? n : min);
        } else if (algorithm === 'weighted') {
          const weights = store.loadBalance.weights;
          selectedNode = nodes.reduce((max, n) => (weights[n.id] || 1) > (weights[max.id] || 1) ? n : max);
        } else {
          // Round robin - just pick first active
          selectedNode = nodes[0];
        }

        // Update load
        selectedNode.load += 1;
        saveCoordStore(store);

        return {
          success: true,
          action: 'distributed',
          task,
          assignedTo: selectedNode.id,
          algorithm,
          nodeLoad: selectedNode.load,
        };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'coordination_sync',
    description: 'Synchronize state across nodes Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'trigger', 'resolve'], description: 'Action to perform' },
        force: { type: 'boolean', description: 'Force synchronization' },
        conflictResolution: { type: 'string', enum: ['latest', 'merge', 'manual'], description: 'Conflict resolution strategy' },
      },
    },
    handler: async (input) => {
      const store = loadCoordStore();
      const action = (input.action as string) || 'status';

      if (action === 'status') {
        const timeSinceSync = Date.now() - new Date(store.sync.lastSync).getTime();

        return {
          success: true,
          sync: store.sync,
          timeSinceSync: `${Math.floor(timeSinceSync / 1000)}s`,
          status: store.sync.conflicts > 0 ? 'conflicts' : store.sync.pendingChanges > 0 ? 'pending' : 'synced',
        };
      }

      if (action === 'trigger') {
        store.sync.syncCount++;
        store.sync.lastSync = new Date().toISOString();
        store.sync.pendingChanges = 0;

        // Simulate sync
        await new Promise(resolve => setTimeout(resolve, 50));

        saveCoordStore(store);

        return {
          success: true,
          action: 'synchronized',
          syncCount: store.sync.syncCount,
          syncedAt: store.sync.lastSync,
          nodesSync: Object.keys(store.nodes).length,
        };
      }

      if (action === 'resolve') {
        const strategy = (input.conflictResolution as string) || 'latest';

        if (store.sync.conflicts > 0) {
          const resolved = store.sync.conflicts;
          store.sync.conflicts = 0;
          saveCoordStore(store);

          return {
            success: true,
            action: 'resolved',
            strategy,
            conflictsResolved: resolved,
          };
        }

        return {
          success: true,
          action: 'resolve',
          message: 'No conflicts to resolve',
        };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'coordination_node',
    description: 'Manage coordination nodes Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'add', 'remove', 'heartbeat'], description: 'Action to perform' },
        nodeId: { type: 'string', description: 'Node ID' },
        status: { type: 'string', description: 'Node status' },
      },
    },
    handler: async (input) => {
      if (input.nodeId) { const vNode = validateIdentifier(input.nodeId, 'nodeId'); if (!vNode.valid) return { success: false, error: vNode.error }; }
      const store = loadCoordStore();
      const action = (input.action as string) || 'list';

      if (action === 'list') {
        const nodes = Object.values(store.nodes);

        return {
          success: true,
          nodes: nodes.map(n => ({
            id: n.id,
            status: n.status,
            load: n.load,
            lastHeartbeat: n.lastHeartbeat,
          })),
          total: nodes.length,
          active: nodes.filter(n => n.status === 'active').length,
        };
      }

      if (action === 'add') {
        const nodeId = (input.nodeId as string) || `node-${Date.now()}`;

        store.nodes[nodeId] = {
          id: nodeId,
          status: 'active',
          load: 0,
          lastHeartbeat: new Date().toISOString(),
        };

        saveCoordStore(store);

        return {
          success: true,
          action: 'added',
          nodeId,
          totalNodes: Object.keys(store.nodes).length,
        };
      }

      if (action === 'remove') {
        const nodeId = input.nodeId as string;

        if (!store.nodes[nodeId]) {
          return { success: false, error: 'Node not found' };
        }

        delete store.nodes[nodeId];
        saveCoordStore(store);

        return {
          success: true,
          action: 'removed',
          nodeId,
          totalNodes: Object.keys(store.nodes).length,
        };
      }

      if (action === 'heartbeat') {
        const nodeId = input.nodeId as string;

        if (store.nodes[nodeId]) {
          store.nodes[nodeId].lastHeartbeat = new Date().toISOString();
          store.nodes[nodeId].status = 'active';
          saveCoordStore(store);
        }

        return {
          success: true,
          action: 'heartbeat',
          nodeId,
          timestamp: new Date().toISOString(),
        };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'coordination_consensus',
    description: 'Manage consensus protocol with BFT, Raft, or Quorum strategies Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['status', 'propose', 'vote', 'commit'], description: 'Action to perform' },
        proposal: { type: 'object', description: 'Proposal data (for propose)' },
        proposalId: { type: 'string', description: 'Proposal ID (for vote/commit/status)' },
        vote: { type: 'string', enum: ['accept', 'reject'], description: 'Vote' },
        voterId: { type: 'string', description: 'Voter node ID' },
        strategy: { type: 'string', enum: ['bft', 'raft', 'quorum'], description: 'Consensus strategy (default: raft)' },
        quorumPreset: { type: 'string', enum: ['unanimous', 'majority', 'supermajority'], description: 'Quorum threshold preset (default: majority)' },
        term: { type: 'number', description: 'Term number (for raft strategy)' },
      },
    },
    handler: async (input) => {
      if (input.proposalId) { const vProp = validateIdentifier(input.proposalId, 'proposalId'); if (!vProp.valid) return { success: false, error: vProp.error }; }
      if (input.voterId) { const vVoter = validateIdentifier(input.voterId, 'voterId'); if (!vVoter.valid) return { success: false, error: vVoter.error }; }
      const store = loadCoordStore();
      const action = (input.action as string) || 'status';
      const strategy = (input.strategy as string) || 'raft';
      const nodeCount = Object.keys(store.nodes).length || 1;

      // Initialize consensus storage in the coordination store if missing
      if (!store.consensus) {
        store.consensus = { pending: [], history: [] };
      }
      const consensus = store.consensus;

      function calcRequired(strat: string, total: number, preset?: string): number {
        if (total <= 0) return 1;
        if (strat === 'bft') return Math.floor((total * 2) / 3) + 1;
        if (strat === 'quorum') {
          if (preset === 'unanimous') return total;
          if (preset === 'supermajority') return Math.floor((total * 2) / 3) + 1;
        }
        return Math.floor(total / 2) + 1;
      }

      if (action === 'status') {
        if (input.proposalId) {
          // Status for specific proposal
          const p = consensus.pending.find(x => x.proposalId === input.proposalId);
          if (p) {
            const votesFor = Object.values(p.votes).filter(v => v).length;
            const votesAgainst = Object.values(p.votes).filter(v => !v).length;
            return {
              success: true,
              proposalId: p.proposalId,
              strategy: p.strategy,
              status: p.status,
              votesFor,
              votesAgainst,
              required: calcRequired(p.strategy, nodeCount, p.quorumPreset),
              totalNodes: nodeCount,
              resolved: false,
            };
          }
          const h = consensus.history.find(x => x.proposalId === input.proposalId);
          if (h) return { success: true, ...h, resolved: true, historical: true };
          return { success: false, error: 'Proposal not found' };
        }

        const quorum = calcRequired(strategy, nodeCount);
        return {
          success: true,
          algorithm: store.topology.consensusAlgorithm,
          strategy,
          nodes: nodeCount,
          quorum,
          pendingProposals: consensus.pending.length,
          resolvedProposals: consensus.history.length,
          status: nodeCount >= quorum ? 'operational' : 'degraded',
        };
      }

      if (action === 'propose') {
        const proposalId = `proposal-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const quorumPreset = (input.quorumPreset as string) || 'majority';
        const term = (input.term as number) || 1;
        const required = calcRequired(strategy, nodeCount, quorumPreset);

        // Raft: one pending proposal per term
        if (strategy === 'raft') {
          const existing = consensus.pending.find(p => p.strategy === 'raft' && p.term === term);
          if (existing) {
            return {
              success: false,
              error: `Raft term ${term} already has pending proposal: ${existing.proposalId}`,
              existingProposalId: existing.proposalId,
            };
          }
        }

        consensus.pending.push({
          proposalId,
          type: 'coordination',
          proposal: input.proposal,
          proposedBy: (input.voterId as string) || 'system',
          proposedAt: new Date().toISOString(),
          votes: {},
          status: 'pending',
          strategy,
          term: strategy === 'raft' ? term : undefined,
          quorumPreset: strategy === 'quorum' ? quorumPreset : undefined,
          byzantineVoters: strategy === 'bft' ? [] : undefined,
        });

        saveCoordStore(store);

        return {
          success: true,
          action: 'proposed',
          proposalId,
          proposal: input.proposal,
          strategy,
          status: 'pending',
          required,
          totalNodes: nodeCount,
          term: strategy === 'raft' ? term : undefined,
        };
      }

      if (action === 'vote') {
        const p = consensus.pending.find(x => x.proposalId === input.proposalId);
        if (!p) return { success: false, error: 'Proposal not found or already resolved' };

        const voterId = input.voterId as string;
        if (!voterId) return { success: false, error: 'voterId is required' };

        const voteValue = input.vote === 'accept';
        const pStrategy = p.strategy || 'raft';
        const required = calcRequired(pStrategy, nodeCount, p.quorumPreset);

        // Double-vote prevention
        if (voterId in p.votes) {
          if (pStrategy === 'bft' && p.votes[voterId] !== voteValue) {
            if (!p.byzantineVoters) p.byzantineVoters = [];
            if (!p.byzantineVoters.includes(voterId)) p.byzantineVoters.push(voterId);
            delete p.votes[voterId];
            saveCoordStore(store);
            return {
              success: false,
              byzantineDetected: true,
              message: `Byzantine behavior: voter ${voterId} attempted conflicting vote. Vote invalidated.`,
              byzantineVoters: p.byzantineVoters,
            };
          }
          return { success: false, error: `Voter ${voterId} has already voted on this proposal` };
        }

        // BFT cross-proposal conflict check
        if (pStrategy === 'bft') {
          for (const other of consensus.pending) {
            if (other.proposalId === p.proposalId) continue;
            if (voterId in other.votes && other.votes[voterId] !== voteValue) {
              if (!p.byzantineVoters) p.byzantineVoters = [];
              if (!p.byzantineVoters.includes(voterId)) p.byzantineVoters.push(voterId);
              saveCoordStore(store);
              return {
                success: false,
                byzantineDetected: true,
                message: `Byzantine behavior: voter ${voterId} cast conflicting votes across proposals.`,
                byzantineVoters: p.byzantineVoters,
              };
            }
          }
        }

        p.votes[voterId] = voteValue;

        const votesFor = Object.values(p.votes).filter(v => v).length;
        const votesAgainst = Object.values(p.votes).filter(v => !v).length;

        // Resolution check
        let resolved = false;
        let result: string | undefined;

        if (votesFor >= required) {
          resolved = true;
          result = 'approved';
        } else if (votesAgainst >= required) {
          resolved = true;
          result = 'rejected';
        } else if (pStrategy === 'quorum' && p.quorumPreset === 'unanimous' && votesAgainst > 0) {
          resolved = true;
          result = 'rejected';
        }

        if (resolved && result) {
          p.status = result;
          consensus.history.push({
            proposalId: p.proposalId,
            result,
            votes: { for: votesFor, against: votesAgainst },
            decidedAt: new Date().toISOString(),
            strategy: pStrategy,
            term: p.term,
            byzantineDetected: p.byzantineVoters?.length ? p.byzantineVoters : undefined,
          });
          consensus.pending = consensus.pending.filter(x => x.proposalId !== p.proposalId);
        }

        saveCoordStore(store);

        return {
          success: true,
          action: 'voted',
          proposalId: p.proposalId,
          voterId,
          vote: input.vote,
          strategy: pStrategy,
          votesFor,
          votesAgainst,
          required,
          totalNodes: nodeCount,
          resolved,
          result: resolved ? result : undefined,
          status: p.status,
        };
      }

      if (action === 'commit') {
        // Commit is a no-op confirmation for already-resolved proposals
        if (input.proposalId) {
          const h = consensus.history.find(x => x.proposalId === input.proposalId);
          if (h) {
            return {
              success: true,
              action: 'committed',
              proposalId: input.proposalId,
              result: h.result,
              committedAt: new Date().toISOString(),
            };
          }
          return { success: false, error: 'Proposal not found in resolved history. Vote must reach quorum first.' };
        }
        return { success: false, error: 'proposalId is required for commit' };
      }

      return { success: false, error: 'Unknown action' };
    },
  },
  {
    name: 'coordination_orchestrate',
    description: 'Orchestrate multi-agent coordination Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Task to orchestrate' },
        agents: { type: 'array', items: { type: 'string' }, description: 'Agent IDs to coordinate' },
        strategy: { type: 'string', enum: ['parallel', 'sequential', 'pipeline', 'broadcast'], description: 'Orchestration strategy' },
        timeout: { type: 'number', description: 'Timeout in ms' },
      },
      required: ['task'],
    },
    handler: async (input) => {
      const vTask = validateText(input.task, 'task');
      if (!vTask.valid) return { success: false, error: vTask.error };
      if (input.agents && Array.isArray(input.agents)) {
        for (const a of input.agents as string[]) { const vA = validateIdentifier(a, 'agents[]'); if (!vA.valid) return { success: false, error: vA.error }; }
      }
      const store = loadCoordStore();
      const task = input.task as string;
      const agents = (input.agents as string[]) || Object.keys(store.nodes);
      const strategy = (input.strategy as string) || 'parallel';

      const orchestrationId = `orch-${Date.now()}`;

      // ADR-093 F7: this tool only schedules an orchestration record — it
      // does not actually execute. Previously it returned a hardcoded
      // `estimatedCompletion: "50ms"` which was misleading. Now we return
      // an honest stub-status with a note pointing callers at agent_spawn
      // / Task tool / hive-mind tools for real orchestration. Persist the
      // record so callers can list/inspect what was scheduled.
      const orchestration = {
        id: orchestrationId,
        task,
        strategy,
        agents,
        status: 'scheduled' as const,
        scheduledAt: new Date().toISOString(),
        topology: store.topology.type,
      };
      // Best-effort persist — keep last 100 scheduled orchestrations.
      type CoordStoreShape = ReturnType<typeof loadCoordStore> & {
        orchestrations?: Array<typeof orchestration>;
      };
      const orchStore = store as CoordStoreShape;
      if (!Array.isArray(orchStore.orchestrations)) orchStore.orchestrations = [];
      orchStore.orchestrations.push(orchestration);
      if (orchStore.orchestrations.length > 100) {
        orchStore.orchestrations = orchStore.orchestrations.slice(-100);
      }
      saveCoordStore(orchStore);

      return {
        success: true,
        orchestrationId,
        task,
        strategy,
        agents,
        status: 'scheduled',
        topology: store.topology.type,
        // Honest stub: no executor wired up yet. Don't lie about completion time.
        executor: 'none',
        _note: 'coordination_orchestrate currently records the orchestration request but does not execute it. For real multi-agent execution use agent_spawn + the Task tool, or hive-mind_spawn for queen-led coordination. Real executor tracked in issue #2140.',
      };
    },
  },
  {
    name: 'coordination_metrics',
    description: 'Get coordination metrics Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['all', 'latency', 'throughput', 'availability'], description: 'Metric type' },
        timeRange: { type: 'string', description: 'Time range' },
      },
    },
    handler: async (input) => {
      const store = loadCoordStore();
      const metric = (input.metric as string) || 'all';

      const nodes = Object.values(store.nodes);
      const activeNodes = nodes.filter(n => n.status === 'active');

      const metrics = {
        latency: {
          avg: null,
          p50: null,
          p95: null,
          p99: null,
          unit: 'ms',
          _note: 'Real-time latency metrics not available — coordination is state-tracking only',
        },
        throughput: {
          current: null,
          peak: null,
          avg: null,
          unit: 'ops/s',
          _note: 'Real-time throughput metrics not available — coordination is state-tracking only',
        },
        availability: {
          uptime: null,
          _note: 'Uptime not tracked — coordination store has no persistent start time',
          activeNodes: activeNodes.length,
          totalNodes: nodes.length,
          syncCount: store.sync.syncCount,
          lastSync: store.sync.lastSync,
          conflicts: store.sync.conflicts,
          pendingChanges: store.sync.pendingChanges,
          syncStatus: store.sync.conflicts === 0 ? 'healthy' : 'conflicts',
        },
      };

      if (metric === 'all') {
        return { success: true, metrics };
      }

      return {
        success: true,
        metric,
        data: metrics[metric as keyof typeof metrics],
      };
    },
  },
];
