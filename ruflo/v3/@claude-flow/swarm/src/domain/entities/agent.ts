/**
 * Agent Entity - Domain Layer
 *
 * Core domain entity representing an AI agent in the swarm.
 * Implements DDD aggregate root pattern with encapsulated business logic.
 *
 * @module v3/swarm/domain/entities
 */

import { randomUUID } from 'crypto';

/**
 * Agent status types
 */
export type AgentStatus = 'idle' | 'active' | 'busy' | 'paused' | 'terminated' | 'error';

/**
 * Agent role types - following 15-agent hierarchy
 */
export type AgentRole =
  | 'queen-coordinator'
  | 'security-architect'
  | 'security-auditor'
  | 'memory-specialist'
  | 'swarm-specialist'
  | 'integration-architect'
  | 'performance-engineer'
  | 'core-architect'
  | 'test-architect'
  | 'project-coordinator'
  | 'coder'
  | 'reviewer'
  | 'tester'
  | 'planner'
  | 'researcher'
  | 'custom';

/**
 * Agent properties
 */
export interface AgentProps {
  id?: string;
  name: string;
  role: AgentRole;
  domain: string;
  capabilities: string[];
  status?: AgentStatus;
  parentId?: string;
  metadata?: Record<string, unknown>;
  maxConcurrentTasks?: number;
  currentTaskIds?: string[];
  completedTaskCount?: number;
  createdAt?: Date;
  updatedAt?: Date;
  lastActiveAt?: Date;
}

/**
 * Agent - Aggregate Root
 *
 * Represents an individual agent with lifecycle management,
 * task tracking, and hierarchical relationships.
 */
export class Agent {
  private _id: string;
  private _name: string;
  private _role: AgentRole;
  private _domain: string;
  private _capabilities: Set<string>;
  private _status: AgentStatus;
  private _parentId?: string;
  private _metadata: Record<string, unknown>;
  private _maxConcurrentTasks: number;
  private _currentTaskIds: Set<string>;
  private _completedTaskCount: number;
  private _createdAt: Date;
  private _updatedAt: Date;
  private _lastActiveAt: Date;

  private constructor(props: AgentProps) {
    const now = new Date();
    this._id = props.id ?? randomUUID();
    this._name = props.name;
    this._role = props.role;
    this._domain = props.domain;
    this._capabilities = new Set(props.capabilities);
    this._status = props.status ?? 'idle';
    this._parentId = props.parentId;
    this._metadata = props.metadata ?? {};
    this._maxConcurrentTasks = props.maxConcurrentTasks ?? 3;
    this._currentTaskIds = new Set(props.currentTaskIds ?? []);
    this._completedTaskCount = props.completedTaskCount ?? 0;
    this._createdAt = props.createdAt ?? now;
    this._updatedAt = props.updatedAt ?? now;
    this._lastActiveAt = props.lastActiveAt ?? now;
  }

  /**
   * Factory method - Create new agent
   */
  static create(props: AgentProps): Agent {
    return new Agent(props);
  }

  /**
   * Factory method - Reconstruct from persistence
   */
  static fromPersistence(props: AgentProps): Agent {
    return new Agent(props);
  }

  // Getters
  get id(): string {
    return this._id;
  }

  get name(): string {
    return this._name;
  }

  get role(): AgentRole {
    return this._role;
  }

  get domain(): string {
    return this._domain;
  }

  get capabilities(): string[] {
    return Array.from(this._capabilities);
  }

  get status(): AgentStatus {
    return this._status;
  }

  get parentId(): string | undefined {
    return this._parentId;
  }

  get metadata(): Record<string, unknown> {
    return { ...this._metadata };
  }

  get maxConcurrentTasks(): number {
    return this._maxConcurrentTasks;
  }

  get currentTaskIds(): string[] {
    return Array.from(this._currentTaskIds);
  }

  get currentTaskCount(): number {
    return this._currentTaskIds.size;
  }

  get completedTaskCount(): number {
    return this._completedTaskCount;
  }

  get createdAt(): Date {
    return new Date(this._createdAt);
  }

  get updatedAt(): Date {
    return new Date(this._updatedAt);
  }

  get lastActiveAt(): Date {
    return new Date(this._lastActiveAt);
  }

  // ============================================================================
  // Business Logic Methods
  // ============================================================================

