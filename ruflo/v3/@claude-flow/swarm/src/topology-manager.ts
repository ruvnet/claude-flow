/**
 * V3 Topology Manager
 * Manages swarm network topology with support for mesh, hierarchical, centralized, and hybrid modes
 */

import { EventEmitter } from 'events';
import {
  TopologyConfig,
  TopologyState,
  TopologyNode,
  TopologyEdge,
  TopologyPartition,
  TopologyType,
  ITopologyManager,
} from './types.js';

export class TopologyManager extends EventEmitter implements ITopologyManager {
  private config: TopologyConfig;
  private state: TopologyState;
  private nodeIndex: Map<string, TopologyNode> = new Map();
  private adjacencyList: Map<string, Set<string>> = new Map();
  private lastRebalance: Date = new Date();

  // O(1) role-based indexes for performance (fixes O(n) find operations)
  private roleIndex: Map<TopologyNode['role'], Set<string>> = new Map();
  private queenNode: TopologyNode | null = null;
  private coordinatorNode: TopologyNode | null = null;

  constructor(config: Partial<TopologyConfig> = {}) {
    super();
    this.config = {
      type: config.type ?? 'mesh',
      maxAgents: config.maxAgents ?? 100,
      replicationFactor: config.replicationFactor ?? 2,
      partitionStrategy: config.partitionStrategy ?? 'hash',
      failoverEnabled: config.failoverEnabled ?? true,
      autoRebalance: config.autoRebalance ?? true,
    };

    this.state = {
      type: this.config.type,
      nodes: [],
      edges: [],
      leader: undefined,
      partitions: [],
    };
  }

  async initialize(config?: TopologyConfig): Promise<void> {
    if (config) {
      this.config = { ...this.config, ...config };
      this.state.type = this.config.type;
    }

    this.emit('initialized', { type: this.config.type });
  }

  getState(): TopologyState {
    return {
      ...this.state,
      nodes: [...this.state.nodes],
      edges: [...this.state.edges],
      partitions: [...this.state.partitions],
    };
  }

  async addNode(agentId: string, role: TopologyNode['role']): Promise<TopologyNode> {
    if (this.nodeIndex.has(agentId)) {
      throw new Error(`Node ${agentId} already exists in topology`);
    }

    if (this.nodeIndex.size >= this.config.maxAgents) {
      throw new Error(`Maximum agents (${this.config.maxAgents}) reached`);
    }

    // Create node with connections based on topology type
    const connections = this.calculateInitialConnections(agentId, role);

    const node: TopologyNode = {
      id: `node_${agentId}`,
      agentId,
      role: this.determineRole(role),
      status: 'syncing',
      connections,
      metadata: {
        joinedAt: new Date().toISOString(),
        version: '1.0.0',
      },
    };

    // Add to state
    this.nodeIndex.set(agentId, node);
    this.state.nodes.push(node);

    // Update role index for O(1) role-based lookups
    this.addToRoleIndex(node);

    // Initialize adjacency list
    this.adjacencyList.set(agentId, new Set(connections));

    // Create edges
    await this.createEdgesForNode(node);

    // Update partitions if needed
    await this.updatePartitions(node);

    // Mark as active after sync
    node.status = 'active';

    this.emit('node.added', { node });

    // Trigger rebalance if needed
    if (this.config.autoRebalance && this.shouldRebalance()) {
      await this.rebalance();
    }

    return node;
  }

  async removeNode(agentId: string): Promise<void> {
    const node = this.nodeIndex.get(agentId);
    if (!node) {
      return;
    }

    // Remove from state
    this.state.nodes = this.state.nodes.filter(n => n.agentId !== agentId);
    this.nodeIndex.delete(agentId);

    // Update role index
    this.removeFromRoleIndex(node);

    // Remove all edges connected to this node
    this.state.edges = this.state.edges.filter(
      e => e.from !== agentId && e.to !== agentId
    );

    // Update adjacency list
    this.adjacencyList.delete(agentId);
    for (const neighbors of this.adjacencyList.values()) {
      neighbors.delete(agentId);
    }

    // Update all nodes' connections
    for (const n of this.state.nodes) {
      n.connections = n.connections.filter(c => c !== agentId);
    }

    // If this was the leader, elect new one
    if (this.state.leader === agentId) {
      await this.electLeader();
    }

    // Update partitions
    for (const partition of this.state.partitions) {
      partition.nodes = partition.nodes.filter(n => n !== agentId);
      if (partition.leader === agentId) {
        partition.leader = partition.nodes[0] || '';
      }
    }

    this.emit('node.removed', { agentId });

    // Trigger rebalance if needed
    if (this.config.autoRebalance) {
      await this.rebalance();
    }
  }

