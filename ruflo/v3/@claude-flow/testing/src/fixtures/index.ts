/**
 * V3 Claude-Flow Test Fixtures Index
 *
 * Central export for all test fixtures
 */

// Agent fixtures (comprehensive)
export * from './agent-fixtures.js';

// Memory fixtures (AgentDB, HNSW, ReasoningBank)
export * from './memory-fixtures.js';

// Swarm fixtures (topologies, coordination, consensus)
export * from './swarm-fixtures.js';

// MCP fixtures (tools, resources, prompts)
export * from './mcp-fixtures.js';

// Note: Legacy files (agents.js, tasks.js, memory-entries.js, configurations.js)
// are deprecated. Their contents have been merged into the comprehensive fixtures above.
// Import directly from the specific fixture files if needed.
