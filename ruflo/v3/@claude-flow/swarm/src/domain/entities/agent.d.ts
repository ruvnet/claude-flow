/**
 * Agent Entity - Domain Layer
 *
 * Core domain entity representing an AI agent in the swarm.
 * Implements DDD aggregate root pattern with encapsulated business logic.
 *
 * @module v3/swarm/domain/entities
 */
/**
 * Agent status types
 */
export type AgentStatus = 'idle' | 'active' | 'busy' | 'paused' | 'terminated' | 'error';
/**
 * Agent role types - following 15-agent hierarchy
 */
export type AgentRole = 'queen-coordinator' | 'security-architect' | 'security-auditor' | 'memory-specialist' | 'swarm-specialist' | 'integration-architect' | 'performance-engineer' | 'core-architect' | 'test-architect' | 'project-coordinator' | 'coder' | 'reviewer' | 'tester' | 'planner' | 'researcher' | 'custom';
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
export declare class Agent {
    private _id;
    private _name;
    private _role;
    private _domain;
    private _capabilities;
    private _status;
    private _parentId?;
    private _metadata;
    private _maxConcurrentTasks;
    private _currentTaskIds;
    private _completedTaskCount;
    private _createdAt;
    private _updatedAt;
    private _lastActiveAt;
    private constructor();
    /**
     * Factory method - Create new agent
     */
    static create(props: AgentProps): Agent;
    /**
     * Factory method - Reconstruct from persistence
     */
    static fromPersistence(props: AgentProps): Agent;
    get id(): string;
    get name(): string;
    get role(): AgentRole;
    get domain(): string;
    get capabilities(): string[];
    get status(): AgentStatus;
    get parentId(): string | undefined;
    get metadata(): Record<string, unknown>;
    get maxConcurrentTasks(): number;
    get currentTaskIds(): string[];
    get currentTaskCount(): number;
    get completedTaskCount(): number;
    get createdAt(): Date;
    get updatedAt(): Date;
    get lastActiveAt(): Date;
    /**
     * Start the agent (transition to active)
     */
    start(): void;
    /**
     * Pause the agent
     */
    pause(): void;
    /**
     * Resume paused agent
     */
    resume(): void;
    /**
     * Terminate the agent
     */
    terminate(): void;
    /**
     * Mark agent as having an error
     */
    setError(errorMessage?: string): void;
    /**
     * Recover from error state
     */
    recover(): void;
    /**
     * Assign a task to this agent
     */
    assignTask(taskId: string): void;
    /**
     * Complete a task
     */
    completeTask(taskId: string): void;
    /**
     * Check if agent can accept more tasks
     */
    canAcceptTask(): boolean;
    /**
     * Check if agent has a specific capability
     */
    hasCapability(capability: string): boolean;
    /**
     * Add a capability
     */
    addCapability(capability: string): void;
    /**
     * Remove a capability
     */
    removeCapability(capability: string): void;
    /**
     * Update metadata
     */
    setMetadata(key: string, value: unknown): void;
    /**
     * Check if agent is a child of given parent
     */
    isChildOf(parentId: string): boolean;
    /**
     * Calculate agent utilization (0-1)
     */
    getUtilization(): number;
    /**
     * Check if agent is available for work
     */
    isAvailable(): boolean;
    /**
     * Convert to plain object for persistence
     */
    toPersistence(): Record<string, unknown>;
    toJSON(): Record<string, unknown>;
}
//# sourceMappingURL=agent.d.ts.map