  async updateNode(agentId: string, updates: Partial<TopologyNode>): Promise<void> {
    const node = this.nodeIndex.get(agentId);
    if (!node) {
      throw new Error(`Node ${agentId} not found`);
    }

    // Apply updates
    if (updates.role !== undefined) node.role = updates.role;
    if (updates.status !== undefined) node.status = updates.status;
    if (updates.connections !== undefined) {
      node.connections = updates.connections;
      this.adjacencyList.set(agentId, new Set(updates.connections));
    }
    if (updates.metadata !== undefined) {
      node.metadata = { ...node.metadata, ...updates.metadata };
    }

    this.emit('node.updated', { agentId, updates });
  }

  getLeader(): string | undefined {
    return this.state.leader;
  }

  async electLeader(): Promise<string> {
    if (this.state.nodes.length === 0) {
      throw new Error('No nodes available for leader election');
    }

    // For hierarchical topology, the queen is the leader (O(1) lookup)
    if (this.config.type === 'hierarchical') {
      const queen = this.queenNode;
      if (queen) {
        this.state.leader = queen.agentId;
        return queen.agentId;
      }
    }

    // For centralized topology, the coordinator is the leader (O(1) lookup)
    if (this.config.type === 'centralized') {
      const coordinator = this.coordinatorNode;
      if (coordinator) {
        this.state.leader = coordinator.agentId;
        return coordinator.agentId;
      }
    }

    // For mesh/hybrid, elect based on node capabilities
    const candidates = this.state.nodes
      .filter(n => n.status === 'active')
      .sort((a, b) => {
        // Prefer coordinators, then queens
        const roleOrder: Record<TopologyNode['role'], number> = {
          queen: 0,
          coordinator: 1,
          worker: 2,
          peer: 2,
        };
        return roleOrder[a.role] - roleOrder[b.role];
      });

    if (candidates.length === 0) {
      throw new Error('No active nodes available for leader election');
    }

    const leader = candidates[0];
    this.state.leader = leader.agentId;

    this.emit('leader.elected', { leaderId: leader.agentId });

    return leader.agentId;
  }

  async rebalance(): Promise<void> {
    const now = new Date();
    const timeSinceLastRebalance = now.getTime() - this.lastRebalance.getTime();

    // Prevent too frequent rebalancing
    if (timeSinceLastRebalance < 5000) {
      return;
    }

    this.lastRebalance = now;

    switch (this.config.type) {
      case 'mesh':
        await this.rebalanceMesh();
        break;
      case 'hierarchical':
        await this.rebalanceHierarchical();
        break;
      case 'centralized':
        await this.rebalanceCentralized();
        break;
      case 'hybrid':
        await this.rebalanceHybrid();
        break;
    }

    this.emit('topology.rebalanced', { type: this.config.type });
  }

  getNeighbors(agentId: string): string[] {
    return Array.from(this.adjacencyList.get(agentId) || []);
  }

