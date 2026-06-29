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
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { orchestrate } from '../orchestration/orchestration-service.js';
import { orchestrationStore } from '../orchestration/orchestration-store.js';
import type { OrchestrationRecord } from '../orchestration/types.js';

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

      return orchestrate({
        task: input.task as string,
        agents: input.agents as string[] | undefined,
        strategy: input.strategy as 'parallel' | 'sequential' | 'pipeline' | 'broadcast' | undefined,
        timeout: input.timeout as number | undefined,
      });
    },
  },
  {
    name: 'coordination_metrics',
    description: 'Get coordination metrics derived from orchestration execution records. Use when native Task is wrong because the work crosses multiple agents that need to vote/sync/load-balance — TodoWrite + a single Task cannot orchestrate consensus. For one-off subtask dispatch, native Task is fine.',
    category: 'coordination',
    inputSchema: {
      type: 'object',
      properties: {
        metric: { type: 'string', enum: ['all', 'latency', 'throughput', 'availability'], description: 'Metric type' },
        timeRange: { type: 'string', description: 'Time range: <N>m (minutes), <N>h (hours), <N>d (days)' },
      },
    },
    handler: async (input) => {
      const metric = (input.metric as string) || 'all';
      const timeRange = input.timeRange as string | undefined;

      const records = orchestrationStore.getMetricsRecords();

      let filteredRecords = records;
      if (timeRange) {
        if (typeof timeRange !== 'string') {
          return { success: false, error: 'timeRange must be a string' };
        }
        const match = timeRange.match(/^(\d+)(m|h|d)$/);
        if (!match) {
          return { success: false, error: `Invalid timeRange format: "${timeRange}". Use <N>m, <N>h, or <N>d.` };
        }
        const value = parseInt(match[1], 10);
        const unit = match[2];
        const cutoff = Date.now() - (
          unit === 'm' ? value * 60 * 1000 :
          unit === 'h' ? value * 60 * 60 * 1000 :
          value * 24 * 60 * 60 * 1000
        );
        filteredRecords = records.filter(r => {
          const t = r.completedAt || r.startedAt;
          return t && new Date(t).getTime() >= cutoff;
        });
      }

      const completedRecords = filteredRecords.filter(r => r.status === 'completed' || r.status === 'partial' || r.status === 'failed');
      const durations = completedRecords.map(r => r.durationMs).filter((d): d is number => d != null).sort((a, b) => a - b);
      const n = durations.length;

      const p50 = n > 0 ? durations[Math.floor(n * 0.5)] : null;
      const p95 = n > 0 ? durations[Math.floor(n * 0.95)] : null;
      const p99 = n > 0 ? durations[Math.floor(n * 0.99)] : null;
      const avg = n > 0 ? durations.reduce((s, d) => s + d, 0) / n : null;

      const byStatus: Record<string, number> = {};
      for (const r of filteredRecords) {
        byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      }

      const totalOrchestrations = filteredRecords.length;
      const successCount = byStatus['completed'] || 0;
      const partialCount = byStatus['partial'] || 0;
      const failedCount = byStatus['failed'] || 0;
      const successRate = totalOrchestrations > 0
        ? Math.round((successCount / totalOrchestrations) * 10000) / 100
        : 0;

      const timeRangeWindow = timeRange || 'all';
      const throughputUnit = timeRange
        ? (timeRange.endsWith('m') ? 'ops/min' : timeRange.endsWith('h') ? 'ops/h' : 'ops/d')
        : 'total';

      const metrics = {
        latency: {
          avg,
          p50,
          p95,
          p99,
          unit: 'ms',
        },
        throughput: {
          count: filteredRecords.length,
          unit: throughputUnit,
          byStatus,
        },
        availability: {
          totalOrchestrations,
          completed: successCount,
          partial: partialCount,
          failed: failedCount,
          successRate,
          running: byStatus['running'] || 0,
          timeRange: timeRangeWindow,
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
