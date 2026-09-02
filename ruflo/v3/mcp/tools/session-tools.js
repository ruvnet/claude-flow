/**
 * V3 MCP Session Tools
 *
 * MCP tools for session management:
 * - session/save - Save current session
 * - session/restore - Restore session
 * - session/list - List available sessions
 *
 * Implements ADR-005: MCP-First API Design
 */
import { z } from 'zod';
import { randomBytes, createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
// Secure ID generation helper
function generateSecureSessionId() {
    const timestamp = Date.now().toString(36);
    const random = randomBytes(12).toString('hex');
    return `session-${timestamp}-${random}`;
}
// Default session directory
const DEFAULT_SESSION_DIR = '.claude-flow/sessions';
// ============================================================================
// Input Schemas
// ============================================================================
const saveSessionSchema = z.object({
    name: z.string().min(1).max(100).optional()
        .describe('Session name (auto-generated if not provided)'),
    description: z.string().max(500).optional()
        .describe('Session description'),
    includeAgents: z.boolean().default(true)
        .describe('Include agent states in the session'),
    includeTasks: z.boolean().default(true)
        .describe('Include task queue in the session'),
    includeMemory: z.boolean().default(true)
        .describe('Include memory entries in the session'),
    includeSwarmState: z.boolean().default(true)
        .describe('Include swarm coordination state'),
    tags: z.array(z.string()).optional()
        .describe('Tags for categorizing the session'),
    metadata: z.record(z.unknown()).optional()
        .describe('Additional metadata'),
});
const restoreSessionSchema = z.object({
    sessionId: z.string().describe('ID of the session to restore'),
    restoreAgents: z.boolean().default(true)
        .describe('Restore agent states'),
    restoreTasks: z.boolean().default(true)
        .describe('Restore task queue'),
    restoreMemory: z.boolean().default(true)
        .describe('Restore memory entries'),
    restoreSwarmState: z.boolean().default(true)
        .describe('Restore swarm coordination state'),
    clearExisting: z.boolean().default(false)
        .describe('Clear existing state before restore'),
});
const listSessionsSchema = z.object({
    limit: z.number().int().positive().max(1000).default(50)
        .describe('Maximum number of sessions to return'),
    offset: z.number().int().nonnegative().default(0)
        .describe('Offset for pagination'),
    tags: z.array(z.string()).optional()
        .describe('Filter by tags'),
    sortBy: z.enum(['created', 'name', 'size']).default('created')
        .describe('Sort order'),
    sortOrder: z.enum(['asc', 'desc']).default('desc')
        .describe('Sort direction'),
    includeMetadata: z.boolean().default(true)
        .describe('Include session metadata'),
});
// ============================================================================
// In-memory session store (for simple implementation)
// ============================================================================
const sessionStore = new Map();
// ============================================================================
// Helper Functions
// ============================================================================
/**
 * Calculate secure checksum for session data using SHA-256
 */
function calculateChecksum(data) {
    return createHash('sha256').update(data).digest('hex');
}
/**
 * Validate session ID to prevent path traversal attacks
 * Only allows alphanumeric characters, hyphens, and underscores
 */
function validateSessionId(sessionId) {
    // Must be non-empty and match safe pattern
    const safePattern = /^[a-zA-Z0-9_-]+$/;
    if (!sessionId || !safePattern.test(sessionId)) {
        return false;
    }
    // Additional checks for path traversal patterns
    if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
        return false;
    }
    // Limit length to prevent excessive file names
    if (sessionId.length > 128) {
        return false;
    }
    return true;
}
/**
 * Get session file path with security validation
 */