  findOptimalPath(from: string, to: string): string[] {
    if (from === to) {
      return [from];
    }

    // BFS for shortest path
    const visited = new Set<string>();
    const queue: { node: string; path: string[] }[] = [{ node: from, path: [from] }];

    while (queue.length > 0) {
      const { node, path } = queue.shift()!;

      if (node === to) {
        return path;
      }

      if (visited.has(node)) {
        continue;
      }
      visited.add(node);

      const neighbors = this.adjacencyList.get(node) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          queue.push({ node: neighbor, path: [...path, neighbor] });
        }
      }
    }

    // No path found
    return [];
  }

  // ===== PRIVATE METHODS =====

  private determineRole(requestedRole: TopologyNode['role']): TopologyNode['role'] {
    switch (this.config.type) {
      case 'mesh':
        return 'peer';
      case 'hierarchical':
        // First node becomes queen
        if (this.state.nodes.length === 0) {
          return 'queen';
        }
        return requestedRole === 'queen' && !this.hasQueen() ? 'queen' : 'worker';
      case 'centralized':
        // First node becomes coordinator
        if (this.state.nodes.length === 0) {
          return 'coordinator';
        }
        return 'worker';
      case 'hybrid':
        return requestedRole;
    }
  }

  private hasQueen(): boolean {
    return this.queenNode !== null; // O(1) check using cached queen
  }

  private calculateInitialConnections(agentId: string, role: TopologyNode['role']): string[] {
    const existingNodes = Array.from(this.nodeIndex.keys());

    switch (this.config.type) {
      case 'mesh':
        // In mesh, connect to all existing nodes (up to a limit)
        const maxMeshConnections = Math.min(10, existingNodes.length);
        return existingNodes.slice(0, maxMeshConnections);

      case 'hierarchical':
        // Workers connect to queen, queen connects to workers (O(1) lookup)
        if (role === 'queen' || existingNodes.length === 0) {
          return existingNodes;
        }
        return this.queenNode ? [this.queenNode.agentId] : [];

      case 'centralized':
        // All nodes connect to coordinator (O(1) lookup)
        if (role === 'coordinator' || existingNodes.length === 0) {
          return existingNodes;
        }
        return this.coordinatorNode ? [this.coordinatorNode.agentId] : [];

      case 'hybrid':
        // Mix of mesh and hierarchical
        const leaders = this.state.nodes.filter(n =>
          n.role === 'queen' || n.role === 'coordinator'
        );
        const peers = existingNodes.slice(0, 3);
        return [...new Set([...leaders.map(l => l.agentId), ...peers])];
    }
  }

  private async createEdgesForNode(node: TopologyNode): Promise<void> {
    for (const connectionId of node.connections) {
      const edge: TopologyEdge = {
        from: node.agentId,
        to: connectionId,
        weight: 1,
        bidirectional: this.config.type === 'mesh',
        latencyMs: 0,
      };

      this.state.edges.push(edge);

      // Add bidirectional edge
      if (edge.bidirectional) {
        const existingNode = this.nodeIndex.get(connectionId);
        if (existingNode && !existingNode.connections.includes(node.agentId)) {
          existingNode.connections.push(node.agentId);
          this.adjacencyList.get(connectionId)?.add(node.agentId);
        }
      }
    }
  }

  private async updatePartitions(node: TopologyNode): Promise<void> {
    if (this.config.type !== 'mesh' && this.config.type !== 'hybrid') {
      return;
    }

    // Create partitions based on strategy
    const nodesPerPartition = Math.ceil(this.config.maxAgents / 10);
    const partitionIndex = Math.floor(this.state.nodes.length / nodesPerPartition);

    if (this.state.partitions.length <= partitionIndex) {
      // Create new partition
      const partition: TopologyPartition = {
        id: `partition_${partitionIndex}`,
        nodes: [node.agentId],
        leader: node.agentId,
        replicaCount: 1,
      };
      this.state.partitions.push(partition);
    } else {
      // Add to existing partition
      const partition = this.state.partitions[partitionIndex];
      partition.nodes.push(node.agentId);
      partition.replicaCount = Math.min(
        partition.nodes.length,
        this.config.replicationFactor ?? 2
      );
    }
  }

  private shouldRebalance(): boolean {
    // Check for uneven distribution
    if (this.config.type === 'mesh') {
      const avgConnections = this.state.nodes.reduce(
        (sum, n) => sum + n.connections.length, 0
      ) / Math.max(1, this.state.nodes.length);

      for (const node of this.state.nodes) {
        if (Math.abs(node.connections.length - avgConnections) > avgConnections * 0.5) {
          return true;
        }
      }
    }

    return false;
  }

  private async rebalanceMesh(): Promise<void> {
    const targetConnections = Math.min(5, this.state.nodes.length - 1);

    for (const node of this.state.nodes) {
      // Ensure minimum connections
      while (node.connections.length < targetConnections) {
        const candidates = this.state.nodes
          .filter(n =>
            n.agentId !== node.agentId &&
            !node.connections.includes(n.agentId)
          )
          .sort(() => Math.random() - 0.5);

        if (candidates.length > 0) {
          node.connections.push(candidates[0].agentId);
          this.adjacencyList.get(node.agentId)?.add(candidates[0].agentId);

          // Bidirectional
          candidates[0].connections.push(node.agentId);
          this.adjacencyList.get(candidates[0].agentId)?.add(node.agentId);
        } else {
          break;
        }
      }
    }
  }

  private async rebalanceHierarchical(): Promise<void> {
    // O(1) queen lookup
    let queen = this.queenNode;
    if (!queen) {
      // Elect a queen if missing
      if (this.state.nodes.length > 0) {
        const newQueen = this.state.nodes[0]!;
        newQueen.role = 'queen';
        this.addToRoleIndex(newQueen);
        queen = newQueen;
      } else {
        return;
      }
    }

    // Ensure all workers are connected to queen
    for (const node of this.state.nodes) {
      if (node.role === 'worker' && !node.connections.includes(queen.agentId)) {
        node.connections.push(queen.agentId);
        this.adjacencyList.get(node.agentId)?.add(queen.agentId);
        queen.connections.push(node.agentId);
        this.adjacencyList.get(queen.agentId)?.add(node.agentId);
      }
    }
  }

  private async rebalanceCentralized(): Promise<void> {
    // O(1) coordinator lookup
    let coordinator = this.coordinatorNode;
    if (!coordinator) {
      if (this.state.nodes.length > 0) {
        const newCoord = this.state.nodes[0]!;
        newCoord.role = 'coordinator';
        this.addToRoleIndex(newCoord);
        coordinator = newCoord;
      } else {
        return;
      }
    }

    // Ensure all nodes are connected to coordinator
    for (const node of this.state.nodes) {
      if (node.role !== 'coordinator' && !node.connections.includes(coordinator.agentId)) {
        node.connections = [coordinator.agentId];
        this.adjacencyList.set(node.agentId, new Set([coordinator.agentId]));
        coordinator.connections.push(node.agentId);
        this.adjacencyList.get(coordinator.agentId)?.add(node.agentId);
      }
    }
  }

  private async rebalanceHybrid(): Promise<void> {
    // Hybrid combines mesh for workers and hierarchical for coordinators
    const coordinators = this.state.nodes.filter(
      n => n.role === 'queen' || n.role === 'coordinator'
    );
    const workers = this.state.nodes.filter(n => n.role === 'worker' || n.role === 'peer');

    // Connect workers in mesh (limited connections)
    for (const worker of workers) {
      const targetConnections = Math.min(3, workers.length - 1);
      const currentWorkerConnections = worker.connections.filter(
        c => workers.some(w => w.agentId === c)
      );

      while (currentWorkerConnections.length < targetConnections) {
        const candidates = workers.filter(
          w => w.agentId !== worker.agentId && !currentWorkerConnections.includes(w.agentId)
        );
        if (candidates.length === 0) break;

        const target = candidates[Math.floor(Math.random() * candidates.length)];
        worker.connections.push(target.agentId);
        currentWorkerConnections.push(target.agentId);
        this.adjacencyList.get(worker.agentId)?.add(target.agentId);
      }
    }

    // Connect all workers to at least one coordinator
    if (coordinators.length > 0) {
      for (const worker of workers) {
        const hasCoordinator = worker.connections.some(
          c => coordinators.some(coord => coord.agentId === c)
        );
        if (!hasCoordinator) {
          const coord = coordinators[Math.floor(Math.random() * coordinators.length)];
          worker.connections.push(coord.agentId);
          this.adjacencyList.get(worker.agentId)?.add(coord.agentId);
          coord.connections.push(worker.agentId);
          this.adjacencyList.get(coord.agentId)?.add(worker.agentId);
        }
      }
    }
  }

  // ===== ROLE INDEX METHODS (O(1) lookups) =====

  /**
   * Add node to role index
   */
  private addToRoleIndex(node: TopologyNode): void {
    let roleSet = this.roleIndex.get(node.role);
    if (!roleSet) {
      roleSet = new Set();
      this.roleIndex.set(node.role, roleSet);
    }
    roleSet.add(node.agentId);

    // Cache queen/coordinator for O(1) access
    if (node.role === 'queen') {
      this.queenNode = node;
    } else if (node.role === 'coordinator') {
      this.coordinatorNode = node;
    }
  }

  /**
   * Remove node from role index
   */
  private removeFromRoleIndex(node: TopologyNode): void {
    const roleSet = this.roleIndex.get(node.role);
    if (roleSet) {
      roleSet.delete(node.agentId);
    }

    // Clear cached queen/coordinator
    if (node.role === 'queen' && this.queenNode?.agentId === node.agentId) {
      this.queenNode = null;
    } else if (node.role === 'coordinator' && this.coordinatorNode?.agentId === node.agentId) {
      this.coordinatorNode = null;
    }
  }

  /**
   * Get queen node with O(1) lookup
   */
  getQueen(): TopologyNode | undefined {
    return this.queenNode ?? undefined;
  }

  /**
   * Get coordinator node with O(1) lookup
   */
  getCoordinator(): TopologyNode | undefined {
    return this.coordinatorNode ?? undefined;
  }

  // ===== UTILITY METHODS =====

  getNode(agentId: string): TopologyNode | undefined {
    return this.nodeIndex.get(agentId);
  }

  getNodesByRole(role: TopologyNode['role']): TopologyNode[] {
    // Use role index for O(1) id lookup, then O(k) node retrieval where k = nodes with role
    const roleSet = this.roleIndex.get(role);
    if (!roleSet) return [];

    const nodes: TopologyNode[] = [];
    for (const agentId of roleSet) {
      const node = this.nodeIndex.get(agentId);
      if (node) nodes.push(node);
    }
    return nodes;
  }

  getActiveNodes(): TopologyNode[] {
    return this.state.nodes.filter(n => n.status === 'active');
  }

  getPartition(partitionId: string): TopologyPartition | undefined {
    return this.state.partitions.find(p => p.id === partitionId);
  }

  isConnected(from: string, to: string): boolean {
    return this.adjacencyList.get(from)?.has(to) ?? false;
  }

  getConnectionCount(): number {
    return this.state.edges.length;
  }

  getAverageConnections(): number {
    if (this.state.nodes.length === 0) return 0;
    const total = this.state.nodes.reduce((sum, n) => sum + n.connections.length, 0);
    return total / this.state.nodes.length;
  }
}

export function createTopologyManager(config?: Partial<TopologyConfig>): TopologyManager {
  return new TopologyManager(config);
}
