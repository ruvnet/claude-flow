/**
 * Agent State Adapter
 * Bridges AgentManager to the unified state management system
 */

import { UnifiedStateManager } from '../state-manager.js';
import type { 
  Agent, 
  AgentState,
  StateChangeCallback, 
  Unsubscribe 
} from '../types.js';
import { Logger } from '../../core/logger.js';

export interface AgentStateAdapterConfig {
  managerId: string;
  namespace?: string;
}

export class AgentStateAdapter {
  private logger: Logger;
  private stateManager: UnifiedStateManager;
  private config: AgentStateAdapterConfig;
  private subscriptions: Unsubscribe[] = [];

  constructor(stateManager: UnifiedStateManager, config: AgentStateAdapterConfig) {
    this.stateManager = stateManager;
    this.config = config;
    this.logger = new Logger({
      level: 'info',
      format: 'json',
      destination: 'console'
    }, { component: 'AgentStateAdapter' });

    this.logger.info('Agent state adapter initialized', { managerId: config.managerId });
  }

  // ===== Agent Management =====

  /**
   * Get an agent by ID
   */
  public getAgent(agentId: string): Agent | undefined {
    const state = this.stateManager.getState();
    return state.agents.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  public getAllAgents(): Agent[] {
    const state = this.stateManager.getState();
    return Array.from(state.agents.agents.values());
  }

  /**
   * Get agents by type
   */
  public getAgentsByType(type: Agent['type']): Agent[] {
    return this.getAllAgents().filter(agent => agent.type === type);
  }

  /**
   * Get agents by status
   */
  public getAgentsByStatus(status: Agent['status']): Agent[] {
    return this.getAllAgents().filter(agent => agent.status === status);
  }

  /**
   * Add a new agent
   */
  public addAgent(agent: Agent): void {
    this.stateManager.dispatch({
      type: 'agents/add',
      payload: agent,
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent created'
      }
    });

    this.logger.debug('Agent added to state', { 
      agentId: agent.id, 
      type: agent.type, 
      status: agent.status 
    });
  }

  /**
   * Update an existing agent
   */
  public updateAgent(agentId: string, updates: Partial<Agent>): void {
    this.stateManager.dispatch({
      type: 'agents/update',
      payload: {
        id: agentId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent updated'
      }
    });

    this.logger.debug('Agent updated in state', { agentId, updates });
  }

  /**
   * Remove an agent
   */
  public removeAgent(agentId: string): void {
    this.stateManager.dispatch({
      type: 'agents/remove',
      payload: { id: agentId },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent removed'
      }
    });

