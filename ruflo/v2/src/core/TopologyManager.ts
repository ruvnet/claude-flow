/**
 * TopologyManager - Manages swarm topology (mesh, hierarchical, ring, star)
 * Implements network topology patterns for agent coordination
 */

import { IDatabaseProvider, ITopology, Agent, Network, Connection, Optimization, TopologyType, NetworkMetrics } from '../types/interfaces.js';

export class TopologyManager {
  private currentTopology: ITopology | null = null;
  private agents: Agent[] = [];
  private connections: Connection[] = [];

  constructor(private database: IDatabaseProvider) {}

  /**
   * Configure the swarm topology
   */
  async configure(topologyType: TopologyType, agents: Agent[] = []): Promise<Network> {
    this.agents = agents;
    this.currentTopology = this.createTopology(topologyType);

    const network = await this.currentTopology.configure(agents);
    this.connections = network.connections;

    // Persist topology configuration
    await this.database.store('topology', {
      type: topologyType,
      agentCount: agents.length,
      connectionCount: network.connections.length,
      timestamp: new Date().toISOString()
    }, 'system');

    return network;
  }

  /**
   * Create specific topology implementation
   */
  private createTopology(type: TopologyType): ITopology {
    switch (type) {
      case 'mesh':
        return new MeshTopology();
      case 'hierarchical':
        return new HierarchicalTopology();
      case 'ring':
        return new RingTopology();
      case 'star':
        return new StarTopology();
      default:
        throw new Error(`Unknown topology type: ${type}`);
    }
  }

  /**
   * Add agent to topology
   */
  async addAgent(agent: Agent): Promise<void> {
    if (!this.currentTopology) {
      throw new Error('Topology not configured');
    }

    this.agents.push(agent);
    const network = await this.currentTopology.configure(this.agents);
    this.connections = network.connections;

    await this.database.store(`agent:${agent.id}`, agent, 'agents');
  }

  /**
   * Remove agent from topology
   */
  async removeAgent(agentId: string): Promise<void> {
    if (!this.currentTopology) {
      throw new Error('Topology not configured');
    }

    this.agents = this.agents.filter(agent => agent.id !== agentId);
    const network = await this.currentTopology.configure(this.agents);
    this.connections = network.connections;

    await this.database.delete(`agent:${agentId}`, 'agents');
  }

  /**
   * Optimize current topology
   */
  async optimize(): Promise<Optimization> {
    if (!this.currentTopology) {
      throw new Error('Topology not configured');
    }

    const optimization = await this.currentTopology.optimize();

    // Apply optimization changes
    for (const change of optimization.changes) {
      switch (change.action) {
        case 'add-connection':
          this.connections.push(change.connection);
          break;
        case 'remove-connection':
          this.connections = this.connections.filter(conn =>
            !(conn.from === change.connection.from && conn.to === change.connection.to)
          );
          break;
        case 'modify-weight':
          const existing = this.connections.find(conn =>
            conn.from === change.connection.from && conn.to === change.connection.to
          );
          if (existing) {
            existing.weight = change.connection.weight;
          }
          break;
      }
    }

    return optimization;
  }

  /**
   * Get current topology information
   */
  async getTopologyInfo(): Promise<{
    type: TopologyType;
    agents: Agent[];
    connections: Connection[];
    metrics: NetworkMetrics;
  }> {
    if (!this.currentTopology) {
      throw new Error('Topology not configured');
    }

    const metrics = this.calculateMetrics();

    return {
      type: this.currentTopology.getType(),
      agents: this.agents,
      connections: this.connections,
      metrics
    };
  }

  /**
   * Calculate network metrics
   */
  private calculateMetrics(): NetworkMetrics {
    const totalAgents = this.agents.length;
    const totalConnections = this.connections.length;

    // Calculate average latency
    const latencies = this.connections
      .map(conn => conn.latency || 0)
      .filter(latency => latency > 0);
    const averageLatency = latencies.length > 0
      ? latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length
      : 0;

    // Estimate throughput based on connections
    const throughput = totalConnections > 0 ? totalAgents / totalConnections : 0;

    // Calculate reliability (percentage of active agents)
    const activeAgents = this.agents.filter(agent => agent.status === 'active').length;
    const reliability = totalAgents > 0 ? activeAgents / totalAgents : 0;

    return {
      totalAgents,
      totalConnections,
      averageLatency,
      throughput,
      reliability
    };
  }

  /**
   * Get agents connected to a specific agent
   */
  getConnectedAgents(agentId: string): Agent[] {
    const connectedIds = new Set<string>();

    this.connections.forEach(conn => {
      if (conn.from === agentId) {
        connectedIds.add(conn.to);
      } else if (conn.to === agentId) {
        connectedIds.add(conn.from);
      }
    });

    return this.agents.filter(agent => connectedIds.has(agent.id));
  }

  /**
   * Check if two agents are connected
   */
  areConnected(agentId1: string, agentId2: string): boolean {
    return this.connections.some(conn =>
      (conn.from === agentId1 && conn.to === agentId2) ||
      (conn.from === agentId2 && conn.to === agentId1)
    );
  }
}

/**
 * Mesh Topology - All agents connected to all others
 */
class MeshTopology implements ITopology {
  getType(): TopologyType {
    return 'mesh';
  }