function getSessionPath(sessionId) {
    if (!validateSessionId(sessionId)) {
        throw new Error('Invalid session ID: must contain only alphanumeric characters, hyphens, and underscores');
    }
    const sessionDir = path.join(process.cwd(), DEFAULT_SESSION_DIR);
    const sessionPath = path.join(sessionDir, `${sessionId}.json`);
    // Ensure the resolved path is within the session directory (defense in depth)
    const resolvedPath = path.resolve(sessionPath);
    const resolvedDir = path.resolve(sessionDir);
    if (!resolvedPath.startsWith(resolvedDir + path.sep)) {
        throw new Error('Invalid session ID: path traversal detected');
    }
    return sessionPath;
}
/**
 * Ensure session directory exists
 */
async function ensureSessionDir() {
    const dir = path.join(process.cwd(), DEFAULT_SESSION_DIR);
    await fs.mkdir(dir, { recursive: true });
}
// ============================================================================
// Tool Handlers
// ============================================================================
/**
 * Save current session
 */
async function handleSaveSession(input, context) {
    const sessionId = generateSecureSessionId();
    const savedAt = new Date().toISOString();
    const name = input.name || `Session ${new Date().toLocaleDateString()}`;
    const sessionData = {
        id: sessionId,
        name,
        description: input.description,
        version: '3.0.0',
        createdAt: savedAt,
        tags: input.tags,
        metadata: input.metadata,
    };
    // Collect agent states
    if (input.includeAgents && context?.swarmCoordinator) {
        try {
            const coordinator = context.swarmCoordinator;
            const status = await coordinator.getStatus();
            sessionData.agents = (status.agents || []).map((agent) => ({
                id: agent.id,
                type: agent.type,
                status: agent.status,
                config: agent.config,
                metadata: agent.metadata,
            }));
        }
        catch (error) {
            console.error('Failed to collect agent states:', error);
            sessionData.agents = [];
        }
    }
    // Collect task queue
    if (input.includeTasks && context?.orchestrator) {
        try {
            const orchestrator = context.orchestrator;
            const tasks = await orchestrator.listTasks({ limit: 10000 });
            sessionData.tasks = tasks.tasks.map((task) => ({
                id: task.id,
                type: task.type,
                description: task.description,
                status: task.status,
                priority: task.priority,
                dependencies: task.dependencies || [],
                assignedTo: task.assignedAgent,
                input: task.input,
                metadata: task.metadata,
            }));
        }
        catch (error) {
            console.error('Failed to collect task queue:', error);
            sessionData.tasks = [];
        }
    }
    // Collect memory entries
    if (input.includeMemory) {
        const resourceManager = context?.resourceManager;
        if (resourceManager?.memoryService) {
            try {
                const memoryService = resourceManager.memoryService;
                const entries = await memoryService.query({ limit: 10000 });
                sessionData.memory = entries.map((entry) => ({
                    id: entry.id,
                    content: entry.content,
                    type: entry.type,
                    category: entry.namespace,
                    tags: entry.tags,
                    importance: entry.metadata?.importance,
                    metadata: entry.metadata,
                }));
            }
            catch (error) {
                console.error('Failed to collect memory entries:', error);
                sessionData.memory = [];
            }
        }
    }
    // Collect swarm state
    if (input.includeSwarmState && context?.swarmCoordinator) {
        try {
            const coordinator = context.swarmCoordinator;
            const status = await coordinator.getStatus();
            sessionData.swarmState = {
                topology: status.topology?.type || 'hierarchical-mesh',
                agents: status.agents?.length || 0,
                connections: status.topology?.edges || [],
                consensus: status.consensus,
            };
        }
        catch (error) {
            console.error('Failed to collect swarm state:', error);
        }
    }
    // Calculate checksum
    const dataStr = JSON.stringify(sessionData);
    sessionData.checksum = calculateChecksum(dataStr);
    // Save to store
    sessionStore.set(sessionId, sessionData);
    // Try to persist to file
    let filePath;
    try {
        await ensureSessionDir();
        filePath = getSessionPath(sessionId);
        await fs.writeFile(filePath, JSON.stringify(sessionData, null, 2), 'utf-8');
    }
    catch (error) {
        console.error('Failed to persist session to file:', error);
    }
    return {
        sessionId,
        name,
        savedAt,
        size: dataStr.length,
        agentCount: sessionData.agents?.length,
        taskCount: sessionData.tasks?.length,
        memoryCount: sessionData.memory?.length,
        path: filePath,
    };
}
/**
 * Restore session
 */
