/**
 * Task Entity - Domain Layer
 *
 * Core domain entity representing a task in the swarm.
 * Tasks are units of work assigned to agents.
 *
 * @module v3/swarm/domain/entities
 */
/**
 * Task status types
 */
export type TaskStatus = 'pending' | 'queued' | 'assigned' | 'running' | 'completed' | 'failed' | 'cancelled';
/**
 * Task priority levels
 */
export type TaskPriority = 'critical' | 'high' | 'normal' | 'low';
/**
 * Task properties
 */
export interface TaskProps {
    id?: string;
    title: string;
    description: string;
    type: string;
    priority?: TaskPriority;
    status?: TaskStatus;
    assignedAgentId?: string;
    dependencies?: string[];
    metadata?: Record<string, unknown>;
    input?: unknown;
    output?: unknown;
    error?: string;
    retryCount?: number;
    maxRetries?: number;
    timeout?: number;
    createdAt?: Date;
    startedAt?: Date;
    completedAt?: Date;
}
/**
 * Task - Entity
 *
 * Represents a unit of work with lifecycle management,
 * dependency tracking, and result storage.
 */
export declare class Task {
    private _id;
    private _title;
    private _description;
    private _type;
    private _priority;
    private _status;
    private _assignedAgentId?;
    private _dependencies;
    private _metadata;
    private _input?;
    private _output?;
    private _error?;
    private _retryCount;
    private _maxRetries;
    private _timeout;
    private _createdAt;
    private _startedAt?;
    private _completedAt?;
    private constructor();
    static create(props: TaskProps): Task;
    static fromPersistence(props: TaskProps): Task;
    get id(): string;
    get title(): string;
    get description(): string;
    get type(): string;
    get priority(): TaskPriority;
    get status(): TaskStatus;
    get assignedAgentId(): string | undefined;
    get dependencies(): string[];
    get metadata(): Record<string, unknown>;
    get input(): unknown;
    get output(): unknown;
    get error(): string | undefined;
    get retryCount(): number;
    get maxRetries(): number;
    get timeout(): number;
    get createdAt(): Date;
    get startedAt(): Date | undefined;
    get completedAt(): Date | undefined;
    /**
     * Queue the task for execution
     */
    queue(): void;
    /**
     * Assign task to an agent
     */
    assign(agentId: string): void;
    /**
     * Start task execution
     */
    start(): void;
    /**
     * Complete the task successfully
     */
    complete(output?: unknown): void;
    /**
     * Mark task as failed
     */
    fail(error: string): void;
    /**
     * Cancel the task
     */
    cancel(): void;
    /**
     * Check if all dependencies are satisfied
     */
    areDependenciesSatisfied(completedTaskIds: Set<string>): boolean;
    /**
     * Check if task can be retried
     */
    canRetry(): boolean;
    /**
     * Get execution duration in milliseconds
     */
    getExecutionDuration(): number | null;
    /**
     * Check if task is timed out
     */
    isTimedOut(): boolean;
    /**
     * Priority comparison (for sorting)
     */
    comparePriority(other: Task): number;
    toPersistence(): Record<string, unknown>;
    toJSON(): Record<string, unknown>;
}
//# sourceMappingURL=task.d.ts.map