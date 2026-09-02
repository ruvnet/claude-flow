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
// ============================================================================
// Default Configuration
// ============================================================================
const DEFAULT_CONFIG = {
    federationId: `federation_${Date.now()}`,
    maxEphemeralAgents: 100,
    defaultTTL: 300000, // 5 minutes
    syncIntervalMs: 30000, // 30 seconds
    autoCleanup: true,
    cleanupIntervalMs: 60000, // 1 minute
    communicationTimeoutMs: 5000,
    enableConsensus: true,
    consensusQuorum: 0.66,
};
// ============================================================================
// Federation Hub Implementation
// ============================================================================
export class FederationHub extends EventEmitter {
    config;
    swarms = new Map();
    ephemeralAgents = new Map();
    messages = [];
    proposals = new Map();
    syncInterval;
    cleanupInterval;
    startTime;
    stats;
    // ============================================================================
    // Secondary Indexes for O(1) Lookups (Performance Optimization)
    // ============================================================================
    /** Index: swarmId -> Set of agentIds */
    agentsBySwarm = new Map();
    /** Index: status -> Set of agentIds */
    agentsByStatus = new Map();
    constructor(config) {
        super();
        this.config = { ...DEFAULT_CONFIG, ...config };
        this.startTime = new Date();
        this.stats = {
            messagesExchanged: 0,
            consensusProposals: 0,
            completedAgents: 0,
            failedAgents: 0,
            totalAgentLifespanMs: 0,
        };
        // Initialize status index sets
        this.agentsByStatus.set('spawning', new Set());
        this.agentsByStatus.set('active', new Set());
        this.agentsByStatus.set('completing', new Set());
        this.agentsByStatus.set('terminated', new Set());
    }
    // ==========================================================================
    // Index Maintenance Helpers
    // ==========================================================================
    /**
     * Add agent to indexes - O(1)
     */
    addAgentToIndexes(agent) {
        // Add to swarm index
        if (!this.agentsBySwarm.has(agent.swarmId)) {
            this.agentsBySwarm.set(agent.swarmId, new Set());
        }
        this.agentsBySwarm.get(agent.swarmId).add(agent.id);
        // Add to status index
        this.agentsByStatus.get(agent.status).add(agent.id);
    }
    /**
     * Remove agent from indexes - O(1)
     */
    removeAgentFromIndexes(agent) {
        // Remove from swarm index
        const swarmSet = this.agentsBySwarm.get(agent.swarmId);
        if (swarmSet) {
            swarmSet.delete(agent.id);
            if (swarmSet.size === 0) {
                this.agentsBySwarm.delete(agent.swarmId);
            }
        }
        // Remove from status index
        this.agentsByStatus.get(agent.status)?.delete(agent.id);
    }
    /**
     * Update agent status in index - O(1)
     */
    updateAgentStatusIndex(agent, oldStatus) {
        this.agentsByStatus.get(oldStatus)?.delete(agent.id);
        this.agentsByStatus.get(agent.status).add(agent.id);
    }
    /**
     * Get agents by swarm using index - O(k) where k is agents in swarm
     */
    getAgentIdsBySwarm(swarmId) {
        const agentIds = this.agentsBySwarm.get(swarmId);
        return agentIds ? Array.from(agentIds) : [];
    }
    /**
     * Get agents by status using index - O(k) where k is agents with status
     */
    getAgentIdsByStatus(status) {
        const agentIds = this.agentsByStatus.get(status);
        return agentIds ? Array.from(agentIds) : [];
    }
    // ==========================================================================
    // Lifecycle
    // ==========================================================================
    /**
     * Initialize the federation hub
     */
    async initialize() {
        // Start sync interval
        this.syncInterval = setInterval(() => this.syncFederation(), this.config.syncIntervalMs);
        // Start cleanup interval if enabled
        if (this.config.autoCleanup) {
            this.cleanupInterval = setInterval(() => this.cleanupExpiredAgents(), this.config.cleanupIntervalMs);
        }
        this.emitEvent('federation_synced');
    }
    /**
     * Shutdown the federation hub
     */
    async shutdown() {
        if (this.syncInterval) {
            clearInterval(this.syncInterval);
        }
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        // Terminate all active ephemeral agents using index - O(k) where k = active + spawning
        const activeIds = this.getAgentIdsByStatus('active');
        const spawningIds = this.getAgentIdsByStatus('spawning');
        const toTerminate = [...activeIds, ...spawningIds];
        await Promise.all(toTerminate.map(id => this.terminateAgent(id)));
        // Clear all data structures and indexes
        this.swarms.clear();
        this.ephemeralAgents.clear();
        this.proposals.clear();
        this.agentsBySwarm.clear();
        for (const status of this.agentsByStatus.values()) {
            status.clear();
        }
    }
    // ==========================================================================
    // Swarm Registration
    // ==========================================================================
    /**
     * Register a swarm with the federation
     */
    registerSwarm(registration) {
        const fullRegistration = {
            ...registration,
            registeredAt: new Date(),
            lastHeartbeat: new Date(),
        };
        this.swarms.set(registration.swarmId, fullRegistration);
        this.emitEvent('swarm_joined', registration.swarmId);
    }
    /**
     * Unregister a swarm from the federation
     */
    unregisterSwarm(swarmId) {
        const removed = this.swarms.delete(swarmId);
        if (removed) {
            // Terminate all ephemeral agents in this swarm using index - O(k)
            const agentIds = this.getAgentIdsBySwarm(swarmId);
            for (const agentId of agentIds) {
                this.terminateAgent(agentId);
            }
            this.emitEvent('swarm_left', swarmId);
        }
        return removed;
    }
    /**
     * Update swarm heartbeat
     */
    heartbeat(swarmId, currentAgents) {
        const swarm = this.swarms.get(swarmId);
        if (!swarm)
            return false;
        swarm.lastHeartbeat = new Date();
        if (currentAgents !== undefined) {
            swarm.currentAgents = currentAgents;
        }
        if (swarm.status === 'inactive') {
            swarm.status = 'active';
        }
        return true;
    }
    /**
     * Get all registered swarms
     */
    getSwarms() {
        return Array.from(this.swarms.values());
    }
    /**
     * Get swarm by ID
     */
    getSwarm(swarmId) {
        return this.swarms.get(swarmId);
    }
    // ==========================================================================
    // Ephemeral Agent Management
    // ==========================================================================
    /**
     * Spawn an ephemeral agent
     */
    async spawnEphemeralAgent(options) {
        // Select target swarm
        const targetSwarmId = options.swarmId || this.selectOptimalSwarm(options);
        if (!targetSwarmId) {
            return {
                agentId: '',
                swarmId: '',
                status: 'failed',
                estimatedTTL: 0,
                error: 'No suitable swarm available',
            };
        }
        const swarm = this.swarms.get(targetSwarmId);
        if (!swarm) {
            return {
                agentId: '',
                swarmId: targetSwarmId,
                status: 'failed',
                estimatedTTL: 0,
                error: 'Swarm not found',
            };
        }
        // Check capacity
        const swarmAgentCount = this.getSwarmAgentCount(targetSwarmId);
        if (swarmAgentCount >= this.config.maxEphemeralAgents) {
            return {
                agentId: '',
                swarmId: targetSwarmId,
                status: 'failed',
                estimatedTTL: 0,
                error: 'Swarm at capacity',
            };
        }
        // Create ephemeral agent
        const ttl = options.ttl || this.config.defaultTTL;
        const agentId = `ephemeral_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const now = new Date();
        const agent = {
            id: agentId,
            swarmId: targetSwarmId,
            type: options.type,
            task: options.task,
            status: 'spawning',
            ttl,
            createdAt: now,
            expiresAt: new Date(now.getTime() + ttl),
            metadata: options.metadata,
        };
        this.ephemeralAgents.set(agentId, agent);
        this.addAgentToIndexes(agent);
        // Simulate spawn (in real implementation, this would call the swarm coordinator)
        setTimeout(() => {
            const a = this.ephemeralAgents.get(agentId);
            if (a && a.status === 'spawning') {
                this.updateAgentStatusIndex(a, 'spawning');
                a.status = 'active';
                this.emitEvent('agent_spawned', targetSwarmId, agentId);
            }
        }, 50);
        // If waiting for completion
        if (options.waitForCompletion) {
            const timeout = options.completionTimeout || ttl;
            const result = await this.waitForAgentCompletion(agentId, timeout);
            return {
                agentId,
                swarmId: targetSwarmId,
                status: result ? 'spawned' : 'failed',
                estimatedTTL: ttl,
                result: result?.result,
                error: result?.error?.message,
            };
        }
        return {
            agentId,
            swarmId: targetSwarmId,
            status: 'spawned',
            estimatedTTL: ttl,
        };
    }
    /**
     * Complete an ephemeral agent's task
     */
    completeAgent(agentId, result) {
        const agent = this.ephemeralAgents.get(agentId);
        if (!agent)
            return false;
        const oldStatus = agent.status;
        agent.status = 'completing';
        this.updateAgentStatusIndex(agent, oldStatus);
        agent.result = result;
        agent.completedAt = new Date();
        const lifespan = agent.completedAt.getTime() - agent.createdAt.getTime();
        this.stats.completedAgents++;
        this.stats.totalAgentLifespanMs += lifespan;
        // Mark as terminated after a brief delay
        setTimeout(() => {
            const a = this.ephemeralAgents.get(agentId);
            if (a) {
                this.updateAgentStatusIndex(a, 'completing');
                a.status = 'terminated';
                this.emitEvent('agent_completed', a.swarmId, agentId);
            }
        }, 100);
        return true;
    }
    /**
     * Terminate an ephemeral agent
     */
    async terminateAgent(agentId, error) {
        const agent = this.ephemeralAgents.get(agentId);
        if (!agent)
            return false;
        const oldStatus = agent.status;
        agent.status = 'terminated';
        this.updateAgentStatusIndex(agent, oldStatus);
        agent.completedAt = new Date();
        if (error) {
            agent.error = error;
            this.stats.failedAgents++;
            this.emitEvent('agent_failed', agent.swarmId, agentId);
        }
        else {
            this.stats.completedAgents++;
            this.emitEvent('agent_completed', agent.swarmId, agentId);
        }
        const lifespan = agent.completedAt.getTime() - agent.createdAt.getTime();
        this.stats.totalAgentLifespanMs += lifespan;
        return true;
    }
    /**
     * Get ephemeral agent by ID
     */
    getAgent(agentId) {
        return this.ephemeralAgents.get(agentId);
    }
    /**
     * Get all ephemeral agents
     */
    getAgents(swarmId) {
        const agents = Array.from(this.ephemeralAgents.values());
        return swarmId ? agents.filter(a => a.swarmId === swarmId) : agents;
    }
    /**
     * Get active ephemeral agents
     */
    getActiveAgents(swarmId) {
        return this.getAgents(swarmId).filter(a => a.status === 'active' || a.status === 'spawning');
    }
    // ==========================================================================
    // Cross-Swarm Communication
    // ==========================================================================
    /**
     * Send a message to another swarm
     */
    async sendMessage(sourceSwarmId, targetSwarmId, payload) {
        const targetSwarm = this.swarms.get(targetSwarmId);
        if (!targetSwarm || targetSwarm.status === 'inactive') {
            return false;
        }
        const message = {
            id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            type: 'direct',
            sourceSwarmId,
            targetSwarmId,
            payload,
            timestamp: new Date(),
        };
        this.messages.push(message);
        this.stats.messagesExchanged++;
        this.emitEvent('message_sent', sourceSwarmId);
        // In real implementation, this would send to the target swarm's endpoint
        // For now, we emit an event that can be listened to
        this.emit('message', message);
        return true;
    }
    /**
     * Broadcast a message to all swarms
     */
    async broadcast(sourceSwarmId, payload) {
        let sent = 0;
        for (const swarm of this.swarms.values()) {
            if (swarm.swarmId !== sourceSwarmId && swarm.status === 'active') {
                const success = await this.sendMessage(sourceSwarmId, swarm.swarmId, payload);
                if (success)
                    sent++;
            }
        }
        return sent;
    }
    /**
     * Get recent messages
     */
    getMessages(limit = 100) {
        return this.messages.slice(-limit);
    }
    // ==========================================================================
    // Federation Consensus
    // ==========================================================================
    /**
     * Propose a value for federation-wide consensus
     */
    async propose(proposerId, type, value, timeoutMs = 30000) {
        if (!this.config.enableConsensus) {
            throw new Error('Consensus is disabled');
        }
        const proposal = {
            id: `proposal_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            proposerId,
            type,
            value,
            votes: new Map([[proposerId, true]]),
            status: 'pending',
            createdAt: new Date(),
            expiresAt: new Date(Date.now() + timeoutMs),
        };
        this.proposals.set(proposal.id, proposal);
        this.stats.consensusProposals++;
        this.emitEvent('consensus_started', proposerId);
        // Request votes from all active swarms
        await this.broadcast(proposerId, {
            type: 'vote_request',
            proposalId: proposal.id,
            proposalType: type,
            value,
        });
        return proposal;
    }
    /**
     * Vote on a proposal
     */
    vote(swarmId, proposalId, approve) {
        const proposal = this.proposals.get(proposalId);
        if (!proposal || proposal.status !== 'pending') {
            return false;
        }
        if (new Date() > proposal.expiresAt) {
            proposal.status = 'rejected';
            return false;
        }
        proposal.votes.set(swarmId, approve);
        // Check if quorum reached
        const activeSwarms = this.getActiveSwarmCount();
        const approvals = Array.from(proposal.votes.values()).filter(v => v).length;
        const rejections = Array.from(proposal.votes.values()).filter(v => !v).length;
        const quorumThreshold = Math.ceil(activeSwarms * this.config.consensusQuorum);
        if (approvals >= quorumThreshold) {
            proposal.status = 'accepted';
            this.emitEvent('consensus_completed', proposal.proposerId);
        }
        else if (rejections > activeSwarms - quorumThreshold) {
            proposal.status = 'rejected';
            this.emitEvent('consensus_completed', proposal.proposerId);
        }
        return true;
    }
    /**
     * Get proposal by ID
     */
    getProposal(proposalId) {
        return this.proposals.get(proposalId);
    }
    /**
     * Get all pending proposals
     */
    getPendingProposals() {
        return Array.from(this.proposals.values()).filter(p => p.status === 'pending');
    }
    // ==========================================================================
    // Statistics & Monitoring
    // ==========================================================================
    /**
     * Get federation statistics
     */
    getStats() {
        const activeAgents = this.getActiveAgents().length;
        const avgLifespan = this.stats.completedAgents > 0
            ? this.stats.totalAgentLifespanMs / this.stats.completedAgents
            : 0;
        return {
            federationId: this.config.federationId,
            totalSwarms: this.swarms.size,
            activeSwarms: this.getActiveSwarmCount(),
            totalEphemeralAgents: this.ephemeralAgents.size,
            activeEphemeralAgents: activeAgents,
            completedAgents: this.stats.completedAgents,
            failedAgents: this.stats.failedAgents,
            avgAgentLifespanMs: avgLifespan,
            messagesExchanged: this.stats.messagesExchanged,
            consensusProposals: this.stats.consensusProposals,
            uptime: Date.now() - this.startTime.getTime(),
        };
    }
    // ==========================================================================
    // Private Helpers
    // ==========================================================================
    selectOptimalSwarm(options) {
        const candidates = [];
        for (const swarm of this.swarms.values()) {
            if (swarm.status !== 'active')
                continue;
            // Check capacity
            const agentCount = this.getSwarmAgentCount(swarm.swarmId);
            if (agentCount >= swarm.maxAgents)
                continue;
            // Check capabilities
            if (options.capabilities) {
                const hasAllCapabilities = options.capabilities.every(cap => swarm.capabilities.includes(cap));
                if (!hasAllCapabilities)
                    continue;
            }
            // Calculate score (higher is better)
            let score = 100;
            // Prefer swarms with more available capacity
            const availableCapacity = swarm.maxAgents - agentCount;
            score += availableCapacity * 5;
            // Prefer recently active swarms
            const lastHeartbeatAge = Date.now() - swarm.lastHeartbeat.getTime();
            score -= lastHeartbeatAge / 10000;
            candidates.push({ swarmId: swarm.swarmId, score });
        }
        if (candidates.length === 0)
            return null;
        // Sort by score and return best
        candidates.sort((a, b) => b.score - a.score);
        return candidates[0].swarmId;
    }
    getSwarmAgentCount(swarmId) {
        // Use index for O(1) lookup instead of O(n) filter
        const swarmAgents = this.agentsBySwarm.get(swarmId);
        if (!swarmAgents)
            return 0;
        // Count only active and spawning agents
        let count = 0;
        for (const agentId of swarmAgents) {
            const agent = this.ephemeralAgents.get(agentId);
            if (agent && (agent.status === 'active' || agent.status === 'spawning')) {
                count++;
            }
        }
        return count;
    }
    getActiveSwarmCount() {
        return Array.from(this.swarms.values()).filter(s => s.status === 'active').length;
    }
    async waitForAgentCompletion(agentId, timeout) {
        return new Promise((resolve) => {
            const startTime = Date.now();
            const check = () => {
                const agent = this.ephemeralAgents.get(agentId);
                if (!agent) {
                    resolve(null);
                    return;
                }
                if (agent.status === 'terminated' || agent.status === 'completing') {
                    resolve(agent);
                    return;
                }
                if (Date.now() - startTime > timeout) {
                    resolve(null);
                    return;
                }
                setTimeout(check, 100);
            };
            check();
        });
    }
    syncFederation() {
        const now = new Date();
        const heartbeatTimeout = this.config.syncIntervalMs * 3;
        // Check for inactive swarms
        for (const swarm of this.swarms.values()) {
            const age = now.getTime() - swarm.lastHeartbeat.getTime();
            if (age > heartbeatTimeout && swarm.status === 'active') {
                swarm.status = 'degraded';
                this.emitEvent('swarm_degraded', swarm.swarmId);
            }
            else if (age > heartbeatTimeout * 2 && swarm.status === 'degraded') {
                swarm.status = 'inactive';
            }
        }
        // Check for expired proposals
        for (const proposal of this.proposals.values()) {
            if (proposal.status === 'pending' && now > proposal.expiresAt) {
                proposal.status = 'rejected';
            }
        }
        this.emitEvent('federation_synced');
    }
    cleanupExpiredAgents() {
        const now = new Date();
        // Use status index to only check active agents - O(k) instead of O(n)
        const activeIds = this.getAgentIdsByStatus('active');
        for (const agentId of activeIds) {
            const agent = this.ephemeralAgents.get(agentId);
            if (agent && now > agent.expiresAt) {
                this.updateAgentStatusIndex(agent, 'active');
                agent.status = 'terminated';
                agent.completedAt = now;
                agent.error = new Error('Agent TTL expired');
                this.stats.failedAgents++;
                this.emitEvent('agent_expired', agent.swarmId, agent.id);
            }
        }
        // Clean up old terminated agents using index - O(k)
        const cleanupThreshold = 5 * 60 * 1000;
        const terminatedIds = this.getAgentIdsByStatus('terminated');
        for (const agentId of terminatedIds) {
            const agent = this.ephemeralAgents.get(agentId);
            if (agent &&
                agent.completedAt &&
                now.getTime() - agent.completedAt.getTime() > cleanupThreshold) {
                this.removeAgentFromIndexes(agent);
                this.ephemeralAgents.delete(agentId);
            }
        }
    }
    emitEvent(type, swarmId, agentId, data) {
        const event = {
            type,
            federationId: this.config.federationId,
            swarmId,
            agentId,
            data,
            timestamp: new Date(),
        };
        this.emit('event', event);
        this.emit(type, event);
    }
}
// ============================================================================
// Factory Functions
// ============================================================================
/**
 * Create a new Federation Hub instance
 */
export function createFederationHub(config) {
    return new FederationHub(config);
}
/**
 * Global federation hub instance
 */
let defaultFederationHub = null;
/**
 * Get or create the default federation hub
 */
export function getDefaultFederationHub() {
    if (!defaultFederationHub) {
        defaultFederationHub = createFederationHub();
    }
    return defaultFederationHub;
}
/**
 * Reset the default federation hub
 */
export async function resetDefaultFederationHub() {
    if (defaultFederationHub) {
        await defaultFederationHub.shutdown();
        defaultFederationHub = null;
    }
}
//# sourceMappingURL=federation-hub.js.map