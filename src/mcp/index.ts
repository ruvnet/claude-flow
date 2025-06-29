/**
 * MCP (Model Context Protocol) Module
 * Export all MCP components for easy integration
 */

// Core MCP Server
export { MCPServer, type IMCPServer } from './server.js';

// Lifecycle Management
export { 
  MCPLifecycleManager, 
  LifecycleState,
  type LifecycleEvent,
  type HealthCheckResult,
  type LifecycleManagerConfig 
} from './lifecycle-manager.js';

// Tool Registry and Management
export { 
  ToolRegistry,
  type ToolCapability,
  type ToolMetrics,
  type ToolDiscoveryQuery 
} from './tools.js';

// Protocol Management
export { 
  MCPProtocolManager,
  type ProtocolVersionInfo,
  type CompatibilityResult,
  type NegotiationResult 
} from './protocol-manager.js';

// Authentication and Authorization
export { 
  AuthManager,
  type IAuthManager,
  type AuthContext,
  type AuthResult,
  type TokenInfo,
  type TokenGenerationOptions,
  type AuthSession,
  Permissions 
} from './auth.js';

// Performance Monitoring
export { 
  MCPPerformanceMonitor,
  type PerformanceMetrics,
  type RequestMetrics,
  type AlertRule,
  type Alert,
  type OptimizationSuggestion 
} from './performance-monitor.js';

// Orchestration Integration
export { 
  MCPOrchestrationIntegration,
  type OrchestrationComponents,
  type MCPOrchestrationConfig,
  type IntegrationStatus 
} from './orchestration-integration.js';

// Transport Implementations
export { type ITransport } from './transports/base.js';
export { StdioTransport } from './transports/stdio.js';
export { HttpTransport } from './transports/http.js';

// Request Routing
export { RequestRouter } from './router.js';

// Session Management
export { SessionManager, type ISessionManager } from './session-manager.js';

// Load Balancing
export { LoadBalancer, type ILoadBalancer, RequestQueue } from './load-balancer.js';

// Tool Implementations
export { createClaudeFlowTools, type ClaudeFlowToolContext } from './claude-flow-tools.js';
export { createSwarmTools, type SwarmToolContext } from './swarm-tools.js';

// Factory and Utilities
export { 
  MCPIntegrationFactory,
  DefaultMCPConfigs,
  MCPUtils
} from './mcp-factory.js';