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
 * Agent - Aggregate Root
 *
 * Represents an individual agent with lifecycle management,
 * task tracking, and hierarchical relationships.
 */
export class Agent {
    _id;
    _name;
    _role;
    _domain;
    _capabilities;
    _status;
    _parentId;
    _metadata;
    _maxConcurrentTasks;
    _currentTaskIds;
    _completedTaskCount;
    _createdAt;
    _updatedAt;
    _lastActiveAt;
    constructor(props) {
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
    static create(props) {
        return new Agent(props);
    }
    /**
     * Factory method - Reconstruct from persistence
     */
    static fromPersistence(props) {
        return new Agent(props);
    }
    // Getters
    get id() {
        return this._id;
    }
    get name() {
        return this._name;
    }
    get role() {
        return this._role;
    }
    get domain() {
        return this._domain;
    }
    get capabilities() {
        return Array.from(this._capabilities);
    }
    get status() {
        return this._status;
    }
    get parentId() {
        return this._parentId;
    }
    get metadata() {
        return { ...this._metadata };
    }
    get maxConcurrentTasks() {
        return this._maxConcurrentTasks;
    }
    get currentTaskIds() {
        return Array.from(this._currentTaskIds);
    }
    get currentTaskCount() {
        return this._currentTaskIds.size;
    }
    get completedTaskCount() {
        return this._completedTaskCount;
    }
    get createdAt() {
        return new Date(this._createdAt);
    }
    get updatedAt() {
        return new Date(this._updatedAt);
    }
    get lastActiveAt() {
        return new Date(this._lastActiveAt);
    }
    // ============================================================================
    // Business Logic Methods
    // ============================================================================
    /**
     * Start the agent (transition to active)
     */
    start() {
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
    pause() {
        if (this._status !== 'active' && this._status !== 'busy') {
            throw new Error('Can only pause active or busy agent');
        }
        this._status = 'paused';
        this._updatedAt = new Date();
    }
    /**
     * Resume paused agent
     */
    resume() {
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
    terminate() {
        this._status = 'terminated';
        this._currentTaskIds.clear();
        this._updatedAt = new Date();
    }
    /**
     * Mark agent as having an error
     */
    setError(errorMessage) {
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
    recover() {
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
    assignTask(taskId) {
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
    completeTask(taskId) {
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
    canAcceptTask() {
        return (this._status !== 'terminated' &&
            this._status !== 'error' &&
            this._status !== 'paused' &&
            this._currentTaskIds.size < this._maxConcurrentTasks);
    }
    /**
     * Check if agent has a specific capability
     */
    hasCapability(capability) {
        return this._capabilities.has(capability);
    }
    /**
     * Add a capability
     */
    addCapability(capability) {
        this._capabilities.add(capability);
        this._updatedAt = new Date();
    }
    /**
     * Remove a capability
     */
    removeCapability(capability) {
        this._capabilities.delete(capability);
        this._updatedAt = new Date();
    }
    /**
     * Update metadata
     */
    setMetadata(key, value) {
        this._metadata[key] = value;
        this._updatedAt = new Date();
    }
    /**
     * Check if agent is a child of given parent
     */
    isChildOf(parentId) {
        return this._parentId === parentId;
    }
    /**
     * Calculate agent utilization (0-1)
     */
    getUtilization() {
        return this._currentTaskIds.size / this._maxConcurrentTasks;
    }
    /**
     * Check if agent is available for work
     */
    isAvailable() {
        return this._status === 'idle' || (this._status === 'active' && this.canAcceptTask());
    }
    /**
     * Convert to plain object for persistence
     */
    toPersistence() {
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
    toJSON() {
        return this.toPersistence();
    }
}
//# sourceMappingURL=agent.js.map