    this.logger.debug('Agent removed from state', { agentId });
  }

  /**
   * Update agent status
   */
  public setAgentStatus(agentId: string, status: Agent['status']): void {
    this.updateAgent(agentId, { 
      status,
      lastActiveAt: new Date()
    });
  }

  /**
   * Update agent metadata
   */
  public updateAgentMetadata(agentId: string, metadata: Record<string, unknown>): void {
    const currentAgent = this.getAgent(agentId);
    if (currentAgent) {
      this.updateAgent(agentId, {
        metadata: { ...currentAgent.metadata, ...metadata }
      });
    }
  }

  /**
   * Assign task to agent
   */
  public assignTask(agentId: string, taskId: string): void {
    this.updateAgent(agentId, {
      currentTask: taskId,
      status: 'busy',
      lastActiveAt: new Date()
    });
  }

  /**
   * Unassign task from agent
   */
  public unassignTask(agentId: string): void {
    this.updateAgent(agentId, {
      currentTask: undefined,
      status: 'idle',
      lastActiveAt: new Date()
    });
  }

  // ===== Agent Pool Management =====

  /**
   * Get all agent pools
   */
  public getAllPools(): any[] {
    const state = this.stateManager.getState();
    return Array.from(state.agents.pools.values());
  }

  /**
   * Get pool by ID
   */
  public getPool(poolId: string): any | undefined {
    const state = this.stateManager.getState();
    return state.agents.pools.get(poolId);
  }

  /**
   * Add agent pool
   */
  public addPool(pool: any): void {
    this.stateManager.dispatch({
      type: 'agents/addPool',
      payload: pool,
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent pool created'
      }
    });

    this.logger.debug('Agent pool added to state', { poolId: pool.id });
  }

  /**
   * Update agent pool
   */
  public updatePool(poolId: string, updates: any): void {
    this.stateManager.dispatch({
      type: 'agents/updatePool',
      payload: {
        id: poolId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent pool updated'
      }
    });

    this.logger.debug('Agent pool updated in state', { poolId, updates });
  }

  /**
   * Remove agent pool
   */
  public removePool(poolId: string): void {
    this.stateManager.dispatch({
      type: 'agents/removePool',
      payload: { id: poolId },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent pool removed'
      }
    });

    this.logger.debug('Agent pool removed from state', { poolId });
  }

  // ===== Agent Cluster Management =====

  /**
   * Get all agent clusters
   */
  public getAllClusters(): any[] {
    const state = this.stateManager.getState();
    return Array.from(state.agents.clusters.values());
  }

  /**
   * Get cluster by ID
   */
  public getCluster(clusterId: string): any | undefined {
    const state = this.stateManager.getState();
    return state.agents.clusters.get(clusterId);
  }

  /**
   * Add agent cluster
   */
  public addCluster(cluster: any): void {
    this.stateManager.dispatch({
      type: 'agents/addCluster',
      payload: cluster,
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent cluster created'
      }
    });

    this.logger.debug('Agent cluster added to state', { clusterId: cluster.id });
  }

  /**
   * Update agent cluster
   */
  public updateCluster(clusterId: string, updates: any): void {
    this.stateManager.dispatch({
      type: 'agents/updateCluster',
      payload: {
        id: clusterId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent cluster updated'
      }
    });

    this.logger.debug('Agent cluster updated in state', { clusterId, updates });
  }

  /**
   * Remove agent cluster
   */
  public removeCluster(clusterId: string): void {
    this.stateManager.dispatch({
      type: 'agents/removeCluster',
      payload: { id: clusterId },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent cluster removed'
      }
    });

    this.logger.debug('Agent cluster removed from state', { clusterId });
  }

  // ===== Agent Template Management =====

  /**
   * Get all agent templates
   */
  public getAllTemplates(): any[] {
    const state = this.stateManager.getState();
    return Array.from(state.agents.templates.values());
  }

  /**
   * Get template by ID
   */
  public getTemplate(templateId: string): any | undefined {
    const state = this.stateManager.getState();
    return state.agents.templates.get(templateId);
  }

  /**
   * Add agent template
   */
  public addTemplate(template: any): void {
    this.stateManager.dispatch({
      type: 'agents/addTemplate',
      payload: template,
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent template created'
      }
    });

    this.logger.debug('Agent template added to state', { templateId: template.id });
  }

  /**
   * Update agent template
   */
  public updateTemplate(templateId: string, updates: any): void {
    this.stateManager.dispatch({
      type: 'agents/updateTemplate',
      payload: {
        id: templateId,
        updates
      },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent template updated'
      }
    });

    this.logger.debug('Agent template updated in state', { templateId, updates });
  }

  /**
   * Remove agent template
   */
  public removeTemplate(templateId: string): void {
    this.stateManager.dispatch({
      type: 'agents/removeTemplate',
      payload: { id: templateId },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent template removed'
      }
    });

    this.logger.debug('Agent template removed from state', { templateId });
  }

  // ===== Agent Metrics Management =====

  /**
   * Get agent metrics
   */
  public getAgentMetrics(agentId: string): any | undefined {
    const state = this.stateManager.getState();
    return state.agents.metrics.get(agentId);
  }

  /**
   * Update agent metrics
   */
  public updateAgentMetrics(agentId: string, metrics: any): void {
    this.stateManager.dispatch({
      type: 'agents/updateMetrics',
      payload: {
        id: agentId,
        metrics
      },
      metadata: {
        timestamp: new Date(),
        source: `AgentManager:${this.config.managerId}`,
        reason: 'Agent metrics updated'
      }
    });

    this.logger.debug('Agent metrics updated in state', { agentId, metrics });
  }

  // ===== State Subscription =====

  /**
   * Subscribe to agent changes
   */
  public onAgentChanged(callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('agents', (change) => {
      if (change.action.type.startsWith('agents/')) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to specific agent changes
   */
  public onSpecificAgentChanged(agentId: string, callback: StateChangeCallback): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('agents', (change) => {
      if (change.action.type.startsWith('agents/') && 
          change.action.payload?.id === agentId) {
        callback(change);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  /**
   * Subscribe to agent status changes
   */
  public onAgentStatusChanged(callback: (agentId: string, status: Agent['status']) => void): Unsubscribe {
    const unsubscribe = this.stateManager.subscribe('agents', (change) => {
      if (change.action.type === 'agents/update' && 
          change.action.payload?.updates?.status) {
        callback(change.action.payload.id, change.action.payload.updates.status);
      }
    });
    
    this.subscriptions.push(unsubscribe);
    return unsubscribe;
  }

  // ===== Query Methods =====

  /**
   * Get agent statistics
   */
  public getAgentStats(): {
    totalAgents: number;
    agentsByType: Record<string, number>;
    agentsByStatus: Record<string, number>;
    idleAgents: number;
    busyAgents: number;
    failedAgents: number;
  } {
    const agents = this.getAllAgents();
    const agentsByType: Record<string, number> = {};
    const agentsByStatus: Record<string, number> = {};

    agents.forEach(agent => {
      agentsByType[agent.type] = (agentsByType[agent.type] || 0) + 1;
      agentsByStatus[agent.status] = (agentsByStatus[agent.status] || 0) + 1;
    });

    return {
      totalAgents: agents.length,
      agentsByType,
      agentsByStatus,
      idleAgents: agentsByStatus['idle'] || 0,
      busyAgents: agentsByStatus['busy'] || 0,
      failedAgents: agentsByStatus['failed'] || 0
    };
  }

  /**
   * Get available agents for task assignment
   */
  public getAvailableAgents(capabilities?: string[]): Agent[] {
    const idleAgents = this.getAgentsByStatus('idle');
    
    if (!capabilities || capabilities.length === 0) {
      return idleAgents;
    }

    return idleAgents.filter(agent => {
      // Check if agent has all required capabilities
      const agentCapabilities = agent.capabilities;
      return capabilities.every(cap => {
        // Check in each capability array
        return agentCapabilities.languages?.includes(cap) ||
               agentCapabilities.frameworks?.includes(cap) ||
               agentCapabilities.domains?.includes(cap) ||
               agentCapabilities.tools?.includes(cap);
      });
    });
  }

  /**
   * Get agents with current tasks
   */
  public getBusyAgents(): Agent[] {
    return this.getAllAgents().filter(agent => 
      agent.status === 'busy' && agent.currentTask
    );
  }

  /**
   * Get agent load distribution
   */
  public getAgentLoadDistribution(): Record<string, number> {
    const agents = this.getAllAgents();
    const distribution: Record<string, number> = {};

    agents.forEach(agent => {
      const load = agent.currentTask ? 1 : 0;
      distribution[agent.id] = load;
    });

    return distribution;
  }

  /**
   * Cleanup subscriptions
   */
  public dispose(): void {
    this.subscriptions.forEach(unsubscribe => unsubscribe());
    this.subscriptions = [];
    this.logger.info('Agent state adapter disposed', { managerId: this.config.managerId });
  }
}