  async configure(agents: Agent[]): Promise<Network> {
    const connections: Connection[] = [];

    // Create connections between all pairs
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        connections.push({
          from: agents[i].id,
          to: agents[j].id,
          type: 'direct',
          weight: 1.0,
          latency: Math.random() * 10 + 5 // 5-15ms simulated latency
        });
      }
    }

    return {
      topology: 'mesh',
      agents,
      connections,
      metrics: this.calculateMetrics(agents, connections)
    };
  }

  async optimize(): Promise<Optimization> {
    // For mesh topology, optimization might involve removing redundant connections
    return {
      type: 'latency',
      changes: [],
      expectedImprovement: 0
    };
  }

  getConnections(): Connection[] {
    return [];
  }

  private calculateMetrics(agents: Agent[], connections: Connection[]): NetworkMetrics {
    return {
      totalAgents: agents.length,
      totalConnections: connections.length,
      averageLatency: connections.reduce((sum, conn) => sum + (conn.latency || 0), 0) / connections.length || 0,
      throughput: agents.length,
      reliability: 0.95 // High reliability for mesh
    };
  }
}

/**
 * Hierarchical Topology - Tree-like structure with coordinators
 */
class HierarchicalTopology implements ITopology {
  getType(): TopologyType {
    return 'hierarchical';
  }

  async configure(agents: Agent[]): Promise<Network> {
    const connections: Connection[] = [];

    if (agents.length === 0) {
      return { topology: 'hierarchical', agents, connections, metrics: this.calculateMetrics(agents, connections) };
    }

    // Select coordinators (every 3-4 agents)
    const coordinators = agents.filter((_, index) => index % 4 === 0);
    const workers = agents.filter((_, index) => index % 4 !== 0);

    // Connect workers to nearest coordinator
    workers.forEach((worker, index) => {
      const coordinatorIndex = Math.floor(index / 3);
      const coordinator = coordinators[coordinatorIndex] || coordinators[0];

      connections.push({
        from: worker.id,
        to: coordinator.id,
        type: 'direct',
        weight: 1.0,
        latency: Math.random() * 5 + 2
      });
    });

    // Connect coordinators in a chain
    for (let i = 0; i < coordinators.length - 1; i++) {
      connections.push({
        from: coordinators[i].id,
        to: coordinators[i + 1].id,
        type: 'relay',
        weight: 2.0,
        latency: Math.random() * 8 + 3
      });
    }

    return {
      topology: 'hierarchical',
      agents,
      connections,
      metrics: this.calculateMetrics(agents, connections)
    };
  }

  async optimize(): Promise<Optimization> {
    return {
      type: 'throughput',
      changes: [],
      expectedImprovement: 0
    };
  }

  getConnections(): Connection[] {
    return [];
  }

  private calculateMetrics(agents: Agent[], connections: Connection[]): NetworkMetrics {
    return {
      totalAgents: agents.length,
      totalConnections: connections.length,
      averageLatency: connections.reduce((sum, conn) => sum + (conn.latency || 0), 0) / connections.length || 0,
      throughput: Math.sqrt(agents.length), // Logarithmic scaling
      reliability: 0.85 // Good reliability
    };
  }
}

/**
 * Ring Topology - Agents connected in a circular pattern
 */
class RingTopology implements ITopology {
  getType(): TopologyType {
    return 'ring';
  }

  async configure(agents: Agent[]): Promise<Network> {
    const connections: Connection[] = [];

    if (agents.length < 2) {
      return { topology: 'ring', agents, connections, metrics: this.calculateMetrics(agents, connections) };
    }

    // Connect each agent to the next (and last to first)
    for (let i = 0; i < agents.length; i++) {
      const nextIndex = (i + 1) % agents.length;
      connections.push({
        from: agents[i].id,
        to: agents[nextIndex].id,
        type: 'direct',
        weight: 1.0,
        latency: Math.random() * 6 + 3
      });
    }

    return {
      topology: 'ring',
      agents,
      connections,
      metrics: this.calculateMetrics(agents, connections)
    };
  }

  async optimize(): Promise<Optimization> {
    return {
      type: 'reliability',
      changes: [],
      expectedImprovement: 0
    };
  }

  getConnections(): Connection[] {
    return [];
  }

  private calculateMetrics(agents: Agent[], connections: Connection[]): NetworkMetrics {
    return {
      totalAgents: agents.length,
      totalConnections: connections.length,
      averageLatency: connections.reduce((sum, conn) => sum + (conn.latency || 0), 0) / connections.length || 0,
      throughput: agents.length * 0.7, // Reduced due to ring bottlenecks
      reliability: 0.75 // Lower reliability due to single points of failure
    };
  }
}

/**
 * Star Topology - All agents connected to a central hub
 */
class StarTopology implements ITopology {
  getType(): TopologyType {
    return 'star';
  }

  async configure(agents: Agent[]): Promise<Network> {
    const connections: Connection[] = [];

    if (agents.length === 0) {
      return { topology: 'star', agents, connections, metrics: this.calculateMetrics(agents, connections) };
    }

    // First agent becomes the hub
    const hub = agents[0];
    const spokes = agents.slice(1);

    // Connect all spokes to hub
    spokes.forEach(spoke => {
      connections.push({
        from: spoke.id,
        to: hub.id,
        type: 'direct',
        weight: 1.0,
        latency: Math.random() * 4 + 2
      });
    });

    return {
      topology: 'star',
      agents,
      connections,
      metrics: this.calculateMetrics(agents, connections)
    };
  }

  async optimize(): Promise<Optimization> {
    return {
      type: 'latency',
      changes: [],
      expectedImprovement: 0
    };
  }

  getConnections(): Connection[] {
    return [];
  }

  private calculateMetrics(agents: Agent[], connections: Connection[]): NetworkMetrics {
    return {
      totalAgents: agents.length,
      totalConnections: connections.length,
      averageLatency: connections.reduce((sum, conn) => sum + (conn.latency || 0), 0) / connections.length || 0,
      throughput: Math.min(agents.length, 10), // Limited by hub capacity
      reliability: 0.70 // Lower due to single point of failure
    };
  }
}