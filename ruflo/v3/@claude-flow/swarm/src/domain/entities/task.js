/**
 * Task Entity - Domain Layer
 *
 * Core domain entity representing a task in the swarm.
 * Tasks are units of work assigned to agents.
 *
 * @module v3/swarm/domain/entities
 */
import { randomUUID } from 'crypto';
/**
 * Task - Entity
 *
 * Represents a unit of work with lifecycle management,
 * dependency tracking, and result storage.
 */
export class Task {
    _id;
    _title;
    _description;
    _type;
    _priority;
    _status;
    _assignedAgentId;
    _dependencies;
    _metadata;
    _input;
    _output;
    _error;
    _retryCount;
    _maxRetries;
    _timeout;
    _createdAt;
    _startedAt;
    _completedAt;
    constructor(props) {
        const now = new Date();
        this._id = props.id ?? randomUUID();
        this._title = props.title;
        this._description = props.description;
        this._type = props.type;
        this._priority = props.priority ?? 'normal';
        this._status = props.status ?? 'pending';
        this._assignedAgentId = props.assignedAgentId;
        this._dependencies = new Set(props.dependencies ?? []);
        this._metadata = props.metadata ?? {};
        this._input = props.input;
        this._output = props.output;
        this._error = props.error;
        this._retryCount = props.retryCount ?? 0;
        this._maxRetries = props.maxRetries ?? 3;
        this._timeout = props.timeout ?? 300000; // 5 minutes default
        this._createdAt = props.createdAt ?? now;
        this._startedAt = props.startedAt;
        this._completedAt = props.completedAt;
    }
    static create(props) {
        return new Task(props);
    }
    static fromPersistence(props) {
        return new Task(props);
    }
    // Getters
    get id() {
        return this._id;
    }
    get title() {
        return this._title;
    }
    get description() {
        return this._description;
    }
    get type() {
        return this._type;
    }
    get priority() {
        return this._priority;
    }
    get status() {
        return this._status;
    }
    get assignedAgentId() {
        return this._assignedAgentId;
    }
    get dependencies() {
        return Array.from(this._dependencies);
    }
    get metadata() {
        return { ...this._metadata };
    }
    get input() {
        return this._input;
    }
    get output() {
        return this._output;
    }
    get error() {
        return this._error;
    }
    get retryCount() {
        return this._retryCount;
    }
    get maxRetries() {
        return this._maxRetries;
    }
    get timeout() {
        return this._timeout;
    }
    get createdAt() {
        return new Date(this._createdAt);
    }
    get startedAt() {
        return this._startedAt ? new Date(this._startedAt) : undefined;
    }
    get completedAt() {
        return this._completedAt ? new Date(this._completedAt) : undefined;
    }
    // ============================================================================
    // Business Logic
    // ============================================================================
    /**
     * Queue the task for execution
     */
    queue() {
        if (this._status !== 'pending') {
            throw new Error('Can only queue pending tasks');
        }
        this._status = 'queued';
    }
    /**
     * Assign task to an agent
     */
    assign(agentId) {
        if (this._status !== 'queued' && this._status !== 'pending') {
            throw new Error('Can only assign queued or pending tasks');
        }
        this._assignedAgentId = agentId;
        this._status = 'assigned';
    }
    /**
     * Start task execution
     */
    start() {
        if (this._status !== 'assigned') {
            throw new Error('Can only start assigned tasks');
        }
        this._status = 'running';
        this._startedAt = new Date();
    }
    /**
     * Complete the task successfully
     */
    complete(output) {
        if (this._status !== 'running') {
            throw new Error('Can only complete running tasks');
        }
        this._status = 'completed';
        this._output = output;
        this._completedAt = new Date();
    }
    /**
     * Mark task as failed
     */
    fail(error) {
        if (this._status !== 'running' && this._status !== 'assigned') {
            throw new Error('Can only fail running or assigned tasks');
        }
        this._error = error;
        this._retryCount++;
        if (this._retryCount >= this._maxRetries) {
            this._status = 'failed';
            this._completedAt = new Date();
        }
        else {
            // Reset for retry
            this._status = 'queued';
            this._assignedAgentId = undefined;
        }
    }
    /**
     * Cancel the task
     */
    cancel() {
        if (this._status === 'completed' || this._status === 'failed') {
            throw new Error('Cannot cancel finished tasks');
        }
        this._status = 'cancelled';
        this._completedAt = new Date();
    }
    /**
     * Check if all dependencies are satisfied
     */
    areDependenciesSatisfied(completedTaskIds) {
        for (const depId of this._dependencies) {
            if (!completedTaskIds.has(depId)) {
                return false;
            }
        }
        return true;
    }
    /**
     * Check if task can be retried
     */
    canRetry() {
        return this._retryCount < this._maxRetries;
    }
    /**
     * Get execution duration in milliseconds
     */
    getExecutionDuration() {
        if (!this._startedAt)
            return null;
        const endTime = this._completedAt ?? new Date();
        return endTime.getTime() - this._startedAt.getTime();
    }
    /**
     * Check if task is timed out
     */
    isTimedOut() {
        if (this._status !== 'running' || !this._startedAt)
            return false;
        return Date.now() - this._startedAt.getTime() > this._timeout;
    }
    /**
     * Priority comparison (for sorting)
     */
    comparePriority(other) {
        const priorityOrder = {
            critical: 0,
            high: 1,
            normal: 2,
            low: 3,
        };
        return priorityOrder[this._priority] - priorityOrder[other.priority];
    }
    toPersistence() {
        return {
            id: this._id,
            title: this._title,
            description: this._description,
            type: this._type,
            priority: this._priority,
            status: this._status,
            assignedAgentId: this._assignedAgentId,
            dependencies: Array.from(this._dependencies),
            metadata: this._metadata,
            input: this._input,
            output: this._output,
            error: this._error,
            retryCount: this._retryCount,
            maxRetries: this._maxRetries,
            timeout: this._timeout,
            createdAt: this._createdAt.toISOString(),
            startedAt: this._startedAt?.toISOString(),
            completedAt: this._completedAt?.toISOString(),
        };
    }
    toJSON() {
        return this.toPersistence();
    }
}
//# sourceMappingURL=task.js.map