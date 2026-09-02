/**
 * Claude Flow V3 Main Index
 *
 * Exports all public APIs for the V3 modular architecture.
 */

// Shared Types
export * from './shared/types';

// Domain Entities
export { Agent } from './agent-lifecycle/domain/Agent';
export { Task } from './task-execution/domain/Task';
export { MemoryEntity, type Memory } from './memory/domain/Memory';

// Application Services
export { SwarmCoordinator, type SwarmCoordinatorOptions } from './coordination/application/SwarmCoordinator';
export { WorkflowEngine, type WorkflowEngineOptions } from './task-execution/application/WorkflowEngine';

// Memory Infrastructure
export { HybridBackend } from './memory/infrastructure/HybridBackend';
export { SQLiteBackend } from './memory/infrastructure/SQLiteBackend';
export { AgentDBBackend } from './memory/infrastructure/AgentDBBackend';

// Plugin Infrastructure
export { PluginManager, type PluginManagerOptions } from './infrastructure/plugins/PluginManager';
export { BasePlugin, type Plugin, type ExtensionPoint } from './infrastructure/plugins/Plugin';

// MCP Infrastructure
export { MCPServer } from './infrastructure/mcp/MCPServer';
export { AgentTools } from './infrastructure/mcp/tools/AgentTools';
export { MemoryTools } from './infrastructure/mcp/tools/MemoryTools';
export { ConfigTools } from './infrastructure/mcp/tools/ConfigTools';
