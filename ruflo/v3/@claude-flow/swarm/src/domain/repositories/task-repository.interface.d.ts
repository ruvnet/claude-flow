/**
 * Task Repository Interface - Domain Layer
 *
 * Defines the contract for task persistence.
 *
 * @module v3/swarm/domain/repositories
 */
import { Task, TaskStatus, TaskPriority } from '../entities/task.js';
/**
 * Task query options
 */
export interface TaskQueryOptions {
    status?: TaskStatus;
    priority?: TaskPriority;
    type?: string;
    assignedAgentId?: string;
    limit?: number;
    offset?: number;
    orderBy?: 'createdAt' | 'priority' | 'startedAt';
    orderDirection?: 'asc' | 'desc';
}
/**
 * Task statistics
 */
export interface TaskStatistics {
    total: number;
    byStatus: Record<TaskStatus, number>;
    byPriority: Record<TaskPriority, number>;
    byType: Record<string, number>;
    averageExecutionTime: number;
    successRate: number;
    retryRate: number;
}
/**
 * Task Repository Interface
 */
export interface ITaskRepository {
    save(task: Task): Promise<void>;
    findById(id: string): Promise<Task | null>;
    delete(id: string): Promise<boolean>;
    exists(id: string): Promise<boolean>;
    saveMany(tasks: Task[]): Promise<void>;
    findByIds(ids: string[]): Promise<Task[]>;
    deleteMany(ids: string[]): Promise<number>;
    findAll(options?: TaskQueryOptions): Promise<Task[]>;
    findByStatus(status: TaskStatus): Promise<Task[]>;
    findByPriority(priority: TaskPriority): Promise<Task[]>;
    findByAgent(agentId: string): Promise<Task[]>;
    findPending(): Promise<Task[]>;
    findQueued(): Promise<Task[]>;
    findRunning(): Promise<Task[]>;
    findTimedOut(): Promise<Task[]>;
    getNextTask(agentCapabilities?: string[]): Promise<Task | null>;
    getTaskQueue(limit?: number): Promise<Task[]>;
    getStatistics(): Promise<TaskStatistics>;
    count(options?: TaskQueryOptions): Promise<number>;
    initialize(): Promise<void>;
    shutdown(): Promise<void>;
    clear(): Promise<void>;
}
//# sourceMappingURL=task-repository.interface.d.ts.map