  /**
   * Start the agent (transition to active)
   */
  start(): void {
    if (this._status === 'terminated') {
      throw new Error('Cannot start terminated agent');
    }
    this._status = 'active';
    this._lastActiveAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Pause the agent
   */
  pause(): void {
    if (this._status !== 'active' && this._status !== 'busy') {
      throw new Error('Can only pause active or busy agent');
    }
    this._status = 'paused';
    this._updatedAt = new Date();
  }

  /**
   * Resume paused agent
   */
  resume(): void {
    if (this._status !== 'paused') {
      throw new Error('Can only resume paused agent');
    }
    this._status = this._currentTaskIds.size > 0 ? 'busy' : 'active';
    this._lastActiveAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Terminate the agent
   */
  terminate(): void {
    this._status = 'terminated';
    this._currentTaskIds.clear();
    this._updatedAt = new Date();
  }

  /**
   * Mark agent as having an error
   */
  setError(errorMessage?: string): void {
    this._status = 'error';
    if (errorMessage) {
      this._metadata['lastError'] = errorMessage;
      this._metadata['lastErrorAt'] = new Date().toISOString();
    }
    this._updatedAt = new Date();
  }

  /**
   * Recover from error state
   */
  recover(): void {
    if (this._status !== 'error') {
      throw new Error('Can only recover from error state');
    }
    this._status = 'idle';
    delete this._metadata['lastError'];
    this._updatedAt = new Date();
  }

  /**
   * Assign a task to this agent
   */
  assignTask(taskId: string): void {
    if (this._status === 'terminated') {
      throw new Error('Cannot assign task to terminated agent');
    }
    if (this._currentTaskIds.size >= this._maxConcurrentTasks) {
      throw new Error('Agent at maximum concurrent task capacity');
    }

    this._currentTaskIds.add(taskId);
    this._status = 'busy';
    this._lastActiveAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Complete a task
   */
  completeTask(taskId: string): void {
    if (!this._currentTaskIds.has(taskId)) {
      throw new Error(`Task ${taskId} not assigned to this agent`);
    }

    this._currentTaskIds.delete(taskId);
    this._completedTaskCount++;

    if (this._currentTaskIds.size === 0) {
      this._status = 'active';
    }

    this._lastActiveAt = new Date();
    this._updatedAt = new Date();
  }

  /**
   * Check if agent can accept more tasks
   */
  canAcceptTask(): boolean {
    return (
      this._status !== 'terminated' &&
      this._status !== 'error' &&
      this._status !== 'paused' &&
      this._currentTaskIds.size < this._maxConcurrentTasks
    );
  }

  /**
   * Check if agent has a specific capability
   */
  hasCapability(capability: string): boolean {
    return this._capabilities.has(capability);
  }

  /**
   * Add a capability
   */
  addCapability(capability: string): void {
    this._capabilities.add(capability);
    this._updatedAt = new Date();
  }

  /**
   * Remove a capability
   */
  removeCapability(capability: string): void {
    this._capabilities.delete(capability);
    this._updatedAt = new Date();
  }

  /**
   * Update metadata
   */
  setMetadata(key: string, value: unknown): void {
    this._metadata[key] = value;
    this._updatedAt = new Date();
  }

  /**
   * Check if agent is a child of given parent
   */
  isChildOf(parentId: string): boolean {
    return this._parentId === parentId;
  }

  /**
   * Calculate agent utilization (0-1)
   */
  getUtilization(): number {
    return this._currentTaskIds.size / this._maxConcurrentTasks;
  }

  /**
   * Check if agent is available for work
   */
  isAvailable(): boolean {
    return this._status === 'idle' || (this._status === 'active' && this.canAcceptTask());
  }

  /**
   * Convert to plain object for persistence
   */
  toPersistence(): Record<string, unknown> {
    return {
      id: this._id,
      name: this._name,
      role: this._role,
      domain: this._domain,
      capabilities: Array.from(this._capabilities),
      status: this._status,
      parentId: this._parentId,
      metadata: this._metadata,
      maxConcurrentTasks: this._maxConcurrentTasks,
      currentTaskIds: Array.from(this._currentTaskIds),
      completedTaskCount: this._completedTaskCount,
      createdAt: this._createdAt.toISOString(),
      updatedAt: this._updatedAt.toISOString(),
      lastActiveAt: this._lastActiveAt.toISOString(),
    };
  }

  toJSON(): Record<string, unknown> {
    return this.toPersistence();
  }
}
