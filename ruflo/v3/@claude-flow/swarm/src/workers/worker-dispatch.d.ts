/**
 * Worker Dispatch Service
 *
 * Implements the 12 background worker triggers from agentic-flow@alpha:
 * - ultralearn: Deep knowledge acquisition
 * - optimize: Performance optimization
 * - consolidate: Memory consolidation
 * - predict: Predictive preloading
 * - audit: Security analysis
 * - map: Codebase mapping
 * - preload: Resource preloading
 * - deepdive: Deep code analysis
 * - document: Auto-documentation
 * - refactor: Refactoring suggestions
 * - benchmark: Performance benchmarks
 * - testgaps: Test coverage analysis
 *
 * Performance Targets:
 * - Trigger Detection: <5ms
 * - Worker Spawn: <50ms
 * - Max Concurrent: 10 workers (configurable)
 *
 * @module v3/swarm/workers/worker-dispatch
 */
import { EventEmitter } from 'events';
/**
 * Worker trigger types (matching agentic-flow@alpha)
 */
export type WorkerTrigger = 'ultralearn' | 'optimize' | 'consolidate' | 'predict' | 'audit' | 'map' | 'preload' | 'deepdive' | 'document' | 'refactor' | 'benchmark' | 'testgaps';
/**
 * Worker status
 */
export type WorkerStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
/**
 * Worker configuration
 */
export interface WorkerConfig {
    /** Maximum concurrent workers */
    maxConcurrent: number;
    /** Default timeout in milliseconds */
    defaultTimeout: number;
    /** Memory limit per worker in MB */
    memoryLimit: number;
    /** Enable auto-dispatch based on context */
    autoDispatch: boolean;
    /** Priority queue for workers */
    priorityQueue: boolean;
}
/**
 * Worker instance
 */
export interface WorkerInstance {
    id: string;
    trigger: WorkerTrigger;
    context: string;
    sessionId: string;
    status: WorkerStatus;
    progress: number;
    phase: string;
    startedAt: Date;
    completedAt?: Date;
    result?: WorkerResult;
    error?: Error;
    metadata?: Record<string, unknown>;
}
/**
 * Worker result
 */
export interface WorkerResult {
    success: boolean;
    data?: unknown;
    artifacts?: WorkerArtifact[];
    metrics?: WorkerMetrics;
    summary?: string;
}
/**
 * Worker artifact
 */
export interface WorkerArtifact {
    type: 'file' | 'data' | 'report' | 'suggestion';
    name: string;
    content: string | Buffer | Record<string, unknown>;
    size?: number;
}
/**
 * Worker metrics
 */
export interface WorkerMetrics {
    duration: number;
    tokensUsed?: number;
    filesProcessed?: number;
    itemsAnalyzed?: number;
    memoryUsed?: number;
}
/**
 * Trigger detection result
 */
export interface TriggerDetectionResult {
    detected: boolean;
    triggers: WorkerTrigger[];
    confidence: number;
    context?: string;
}
/**
 * Worker dispatch options
 */
export interface DispatchOptions {
    priority?: 'low' | 'normal' | 'high' | 'critical';
    timeout?: number;
    context?: Record<string, unknown>;
    callback?: (worker: WorkerInstance) => void;
}
/**
 * Trigger configurations
 */
declare const TRIGGER_CONFIGS: Record<WorkerTrigger, {
    description: string;
    priority: 'low' | 'normal' | 'high' | 'critical';
    estimatedDuration: number;
    capabilities: string[];
}>;
/**
 * Worker Dispatch Service
 *
 * Manages background workers for various analysis and optimization tasks.
 */
export declare class WorkerDispatchService extends EventEmitter {
    private config;
    private workers;
    private queue;
    private running;
    private idCounter;
    constructor(config?: Partial<WorkerConfig>);
    /**
     * Dispatch a worker for the given trigger
     *
     * @param trigger - Worker trigger type
     * @param context - Context string (e.g., file path, topic)
     * @param sessionId - Session identifier
     * @param options - Dispatch options
     * @returns Worker ID
     */
    dispatch(trigger: WorkerTrigger, context: string, sessionId: string, options?: DispatchOptions): Promise<string>;
    /**
     * Detect triggers in a prompt/context
     *
     * @param text - Text to analyze
     * @returns Detection result
     */
    detectTriggers(text: string): TriggerDetectionResult;
    /**
     * Get worker status
     *
     * @param workerId - Worker ID
     * @returns Worker instance or undefined
     */
    getWorker(workerId: string): WorkerInstance | undefined;
    /**
     * Get all workers for a session
     *
     * @param sessionId - Session ID
     * @returns Worker instances
     */
    getSessionWorkers(sessionId: string): WorkerInstance[];
    /**
     * Cancel a worker
     *
     * @param workerId - Worker ID
     * @returns Success status
     */
    cancel(workerId: string): Promise<boolean>;
    /**
     * Get available triggers
     *
     * @returns Trigger configurations
     */
    getTriggers(): typeof TRIGGER_CONFIGS;
    /**
     * Get worker statistics
     */
    getStats(): {
        total: number;
        pending: number;
        running: number;
        completed: number;
        failed: number;
        cancelled: number;
    };
    /**
     * Get context for prompt injection
     *
     * @param sessionId - Session ID
     * @returns Context string for injection
     */
    getContextForInjection(sessionId: string): string;
    /**
     * Process the worker queue
     */
    private processQueue;
    /**
     * Execute a worker
     */
    private executeWorker;
    /**
     * Execute worker based on trigger type
     */
    private executeWorkerByTrigger;
    private executeUltralearn;
    private executeOptimize;
    private executeConsolidate;
    private executePredict;
    private executeAudit;
    private executeMap;
    private executePreload;
    private executeDeepdive;
    private executeDocument;
    private executeRefactor;
    private executeBenchmark;
    private executeTestgaps;
    private generateWorkerId;
    private getPriorityValue;
    private updateProgress;
    private processWorkPhase;
}
/**
 * Get the worker dispatch service singleton
 */
export declare function getWorkerDispatchService(config?: Partial<WorkerConfig>): WorkerDispatchService;
/**
 * Create a new worker dispatch service
 */
export declare function createWorkerDispatchService(config?: Partial<WorkerConfig>): WorkerDispatchService;
export default WorkerDispatchService;
//# sourceMappingURL=worker-dispatch.d.ts.map