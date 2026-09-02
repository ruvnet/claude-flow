/**
 * Agent Repository Interface - Domain Layer
 *
 * Defines the contract for agent persistence.
 *
 * @module v3/swarm/domain/repositories
 */

import { Agent, AgentStatus, AgentRole } from '../entities/agent.js';

/**
 * Agent query options
 */
export interface AgentQueryOptions {
  status?: AgentStatus;
  role?: AgentRole;
  domain?: string;
  parentId?: string;
  capability?: string;
  limit?: number;
  offset?: number;
}

/**
 * Agent statistics
 */
export interface AgentStatistics {
  total: number;
  byStatus: Record<AgentStatus, number>;
  byRole: Record<string, number>;
  byDomain: Record<string, number>;
  totalTasksCompleted: number;
  averageUtilization: number;
}

/**
 * Agent Repository Interface
 */
export interface IAgentRepository {
  // CRUD
  save(agent: Agent): Promise<void>;
  findById(id: string): Promise<Agent | null>;
  findByName(name: string): Promise<Agent | null>;
  delete(id: string): Promise<boolean>;
  exists(id: string): Promise<boolean>;

  // Bulk operations
  saveMany(agents: Agent[]): Promise<void>;
  findByIds(ids: string[]): Promise<Agent[]>;
  deleteMany(ids: string[]): Promise<number>;

  // Query operations
  findAll(options?: AgentQueryOptions): Promise<Agent[]>;
  findByStatus(status: AgentStatus): Promise<Agent[]>;
  findByRole(role: AgentRole): Promise<Agent[]>;
  findByDomain(domain: string): Promise<Agent[]>;
  findByParent(parentId: string): Promise<Agent[]>;
  findByCapability(capability: string): Promise<Agent[]>;
  findAvailable(): Promise<Agent[]>;

  // Statistics
  getStatistics(): Promise<AgentStatistics>;
  count(options?: AgentQueryOptions): Promise<number>;

  // Lifecycle
  initialize(): Promise<void>;
  shutdown(): Promise<void>;
  clear(): Promise<void>;
}