async function handleRestoreSession(input, context) {
    const restoredAt = new Date().toISOString();
    const errors = [];
    const restored = {
        agents: 0,
        tasks: 0,
        memory: 0,
        swarmState: false,
    };
    // Try to load from store or file
    let sessionData = sessionStore.get(input.sessionId);
    if (!sessionData) {
        try {
            const filePath = getSessionPath(input.sessionId);
            const fileContent = await fs.readFile(filePath, 'utf-8');
            sessionData = JSON.parse(fileContent);
            // Verify checksum
            const { checksum, ...dataWithoutChecksum } = sessionData;
            const calculatedChecksum = calculateChecksum(JSON.stringify(dataWithoutChecksum));
            if (checksum && checksum !== calculatedChecksum) {
                errors.push('Session checksum mismatch - data may be corrupted');
            }
        }
        catch (error) {
            throw new Error(`Session not found: ${input.sessionId}`);
        }
    }
    // Clear existing state if requested
    if (input.clearExisting) {
        if (context?.swarmCoordinator) {
            try {
                const coordinator = context.swarmCoordinator;
                if (coordinator.terminateAll) {
                    await coordinator.terminateAll();
                }
            }
            catch (error) {
                errors.push('Failed to clear existing agents');
            }
        }
        if (context?.orchestrator) {
            try {
                const orchestrator = context.orchestrator;
                if (orchestrator.cancelAll) {
                    await orchestrator.cancelAll();
                }
            }
            catch (error) {
                errors.push('Failed to clear existing tasks');
            }
        }
    }
    // Restore agents
    if (input.restoreAgents && sessionData.agents && context?.swarmCoordinator) {
        try {
            const coordinator = context.swarmCoordinator;
            for (const agent of sessionData.agents) {
                try {
                    await coordinator.spawnAgent({
                        id: agent.id,
                        type: agent.type,
                        config: agent.config,
                        metadata: agent.metadata,
                    });
                    restored.agents++;
                }
                catch (error) {
                    errors.push(`Failed to restore agent ${agent.id}`);
                }
            }
        }
        catch (error) {
            errors.push('Failed to restore agents: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
    // Restore tasks
    if (input.restoreTasks && sessionData.tasks && context?.orchestrator) {
        try {
            const orchestrator = context.orchestrator;
            for (const task of sessionData.tasks) {
                // Only restore pending/queued tasks
                if (task.status === 'pending' || task.status === 'queued' || task.status === 'assigned') {
                    try {
                        await orchestrator.submitTask({
                            id: task.id,
                            type: task.type,
                            description: task.description,
                            priority: task.priority,
                            dependencies: task.dependencies,
                            assignedAgent: task.assignedTo,
                            input: task.input,
                            metadata: task.metadata,
                        });
                        restored.tasks++;
                    }
                    catch (error) {
                        errors.push(`Failed to restore task ${task.id}`);
                    }
                }
            }
        }
        catch (error) {
            errors.push('Failed to restore tasks: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
    // Restore memory
    if (input.restoreMemory && sessionData.memory) {
        const resourceManager = context?.resourceManager;
        if (resourceManager?.memoryService) {
            try {
                const memoryService = resourceManager.memoryService;
                for (const entry of sessionData.memory) {
                    try {
                        await memoryService.storeEntry({
                            namespace: entry.category || 'default',
                            key: entry.id,
                            content: entry.content,
                            type: entry.type,
                            tags: entry.tags || [],
                            metadata: {
                                ...entry.metadata,
                                importance: entry.importance,
                                restoredFrom: input.sessionId,
                            },
                        });
                        restored.memory++;
                    }
                    catch (error) {
                        errors.push(`Failed to restore memory entry ${entry.id}`);
                    }
                }
            }
            catch (error) {
                errors.push('Failed to restore memory: ' + (error instanceof Error ? error.message : 'Unknown error'));
            }
        }
    }
    // Restore swarm state
    if (input.restoreSwarmState && sessionData.swarmState && context?.swarmCoordinator) {
        try {
            const coordinator = context.swarmCoordinator;
            if (coordinator.setTopology) {
                await coordinator.setTopology({
                    type: sessionData.swarmState.topology,
                    connections: sessionData.swarmState.connections,
                });
                restored.swarmState = true;
            }
        }
        catch (error) {
            errors.push('Failed to restore swarm state: ' + (error instanceof Error ? error.message : 'Unknown error'));
        }
    }
    return {
        sessionId: input.sessionId,
        restoredAt,
        success: errors.length === 0,
        restored,
        errors: errors.length > 0 ? errors : undefined,
    };
}
/**
 * List available sessions
 */
async function handleListSessions(input, context) {
    const sessions = [];
    // Collect sessions from store
    for (const [id, data] of Array.from(sessionStore.entries())) {
        sessions.push({
            id,
            name: data.name,
            description: data.description,
            createdAt: data.createdAt,
            size: JSON.stringify(data).length,
            agentCount: data.agents?.length || 0,
            taskCount: data.tasks?.length || 0,
            memoryCount: data.memory?.length || 0,
            tags: data.tags,
            metadata: input.includeMetadata ? data.metadata : undefined,
        });
    }
    // Try to load sessions from file system
    try {
        const dir = path.join(process.cwd(), DEFAULT_SESSION_DIR);
        const files = await fs.readdir(dir);
        for (const file of files) {
            if (!file.endsWith('.json'))
                continue;
            const sessionId = file.replace('.json', '');
            if (sessionStore.has(sessionId))
                continue; // Already loaded
            try {
                const filePath = path.join(dir, file);
                const stat = await fs.stat(filePath);
                const content = await fs.readFile(filePath, 'utf-8');
                const data = JSON.parse(content);
                sessions.push({
                    id: data.id,
                    name: data.name,
                    description: data.description,
                    createdAt: data.createdAt,
                    size: stat.size,
                    agentCount: data.agents?.length || 0,
                    taskCount: data.tasks?.length || 0,
                    memoryCount: data.memory?.length || 0,
                    tags: data.tags,
                    metadata: input.includeMetadata ? data.metadata : undefined,
                });
            }
            catch (error) {
                // Skip invalid session files
                console.error(`Failed to read session file ${file}:`, error);
            }
        }
    }
    catch (error) {
        // Session directory may not exist
    }
    // Apply tag filter
    let filteredSessions = sessions;
    if (input.tags && input.tags.length > 0) {
        filteredSessions = sessions.filter(s => input.tags.every(tag => s.tags?.includes(tag)));
    }
    // Apply sorting
    filteredSessions.sort((a, b) => {
        let aVal;
        let bVal;
        switch (input.sortBy) {
            case 'created':
                aVal = new Date(a.createdAt).getTime();
                bVal = new Date(b.createdAt).getTime();
                break;
            case 'name':
                aVal = a.name.toLowerCase();
                bVal = b.name.toLowerCase();
                break;
            case 'size':
                aVal = a.size;
                bVal = b.size;
                break;
            default:
                aVal = 0;
                bVal = 0;
        }
        if (input.sortOrder === 'asc') {
            return aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
        }
        else {
            return aVal > bVal ? -1 : aVal < bVal ? 1 : 0;
        }
    });
    const total = filteredSessions.length;
    const paginated = filteredSessions.slice(input.offset, input.offset + input.limit);
    return {
        sessions: paginated,
        total,
        limit: input.limit,
        offset: input.offset,
    };
}
// ============================================================================
// Tool Definitions
// ============================================================================
/**
 * session/save tool
 */
export const saveSessionTool = {
    name: 'session/save',
    description: 'Save current session including agents, tasks, memory, and swarm state',
    inputSchema: {
        type: 'object',
        properties: {
            name: {
                type: 'string',
                description: 'Session name (auto-generated if not provided)',
                maxLength: 100,
            },
            description: {
                type: 'string',
                description: 'Session description',
                maxLength: 500,
            },
            includeAgents: {
                type: 'boolean',
                description: 'Include agent states in the session',
                default: true,
            },
            includeTasks: {
                type: 'boolean',
                description: 'Include task queue in the session',
                default: true,
            },
            includeMemory: {
                type: 'boolean',
                description: 'Include memory entries in the session',
                default: true,
            },
            includeSwarmState: {
                type: 'boolean',
                description: 'Include swarm coordination state',
                default: true,
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Tags for categorizing the session',
            },
            metadata: {
                type: 'object',
                description: 'Additional metadata',
                additionalProperties: true,
            },
        },
    },
    handler: async (input, context) => {
        const validated = saveSessionSchema.parse(input);
        return handleSaveSession(validated, context);
    },
    category: 'session',
    tags: ['session', 'save', 'persistence'],
    version: '1.0.0',
};
/**
 * session/restore tool
 */
export const restoreSessionTool = {
    name: 'session/restore',
    description: 'Restore a previously saved session including agents, tasks, memory, and swarm state',
    inputSchema: {
        type: 'object',
        properties: {
            sessionId: {
                type: 'string',
                description: 'ID of the session to restore',
            },
            restoreAgents: {
                type: 'boolean',
                description: 'Restore agent states',
                default: true,
            },
            restoreTasks: {
                type: 'boolean',
                description: 'Restore task queue',
                default: true,
            },
            restoreMemory: {
                type: 'boolean',
                description: 'Restore memory entries',
                default: true,
            },
            restoreSwarmState: {
                type: 'boolean',
                description: 'Restore swarm coordination state',
                default: true,
            },
            clearExisting: {
                type: 'boolean',
                description: 'Clear existing state before restore',
                default: false,
            },
        },
        required: ['sessionId'],
    },
    handler: async (input, context) => {
        const validated = restoreSessionSchema.parse(input);
        return handleRestoreSession(validated, context);
    },
    category: 'session',
    tags: ['session', 'restore', 'persistence'],
    version: '1.0.0',
};
/**
 * session/list tool
 */
export const listSessionsTool = {
    name: 'session/list',
    description: 'List available sessions with filtering, sorting, and pagination',
    inputSchema: {
        type: 'object',
        properties: {
            limit: {
                type: 'number',
                description: 'Maximum number of sessions to return',
                minimum: 1,
                maximum: 1000,
                default: 50,
            },
            offset: {
                type: 'number',
                description: 'Offset for pagination',
                minimum: 0,
                default: 0,
            },
            tags: {
                type: 'array',
                items: { type: 'string' },
                description: 'Filter by tags',
            },
            sortBy: {
                type: 'string',
                enum: ['created', 'name', 'size'],
                description: 'Sort order',
                default: 'created',
            },
            sortOrder: {
                type: 'string',
                enum: ['asc', 'desc'],
                description: 'Sort direction',
                default: 'desc',
            },
            includeMetadata: {
                type: 'boolean',
                description: 'Include session metadata',
                default: true,
            },
        },
    },
    handler: async (input, context) => {
        const validated = listSessionsSchema.parse(input);
        return handleListSessions(validated, context);
    },
    category: 'session',
    tags: ['session', 'list', 'query'],
    version: '1.0.0',
    cacheable: true,
    cacheTTL: 5000,
};
// ============================================================================
// Exports
// ============================================================================
export const sessionTools = [
    saveSessionTool,
    restoreSessionTool,
    listSessionsTool,
];
export default sessionTools;
//# sourceMappingURL=session-tools.js.map