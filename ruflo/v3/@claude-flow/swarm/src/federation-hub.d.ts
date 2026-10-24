/**
 * Federation Hub - Ephemeral Agent Coordination
 *
 * Provides cross-swarm coordination and ephemeral agent management
 * for distributed multi-swarm architectures.
 *
 * Features:
 * - Ephemeral agent spawning (short-lived, task-specific)
 * - Cross-swarm communication and coordination
 * - Federation protocol for distributed consensus
 * - Resource allocation and load balancing
 * - Agent lifecycle management with auto-cleanup
 *
 * Performance Targets:
 * - Agent spawn: <50ms
 * - Cross-swarm message: <100ms
 * - Federation sync: <500ms
 * - Auto-cleanup: Background, non-blocking
 *
 * Implements ADR-001: agentic-flow@alpha compatibility
 * Implements ADR-003: Unified coordination engine
 *
 * @module @claude-flow/swarm/federation-hub
 * @version 3.0.0-alpha.1
 */
import { EventEmitter } from 'events';
export type FederationId = string;
export type SwarmId = string;
export type EphemeralAgentId = string;
export interface FederationConfig {
    /** Federation identifier */
    federationId?: FederationId;
    /** Maximum ephemeral agents per swarm */
    maxEphemeralAgents?: number;
    /** Default TTL for ephemeral agents (ms) */
    defaultTTL?: number;
    /** Sync interval for federation state (ms) */
    syncIntervalMs?: number;
    /** Enable auto-cleanup of expired agents */
    autoCleanup?: boolean;
    /** Cleanup check interval (ms) */
    cleanupIntervalMs?: number;
    /** Cross-swarm communication timeout (ms) */
    communicationTimeoutMs?: number;
    /** Enable federation-wide consensus */
    enableConsensus?: boolean;
    /** Consensus quorum percentage */
    consensusQuorum?: number;
}
export interface SwarmRegistration {
    swarmId: SwarmId;
    name: string;
    endpoint?: string;
    capabilities: string[];
    maxAgents: number;
    currentAgents: number;
    status: 'active' | 'inactive' | 'degraded';
    registeredAt: Date;
    lastHeartbeat: Date;
    metadata?: Record<string, unknown>;
}
export interface EphemeralAgent {
    id: EphemeralAgentId;
    swarmId: SwarmId;
    type: string;
    task: string;
    status: 'spawning' | 'active' | 'completing' | 'terminated';
    ttl: number;
    createdAt: Date;
    expiresAt: Date;
    completedAt?: Date;
    result?: unknown;
    error?: Error;
    metadata?: Record<string, unknown>;
}
export interface SpawnEphemeralOptions {
    /** Target swarm (auto-select if not specified) */
    swarmId?: SwarmId;
    /** Agent type */
    type: string;
    /** Task description */
    task: string;
    /** Time-to-live in ms (default from config) */
    ttl?: number;
    /** Required capabilities */
    capabilities?: string[];
    /** Priority for swarm selection */
    priority?: 'low' | 'normal' | 'high' | 'critical';
    /** Wait for completion */
    waitForCompletion?: boolean;
    /** Completion timeout (ms) */
    completionTimeout?: number;
    /** Additional metadata */
    metadata?: Record<string, unknown>;
}
export interface SpawnResult {
    agentId: EphemeralAgentId;
    swarmId: SwarmId;
    status: 'spawned' | 'queued' | 'failed';
    estimatedTTL: number;
    result?: unknown;
    error?: string;
}
export interface FederationMessage {
    id: string;
    type: 'broadcast' | 'direct' | 'consensus' | 'heartbeat';
    sourceSwarmId: SwarmId;
    targetSwarmId?: SwarmId;
    payload: unknown;
    timestamp: Date;
    ttl?: number;
}
export interface ConsensusProposal {
    id: string;
    proposerId: SwarmId;
    type: string;
    value: unknown;
    votes: Map<SwarmId, boolean>;
    status: 'pending' | 'accepted' | 'rejected';
    createdAt: Date;
    expiresAt: Date;
}
export interface FederationStats {
    federationId: FederationId;
    totalSwarms: number;
    activeSwarms: number;
    totalEphemeralAgents: number;
    activeEphemeralAgents: number;
    completedAgents: number;
    failedAgents: number;
    avgAgentLifespanMs: number;
    messagesExchanged: number;
    consensusProposals: number;
    uptime: number;
}
export interface FederationEvent {
    type: FederationEventType;
    federationId: FederationId;
    swarmId?: SwarmId;
    agentId?: EphemeralAgentId;
    data?: unknown;
    timestamp: Date;
}
export type FederationEventType = 'swarm_joined' | 'swarm_left' | 'swarm_degraded' | 'agent_spawned' | 'agent_completed' | 'agent_failed' | 'agent_expired' | 'message_sent' | 'message_received' | 'consensus_started' | 'consensus_completed' | 'federation_synced';
export declare class FederationHub extends EventEmitter {
    private config;
    private swarms;
    private ephemeralAgents;
    private messages;
    private proposals;
    private syncInterval?;
    private cleanupInterval?;
    private startTime;
    private stats;
    /** Index: swarmId -> Set of agentIds */
    private agentsBySwarm;
    /** Index: status -> Set of agentIds */
    private agentsByStatus;
    constructor(config?: FederationConfig);
    /**
     * Add agent to indexes - O(1)
     */
    private addAgentToIndexes;
    /**
     * Remove agent from indexes - O(1)
     */
    private removeAgentFromIndexes;
    /**
     * Update agent status in index - O(1)
     */
    private updateAgentStatusIndex;
    /**
     * Get agents by swarm using index - O(k) where k is agents in swarm
     */
    private getAgentIdsBySwarm;
    /**
     * Get agents by status using index - O(k) where k is agents with status
     */
    private getAgentIdsByStatus;
    /**
     * Initialize the federation hub
     */
    initialize(): Promise<void>;
    /**
     * Shutdown the federation hub
     */
    shutdown(): Promise<void>;
    /**
     * Register a swarm with the federation
     */
    registerSwarm(registration: Omit<SwarmRegistration, 'registeredAt' | 'lastHeartbeat'>): void;
    /**
     * Unregister a swarm from the federation
     */
    unregisterSwarm(swarmId: SwarmId): boolean;
    /**
     * Update swarm heartbeat
     */
    heartbeat(swarmId: SwarmId, currentAgents?: number): boolean;
    /**
     * Get all registered swarms
     */
    getSwarms(): SwarmRegistration[];
    /**
     * Get swarm by ID
     */
    getSwarm(swarmId: SwarmId): SwarmRegistration | undefined;
    /**
     * Spawn an ephemeral agent
     */
    spawnEphemeralAgent(options: SpawnEphemeralOptions): Promise<SpawnResult>;
    /**
     * Complete an ephemeral agent's task
     */
    completeAgent(agentId: EphemeralAgentId, result?: unknown): boolean;
    /**
     * Terminate an ephemeral agent
     */
    terminateAgent(agentId: EphemeralAgentId, error?: Error): Promise<boolean>;
    /**
     * Get ephemeral agent by ID
     */
    getAgent(agentId: EphemeralAgentId): EphemeralAgent | undefined;
    /**
     * Get all ephemeral agents
     */
    getAgents(swarmId?: SwarmId): EphemeralAgent[];
    /**
     * Get active ephemeral agents
     */
    getActiveAgents(swarmId?: SwarmId): EphemeralAgent[];
    /**
     * Send a message to another swarm
     */
    sendMessage(sourceSwarmId: SwarmId, targetSwarmId: SwarmId, payload: unknown): Promise<boolean>;
    /**
     * Broadcast a message to all swarms
     */
    broadcast(sourceSwarmId: SwarmId, payload: unknown): Promise<number>;
    /**
     * Get recent messages
     */
    getMessages(limit?: number): FederationMessage[];
    /**
     * Propose a value for federation-wide consensus
     */
    propose(proposerId: SwarmId, type: string, value: unknown, timeoutMs?: number): Promise<ConsensusProposal>;
    /**
     * Vote on a proposal
     */
    vote(swarmId: SwarmId, proposalId: string, approve: boolean): boolean;
    /**
     * Get proposal by ID
     */
    getProposal(proposalId: string): ConsensusProposal | undefined;
    /**
     * Get all pending proposals
     */
    getPendingProposals(): ConsensusProposal[];
    /**
     * Get federation statistics
     */
    getStats(): FederationStats;
    private selectOptimalSwarm;
    private getSwarmAgentCount;
    private getActiveSwarmCount;
    private waitForAgentCompletion;
    private syncFederation;
    private cleanupExpiredAgents;
    private emitEvent;
}
/**
 * Create a new Federation Hub instance
 */
export declare function createFederationHub(config?: FederationConfig): FederationHub;
/**
 * Get or create the default federation hub
 */
export declare function getDefaultFederationHub(): FederationHub;
/**
 * Reset the default federation hub
 */
export declare function resetDefaultFederationHub(): Promise<void>;
//# sourceMappingURL=federation-hub.d.ts.map